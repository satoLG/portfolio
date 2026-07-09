/**
 * PostProcess.ts — Full-screen post-processing pass.
 *
 * Combines two independent effects into a single shader pass:
 *   1. Underwater distortion — multi-frequency wave displacement (camera below water)
 *   2. Pixelation — grid-snapping for a retro look (user setting)
 *
 * renderScene() wraps the main renderer.render() call: it renders the scene
 * normally, then (if any effect is active) copies the framebuffer and draws
 * it back through the post-process shader.
 */

import {
    Mesh,
    PlaneGeometry,
    ShaderMaterial,
    OrthographicCamera,
    Scene as ThreeScene,
    WebGLRenderer,
    Vector2,
    Vector3,
    Vector4,
    Matrix4,
    Camera,
    PerspectiveCamera,
    MathUtils,
} from "three";
import { time } from "../core/Time";
import {
    distortionStrength, distortionSpeed, distortionScale, distortionEdgeFade,
    underwaterTintColor, underwaterTintStrength,
    underwaterLineDistance, underwaterLineHeightOffset, underwaterLineWobbleGain, underwaterLineEdge,
} from '../scene/config/OceanConfig';
import {
    sceneColorUniform,
    sceneResolutionUniform,
    captureSceneColor,
    waterlineYUniform,
    // Surface wave uniforms — shared by reference so the ocean line ripples in
    // phase with the rendered ocean surface (auto-synced with any GUI tweak).
    surfaceWaveLengthUniform,
    surfaceWaveSpeedUniform,
    surfaceWaveSteepnessUniform,
    waveVelocity1Uniform,
    waveVelocity2Uniform,
} from "../materials/OceanMaterial";
import { oceanWavePatternGLSL } from "../shaders/OceanShaders";

// ── Underwater constants ─────────────────────────────────────────────────────
export const UNDERWATER_Y_THRESHOLD = 0.0;
const DISTORTION_STRENGTH = distortionStrength;
const DISTORTION_SPEED    = distortionSpeed;
const DISTORTION_SCALE    = distortionScale;
const DISTORTION_EDGE_FADE = distortionEdgeFade;

// ── Internals ────────────────────────────────────────────────────────────────
const orthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadScene = new ThreeScene();

let material: ShaderMaterial | null = null;
let pixelSize = 0;
let fxaaEnabled = false;
let initialized = false;
let width = 1;
let height = 1;

// Scene-color FBT is now owned by OceanMaterial (the only other consumer) and
// shared with this module — saves ~58 MB of VRAM at retina resolutions vs. two
// viewport-sized textures. Ocean captures pre-ocean state for its refraction
// sampling; PostProcess re-captures the post-ocean+transparents state after
// renderer.render. The texture's content swaps within the frame but each
// consumer reads at the right moment.

// ── Shaders ──────────────────────────────────────────────────────────────────

const vertexShader = /* glsl */`
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

const fragmentShader = /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uDistortion;
    uniform float uSpeed;
    uniform float uScale;
    uniform float uEdgeFade;
    uniform float uPixelSize;
    uniform float uFxaa;        // 1.0 = enabled, 0.0 = disabled (when MSAA is on)
    uniform vec2 uResolution;
    uniform vec3 uTintColor;
    uniform float uTintStrength;

    // Distortion "quiet rects" — screen-space rectangles (UV min/max) where the
    // underwater wave displacement is damped to uQuietMul. Every CSS3D punch
    // surface needs one: the punched alpha holes must stay registered with the
    // static DOM behind the canvas, and full-strength distortion would shear
    // them apart (offset dark copies of the panel). Slot 0 = card carousel,
    // slots 1..2 = in-scene panels (media player / coin tooltip).
    #define QUIET_RECT_COUNT 3
    uniform vec4 uQuietRects[QUIET_RECT_COUNT];  // xy = min UV, zw = max UV
    uniform float uQuietOns[QUIET_RECT_COUNT];   // per-slot 1.0 = active
    uniform float uQuietMul;     // residual distortion inside a rect
    uniform float uQuietFeather; // UV half-width of the soft edge

    // Underwater "over/under" mask — pure SCREEN-SPACE, no depth, no geometry.
    // There is a single "ocean line" across the screen: the water surface (y≈0,
    // wavy) projected a fixed distance uLineDistance in front of the camera.
    // Everything BELOW that line gets the effect; everything above is untouched.
    // Because the scroll camera is level (pitch 0, only its height Y changes),
    // the line's screen row follows a simple projection of (waterY - camY): it
    // sits off the bottom of the screen while the camera is well above water
    // (→ 0% effect), rises to centre at the surface (over/under), and climbs off
    // the top once submerged (→ 100%). The line ripples in phase with the real
    // ocean waves by sampling the shared surface-wave pattern per column.
    uniform float uTanHalfFov;
    uniform float uAspect;
    uniform mat4 uCameraMatrixWorld;
    uniform float uWaterlineY;
    // Shared surface-wave uniforms (same references as OceanMaterial.surface) —
    // only the shape (wavelength/speed/direction/steepness) is reused, so the
    // line's ripple stays in phase with the rendered water.
    uniform float uWaveLen;
    uniform float uWaveSpeed;
    uniform float uWaveSteepness;
    uniform vec2  uWaveDir1;
    uniform vec2  uWaveDir2;
    // Effect-only knobs:
    uniform float uLineDistance;         // world distance ahead the ocean line is projected from (sensitivity/height)
    uniform float uLineHeightOffset;     // extra NDC nudge of the line up/down
    uniform float uLineWobbleGain;       // NDC amplitude of the line's ripple
    uniform float uLineEdge;             // NDC half-width of the soft boundary

    varying vec2 vUv;
` + oceanWavePatternGLSL + /* glsl */`
    // Screen row (NDC y, -1 bottom .. +1 top) of the wavy ocean line at a given
    // screen column (ndcX). Level-camera projection of the water surface a fixed
    // distance ahead — no depth buffer involved.
    float oceanLineNdcY(float ndcX) {
        vec3 camPos = uCameraMatrixWorld[3].xyz;
        vec2 fwdXZ = normalize(-uCameraMatrixWorld[2].xz + vec2(1e-5));
        vec2 rightXZ = normalize(uCameraMatrixWorld[0].xz + vec2(1e-5));

        // World XZ the ocean line occupies for this column, uLineDistance ahead.
        vec2 worldXZ = camPos.xz
                     + fwdXZ * uLineDistance
                     + rightXZ * (ndcX * uLineDistance * uTanHalfFov * uAspect);

        float k = 6.2831853 / max(uWaveLen, 0.01);
        float t = uTime * uWaveSpeed;
        vec2 dir1 = normalize(uWaveDir1 + vec2(1e-5));
        vec2 dir2 = normalize(uWaveDir2 + vec2(1e-5));
        vec2 g;
        float wave = oceanWavePattern(worldXZ, t, dir1, dir2, k, uWaveSteepness * 0.6, g);

        // Project (surfaceY - camY) at distance uLineDistance to an NDC row, then
        // ripple it in phase with the real waves.
        float baseNdc = (uWaterlineY - camPos.y) / max(uLineDistance * uTanHalfFov, 1e-4);
        return baseNdc + uLineHeightOffset + uLineWobbleGain * wave;
    }

    // FXAA 3.11 — single-pass luma-based AA. Cheap (~6 texture taps), no extra
    // VRAM. Replaces WebGL MSAA which would cost a multi-sample backbuffer
    // (~150–250 MB at retina resolutions).
    #define FXAA_REDUCE_MIN (1.0/128.0)
    #define FXAA_REDUCE_MUL (1.0/8.0)
    #define FXAA_SPAN_MAX 8.0

    vec4 fxaa(sampler2D tex, vec2 uv, vec2 invRes) {
        vec4 cM  = texture2D(tex, uv);
        vec3 rgbNW = texture2D(tex, uv + vec2(-1.0, -1.0) * invRes).rgb;
        vec3 rgbNE = texture2D(tex, uv + vec2( 1.0, -1.0) * invRes).rgb;
        vec3 rgbSW = texture2D(tex, uv + vec2(-1.0,  1.0) * invRes).rgb;
        vec3 rgbSE = texture2D(tex, uv + vec2( 1.0,  1.0) * invRes).rgb;
        vec3 rgbM  = cM.rgb;

        vec3 luma = vec3(0.299, 0.587, 0.114);
        float lumaNW = dot(rgbNW, luma);
        float lumaNE = dot(rgbNE, luma);
        float lumaSW = dot(rgbSW, luma);
        float lumaSE = dot(rgbSE, luma);
        float lumaM  = dot(rgbM,  luma);

        float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
        float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

        vec2 dir = vec2(
            -((lumaNW + lumaNE) - (lumaSW + lumaSE)),
             ((lumaNW + lumaSW) - (lumaNE + lumaSE))
        );

        float dirReduce = max(
            (lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL),
            FXAA_REDUCE_MIN
        );
        float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
        dir = clamp(dir * rcpDirMin, vec2(-FXAA_SPAN_MAX), vec2(FXAA_SPAN_MAX)) * invRes;

        vec3 rgbA = 0.5 * (
            texture2D(tex, uv + dir * (1.0/3.0 - 0.5)).rgb +
            texture2D(tex, uv + dir * (2.0/3.0 - 0.5)).rgb);
        vec3 rgbB = rgbA * 0.5 + 0.25 * (
            texture2D(tex, uv + dir * -0.5).rgb +
            texture2D(tex, uv + dir *  0.5).rgb);

        float lumaB = dot(rgbB, luma);
        vec3 rgb = ((lumaB < lumaMin) || (lumaB > lumaMax)) ? rgbA : rgbB;
        return vec4(rgb, cM.a);
    }

    void main() {
        vec2 uv = vUv;

        // ── Underwater mask (screen-space over/under line) ─────────────────
        // Everything below the wavy ocean line gets the effect, everything above
        // is untouched — no depth, no geometry, purely 2D relative to the camera.
        float lineNdcY = oceanLineNdcY(uv.x * 2.0 - 1.0);
        float pixelNdcY = uv.y * 2.0 - 1.0;
        float underwaterMix = 1.0 - smoothstep(lineNdcY - uLineEdge, lineNdcY + uLineEdge, pixelNdcY);

        // ── Underwater distortion ────────────────────────────────────────
        // Multi-frequency waves per axis at irrational frequency/phase ratios
        // so zero-crossings never align — eliminates static seam lines.
        float t = uTime * uSpeed;
        float dx = (sin(uv.y * uScale          + t)           * 0.60
                  + sin(uv.y * uScale * 1.7    + t * 1.3 + 1.9) * 0.25
                  + sin(uv.y * uScale * 3.1    + t * 0.7 + 4.1) * 0.15
                   ) * uDistortion * underwaterMix;
        float dy = (cos(uv.x * uScale * 0.8    + t * 0.9)        * 0.60
                  + cos(uv.x * uScale * 1.4    + t * 0.6 + 2.7)  * 0.25
                  + cos(uv.x * uScale * 2.6    + t * 1.1 + 5.2)  * 0.15
                   ) * uDistortion * 0.7 * underwaterMix;
        float edgeDistance = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        float edgeFade = uEdgeFade <= 0.0 ? 1.0 : smoothstep(0.0, uEdgeFade, edgeDistance);

        // Damp the displacement inside any active quiet rect (docs above).
        float quietMul = 1.0;
        for (int qi = 0; qi < QUIET_RECT_COUNT; qi++) {
            if (uQuietOns[qi] > 0.5) {
                vec2 qLo = smoothstep(uQuietRects[qi].xy - uQuietFeather, uQuietRects[qi].xy + uQuietFeather, vUv);
                vec2 qHi = 1.0 - smoothstep(uQuietRects[qi].zw - uQuietFeather, uQuietRects[qi].zw + uQuietFeather, vUv);
                float quiet = qLo.x * qLo.y * qHi.x * qHi.y;
                quietMul = min(quietMul, mix(1.0, uQuietMul, quiet));
            }
        }
        dx *= quietMul;
        dy *= quietMul;

        uv.x += dx * edgeFade;
        uv.y += dy * edgeFade;

        // Clamp to tiny inset to avoid edge-smear from sampler clamping.
        uv = clamp(uv, vec2(0.001), vec2(0.999));

        // ── Pixelation ───────────────────────────────────────────────────
        if (uPixelSize > 0.5) {
            vec2 pixelCount = uResolution / uPixelSize;
            uv = floor(uv * pixelCount) / pixelCount;
        }

        // ── FXAA (only when MSAA is off; pixelation overrides AA) ────────
        vec4 color;
        if (uFxaa > 0.5 && uPixelSize < 0.5) {
            color = fxaa(tDiffuse, uv, 1.0 / uResolution);
        } else {
            color = texture2D(tDiffuse, uv);
        }

        // ── Underwater blue tint ─────────────────────────────────────────
        // Same mask as the distortion above, so the tint only touches the
        // portion of the screen that's actually below the ocean's line —
        // bubbles/particles are already baked into tDiffuse at this point
        // (drawn before this pass captures the framebuffer), so they pick
        // up the tint too without any changes to their own shaders.
        color.rgb = mix(color.rgb, uTintColor, underwaterMix * uTintStrength);

        gl_FragColor = color;
    }
`;

// ── Public API ───────────────────────────────────────────────────────────────

export function Start(renderer: WebGLRenderer): void {
    const size = new Vector2();
    renderer.getDrawingBufferSize(size);
    width = size.x;
    height = size.y;

    material = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            tDiffuse: sceneColorUniform,                   // shared with OceanMaterial
            uTime: { value: 0 },
            uDistortion: { value: DISTORTION_STRENGTH },
            uSpeed: { value: DISTORTION_SPEED },
            uScale: { value: DISTORTION_SCALE },
            uEdgeFade: { value: DISTORTION_EDGE_FADE },
            uPixelSize: { value: pixelSize },
            uFxaa: { value: fxaaEnabled ? 1.0 : 0.0 },
            uResolution: sceneResolutionUniform,           // shared
            uTintColor: { value: new Vector3(underwaterTintColor.r, underwaterTintColor.g, underwaterTintColor.b) },
            uTintStrength: { value: underwaterTintStrength },
            uWaterlineY: waterlineYUniform,                // shared
            uTanHalfFov: { value: 1 },
            uAspect: { value: 1 },
            uCameraMatrixWorld: { value: new Matrix4() },
            // Surface-wave uniforms shared by reference — the ocean line ripples
            // in phase with the rendered water; any Debug-GUI wave tweak flows through.
            uWaveLen: surfaceWaveLengthUniform,
            uWaveSpeed: surfaceWaveSpeedUniform,
            uWaveSteepness: surfaceWaveSteepnessUniform,
            uWaveDir1: waveVelocity1Uniform,
            uWaveDir2: waveVelocity2Uniform,
            // Effect-only knobs:
            uLineDistance: { value: underwaterLineDistance },
            uLineHeightOffset: { value: underwaterLineHeightOffset },
            uLineWobbleGain: { value: underwaterLineWobbleGain },
            uLineEdge: { value: underwaterLineEdge },
            // Distortion quiet rects (slot 0: CardCarousel; 1..2: CSS3DPanel):
            uQuietRects: { value: [new Vector4(0, 0, 0, 0), new Vector4(0, 0, 0, 0), new Vector4(0, 0, 0, 0)] },
            uQuietOns: { value: [0, 0, 0] },
            uQuietMul: { value: 0.12 },
            uQuietFeather: { value: 0.06 },
        },
        depthTest: false,
        depthWrite: false
    });

    const quad = new Mesh(new PlaneGeometry(2, 2), material);
    quadScene.add(quad);
    initialized = true;
}

export function onResize(w: number, h: number): void {
    // The shared sceneColor FBT is owned by OceanMaterial and reallocated
    // on demand from captureSceneColor() when the drawing-buffer size shifts,
    // so there's nothing to recreate here. Resolution uniform is also shared
    // (sceneResolutionUniform) and updated by Ocean's capture path.
    width = w;
    height = h;
}

/** Screen row (NDC y, -1 bottom .. +1 top) of the ocean line at screen centre
 *  for a given camera height — the same base projection the shader uses (minus
 *  the per-column ripple). Bubbles use it to know when the effect is on screen
 *  and to clip themselves at the line. Returns -1 (off the bottom) pre-init. */
export function getLineNdcY(camY: number): number {
    if (!material) return -1;
    const u = material.uniforms;
    const tanHalfFov = u.uTanHalfFov.value as number;
    const dist = u.uLineDistance.value as number;
    const waterY = u.uWaterlineY.value as number;
    const offset = u.uLineHeightOffset.value as number;
    return (waterY - camY) / Math.max(dist * tanHalfFov, 1e-4) + offset;
}

/** Push the real camera's projection parameters (FOV/aspect/matrixWorld) plus
 *  the animation clock — needed to project the ocean line and ripple it in
 *  phase with the waves. This pass renders its quad with a dedicated
 *  orthographic camera, so Three's auto-injected matrices don't belong to the
 *  real camera; we supply them explicitly. Called once per frame. */
export function updateCameraProjectionUniforms(cam: Camera): void {
    if (!material) return;
    material.uniforms.uTime.value = time;
    const persp = cam as PerspectiveCamera;
    if (!persp.isPerspectiveCamera) return;
    material.uniforms.uTanHalfFov.value = Math.tan(MathUtils.degToRad(persp.fov) / 2);
    material.uniforms.uAspect.value = persp.aspect;
    (material.uniforms.uCameraMatrixWorld.value as Matrix4).copy(persp.matrixWorld);
}

/**
 * Render the scene with post-processing.
 * Renders normally first, then applies post-process pass if any effect is active.
 */
export function renderScene(renderer: WebGLRenderer, scene: ThreeScene, camera: Camera, afterBaseRender?: () => void): void {
    renderer.render(scene, camera);
    if (afterBaseRender) afterBaseRender();

    // Always run: the underwater tint is computed per-pixel in the shader from
    // the wavy water surface, so there's no cheap CPU-side scalar to gate on.
    // FXAA is on by default (antialias defaults off, see Scene.ts), so this pass
    // already ran unconditionally for almost every user anyway — the cost for
    // anyone with pixelation+FXAA both off and nothing underwater on screen is a
    // straight passthrough (one extra texture sample + copy).
    if (!initialized || !material) {
        return;
    }

    // Re-capture into the shared FBT after ocean + underwater transparents have
    // drawn so the quad sees the final composed scene. This overwrites Ocean's
    // pre-render capture, which is fine — Ocean already consumed it above.
    captureSceneColor(renderer);
    renderer.render(quadScene, orthoCamera);
}

/** Enable / disable FXAA in the post-process pass. Off when MSAA (WebGL antialias) is on. */
export function setFxaaEnabled(value: boolean): void {
    fxaaEnabled = value;
    if (material) material.uniforms.uFxaa.value = value ? 1.0 : 0.0;
}

// ── Underwater distortion setters ────────────────────────────────────────────

export function setDistortion(v: number): void {
    if (material) material.uniforms.uDistortion.value = v;
}

export function setDistortionSpeed(v: number): void {
    if (material) material.uniforms.uSpeed.value = v;
}

export function setDistortionScale(v: number): void {
    if (material) material.uniforms.uScale.value = v;
}

export function setDistortionEdgeFade(v: number): void {
    if (material) material.uniforms.uEdgeFade.value = v;
}

/** Screen-space rectangle (UV space) where the underwater distortion is damped
 *  so a CSS3D punch surface stays registered with the static DOM behind the
 *  canvas. Slot 0 belongs to CardCarousel; slots 1..2 to CSS3DPanel. Callers
 *  own their slot and update it once per frame. */
export function setDistortionQuietRect(slot: number, minU: number, minV: number, maxU: number, maxV: number, on: boolean): void {
    if (!material || slot < 0 || slot > 2) return;
    (material.uniforms.uQuietRects.value[slot] as Vector4).set(minU, minV, maxU, maxV);
    (material.uniforms.uQuietOns.value as number[])[slot] = on ? 1 : 0;
}

// ── Underwater tint / wavy-boundary setters ──────────────────────────────────

export function setUnderwaterTintStrength(v: number): void {
    if (material) material.uniforms.uTintStrength.value = v;
}

export function setUnderwaterTintColor(r: number, g: number, b: number): void {
    if (material) (material.uniforms.uTintColor.value as Vector3).set(r, g, b);
}

export function setUnderwaterLineDistance(v: number): void {
    if (material) material.uniforms.uLineDistance.value = v;
}

export function setUnderwaterLineHeightOffset(v: number): void {
    if (material) material.uniforms.uLineHeightOffset.value = v;
}

export function setUnderwaterLineWobbleGain(v: number): void {
    if (material) material.uniforms.uLineWobbleGain.value = v;
}

export function setUnderwaterLineEdge(v: number): void {
    if (material) material.uniforms.uLineEdge.value = v;
}

// ── GPU prewarm ──────────────────────────────────────────────────────────────

/** Pre-compile the post-process quad shader so the first underwater frame is stutter-free. */
export function prewarm(r: WebGLRenderer): void {
    if (!initialized) return;
    r.compile(quadScene, orthoCamera);
}

// ── Pixelation setter ────────────────────────────────────────────────────────

export function setPixelSize(v: number): void {
    pixelSize = v;
    if (material) material.uniforms.uPixelSize.value = v;
}

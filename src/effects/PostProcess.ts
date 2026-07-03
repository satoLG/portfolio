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
    Matrix4,
    Camera,
    PerspectiveCamera,
    MathUtils,
} from "three";
import { time } from "../core/Time";
import {
    distortionStrength, distortionSpeed, distortionScale, distortionEdgeFade,
    underwaterMaskSoftness, underwaterTintColor, underwaterTintStrength,
    underwaterDarkenAmount, underwaterMaskFadeDistance,
} from '../scene/config/OceanConfig';
import {
    sceneColorUniform,
    sceneResolutionUniform,
    captureSceneColor,
    sceneDepthUniform,
    cameraNearUniform,
    cameraFarUniform,
    waterlineYUniform,
} from "../materials/OceanMaterial";

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
    uniform float uWaterLineUv;      // screen-space row (0 bottom .. 1 top) of the projected ocean line (flat-line fallback)
    uniform float uWaterLineSoftness;
    uniform vec3 uTintColor;
    uniform float uTintStrength;
    uniform float uDarkenAmount;

    // Occlusion-aware mask: reconstructs world-space Y per pixel from the
    // opaque-scene depth buffer, so solid foreground objects (e.g. a pug or
    // tent standing on dry land) never get treated as "underwater" just
    // because they happen to sit at the same screen row as the projected
    // waterline. Falls back to the flat uWaterLineUv row only where there's
    // no opaque hit (sky, or open water — the ocean mesh itself is never in
    // this depth texture, see SceneDepth.ts/Ocean.ts's private overlayScene).
    uniform highp sampler2D uSceneDepth;   // highp required — mediump quantizes badly near depth=1 (see OceanShaders.ts calcEdgeFoam)
    uniform float uCameraNear;
    uniform float uCameraFar;
    uniform float uTanHalfFov;
    uniform float uAspect;
    uniform mat4 uCameraMatrixWorld;
    uniform float uWaterlineY;
    uniform float uMaskFadeDistance;
    uniform float uDepthPassActive;   // 1.0 = depth pre-pass ran this frame, 0.0 = flat-line fallback only

    varying vec2 vUv;

    float linearizeDepthBuffer(float depth, float near, float far) {
        return (near * far) / (far * (1.0 - depth) + depth * near);
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

        // ── Occlusion-aware underwater mask ──────────────────────────────
        // Driven purely by whether THIS pixel shows underwater content —
        // not by the camera's own eye depth — so the effect starts the
        // instant any sliver of underwater area is visible on screen, at
        // full local strength, regardless of how submerged the camera
        // itself is.
        float underwaterMix;
        float depthSample = texture2D(uSceneDepth, uv).x;
        bool hasOpaqueHit = uDepthPassActive > 0.5 && depthSample < 0.9999;

        if (hasOpaqueHit) {
            // Reconstruct this pixel's world-space Y from the depth buffer
            // and compare to the waterline — correct regardless of what's
            // in front of the ocean (pug, tent, rocks, ...), since depth
            // naturally encodes whatever's actually nearest along this ray.
            float eyeDepth = linearizeDepthBuffer(depthSample, uCameraNear, uCameraFar);
            vec2 ndc = uv * 2.0 - 1.0;
            vec3 viewPos = vec3(
                ndc.x * eyeDepth * uTanHalfFov * uAspect,
                ndc.y * eyeDepth * uTanHalfFov,
                -eyeDepth
            );
            float worldY = (uCameraMatrixWorld * vec4(viewPos, 1.0)).y;
            float below = uWaterlineY - worldY;
            underwaterMix = clamp(below / uMaskFadeDistance, 0.0, 1.0);
        } else {
            // No opaque hit here: sky, open water (the ocean mesh is never
            // in the depth pre-pass), or the depth pre-pass didn't run this
            // frame — fall back to the flat analytic waterline row.
            float uvBelow = uWaterLineUv - uv.y;
            underwaterMix = clamp(uvBelow / uWaterLineSoftness, 0.0, 1.0);
        }

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
        // A pure mix() toward even a dark color still reads as a flat,
        // slightly milky veil at partial strength — pre-darken the base
        // color first so it reads as genuinely murky water, not a wash.
        float darkenFactor = mix(1.0, 1.0 - uDarkenAmount, underwaterMix);
        color.rgb *= darkenFactor;
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
            uWaterLineUv: { value: 0.5 },
            uWaterLineSoftness: { value: underwaterMaskSoftness },
            uTintColor: { value: new Vector3(underwaterTintColor.r, underwaterTintColor.g, underwaterTintColor.b) },
            uTintStrength: { value: underwaterTintStrength },
            uDarkenAmount: { value: underwaterDarkenAmount },
            uSceneDepth: sceneDepthUniform,                // shared with OceanMaterial
            uCameraNear: cameraNearUniform,                // shared
            uCameraFar: cameraFarUniform,                  // shared
            uWaterlineY: waterlineYUniform,                // shared
            uMaskFadeDistance: { value: underwaterMaskFadeDistance },
            uDepthPassActive: { value: 0 },
            uTanHalfFov: { value: 1 },
            uAspect: { value: 1 },
            uCameraMatrixWorld: { value: new Matrix4() },
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

/** Update the screen-space row (0 bottom .. 1 top) the ocean's line projects to
 *  (flat-line fallback used where the depth-based mask has no opaque hit). */
export function updateWaterLineUv(uv: number): void {
    if (!material) return;
    material.uniforms.uTime.value = time;
    material.uniforms.uWaterLineUv.value = MathUtils.clamp(uv, 0, 1);
}

/** Whether the depth pre-pass ran this frame — gates the occlusion-aware
 *  underwater mask; falls back to the flat waterline row when false. */
export function setDepthMaskEnabled(active: boolean): void {
    if (material) material.uniforms.uDepthPassActive.value = active ? 1 : 0;
}

/** Push the real camera's projection parameters (FOV/aspect/matrixWorld) —
 *  needed to reconstruct world-space position from the depth buffer, since
 *  this pass renders its quad with a dedicated orthographic camera, so
 *  Three's auto-injected matrices don't belong to the real camera. */
export function updateCameraProjectionUniforms(cam: Camera): void {
    if (!material) return;
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

    // Always run: the underwater mask is now purely screen-space/per-pixel
    // (no single camera-depth scalar can distinguish "nothing underwater
    // visible" from "camera fully submerged, whole screen underwater" — see
    // WaterLine's clamped UV). FXAA is already on by default (antialias is
    // off by default, see Scene.ts), so this pass already ran unconditionally
    // for almost every user before this change; the cost for anyone with
    // pixelation+FXAA both off and no underwater content on screen is a
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

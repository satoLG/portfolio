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
    Camera,
    MathUtils,
} from "three";
import { time } from "../core/Time";
import {
    distortionStrength, distortionSpeed, distortionScale, distortionEdgeFade,
    underwaterMaskSoftness, underwaterTintColor, underwaterTintStrength,
} from '../scene/config/OceanConfig';
import {
    sceneColorUniform,
    sceneResolutionUniform,
    captureSceneColor,
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
    uniform float uWaterLineUv;      // screen-space row (0 bottom .. 1 top) of the projected ocean line
    uniform float uWaterLineSoftness;
    uniform vec3 uTintColor;
    uniform float uTintStrength;

    varying vec2 vUv;

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

        // ── Screen-space waterline mask ──────────────────────────────────
        // Single source of truth for "where and when" every underwater
        // effect (distortion, tint here; bubbles separately) applies: the
        // ocean line's projected screen row, recomputed every frame from
        // scroll/camera position (see WaterLine.ts) — NOT the camera's own
        // eye depth. 1.0 below the line, 0.0 above it, soft transition
        // across uWaterLineSoftness. This is why the effect starts the
        // instant any sliver of underwater area is visible on screen,
        // regardless of how submerged the camera itself is.
        float underwaterMix = 1.0 - smoothstep(uWaterLineUv - uWaterLineSoftness, uWaterLineUv + uWaterLineSoftness, uv.y);

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

/** Update the screen-space row (0 bottom .. 1 top) the ocean's line projects to. */
export function updateWaterLineUv(uv: number): void {
    if (!material) return;
    material.uniforms.uTime.value = time;
    material.uniforms.uWaterLineUv.value = MathUtils.clamp(uv, 0, 1);
}

/**
 * Render the scene with post-processing.
 * Renders normally first, then applies post-process pass if any effect is active.
 */
export function renderScene(renderer: WebGLRenderer, scene: ThreeScene, camera: Camera, afterBaseRender?: () => void): void {
    renderer.render(scene, camera);
    if (afterBaseRender) afterBaseRender();

    // Always run: the underwater mask is screen-space (WaterLine's projected
    // row), so a single scalar can't tell "nothing underwater visible" apart
    // from "camera fully submerged, whole screen underwater". FXAA is on by
    // default (antialias defaults off, see Scene.ts), so this pass already
    // ran unconditionally for almost every user before this — the cost for
    // anyone with pixelation+FXAA both off and no underwater content on
    // screen is a straight passthrough (one extra texture sample + copy).
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

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
    Camera,
    FramebufferTexture,
    LinearFilter,
    RGBAFormat
} from "three";
import { time } from "../scripts/Time";
import { distortionStrength, distortionSpeed, distortionScale } from '../scene/OceanConfig';

// ── Underwater constants ─────────────────────────────────────────────────────
export const UNDERWATER_Y_THRESHOLD = 0.0;
const DISTORTION_STRENGTH = distortionStrength;
const DISTORTION_SPEED    = distortionSpeed;
const DISTORTION_SCALE    = distortionScale;

// ── Internals ────────────────────────────────────────────────────────────────
const orthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadScene = new ThreeScene();

let material: ShaderMaterial | null = null;
let framebufferTexture: FramebufferTexture | null = null;
let underwaterAmount = 0;
let pixelSize = 0;
let initialized = false;
let width = 1;
let height = 1;

const _copyOffset = new Vector2(0, 0);

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
    uniform float uAmount;
    uniform float uPixelSize;
    uniform vec2 uResolution;
    
    varying vec2 vUv;
    
    void main() {
        vec2 uv = vUv;
        
        // ── Underwater distortion ────────────────────────────────────────
        // Multi-frequency waves per axis at irrational frequency/phase ratios
        // so zero-crossings never align — eliminates static seam lines.
        float t = uTime * uSpeed;
        float dx = (sin(uv.y * uScale          + t)           * 0.60
                  + sin(uv.y * uScale * 1.7    + t * 1.3 + 1.9) * 0.25
                  + sin(uv.y * uScale * 3.1    + t * 0.7 + 4.1) * 0.15
                   ) * uDistortion * uAmount;
        float dy = (cos(uv.x * uScale * 0.8    + t * 0.9)        * 0.60
                  + cos(uv.x * uScale * 1.4    + t * 0.6 + 2.7)  * 0.25
                  + cos(uv.x * uScale * 2.6    + t * 1.1 + 5.2)  * 0.15
                   ) * uDistortion * 0.7 * uAmount;
        uv.x += dx;
        uv.y += dy;

        // Clamp to tiny inset to avoid edge-smear from sampler clamping.
        uv = clamp(uv, vec2(0.001), vec2(0.999));

        // ── Pixelation ───────────────────────────────────────────────────
        if (uPixelSize > 0.5) {
            vec2 pixelCount = uResolution / uPixelSize;
            uv = floor(uv * pixelCount) / pixelCount;
        }

        gl_FragColor = texture2D(tDiffuse, uv);
    }
`;

// ── Public API ───────────────────────────────────────────────────────────────

export function Start(renderer: WebGLRenderer): void {
    const size = new Vector2();
    renderer.getDrawingBufferSize(size);
    width = size.x;
    height = size.y;

    framebufferTexture = new FramebufferTexture(width, height, RGBAFormat);
    framebufferTexture.minFilter = LinearFilter;
    framebufferTexture.magFilter = LinearFilter;
    
    material = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            tDiffuse: { value: framebufferTexture },
            uTime: { value: 0 },
            uDistortion: { value: DISTORTION_STRENGTH },
            uSpeed: { value: DISTORTION_SPEED },
            uScale: { value: DISTORTION_SCALE },
            uAmount: { value: 0 },
            uPixelSize: { value: pixelSize },
            uResolution: { value: new Vector2(width, height) }
        },
        depthTest: false,
        depthWrite: false
    });
    
    const quad = new Mesh(new PlaneGeometry(2, 2), material);
    quadScene.add(quad);
    initialized = true;
}

export function onResize(w: number, h: number): void {
    width = w;
    height = h;
    if (framebufferTexture) {
        framebufferTexture.dispose();
        framebufferTexture = new FramebufferTexture(width, height, RGBAFormat);
        framebufferTexture.minFilter = LinearFilter;
        framebufferTexture.magFilter = LinearFilter;
        if (material) {
            material.uniforms.tDiffuse.value = framebufferTexture;
            material.uniforms.uResolution.value.set(width, height);
        }
    }
}

/** Update underwater distortion amount based on camera depth. */
export function updateUnderwaterAmount(cameraY: number): void {
    if (!material) return;
    const depth = UNDERWATER_Y_THRESHOLD - cameraY;
    underwaterAmount = Math.max(0, Math.min(1, depth / 0.5));
    material.uniforms.uTime.value = time;
    material.uniforms.uAmount.value = underwaterAmount;
}

/**
 * Render the scene with post-processing.
 * Renders normally first, then applies post-process pass if any effect is active.
 */
export function renderScene(renderer: WebGLRenderer, scene: ThreeScene, camera: Camera): void {
    renderer.render(scene, camera);
    
    const needsPostProcess = (underwaterAmount > 0 || pixelSize > 0);
    if (!needsPostProcess || !initialized || !framebufferTexture || !material) {
        return;
    }
    
    renderer.copyFramebufferToTexture(_copyOffset, framebufferTexture);
    renderer.render(quadScene, orthoCamera);
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

// ── Pixelation setter ────────────────────────────────────────────────────────

export function setPixelSize(v: number): void {
    pixelSize = v;
    if (material) material.uniforms.uPixelSize.value = v;
}

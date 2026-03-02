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
    LinearFilter
} from "three";
import { time } from "../scripts/Time";
import { distortionStrength, distortionSpeed, distortionScale } from '../scene/OceanConfig';

// ============================================
// DISTORTION SETTINGS
// ============================================
export const UNDERWATER_Y_THRESHOLD = 0.0;
export const DISTORTION_STRENGTH = distortionStrength;
export const DISTORTION_SPEED    = distortionSpeed;
export const DISTORTION_SCALE    = distortionScale;
// ============================================

const orthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadScene = new ThreeScene();

let material: ShaderMaterial | null = null;
let framebufferTexture: FramebufferTexture | null = null;
let underwaterAmount = 0;
let pixelSize = 0;
let initialized = false;
let width = 1;
let height = 1;

// Reuse a static Vector2 for copyFramebufferToTexture offset (avoids per-frame allocation)
const _copyOffset = new Vector2(0, 0);

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
        
        // Multi-frequency underwater distortion.
        // Three waves per axis at irrational frequency/phase ratios so their
        // zero-crossings never align — this eliminates the static seam line
        // that a single sin/cos wave produces where its amplitude is exactly 0.
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

        // Guard against UVs escaping [0,1] — clamping to a tiny inset avoids
        // the edge-smear that appears when the sampler clamps to the border.
        uv = clamp(uv, vec2(0.001), vec2(0.999));

        // Pixelation effect
        if (uPixelSize > 0.5) {
            vec2 pixelCount = uResolution / uPixelSize;
            uv = floor(uv * pixelCount) / pixelCount;
        }

        gl_FragColor = texture2D(tDiffuse, uv);
    }
`;

export function Start(renderer: WebGLRenderer): void {
    const size = new Vector2();
    renderer.getSize(size);
    width = size.x;
    height = size.y;

    // FramebufferTexture copies directly from the framebuffer - no color conversion
    framebufferTexture = new FramebufferTexture(width, height);
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
        framebufferTexture = new FramebufferTexture(width, height);
        framebufferTexture.minFilter = LinearFilter;
        framebufferTexture.magFilter = LinearFilter;
        if (material) {
            material.uniforms.tDiffuse.value = framebufferTexture;
            material.uniforms.uResolution.value.set(width, height);
        }
    }
}

export function Update(cameraY: number): void {
    if (!material) return;
    const depth = UNDERWATER_Y_THRESHOLD - cameraY;
    underwaterAmount = Math.max(0, Math.min(1, depth / 0.5));
    material.uniforms.uTime.value = time;
    material.uniforms.uAmount.value = underwaterAmount;
}

export function renderScene(renderer: WebGLRenderer, scene: ThreeScene, camera: Camera): void {
    // Always render scene first
    renderer.render(scene, camera);
    
    // Run post-process pass if underwater OR pixelation is active
    const needsPostProcess = (underwaterAmount > 0 || pixelSize > 0);
    if (!needsPostProcess || !initialized || !framebufferTexture || !material) {
        return;
    }
    
    // Copy the framebuffer (already has correct colors) to texture
    // Reuse static Vector2 to avoid allocation every frame
    renderer.copyFramebufferToTexture(framebufferTexture, _copyOffset);
    
    // Render post-processed version on top
    renderer.render(quadScene, orthoCamera);
}

export function setDistortion(v: number): void {
    if (material) material.uniforms.uDistortion.value = v;
}

export function setSpeed(v: number): void {
    if (material) material.uniforms.uSpeed.value = v;
}

export function setScale(v: number): void {
    if (material) material.uniforms.uScale.value = v;
}

export function setPixelSize(v: number): void {
    pixelSize = v;
    if (material) material.uniforms.uPixelSize.value = v;
}

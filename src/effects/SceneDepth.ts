/**
 * SceneDepth — captures the opaque scene's depth buffer into a texture so the
 * ocean shader can do depth-difference foam (industry-standard "intersection
 * foam"). Runs as a depth-only pre-pass before the main render; uses
 * `MeshDepthMaterial` as `scene.overrideMaterial` so the cost is just the
 * vertex pipeline + depth write (no lighting, no textures).
 *
 * The depth texture is wired into OceanMaterial.surface; the ocean fragment
 * shader linearizes both `gl_FragCoord.z` and the sampled scene depth to
 * compare them in view space.
 */
import {
    Camera,
    DepthTexture,
    MeshDepthMaterial,
    NearestFilter,
    RGBADepthPacking,
    Scene as ThreeScene,
    UnsignedIntType,
    Vector2,
    WebGLRenderer,
    WebGLRenderTarget,
} from "three";

let depthTarget: WebGLRenderTarget | null = null;
let depthTexture: DepthTexture | null = null;
let width = 1;
let height = 1;

// The foam edge is a soft smoothstep, so it tolerates a half-resolution depth
// target: a quarter of the depth-buffer fragments + a quarter of the VRAM, with
// no visible change to the contact line. The ocean shader samples by normalized
// UV, so the lower-res target is fully transparent to it.
const DEPTH_SCALE = 0.5;
function scaleDim(v: number): number {
    return Math.max(1, Math.round(v * DEPTH_SCALE));
}

// MeshDepthMaterial writes the scene depth into the attached DepthTexture; with a
// dedicated DepthTexture attachment we don't consume its color output, but the
// material is required as `scene.overrideMaterial` so that custom shaders (grass
// wind, apple physics) don't burn lighting work during the depth-only pass.
const overrideMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });

const _size = new Vector2();

function ensureTarget(w: number, h: number): WebGLRenderTarget {
    if (depthTarget && width === w && height === h) return depthTarget;
    if (depthTarget) depthTarget.dispose();
    if (depthTexture) depthTexture.dispose();

    depthTexture = new DepthTexture(w, h);
    depthTexture.type = UnsignedIntType; // 24-bit depth — enough precision for foam edge
    depthTexture.minFilter = NearestFilter;
    depthTexture.magFilter = NearestFilter;

    depthTarget = new WebGLRenderTarget(w, h, {
        depthTexture,
        depthBuffer: true,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
    });
    width = w;
    height = h;
    return depthTarget;
}

/** Allocate the depth target at half the renderer's current drawing-buffer size. */
export function Start(renderer: WebGLRenderer): void {
    renderer.getDrawingBufferSize(_size);
    ensureTarget(scaleDim(_size.x), scaleDim(_size.y));
}

export function onResize(w: number, h: number): void {
    ensureTarget(scaleDim(w), scaleDim(h));
}

/** Get the depth texture for ocean-shader sampling. May be null pre-Start(). */
export function getDepthTexture(): DepthTexture | null {
    return depthTexture;
}

/** Pre-compile the depth-override shader path against the live scene so the
 *  first real `capture()` doesn't compile mid-frame. */
export function prewarm(renderer: WebGLRenderer, scene: ThreeScene, camera: Camera): void {
    const prevOverride = scene.overrideMaterial;
    scene.overrideMaterial = overrideMaterial;
    renderer.compile(scene, camera);
    scene.overrideMaterial = prevOverride;
}

/**
 * Render the scene's depth into the depth target. Call once per frame, after
 * visibility gating is set but before the main `renderer.render(scene, camera)`.
 */
export function capture(renderer: WebGLRenderer, scene: ThreeScene, camera: Camera): void {
    renderer.getDrawingBufferSize(_size);
    const target = ensureTarget(scaleDim(_size.x), scaleDim(_size.y));

    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    // This depth-only pass uses MeshDepthMaterial and receives no shadows, but
    // renderer.render() re-renders every shadow map at the top of the call when
    // shadowMap.autoUpdate is on (the default). That would render the VSM maps
    // (+ blur pass) a second time per frame for nothing. Suspend shadow updates
    // during the pre-pass; the main render right after re-enables and renders
    // them exactly once.
    const prevShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;

    scene.overrideMaterial = overrideMaterial;
    renderer.setRenderTarget(target);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);

    scene.overrideMaterial = prevOverride;
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;
}

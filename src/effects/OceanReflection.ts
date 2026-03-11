import {
    PerspectiveCamera,
    WebGLRenderTarget,
    LinearFilter,
    RGBAFormat,
    Plane,
    Vector3,
    Matrix4,
    WebGLRenderer,
    Scene,
    Mesh,
} from "three";
import { UNDERWATER_Y_THRESHOLD } from "./Underwater";
import { reflectionRTSize } from '../scene/OceanConfig';
import { skybox } from '../scene/Skybox';
import { reflectionStrengthUniform } from '../materials/OceanMaterial';
import { reflectionStrength as _configStrength } from '../scene/OceanConfig';

// ============================================
// PLANAR OCEAN REFLECTION
// Renders the scene from a mirrored camera into a small render target each frame.
// The ocean surface shader samples this texture to show island reflections.
// ============================================

export const renderTarget = new WebGLRenderTarget(reflectionRTSize, reflectionRTSize, {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    format: RGBAFormat,
});
renderTarget.texture.name = 'OceanReflection';

// Mirror camera — projection matrix is copied from main camera each frame;
// world transform is set to the Y=0 reflection of the main camera.
const reflectionCamera = new PerspectiveCamera();
reflectionCamera.matrixAutoUpdate = false;

// Reflection matrix: scale (1, -1, 1) flips Y through the Y=0 plane
const _flipMatrix = new Matrix4().makeScale(1, -1, 1);

// Global clipping plane: keep only geometry at or above Y=0
// (sea floor, fish, underwater particles are all below — correctly excluded)
const _clipPlane = new Plane(new Vector3(0, 1, 0), 0);

/**
 * Call once per frame, BEFORE the main scene render.
 * Renders the scene from the mirrored camera into the reflection render target.
 *
 * @param mainCamera   The active scene camera
 * @param renderer     The WebGL renderer
 * @param scene        The Three.js scene
 * @param oceanSurface The ocean surface Mesh (hidden during the reflection pass)
 */
let _reflectionEnabled = true;

export function update(
    mainCamera: PerspectiveCamera,
    renderer: WebGLRenderer,
    scene: Scene,
    oceanSurface: Mesh,
): void {
    // Skip if reflection is globally disabled (Low quality preset)
    if (!_reflectionEnabled) return;
    // Skip while underwater — the reflection surface is not visible from below
    if (mainCamera.position.y < UNDERWATER_Y_THRESHOLD) return;

    // ── Mirror camera ──────────────────────────────────────────────────────
    // Copy projection from main camera so FOV / aspect / near / far are identical
    reflectionCamera.projectionMatrix.copy(mainCamera.projectionMatrix);
    reflectionCamera.projectionMatrixInverse.copy(mainCamera.projectionMatrixInverse);

    // Reflect the world transform through Y=0: premultiply by scale(1,-1,1)
    reflectionCamera.matrixWorld.copy(mainCamera.matrixWorld).premultiply(_flipMatrix);
    reflectionCamera.matrixWorldInverse.copy(reflectionCamera.matrixWorld).invert();

    // ── Render pass ────────────────────────────────────────────────────────
    // Hide the ocean surface so it doesn't occlude its own reflection.
    // Hide the skybox — it's already sampled analytically in the shader via sampleSkybox();
    // rendering it again at RT resolution just adds a blurry low-res sky duplicate.
    oceanSurface.visible = false;
    skybox.visible = false;

    // Clip everything below Y=0 (sea floor, fish, underwater particles)
    renderer.clippingPlanes = [_clipPlane];
    renderer.localClippingEnabled = true;

    // Flipping Y inverts the coordinate system handedness — triangles that
    // were front-facing now appear back-facing and get culled.
    // Switch to CW winding for the duration of the reflection pass then restore.
    const gl = renderer.getContext();
    gl.frontFace(gl.CW);

    renderer.setRenderTarget(renderTarget);
    // Clear to fully transparent so pixels with no model (sky) have alpha=0.
    // The shader uses RT alpha as a model mask: a=0 → fall back to analytical sampleSkybox(),
    // a=1 → blend in the model reflection at _ReflectionStrength.
    const prevAutoClear = renderer.autoClear;
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.autoClear = false;
    renderer.setClearAlpha(0);
    renderer.clear();
    renderer.setClearAlpha(prevClearAlpha);
    renderer.render(scene, reflectionCamera);
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(null);

    // Restore state
    gl.frontFace(gl.CCW);
    renderer.localClippingEnabled = false;
    renderer.clippingPlanes = [];
    oceanSurface.visible = true;
    skybox.visible = true;
}

/** Current render-target edge size in pixels (256 or 512). */
export let currentResolution = reflectionRTSize;

/**
 * Resize the reflection render target.
 * Also updates reflectionTextureUniform so the shader picks up the new texture automatically.
 */
export function setResolution(size: 256 | 512): void {
    if (size === currentResolution) return;
    currentResolution = size;
    renderTarget.setSize(size, size);
    // The texture object is stable after setSize — no need to re-assign the uniform.
}

/** Enable or disable the reflection pass entirely (disabled = Low quality preset). */
export function setReflectionEnabled(enabled: boolean): void {
    _reflectionEnabled = enabled;
    // Zero out the shader strength immediately so the stale RT texture
    // doesn't linger on the ocean surface while the pass is skipped.
    reflectionStrengthUniform.value = enabled ? _configStrength : 0;
}

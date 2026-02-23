import {
    WebGLRenderer,
    WebGLRenderTarget,
    OrthographicCamera,
    Scene as ThreeScene,
    MeshBasicMaterial,
    Color,
    Box3,
    Vector3,
    LinearFilter,
    Group,
    Mesh
} from "three";

// ============================================
// FOAM MASK SETTINGS (tweak these!)
// ============================================
export const FOAM_MASK_RESOLUTION = 256;    // Texture size — 256 is plenty for a silhouette
export const FOAM_MASK_PADDING = 0.3;       // World-unit padding around the island bounding box
export const FOAM_SLICE_Y = 0.0;            // Y level to slice (ocean surface level)
// ============================================

let maskTexture: WebGLRenderTarget | null = null;
let maskCenter = { x: 0, y: 0 };   // World XZ center of the captured region
let maskSize = { x: 1, y: 1 };     // World XZ extent of the captured region

// Reusable objects — allocated once
const maskScene = new ThreeScene();
const maskCamera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
const whiteMat = new MeshBasicMaterial({ color: 0xffffff });
const _box = new Box3();
const _size = new Vector3();
const _center = new Vector3();

/**
 * Render a top-down silhouette of the island group into a small render target.
 * The resulting texture is white where island exists and black (background) elsewhere.
 * The ocean shader samples this to detect edges and place foam.
 */
export function generateFoamMask(rendererRef: WebGLRenderer, islandGroup: Group): void {
    // Compute world bounding box of the entire island group
    _box.setFromObject(islandGroup);
    _box.getCenter(_center);
    _box.getSize(_size);

    // XZ extent with padding
    const halfW = _size.x / 2 + FOAM_MASK_PADDING;
    const halfD = _size.z / 2 + FOAM_MASK_PADDING;

    maskCenter.x = _center.x;
    maskCenter.y = _center.z;
    maskSize.x = halfW * 2;
    maskSize.y = halfD * 2;

    // Setup orthographic camera looking straight down (+Y → -Y)
    // left/right = world X, top/bottom = world Z
    maskCamera.left = -halfW;
    maskCamera.right = halfW;
    maskCamera.top = halfD;
    maskCamera.bottom = -halfD;
    maskCamera.near = 0.01;
    maskCamera.far = _size.y + 10;
    maskCamera.position.set(_center.x, _box.max.y + 5, _center.z);
    // Set up = +Z so that texture V increases with world +Z,
    // matching the shader's maskUV.y = (worldZ - center) / size + 0.5
    maskCamera.up.set(0, 0, 1);
    maskCamera.lookAt(_center.x, _center.y, _center.z);
    maskCamera.updateProjectionMatrix();

    // Create (or recreate) render target
    if (maskTexture) {
        maskTexture.dispose();
    }
    maskTexture = new WebGLRenderTarget(FOAM_MASK_RESOLUTION, FOAM_MASK_RESOLUTION, {
        minFilter: LinearFilter,
        magFilter: LinearFilter,
    });

    // Clone island meshes into our mask scene with a flat white material
    // so we get a clean silhouette regardless of the model's own materials
    maskScene.clear();
    maskScene.background = new Color(0x000000);

    islandGroup.traverse((child) => {
        if ((child as any).isMesh) {
            const src = child as Mesh;
            const clone = new Mesh(src.geometry, whiteMat);
            // Copy world transform
            src.updateWorldMatrix(true, false);
            clone.matrixAutoUpdate = false;
            clone.matrix.copy(src.matrixWorld);
            maskScene.add(clone);
        }
    });

    // Render
    const prevTarget = rendererRef.getRenderTarget();
    const prevClearColor = new Color();
    rendererRef.getClearColor(prevClearColor);
    const prevClearAlpha = rendererRef.getClearAlpha();
    const prevAutoClear = rendererRef.autoClearColor;

    rendererRef.autoClearColor = true;
    rendererRef.setClearColor(0x000000, 1);
    rendererRef.setRenderTarget(maskTexture);
    rendererRef.clear();
    rendererRef.render(maskScene, maskCamera);

    // Restore
    rendererRef.setRenderTarget(prevTarget);
    rendererRef.setClearColor(prevClearColor, prevClearAlpha);
    rendererRef.autoClearColor = prevAutoClear;

    // Cleanup clones from mask scene
    maskScene.clear();

    console.log(`Foam mask generated: ${FOAM_MASK_RESOLUTION}x${FOAM_MASK_RESOLUTION}, ` +
        `center=(${maskCenter.x.toFixed(2)}, ${maskCenter.y.toFixed(2)}), ` +
        `size=(${maskSize.x.toFixed(2)}, ${maskSize.y.toFixed(2)})`);
}

/** Get the generated mask texture (null if not yet generated) */
export function getMaskTexture(): WebGLRenderTarget | null {
    return maskTexture;
}

/** World XZ center of the mask region */
export function getMaskCenter(): { x: number; y: number } {
    return maskCenter;
}

/** World XZ size of the mask region */
export function getMaskSize(): { x: number; y: number } {
    return maskSize;
}

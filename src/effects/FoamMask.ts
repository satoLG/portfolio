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
    Mesh,
    DataTexture,
    RedFormat,
    UnsignedByteType,
    ClampToEdgeWrapping,
    Texture,
} from "three";

export const FOAM_MASK_RESOLUTION = 1024;
export const FOAM_MASK_PADDING = 0.3;
export const FOAM_SLICE_Y = 0.0;
const FOAM_SDF_SPREAD_WORLD = 1.5;

let maskRenderTarget: WebGLRenderTarget | null = null;
let maskTexture: DataTexture | null = null;
let maskCenter = { x: 0, y: 0 };
let maskSize = { x: 1, y: 1 };

const maskScene = new ThreeScene();
const maskCamera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
const whiteMat = new MeshBasicMaterial({ color: 0xffffff });
const _box = new Box3();
const _size = new Vector3();
const _center = new Vector3();

const INF = 1e20;

function edt1d(f: Float32Array, n: number, d: Float32Array): void {
    const v = new Int32Array(n);
    const z = new Float32Array(n + 1);
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;

    for (let q = 1; q < n; q++) {
        let s = 0;
        do {
            const vk = v[k];
            s = ((f[q] + q * q) - (f[vk] + vk * vk)) / (2 * q - 2 * vk);
            if (s <= z[k]) k--;
        } while (s <= z[k]);
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = INF;
    }

    k = 0;
    for (let q = 0; q < n; q++) {
        while (z[k + 1] < q) k++;
        const dx = q - v[k];
        d[q] = dx * dx + f[v[k]];
    }
}

function edt2d(featureMask: Uint8Array, width: number, height: number): Float32Array {
    const temp = new Float32Array(width * height);
    const dist = new Float32Array(width * height);
    const f = new Float32Array(Math.max(width, height));
    const d = new Float32Array(Math.max(width, height));

    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) f[y] = featureMask[y * width + x] ? 0 : INF;
        edt1d(f, height, d);
        for (let y = 0; y < height; y++) temp[y * width + x] = d[y];
    }

    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) f[x] = temp[row + x];
        edt1d(f, width, d);
        for (let x = 0; x < width; x++) dist[row + x] = d[x];
    }

    return dist;
}

export function generateFoamMask(rendererRef: WebGLRenderer, islandGroup: Group): void {
    _box.setFromObject(islandGroup);
    _box.getCenter(_center);
    _box.getSize(_size);

    const halfW = _size.x / 2 + FOAM_MASK_PADDING;
    const halfD = _size.z / 2 + FOAM_MASK_PADDING;

    maskCenter.x = _center.x;
    maskCenter.y = _center.z;
    maskSize.x = halfW * 2;
    maskSize.y = halfD * 2;

    maskCamera.left = -halfW;
    maskCamera.right = halfW;
    maskCamera.top = halfD;
    maskCamera.bottom = -halfD;
    maskCamera.near = 0.01;
    maskCamera.far = _size.y + 10;
    maskCamera.position.set(_center.x, _box.max.y + 5, _center.z);
    maskCamera.up.set(0, 0, 1);
    maskCamera.lookAt(_center.x, _center.y, _center.z);
    maskCamera.updateProjectionMatrix();

    if (maskRenderTarget) maskRenderTarget.dispose();
    maskRenderTarget = new WebGLRenderTarget(FOAM_MASK_RESOLUTION, FOAM_MASK_RESOLUTION, {
        minFilter: LinearFilter,
        magFilter: LinearFilter,
    });

    maskScene.clear();
    maskScene.background = new Color(0x000000);

    islandGroup.traverse((child) => {
        if ((child as any).isMesh) {
            const src = child as Mesh;
            const clone = new Mesh(src.geometry, whiteMat);
            src.updateWorldMatrix(true, false);
            clone.matrixAutoUpdate = false;
            clone.matrix.copy(src.matrixWorld);
            maskScene.add(clone);
        }
    });

    const prevTarget = rendererRef.getRenderTarget();
    const prevClearColor = new Color();
    rendererRef.getClearColor(prevClearColor);
    const prevClearAlpha = rendererRef.getClearAlpha();
    const prevAutoClear = rendererRef.autoClearColor;

    rendererRef.autoClearColor = true;
    rendererRef.setClearColor(0x000000, 1);
    rendererRef.setRenderTarget(maskRenderTarget);
    rendererRef.clear();
    rendererRef.render(maskScene, maskCamera);

    const pixels = new Uint8Array(FOAM_MASK_RESOLUTION * FOAM_MASK_RESOLUTION * 4);
    rendererRef.readRenderTargetPixels(maskRenderTarget, 0, 0, FOAM_MASK_RESOLUTION, FOAM_MASK_RESOLUTION, pixels);

    rendererRef.setRenderTarget(prevTarget);
    rendererRef.setClearColor(prevClearColor, prevClearAlpha);
    rendererRef.autoClearColor = prevAutoClear;
    maskScene.clear();

    const total = FOAM_MASK_RESOLUTION * FOAM_MASK_RESOLUTION;
    const inside = new Uint8Array(total);
    const outside = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        const isInside = pixels[i * 4] > 127;
        inside[i] = isInside ? 1 : 0;
        outside[i] = isInside ? 0 : 1;
    }

    const distToInside = edt2d(inside, FOAM_MASK_RESOLUTION, FOAM_MASK_RESOLUTION);
    const distToOutside = edt2d(outside, FOAM_MASK_RESOLUTION, FOAM_MASK_RESOLUTION);
    const sdfBytes = new Uint8Array(total);
    const worldPerPixel = Math.max(maskSize.x, maskSize.y) / FOAM_MASK_RESOLUTION;

    for (let i = 0; i < total; i++) {
        const signedPixelDist = inside[i] ? Math.sqrt(distToOutside[i]) : -Math.sqrt(distToInside[i]);
        const signedWorldDist = signedPixelDist * worldPerPixel;
        const encoded = 0.5 + signedWorldDist / (FOAM_SDF_SPREAD_WORLD * 2);
        sdfBytes[i] = Math.max(0, Math.min(255, Math.round(encoded * 255)));
    }

    if (maskTexture) maskTexture.dispose();
    maskTexture = new DataTexture(sdfBytes, FOAM_MASK_RESOLUTION, FOAM_MASK_RESOLUTION, RedFormat, UnsignedByteType);
    maskTexture.minFilter = LinearFilter;
    maskTexture.magFilter = LinearFilter;
    maskTexture.wrapS = ClampToEdgeWrapping;
    maskTexture.wrapT = ClampToEdgeWrapping;
    maskTexture.needsUpdate = true;

    console.log(`Foam SDF generated: ${FOAM_MASK_RESOLUTION}x${FOAM_MASK_RESOLUTION}, center=(${maskCenter.x.toFixed(2)}, ${maskCenter.y.toFixed(2)}), size=(${maskSize.x.toFixed(2)}, ${maskSize.y.toFixed(2)})`);
}

export function getMaskTexture(): Texture | null {
    return maskTexture;
}

export function getMaskCenter(): { x: number; y: number } {
    return maskCenter;
}

export function getMaskSize(): { x: number; y: number } {
    return maskSize;
}

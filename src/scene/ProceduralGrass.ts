/**
 * ProceduralGrass — Replaces 165+ cloned grass patches with a single merged
 * BufferGeometry containing thousands of X-shaped blade quads.
 *
 * Each blade = 2 quads crossing at 90° (like an X from above), with a random
 * Y-rotation per blade. This gives real normals so Three.js PBR lighting
 * (fire PointLight, directional sun, ambient) works automatically — identical
 * to how GLB models are lit.
 *
 * Wind + mouse interaction injected via onBeforeCompile into MeshStandardMaterial.
 * Ocean lighting injected the same way as other GLB models.
 *
 * Result: 1 draw call, automatic fire/sun/shadow lighting, no manual uniforms.
 */

import {
    BufferGeometry,
    Float32BufferAttribute,
    Mesh,
    MeshStandardMaterial,
    Uniform,
    Vector3,
    DataTexture,
    RepeatWrapping,
    LinearFilter,
    RGBAFormat,
    UnsignedByteType,
    DoubleSide,
    Color,
} from "three";

// ─── Perlin noise generation (CPU, for DataTexture) ────────────────────────

function fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a: number, b: number, t: number): number { return a + t * (b - a); }

const _permutation = (() => {
    const p = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,
        103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,
        197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,
        20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,
        231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,
        102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,
        200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,
        226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,
        47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,
        70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,
        224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,
        12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,
        199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,
        93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
    const arr = new Uint8Array(512);
    for (let i = 0; i < 256; i++) { arr[i] = p[i]; arr[i + 256] = p[i]; }
    return arr;
})();

function grad(hash: number, x: number, y: number): number {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function perlin2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const p = _permutation;
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    return lerp(
        lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
        lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
        v,
    );
}

// ─── Generate Perlin noise DataTexture ─────────────────────────────────────

const NOISE_SIZE = 128;

export function createPerlinTexture(): DataTexture {
    const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4);
    const freq = 4;
    for (let y = 0; y < NOISE_SIZE; y++) {
        for (let x = 0; x < NOISE_SIZE; x++) {
            const nx = (x / NOISE_SIZE) * freq;
            const ny = (y / NOISE_SIZE) * freq;
            // Two octaves for richer variation
            const v = perlin2D(nx, ny) * 0.7 + perlin2D(nx * 2, ny * 2) * 0.3;
            const byte = Math.floor((v * 0.5 + 0.5) * 255);
            const i = (y * NOISE_SIZE + x) * 4;
            data[i]     = byte;
            data[i + 1] = byte;
            data[i + 2] = byte;
            data[i + 3] = 255;
        }
    }
    const tex = new DataTexture(data, NOISE_SIZE, NOISE_SIZE, RGBAFormat, UnsignedByteType);
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

// ─── Blade geometry builder ────────────────────────────────────────────────

export interface BladeConfig {
    /** Number of blades to distribute per spawn point */
    bladesPerPoint: number;
    /** Spread radius around each spawn point */
    spreadRadius: number;
    /** Base blade half-width */
    bladeWidth: number;
    /** Base blade height */
    bladeHeight: number;
    /** Height variation factor (0-1) */
    heightVariation: number;
}

const DEFAULT_BLADE_CONFIG: BladeConfig = {
    bladesPerPoint: 40,
    spreadRadius: 0.12,
    bladeWidth: 0.003,
    bladeHeight: 0.06,
    heightVariation: 0.4,
};

/**
 * Seeded pseudo-random number generator (mulberry32).
 * We need deterministic placement so blades don't shuffle on respawn.
 */
function mulberry32(seed: number): () => number {
    let s = seed | 0;
    return () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Base and tip colors for grass — exported so debug GUI can update them before a respawn.
// Values are set from sRGB hex so the picker hex matches what you see on screen.
// #7ca550 ≈ sRGB equivalent of linear (0.20, 0.38, 0.08)
// #b3d26c ≈ sRGB equivalent of linear (0.45, 0.65, 0.15)
export const grassColorBase = new Color('#7ca550');
export const grassColorTip  = new Color('#b3d26c');

/**
 * Build a single merged BufferGeometry containing all grass blades.
 * Each blade = 2 quads (4 triangles) crossing at 90° with random Y-rotation.
 * Includes real normals, vertex colors, and custom attributes for wind/mouse.
 */
export function buildGrassGeometry(
    spawnPoints: Array<{ x: number; z: number; y?: number }>,
    worldY: number,
    config: Partial<BladeConfig> = {},
    seed = 42,
): BufferGeometry {
    const cfg = { ...DEFAULT_BLADE_CONFIG, ...config };
    const totalBlades = spawnPoints.length * cfg.bladesPerPoint;

    // Each blade = 2 quads = 8 vertices, 4 triangles = 12 indices
    const vertsPerBlade = 8;
    const indicesPerBlade = 12;

    const positions    = new Float32Array(totalBlades * vertsPerBlade * 3);
    const normals      = new Float32Array(totalBlades * vertsPerBlade * 3);
    const colors       = new Float32Array(totalBlades * vertsPerBlade * 3);
    const bladeCenters = new Float32Array(totalBlades * vertsPerBlade * 2);
    const tipness      = new Float32Array(totalBlades * vertsPerBlade);
    const indices      = new Uint32Array(totalBlades * indicesPerBlade);

    const rng = mulberry32(seed);
    let vi = 0;  // vertex index
    let ii = 0;  // index index

    const tmpColor = new Color();

    for (const sp of spawnPoints) {
        const baseY = sp.y !== undefined ? sp.y : worldY;
        for (let b = 0; b < cfg.bladesPerPoint; b++) {
            // Random offset within spread radius
            const angle = rng() * Math.PI * 2;
            const dist  = rng() * cfg.spreadRadius;
            const cx = sp.x + Math.cos(angle) * dist;
            const cz = sp.z + Math.sin(angle) * dist;

            // Per-blade random for height/color variation
            const r = rng();
            const h = cfg.bladeHeight * (1 - cfg.heightVariation + r * cfg.heightVariation);
            const w = cfg.bladeWidth * (0.8 + rng() * 0.4);

            // Random Y-rotation for each blade
            const rotY = rng() * Math.PI;

            // Two quads at 90° apart
            for (let q = 0; q < 2; q++) {
                const qAngle = rotY + q * Math.PI * 0.5;
                const cosA = Math.cos(qAngle);
                const sinA = Math.sin(qAngle);

                // Quad half-width offset
                const dx = cosA * w;
                const dz = sinA * w;

                // Normal is perpendicular to the quad face (horizontal cross product with up)
                const nx = -sinA;
                const nz = cosA;

                // Vertex colors: base→tip gradient + per-blade variation
                // Base vertices
                const baseStyle = 0.5 + r * 0.8;
                tmpColor.copy(grassColorBase).multiplyScalar(baseStyle);
                tmpColor.r += (r - 0.5) * 0.07;
                tmpColor.g += (r - 0.5) * 0.03;
                tmpColor.r = Math.max(0, Math.min(1, tmpColor.r));
                tmpColor.g = Math.max(0, Math.min(1, tmpColor.g));
                tmpColor.b = Math.max(0, Math.min(1, tmpColor.b));
                const baseR = tmpColor.r, baseG = tmpColor.g, baseB = tmpColor.b;

                // Tip color — blend toward tip color with shifted gradient
                const styledTipness = Math.min(1, Math.max(0, 1.0 + (r - 0.5) * 0.5));
                tmpColor.copy(grassColorBase).lerp(grassColorTip, styledTipness).multiplyScalar(baseStyle);
                tmpColor.r += (r - 0.5) * 0.07;
                tmpColor.g += (r - 0.5) * 0.03;
                tmpColor.r = Math.max(0, Math.min(1, tmpColor.r));
                tmpColor.g = Math.max(0, Math.min(1, tmpColor.g));
                tmpColor.b = Math.max(0, Math.min(1, tmpColor.b));
                const tipR = tmpColor.r, tipG = tmpColor.g, tipB = tmpColor.b;

                const baseVi = vi;

                // v0: bottom-left
                let p = vi * 3; let c = vi * 2;
                positions[p] = cx - dx; positions[p+1] = baseY; positions[p+2] = cz - dz;
                normals[p] = nx; normals[p+1] = 0; normals[p+2] = nz;
                colors[p] = baseR; colors[p+1] = baseG; colors[p+2] = baseB;
                bladeCenters[c] = cx; bladeCenters[c+1] = cz;
                tipness[vi] = 0; vi++;

                // v1: bottom-right
                p = vi * 3; c = vi * 2;
                positions[p] = cx + dx; positions[p+1] = baseY; positions[p+2] = cz + dz;
                normals[p] = nx; normals[p+1] = 0; normals[p+2] = nz;
                colors[p] = baseR; colors[p+1] = baseG; colors[p+2] = baseB;
                bladeCenters[c] = cx; bladeCenters[c+1] = cz;
                tipness[vi] = 0; vi++;

                // v2: top-right
                p = vi * 3; c = vi * 2;
                positions[p] = cx + dx; positions[p+1] = baseY + h; positions[p+2] = cz + dz;
                normals[p] = nx; normals[p+1] = 0; normals[p+2] = nz;
                colors[p] = tipR; colors[p+1] = tipG; colors[p+2] = tipB;
                bladeCenters[c] = cx; bladeCenters[c+1] = cz;
                tipness[vi] = 1; vi++;

                // v3: top-left
                p = vi * 3; c = vi * 2;
                positions[p] = cx - dx; positions[p+1] = baseY + h; positions[p+2] = cz - dz;
                normals[p] = nx; normals[p+1] = 0; normals[p+2] = nz;
                colors[p] = tipR; colors[p+1] = tipG; colors[p+2] = tipB;
                bladeCenters[c] = cx; bladeCenters[c+1] = cz;
                tipness[vi] = 1; vi++;

                // Two triangles: (0,1,2) and (0,2,3)
                indices[ii++] = baseVi;
                indices[ii++] = baseVi + 1;
                indices[ii++] = baseVi + 2;
                indices[ii++] = baseVi;
                indices[ii++] = baseVi + 2;
                indices[ii++] = baseVi + 3;
            }
        }
    }

    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal',   new Float32BufferAttribute(normals, 3));
    geom.setAttribute('color',    new Float32BufferAttribute(colors, 3));
    geom.setAttribute('aBladeCenter', new Float32BufferAttribute(bladeCenters, 2));
    geom.setAttribute('aTipness', new Float32BufferAttribute(tipness, 1));
    geom.setIndex(Array.from(indices));
    return geom;
}

// ─── Grass MeshStandardMaterial + onBeforeCompile ──────────────────────────

export interface GrassUniforms {
    uWindTime:      Uniform;
    uWindStrength:  Uniform;
    uNoiseTexture:  Uniform;
    uNoiseScale:    Uniform;
    uMouseWorldPos: Uniform;
    uMouseRadius:   Uniform;
    uMouseStrength: Uniform;
    uLight:         Uniform;
    uAbsorption:    Uniform;
    uSunVisibility: Uniform;
    uFogDist:       Uniform;
    uYOffset:       Uniform;
}

export function createGrassMaterial(
    uniforms: GrassUniforms,
    oceanLightingPars: string,
    oceanLightingFragment: string,
): MeshStandardMaterial {
    const mat = new MeshStandardMaterial({
        vertexColors: true,
        side: DoubleSide,
        roughness: 1.0,
        metalness: 0.0,
        depthWrite: true,
        transparent: false,
    });

    mat.customProgramCacheKey = () => 'procedural_grass';

    mat.onBeforeCompile = (shader) => {
        // Inject uniforms
        shader.uniforms.uWindTime      = uniforms.uWindTime;
        shader.uniforms.uWindStrength   = uniforms.uWindStrength;
        shader.uniforms.uNoiseTexture   = uniforms.uNoiseTexture;
        shader.uniforms.uNoiseScale     = uniforms.uNoiseScale;
        shader.uniforms.uMouseWorldPos  = uniforms.uMouseWorldPos;
        shader.uniforms.uMouseRadius    = uniforms.uMouseRadius;
        shader.uniforms.uMouseStrength  = uniforms.uMouseStrength;
        shader.uniforms.uYOffset        = uniforms.uYOffset;
        // Ocean lighting uniforms
        shader.uniforms.uLight          = uniforms.uLight;
        shader.uniforms.uAbsorption     = uniforms.uAbsorption;
        shader.uniforms.uFogDist        = uniforms.uFogDist;
        shader.uniforms.uSunVisibility  = uniforms.uSunVisibility;

        // ── Vertex shader: add attributes + wind + mouse ──────────────
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            attribute vec2 aBladeCenter;
            attribute float aTipness;
            uniform float uWindTime;
            uniform float uWindStrength;
            uniform sampler2D uNoiseTexture;
            uniform float uNoiseScale;
            uniform vec3 uMouseWorldPos;
            uniform float uMouseRadius;
            uniform float uMouseStrength;
            uniform float uYOffset;
            varying vec3 vWorldPosition;`
        );

        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            transformed.y += uYOffset;

            // Wind via Perlin noise — only tips move
            vec2 noiseUV = aBladeCenter * uNoiseScale + vec2(uWindTime * 0.08, uWindTime * 0.06);
            vec4 noiseVal = texture2D(uNoiseTexture, noiseUV);
            transformed.x += (noiseVal.r - 0.5) * 2.0 * uWindStrength * aTipness;
            transformed.z += (noiseVal.g - 0.5) * 2.0 * uWindStrength * aTipness * 0.6;

            // Mouse interaction — compress tips downward near cursor
            float mDist = length(aBladeCenter - uMouseWorldPos.xz);
            float mT = smoothstep(uMouseRadius, 0.0, mDist);
            transformed.y -= mT * mT * aTipness * uMouseStrength;`
        );

        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`
        );

        // ── Fragment shader: ocean lighting injection ─────────────────
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vWorldPosition;
            ${oceanLightingPars}`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            `${oceanLightingFragment}
            #include <opaque_fragment>`
        );
    };

    mat.needsUpdate = true;
    return mat;
}

export function createGrassMesh(
    spawnPoints: Array<{ x: number; z: number; y?: number }>,
    worldY: number,
    uniforms: GrassUniforms,
    oceanLightingPars: string,
    oceanLightingFragment: string,
    config?: Partial<BladeConfig>,
): Mesh {
    const geom = buildGrassGeometry(spawnPoints, worldY, config);
    const mat  = createGrassMaterial(uniforms, oceanLightingPars, oceanLightingFragment);
    const mesh = new Mesh(geom, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    return mesh;
}


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
    ShaderMaterial,
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
import { GRASS_COLOR_BASE, GRASS_COLOR_TIP } from './config/IslandConfig';
import {
    waterlineYUniform,
    waterlineThicknessUniform,
    waterlineSoftnessUniform,
    waterlineColorUniform,
    waterlineIntensityUniform,
} from '../materials/OceanMaterial';

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
    /** Base blade half-width (distance from tip to side) */
    bladeWidth: number;
    /** Base blade height */
    bladeHeight: number;
    /** Height variation factor (0-1) */
    heightVariation: number;
    /** Minimum blade scale at island edge (0=invisible, 1=full size) */
    minEdgeScale: number;
}

const DEFAULT_BLADE_CONFIG: BladeConfig = {
    bladesPerPoint: 40,
    spreadRadius: 0.12,
    bladeWidth: 0.009,
    bladeHeight: 0.085,
    heightVariation: 0.50,
    minEdgeScale: 0.25,
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
export const grassColorBase = new Color(GRASS_COLOR_BASE);
export const grassColorTip  = new Color(GRASS_COLOR_TIP);

/**
 * Build a single merged BufferGeometry containing all grass blades.
 * Each blade = 1 tall triangle (3 vertices, 1 triangle). Shape: two base
 * corners at ground level + one apex at center+height. Random Y-rotation
 * per blade preserves varied normals so PBR lighting (fire PointLight,
 * directional sun) works correctly — no billboard rotation needed.
 * Blades near the island edge are scaled down via the per-point edgeFactor.
 */
export function buildGrassGeometry(
    spawnPoints: Array<{ x: number; z: number; y?: number; edgeFactor?: number }>,
    worldY: number,
    config: Partial<BladeConfig> = {},
    seed = 42,
): BufferGeometry {
    const cfg = { ...DEFAULT_BLADE_CONFIG, ...config };
    const totalBlades = spawnPoints.length * cfg.bladesPerPoint;

    // Each blade = 1 triangle = 3 vertices, 3 indices
    const vertsPerBlade   = 3;
    const indicesPerBlade = 3;

    const positions    = new Float32Array(totalBlades * vertsPerBlade * 3);
    const normals      = new Float32Array(totalBlades * vertsPerBlade * 3);
    const colors       = new Float32Array(totalBlades * vertsPerBlade * 3);
    const bladeCenters = new Float32Array(totalBlades * vertsPerBlade * 2);
    const tipness      = new Float32Array(totalBlades * vertsPerBlade);
    const indices      = new Uint32Array(totalBlades * indicesPerBlade);

    const rng = mulberry32(seed);
    let vi = 0;  // vertex cursor
    let ii = 0;  // index cursor

    const tmpColor = new Color();

    for (const sp of spawnPoints) {
        const baseY = sp.y !== undefined ? sp.y : worldY;
        // Smooth edge taper: 0 at edge → cfg.minEdgeScale blend → 1 at centre
        const ef         = sp.edgeFactor !== undefined ? sp.edgeFactor : 1.0;
        const edgeScale  = lerp(cfg.minEdgeScale, 1.0, ef);

        for (let b = 0; b < cfg.bladesPerPoint; b++) {
            // Random offset within spread radius
            const spreadAngle = rng() * Math.PI * 2;
            const dist        = rng() * cfg.spreadRadius;
            const cx = sp.x + Math.cos(spreadAngle) * dist;
            const cz = sp.z + Math.sin(spreadAngle) * dist;

            // Per-blade height / width variation
            const r = rng();
            const h = cfg.bladeHeight * edgeScale * (1.0 - cfg.heightVariation + r * cfg.heightVariation);
            const w = cfg.bladeWidth  * edgeScale * (0.8 + rng() * 0.4);

            // Random facing direction
            const rotY = rng() * Math.PI * 2;
            const cosA = Math.cos(rotY);
            const sinA = Math.sin(rotY);

            // Face normal: perpendicular to blade direction in XZ.
            // Derived from cross(edge1, edge2) where:
            //   edge1 = v1-v0 = (2*cosA*w, 0, 2*sinA*w)
            //   edge2 = v2-v0 = (cosA*w,   h, sinA*w)
            //   cross  = (-2*sinA*w*h, 0, 2*cosA*w*h)  →  normalise → (-sinA, 0, cosA)
            const faceNx = -sinA;
            const faceNz =  cosA;

            // Vertex colors — base colour at roots, tip colour at apex
            const baseStyle = 0.5 + r * 0.8;
            tmpColor.copy(grassColorBase).multiplyScalar(baseStyle);
            tmpColor.r = Math.max(0, Math.min(1, tmpColor.r + (r - 0.5) * 0.07));
            tmpColor.g = Math.max(0, Math.min(1, tmpColor.g + (r - 0.5) * 0.03));
            const baseR = tmpColor.r, baseG = tmpColor.g, baseB = tmpColor.b;

            tmpColor.copy(grassColorBase).lerp(grassColorTip, 0.6 + r * 0.4).multiplyScalar(baseStyle);
            tmpColor.r = Math.max(0, Math.min(1, tmpColor.r + (r - 0.5) * 0.07));
            tmpColor.g = Math.max(0, Math.min(1, tmpColor.g + (r - 0.5) * 0.03));
            const tipR  = tmpColor.r, tipG = tmpColor.g, tipB = tmpColor.b;

            const baseVi = vi;

            // v0: bottom-left
            let p = vi * 3, c = vi * 2;
            positions[p    ] = cx - cosA * w;
            positions[p + 1] = baseY;
            positions[p + 2] = cz - sinA * w;
            normals[p    ] = faceNx; normals[p + 1] = 0.0; normals[p + 2] = faceNz;
            colors[p    ] = baseR;  colors[p + 1] = baseG; colors[p + 2] = baseB;
            bladeCenters[c] = cx; bladeCenters[c + 1] = cz;
            tipness[vi] = 0.0; vi++;

            // v1: bottom-right
            p = vi * 3; c = vi * 2;
            positions[p    ] = cx + cosA * w;
            positions[p + 1] = baseY;
            positions[p + 2] = cz + sinA * w;
            normals[p    ] = faceNx; normals[p + 1] = 0.0; normals[p + 2] = faceNz;
            colors[p    ] = baseR;  colors[p + 1] = baseG; colors[p + 2] = baseB;
            bladeCenters[c] = cx; bladeCenters[c + 1] = cz;
            tipness[vi] = 0.0; vi++;

            // v2: apex (tip, centred horizontally)
            // Normal tilted slightly upward so tip catches overhead sun naturally
            p = vi * 3; c = vi * 2;
            positions[p    ] = cx;
            positions[p + 1] = baseY + h;
            positions[p + 2] = cz;
            normals[p    ] = faceNx * 0.8; normals[p + 1] = 0.4; normals[p + 2] = faceNz * 0.8;
            colors[p    ] = tipR;  colors[p + 1] = tipG;  colors[p + 2] = tipB;
            bladeCenters[c] = cx; bladeCenters[c + 1] = cz;
            tipness[vi] = 1.0; vi++;

            indices[ii++] = baseVi;
            indices[ii++] = baseVi + 1;
            indices[ii++] = baseVi + 2;
        }
    }

    const geom = new BufferGeometry();
    geom.setAttribute('position',     new Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal',       new Float32BufferAttribute(normals, 3));
    geom.setAttribute('color',        new Float32BufferAttribute(colors, 3));
    geom.setAttribute('aBladeCenter', new Float32BufferAttribute(bladeCenters, 2));
    geom.setAttribute('aTipness',     new Float32BufferAttribute(tipness, 1));
    geom.setIndex(Array.from(indices));
    return geom;
}

/**
 * Creates a single merged-geometry dark floor covering all grass spawn points.
 * Each spawn point contributes one flat polygon disc, with vertices pre-baked
 * at world XZ coordinates — no instancing, no instanceMatrix, no GL extensions.
 * Overlapping discs accumulate naturally over dense areas.
 *
 * @param instanceRadius  World-space radius per disc (≈ spreadRadius + margin)
 */
export function createShadowFloorMesh(
    spawnPoints: Array<{ x: number; z: number; edgeFactor?: number }>,
    cy: number,
    instanceRadius: number,
    opacity: number,
    colorHex: string,
): Mesh {
    const SEGS = 10;  // triangles per disc (low-poly is fine, shadow is soft)
    const count = spawnPoints.length;

    const vertsPerDisc = SEGS + 1;          // 1 centre + SEGS ring verts
    const positions = new Float32Array(count * vertsPerDisc * 3);
    const uvs       = new Float32Array(count * vertsPerDisc * 2);
    const indices   = new Uint32Array(count * SEGS * 3);

    let vi = 0, ii = 0;
    for (let d = 0; d < count; d++) {
        const sp    = spawnPoints[d];
        const ef    = sp.edgeFactor ?? 1.0;
        const r     = instanceRadius * ef;
        const baseVi = vi;

        // Centre vertex  (UV = 0.5, 0.5 so d=0 → fully opaque)
        positions[vi * 3]     = sp.x;
        positions[vi * 3 + 1] = cy;
        positions[vi * 3 + 2] = sp.z;
        uvs[vi * 2]     = 0.5;
        uvs[vi * 2 + 1] = 0.5;
        vi++;

        // Ring vertices (UV on unit circle edge)
        for (let s = 0; s < SEGS; s++) {
            const a = (s / SEGS) * Math.PI * 2;
            const cosA = Math.cos(a), sinA = Math.sin(a);
            positions[vi * 3]     = sp.x + cosA * r;
            positions[vi * 3 + 1] = cy;
            positions[vi * 3 + 2] = sp.z + sinA * r;
            uvs[vi * 2]     = cosA * 0.5 + 0.5;
            uvs[vi * 2 + 1] = sinA * 0.5 + 0.5;
            vi++;
        }

        // Fan triangles: (centre, ring[s], ring[(s+1)%SEGS])
        for (let s = 0; s < SEGS; s++) {
            indices[ii++] = baseVi;
            indices[ii++] = baseVi + 1 + s;
            indices[ii++] = baseVi + 1 + (s + 1) % SEGS;
        }
    }

    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geom.setAttribute('uv',       new Float32BufferAttribute(uvs, 2));
    geom.setIndex(Array.from(indices));

    const colorObj = new Color(colorHex);
    const material = new ShaderMaterial({
        transparent:   true,
        depthWrite:    false,
        side:          DoubleSide,
        polygonOffset:       true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits:  -1,
        uniforms: {
            uColor:   { value: new Vector3(colorObj.r, colorObj.g, colorObj.b) },
            uOpacity: { value: opacity },
        },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform vec3  uColor;
            uniform float uOpacity;
            varying vec2  vUv;
            void main() {
                float d     = length(vUv - vec2(0.5)) * 2.0;
                float alpha = (1.0 - smoothstep(0.1, 1.0, d)) * uOpacity;
                gl_FragColor = vec4(uColor, alpha);
            }
        `,
    });

    const mesh = new Mesh(geom, material);
    mesh.frustumCulled = false;
    mesh.renderOrder   = 1;  // after opaque island surface
    return mesh;
}

// ─── Grass MeshStandardMaterial + onBeforeCompile ──────────────────────────

export interface GrassUniforms {
    uWindTime:       Uniform;
    uWindStrength:   Uniform;
    uWobbleStrength: Uniform;
    uNoiseTexture:   Uniform;
    uNoiseScale:     Uniform;
    uMouseWorldPos:  Uniform;
    uMouseRadius:    Uniform;
    uMouseStrength:  Uniform;
    uLight:          Uniform;
    uAbsorption:     Uniform;
    uSunVisibility:  Uniform;
    uFogDist:        Uniform;
    uYOffset:        Uniform;
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
        shader.uniforms.uWindTime       = uniforms.uWindTime;
        shader.uniforms.uWindStrength   = uniforms.uWindStrength;
        shader.uniforms.uWobbleStrength = uniforms.uWobbleStrength;
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
        shader.uniforms.uWaterlineY = waterlineYUniform;
        shader.uniforms.uWaterlineThickness = waterlineThicknessUniform;
        shader.uniforms.uWaterlineSoftness = waterlineSoftnessUniform;
        shader.uniforms.uWaterlineColor = waterlineColorUniform;
        shader.uniforms.uWaterlineIntensity = waterlineIntensityUniform;

        // ── Vertex shader: add attributes + wind + mouse ──────────────
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            attribute vec2 aBladeCenter;
            attribute float aTipness;
            uniform float uWindTime;
            uniform float uWindStrength;
            uniform float uWobbleStrength;
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

            // Wind via Perlin noise — wobble always on, breeze adds extra sway
            vec2 noiseUV = aBladeCenter * uNoiseScale + vec2(uWindTime * 0.08, uWindTime * 0.06);
            vec4 noiseVal = texture2D(uNoiseTexture, noiseUV);
            transformed.x += (noiseVal.r - 0.5) * 2.0 * (uWobbleStrength + uWindStrength) * aTipness;
            transformed.z += (noiseVal.g - 0.5) * 2.0 * (uWobbleStrength + uWindStrength) * aTipness * 0.6;

            // Mouse interaction — deflect tips away from cursor (XZ repulsion)
            vec2 bladeToCursor = uMouseWorldPos.xz - aBladeCenter;
            float mDist = length(bladeToCursor);
            float mT = smoothstep(uMouseRadius, 0.0, mDist) * aTipness * uMouseStrength;
            vec2 awayDir = mDist > 0.001 ? normalize(-bladeToCursor) : vec2(1.0, 0.0);
            transformed.x += awayDir.x * mT;
            transformed.z += awayDir.y * mT;`
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


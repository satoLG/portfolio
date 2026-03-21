/**
 * SeaFloorDecor — 3 coral rocks, 3 corals, 3 kelps.
 * Each model is explicitly placed via SeaFloorConfig.ts.
 *
 * Call Start() once (loads GLTF models asynchronously).
 * Call Update(dt) every frame.
 * Add decorGroup to the Three.js scene from Scene.ts.
 */
import { Group, Mesh, Uniform } from "three";
import { GLTFLoader }           from "three/examples/jsm/loaders/GLTFLoader";
import { oceanAbsorptionUniform, underwaterFogDistUniform, waveVelocity1Uniform, waveVelocity2Uniform } from "../materials/OceanMaterial";
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial";
import { timeUniform }          from "../scripts/Time";
import * as C                   from "./SeaFloorConfig";

// ── Live config ────────────────────────────────────────────────────────────────
export const config = {
    rock1:  { ...C.rock1  },
    rock2:  { ...C.rock2  },
    rock3:  { ...C.rock3  },
    coral1: { ...C.coral1 },
    coral2: { ...C.coral2 },
    coral3: { ...C.coral3 },
    kelp1:  { ...C.kelp1  },
    kelp2:  { ...C.kelp2  },
    kelp3:  { ...C.kelp3  },
    kelpTopY:          C.kelpTopY,
    kelpSwayStrength:  C.kelpSwayStrength,
    kelpSwaySpeed:     C.kelpSwaySpeed,
    kelpSwayFrequency: C.kelpSwayFrequency,
};

// ── Scene group ────────────────────────────────────────────────────────────────
export const decorGroup = new Group();

// ── Per-instance group references ────────────────────────────────────────────
const _rocks:  (Group | null)[] = [null, null, null]; // rock1, rock2, rock3
const _corals: (Group | null)[] = [null, null, null]; // coral1, coral2, coral3
const _kelps:  (Group | null)[] = [null, null, null]; // kelp1, kelp2, kelp3

// ── Shared kelp animation uniforms ────────────────────────────────────────────
export const kelpTimeUniform  = new Uniform(0.0);
export const kelpSwayUniform  = new Uniform(C.kelpSwayStrength);
export const kelpFreqUniform  = new Uniform(C.kelpSwayFrequency);
export const kelpTopYUniform  = new Uniform(C.kelpTopY);

// ── GLTF template cache ────────────────────────────────────────────────────────
let rockTemplates: (Group | null)[] = [null, null, null];
let coralTemplate: Group | null     = null;
let kelpTemplate:  Group | null     = null;
let loadedCount = 0;
const TOTAL_MODELS = 5;

// ── GLSL snippets (identical to Island.ts) ────────────────────────────────────
const oceanLightingPars = /*glsl*/`
    uniform vec3  uLight;
    uniform vec3  uAbsorption;
    uniform float uSunVisibility;
    uniform float uFogDist;
    const float DENSITY        = 0.35;
    const float FOG_DISTANCE   = 600.0;
`;

const oceanLightingFragment = /*glsl*/`
    vec3 worldPos = vWorldPosition;
    vec3 viewVec  = worldPos - cameraPosition;
    float viewLen = length(viewVec);
    vec3 viewDir  = viewVec / viewLen;
    if (worldPos.y > 0.0) {
        float fogStartLen = viewLen;
        if (cameraPosition.y < 0.0) { fogStartLen -= cameraPosition.y / -viewDir.y; }
        float fog = clamp(fogStartLen / FOG_DISTANCE, 0.0, 1.0);
        fog = fog * fog;
        vec3 horizonColor = mix(vec3(0.07, 0.13, 0.18), vec3(0.7, 0.85, 0.95), uSunVisibility);
        outgoingLight = mix(outgoingLight, horizonColor, fog);
    } else {
        float uwLen   = viewLen;
        float originY = cameraPosition.y;
        if (cameraPosition.y > 0.0) { uwLen -= cameraPosition.y / -viewDir.y; originY = 0.0; }
        uwLen = min(uwLen, uFogDist);
        float sampleY = originY + viewDir.y * uwLen;
        vec3  uwLight = exp((sampleY - uwLen * DENSITY) * uAbsorption) * uLight;
        outgoingLight *= uwLight;
        float uwFog = min(uwLen / uFogDist, 1.0);
        outgoingLight = mix(outgoingLight, uwLight * 0.3, uwFog);
    }
`;

// ── Ocean lighting injector ────────────────────────────────────────────────────
/**
 * Apply the underwater lighting shader to every mesh in `model`.
 * `cacheKeySuffix` lets corals with different tints share the base lighting
 * program (only the uniforms differ, so one suffix per-colour is enough).
 */
function applyOceanLighting(model: Group, cacheKeySuffix = ''): void {
    model.traverse((child) => {
        if (!(child as Mesh).isMesh) return;
        const mesh = child as Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat: any) => {
            if (!(mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshBasicMaterial)) return;
            const key = 'ocean_lighting_sf' + cacheKeySuffix;
            mat.customProgramCacheKey = () => key;
            mat.onBeforeCompile = (shader: any) => {
                shader.uniforms.uLight          = lightUniform;
                shader.uniforms.uAbsorption     = oceanAbsorptionUniform;
                shader.uniforms.uFogDist        = underwaterFogDistUniform;
                shader.uniforms.uSunVisibility  = sunVisibilityUniform;
                shader.uniforms.uTime           = timeUniform;
                shader.uniforms.uWaveVelocity1  = waveVelocity1Uniform;
                shader.uniforms.uWaveVelocity2  = waveVelocity2Uniform;

                shader.vertexShader = shader.vertexShader.replace(
                    '#include <common>',
                    '#include <common>\nvarying vec3 vWorldPosition;'
                );
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <worldpos_vertex>',
                    '#include <worldpos_vertex>\nvWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;'
                );
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    `#include <common>\nvarying vec3 vWorldPosition;\n${oceanLightingPars}`
                );
                // Inject BEFORE #include <opaque_fragment> — that's where gl_FragColor is SET
                // from outgoingLight. Injecting at dithering_fragment would be after the
                // assignment and have zero effect.
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <opaque_fragment>',
                    `${oceanLightingFragment}\n#include <opaque_fragment>`
                );
            };
            mat.needsUpdate = true;
        });
    });
}

// ── Kelp sway injector ────────────────────────────────────────────────────────
/**
 * Apply the kelp sway + ocean lighting shader to every mesh in `model`.
 * All kelp instances share `sf_kelp_sway` as the cache key so the GLSL is
 * compiled only once.  Only `uKelpPhase` differs per instance (captured by
 * the closure).
 */
function applyKelpSway(model: Group, phaseOffset: number): void {
    const phaseUniform = new Uniform(phaseOffset);  // unique per instance

    model.traverse((child) => {
        if (!(child as Mesh).isMesh) return;
        const mesh = child as Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat: any) => {
            if (!(mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshBasicMaterial)) return;
            mat.customProgramCacheKey = () => 'sf_kelp_sway';
            mat.onBeforeCompile = (shader: any) => {
                // Uniforms
                shader.uniforms.uKelpTime      = kelpTimeUniform;   // shared
                shader.uniforms.uKelpSway      = kelpSwayUniform;   // shared
                shader.uniforms.uKelpTopY      = kelpTopYUniform;   // shared
                shader.uniforms.uKelpFreq      = kelpFreqUniform;   // shared
                shader.uniforms.uKelpPhase     = phaseUniform;      // per-instance
                shader.uniforms.uLight         = lightUniform;
                shader.uniforms.uAbsorption    = oceanAbsorptionUniform;
                shader.uniforms.uFogDist       = underwaterFogDistUniform;
                shader.uniforms.uSunVisibility = sunVisibilityUniform;
                shader.uniforms.uTime          = timeUniform;
                shader.uniforms.uWaveVelocity1 = waveVelocity1Uniform;
                shader.uniforms.uWaveVelocity2 = waveVelocity2Uniform;

                // Vertex — declare uniforms + world pos varying
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <common>',
                    `#include <common>
uniform float uKelpTime;
uniform float uKelpPhase;
uniform float uKelpSway;
uniform float uKelpTopY;
uniform float uKelpFreq;
varying vec3 vWorldPosition;`
                );

                // Vertex — sway deformation
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    `#include <begin_vertex>
// Height factor: 0 at base (rooted), 1 at tip — quadratic for natural droop suppression
float kelpFactor = clamp(position.y / max(uKelpTopY, 0.01), 0.0, 1.0);
kelpFactor = kelpFactor * kelpFactor;
float t = uKelpTime + uKelpPhase;
// Multi-frequency sway in X and Z — simulates underwater current turbulence
float swayX = sin(t * 1.10 + position.y * uKelpFreq * 0.90) * 0.60
            + sin(t * 2.37 + position.y * uKelpFreq * 0.45) * 0.28
            + sin(t * 3.83 + position.y * uKelpFreq * 0.20) * 0.12;
float swayZ = cos(t * 0.97 + position.y * uKelpFreq * 0.75) * 0.50
            + cos(t * 1.94 + position.y * uKelpFreq * 0.38) * 0.28
            + cos(t * 4.11 + position.y * uKelpFreq * 0.15) * 0.12;
transformed.x += swayX * uKelpSway * kelpFactor;
transformed.z += swayZ * uKelpSway * kelpFactor;`
                );

                // Vertex — world position for lighting
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <worldpos_vertex>',
                    '#include <worldpos_vertex>\nvWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;'
                );

                // Fragment — ocean lighting (inject BEFORE opaque_fragment where gl_FragColor is set)
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    `#include <common>\nvarying vec3 vWorldPosition;\n${oceanLightingPars}`
                );
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <opaque_fragment>',
                    `${oceanLightingFragment}\n#include <opaque_fragment>`
                );
            };
            mat.needsUpdate = true;
        });
    });
}

// ── Material deep-clone ────────────────────────────────────────────────────────
/**
 * Clone a Group and give every mesh its own independent material instance so
 * that per-instance colour tints and shader closures don't bleed across copies.
 */
function cloneModel(template: Group): Group {
    const clone = template.clone(true);
    clone.traverse((child) => {
        if (!(child as Mesh).isMesh) return;
        const mesh = child as Mesh;
        if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map((m: any) => m.clone());
        } else if (mesh.material) {
            mesh.material = (mesh.material as any).clone();
        }
    });
    return clone;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
type Placement = { x: number; y: number; z: number; scale: number; rx: number; ry: number; rz: number };

function applyPlacement(group: Group, p: Placement): void {
    group.position.set(p.x, p.y, p.z);
    group.scale.setScalar(p.scale);
    group.rotation.set(p.rx, p.ry, p.rz);
}

function applyCoralColor(group: Group, r: number, g: number, b: number): void {
    group.traverse((child) => {
        if (!(child as Mesh).isMesh) return;
        const mesh = child as Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat: any) => { if (mat.color) mat.color.setRGB(r, g, b); });
    });
}

// ── Spawn ─────────────────────────────────────────────────────────────────────
function spawnAll(): void {
    while (decorGroup.children.length > 0) decorGroup.remove(decorGroup.children[0]);
    for (let i = 0; i < 3; i++) { _rocks[i] = null; _corals[i] = null; _kelps[i] = null; }

    kelpSwayUniform.value = config.kelpSwayStrength;
    kelpFreqUniform.value = config.kelpSwayFrequency;
    kelpTopYUniform.value = config.kelpTopY;

    const rockCfgs  = [config.rock1,  config.rock2,  config.rock3 ];
    const coralCfgs = [config.coral1, config.coral2, config.coral3];
    const kelpCfgs  = [config.kelp1,  config.kelp2,  config.kelp3 ];
    const kelpPhases = [0.0, 2.094, 4.189]; // 0, 2π/3, 4π/3 — stagger sway

    for (let i = 0; i < 3; i++) {
        if (rockTemplates[i]) {
            const rock = cloneModel(rockTemplates[i]!);
            applyPlacement(rock, rockCfgs[i]);
            applyOceanLighting(rock);
            decorGroup.add(rock);
            _rocks[i] = rock;
        }
        if (coralTemplate) {
            const coral = cloneModel(coralTemplate);
            applyPlacement(coral, coralCfgs[i]);
            applyCoralColor(coral, coralCfgs[i].r, coralCfgs[i].g, coralCfgs[i].b);
            applyOceanLighting(coral, `_c${i}`);
            decorGroup.add(coral);
            _corals[i] = coral;
        }
        if (kelpTemplate) {
            const kelp = cloneModel(kelpTemplate);
            applyPlacement(kelp, kelpCfgs[i]);
            applyKelpSway(kelp, kelpPhases[i]);
            decorGroup.add(kelp);
            _kelps[i] = kelp;
        }
    }
}

// ── GLTF loading ───────────────────────────────────────────────────────────────
function loadModels(): void {
    const loader = new GLTFLoader();

    const entries: Array<{ path: string; onLoad: (g: Group) => void }> = [
        { path: 'models/underwater/coral_rock1.glb', onLoad: g => { rockTemplates[0] = g; } },
        { path: 'models/underwater/coral_rock2.glb', onLoad: g => { rockTemplates[1] = g; } },
        { path: 'models/underwater/coral_rock3.glb', onLoad: g => { rockTemplates[2] = g; } },
        { path: 'models/underwater/coral.glb',       onLoad: g => { coralTemplate = g; } },
        { path: 'models/underwater/kelp.glb',        onLoad: g => { kelpTemplate  = g; } },
    ];

    for (const entry of entries) {
        loader.load(entry.path, (gltf) => {
            entry.onLoad(gltf.scene);
            loadedCount++;
            if (loadedCount >= TOTAL_MODELS) spawnAll();
        }, undefined, (err) => {
            console.error(`[SeaFloorDecor] Failed to load ${entry.path}:`, err);
            loadedCount++;
            if (loadedCount >= TOTAL_MODELS) spawnAll();
        });
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Apply config.rockN transform to the live group immediately (no respawn). */
export function updateRockTransform(idx: 0 | 1 | 2): void {
    const group = _rocks[idx];
    if (!group) return;
    applyPlacement(group, [config.rock1, config.rock2, config.rock3][idx]);
}

/** Apply config.coralN transform to the live group immediately (no respawn). */
export function updateCoralTransform(idx: 0 | 1 | 2): void {
    const group = _corals[idx];
    if (!group) return;
    applyPlacement(group, [config.coral1, config.coral2, config.coral3][idx]);
}

/** Apply config.coralN color to the live group immediately (no respawn). */
export function updateCoralColor(idx: 0 | 1 | 2): void {
    const group = _corals[idx];
    if (!group) return;
    const c = [config.coral1, config.coral2, config.coral3][idx];
    applyCoralColor(group, c.r, c.g, c.b);
}

/** Apply config.kelpN transform to the live group immediately (no respawn). */
export function updateKelpTransform(idx: 0 | 1 | 2): void {
    const group = _kelps[idx];
    if (!group) return;
    applyPlacement(group, [config.kelp1, config.kelp2, config.kelp3][idx]);
}

export function Start(): void {
    loadModels();
}

export function Update(dt: number): void {
    kelpTimeUniform.value += dt * config.kelpSwaySpeed;
    kelpSwayUniform.value  = config.kelpSwayStrength;
    kelpFreqUniform.value  = config.kelpSwayFrequency;
    kelpTopYUniform.value  = config.kelpTopY;
}

/** Clear all decorations and re-spawn every model using current config values. */
export function respawn(): void {
    if (loadedCount < TOTAL_MODELS) {
        console.warn('[SeaFloorDecor] Models still loading — respawn queued for when they finish.');
        return;
    }
    spawnAll();
}


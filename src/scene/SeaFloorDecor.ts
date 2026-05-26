/**
 * SeaFloorDecor — 3 coral rocks, 3 corals, 3 kelps.
 * Each model is explicitly placed via SeaFloorConfig.ts.
 *
 * Call Start() once (loads GLTF models asynchronously).
 * Call Update(dt) every frame.
 * Add decorGroup to the Three.js scene from Scene.ts.
 */
import { Group, Mesh, Uniform, Vector2, Vector3, Box3, Sphere, AnimationMixer, LoopRepeat } from "three";
import { GLTFLoader }           from "three/examples/jsm/loaders/GLTFLoader";
import { MeshoptDecoder }       from "three/examples/jsm/libs/meshopt_decoder.module.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — r137 @types declares a namespace but the module exports clone directly
import { clone as _skeletonClone } from "three/examples/jsm/utils/SkeletonUtils";
import {
    oceanAbsorptionUniform,
    underwaterFogDistUniform,
    waveVelocity1Uniform,
    waveVelocity2Uniform,
    waterlinePars,
    waterlineFragment,
    waterlineYUniform,
    waterlineThicknessUniform,
    waterlineSoftnessUniform,
    waterlineColorUniform,
    waterlineIntensityUniform,
} from "../materials/OceanMaterial";
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial";
import { timeUniform }          from "../core/Time";
import { camera, renderer }     from "../core/Scene";
import { playCoralHitSound } from "../core/Audio";
import { spawnBubble }          from "../effects/Bubbles";
import { UNDERWATER_Y_THRESHOLD } from "../effects/PostProcess";
import * as C                   from "./config/SeaFloorConfig";

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
    chest:            { ...C.chest },
    chestZoomDist:    C.chestZoomDist,
    chestZoomHeight:  C.chestZoomHeight,
    chestZoomFov:        C.chestZoomFov,
    chestZoomMobileFov:  C.chestZoomMobileFov,
    chestZoomPitch:   C.chestZoomPitch,
    chestGlowX:         C.chestGlowX,
    chestGlowY:         C.chestGlowY,
    chestGlowZ:         C.chestGlowZ,
    chestGlowIntensity: C.chestGlowIntensity,
    chestGlowDistance:  C.chestGlowDistance,
    chestRayRadius:     C.chestRayRadius,
    chestRayMaxOpacity: C.chestRayMaxOpacity,
    chestCoinRevealDelay: C.chestCoinRevealDelay,
    chestCoinHideDelay:   C.chestCoinHideDelay,
    chestCoin1:         { ...C.chestCoin1 },
    chestCoin2:       { ...C.chestCoin2 },
    chestCoin3:       { ...C.chestCoin3 },
    chestCoin1Color:  { ...C.chestCoin1Color },
    chestCoin2Color:  { ...C.chestCoin2Color },
    chestCoin3Color:  { ...C.chestCoin3Color },
    // New scattered props
    coral1Left:  { ...C.coral1Left  },
    coral1Right: { ...C.coral1Right },
    coral2Left:  { ...C.coral2Left  },
    coral2Right: { ...C.coral2Right },
    anemone:           { ...C.anemone },
    anemoneTopY:       C.anemoneTopY,
    anemoneSwayStrength:  C.anemoneSwayStrength,
    anemoneSwaySpeed:     C.anemoneSwaySpeed,
    anemoneSwayFrequency: C.anemoneSwayFrequency,
    anemoneFish1: { ...C.anemoneFish1 },
    anemoneFish2: { ...C.anemoneFish2 },
    starfish: { ...C.starfish },
    crab:     { ...C.crab     },
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
// New templates for the extra props
let coral1Template:    Group | null = null;
let coral2Template:    Group | null = null;
let anemoneTemplate:   Group | null = null;
let starfishTemplate:  Group | null = null;
let crabTemplate:      Group | null = null;
let clownfishTemplate: Group | null = null;
let clownfishAnimations: import("three").AnimationClip[] = [];
let crabAnimations:      import("three").AnimationClip[] = [];
let loadedCount = 0;
const TOTAL_MODELS = 11; // 3 rocks + coral + kelp + coral1 + coral2 + anemone + starfish + crab + clownfish

// Per-frame mixers + spawned references for the new props
let crabMixer: AnimationMixer | null = null;
let anemoneFish1Mixer: AnimationMixer | null = null;
let anemoneFish2Mixer: AnimationMixer | null = null;
let _anemoneGroup: Group | null = null;
let _starfishGroup: Group | null = null;
let _crabGroup: Group | null = null;
let _anemoneFish1Group: Group | null = null;
let _anemoneFish2Group: Group | null = null;
const _extraCorals: (Group | null)[] = [null, null, null, null];  // [c1L, c1R, c2L, c2R]

// Dedicated sway uniforms for the anemone — kept separate from kelp so the
// look can be tuned independently while reusing the same shader injector.
const anemoneTimeUniform = new Uniform(0.0);
const anemoneSwayUniform = new Uniform(C.anemoneSwayStrength);
const anemoneFreqUniform = new Uniform(C.anemoneSwayFrequency);
const anemoneTopYUniform = new Uniform(C.anemoneTopY);

/** True once all 5 underwater decoration GLTFs have finished loading. */
export function isLoaded(): boolean { return loadedCount >= TOTAL_MODELS; }

// ── GLSL snippets (identical to Island.ts) ────────────────────────────────────
const oceanLightingPars = /*glsl*/`
    uniform vec3  uLight;
    uniform vec3  uAbsorption;
    uniform float uSunVisibility;
    uniform float uFogDist;
    const float DENSITY        = 0.35;
    const float FOG_DISTANCE   = 600.0;
    ${waterlinePars}
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
    ${waterlineFragment}
`;

function bindWaterlineUniforms(shader: any): void {
    shader.uniforms.uWaterlineY = waterlineYUniform;
    shader.uniforms.uWaterlineThickness = waterlineThicknessUniform;
    shader.uniforms.uWaterlineSoftness = waterlineSoftnessUniform;
    shader.uniforms.uWaterlineColor = waterlineColorUniform;
    shader.uniforms.uWaterlineIntensity = waterlineIntensityUniform;
}

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
                bindWaterlineUniforms(shader);
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
 * The four shared uniforms (time/sway/topY/freq) are passed in so the same
 * shader injector can power both kelp instances and any other prop that wants
 * the same vertex-distortion-on-top behaviour (e.g. the anemone).
 * `cacheKey` lets each prop family compile its own program once.
 */
type SwayUniforms = {
    time: Uniform<number>;
    sway: Uniform<number>;
    topY: Uniform<number>;
    freq: Uniform<number>;
};

function applyKelpSway(model: Group, phaseOffset: number, uniforms: SwayUniforms = { time: kelpTimeUniform, sway: kelpSwayUniform, topY: kelpTopYUniform, freq: kelpFreqUniform }, cacheKey: string = 'sf_kelp_sway'): void {
    const phaseUniform = new Uniform(phaseOffset);  // unique per instance

    model.traverse((child) => {
        if (!(child as Mesh).isMesh) return;
        const mesh = child as Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat: any) => {
            if (!(mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshBasicMaterial)) return;
            mat.customProgramCacheKey = () => cacheKey;
            mat.onBeforeCompile = (shader: any) => {
                // Uniforms
                shader.uniforms.uKelpTime      = uniforms.time;     // shared per family
                shader.uniforms.uKelpSway      = uniforms.sway;     // shared per family
                shader.uniforms.uKelpTopY      = uniforms.topY;     // shared per family
                shader.uniforms.uKelpFreq      = uniforms.freq;     // shared per family
                shader.uniforms.uKelpPhase     = phaseUniform;      // per-instance
                shader.uniforms.uLight         = lightUniform;
                shader.uniforms.uAbsorption    = oceanAbsorptionUniform;
                shader.uniforms.uFogDist       = underwaterFogDistUniform;
                shader.uniforms.uSunVisibility = sunVisibilityUniform;
                bindWaterlineUniforms(shader);
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

    // ── Extra props (corals around rocks, anemone, starfish, crab, fish) ────
    _spawnExtras();

    _initCoralStates();
}

/** Spawn the new scattered props introduced in the visual_enhancements_2 batch.
 *  Each prop is parented to decorGroup so the existing surface↔underwater
 *  visibility gating already covers them. */
function _spawnExtras(): void {
    // Reset previously spawned references
    for (let i = 0; i < _extraCorals.length; i++) _extraCorals[i] = null;
    _anemoneGroup = null;
    _starfishGroup = null;
    _crabGroup = null;
    _anemoneFish1Group = null;
    _anemoneFish2Group = null;
    crabMixer = null;
    anemoneFish1Mixer = null;
    anemoneFish2Mixer = null;

    // Refresh anemone-specific uniforms from config (kept independent from kelp)
    anemoneSwayUniform.value = config.anemoneSwayStrength;
    anemoneFreqUniform.value = config.anemoneSwayFrequency;
    anemoneTopYUniform.value = config.anemoneTopY;

    // Extra corals: same shader as the main corals, individually tintable.
    const extraCoralCfgs = [
        { cfg: config.coral1Left,  tmpl: coral1Template, key: '_xc1l' },
        { cfg: config.coral1Right, tmpl: coral1Template, key: '_xc1r' },
        { cfg: config.coral2Left,  tmpl: coral2Template, key: '_xc2l' },
        { cfg: config.coral2Right, tmpl: coral2Template, key: '_xc2r' },
    ];
    for (let i = 0; i < extraCoralCfgs.length; i++) {
        const { cfg, tmpl, key } = extraCoralCfgs[i];
        if (!tmpl) continue;
        const g = cloneModel(tmpl);
        applyPlacement(g, cfg);
        applyCoralColor(g, cfg.r, cfg.g, cfg.b);
        applyOceanLighting(g, key);
        decorGroup.add(g);
        _extraCorals[i] = g;
    }

    // Anemone — kelp-sway shader with its own uniforms so top fronds wave
    // distinctly from the regular kelp.
    if (anemoneTemplate) {
        const g = cloneModel(anemoneTemplate);
        applyPlacement(g, config.anemone);
        applyKelpSway(g, 0.0, {
            time: anemoneTimeUniform,
            sway: anemoneSwayUniform,
            topY: anemoneTopYUniform,
            freq: anemoneFreqUniform,
        }, 'sf_anemone_sway');
        decorGroup.add(g);
        _anemoneGroup = g;
    }

    // Starfish — static, ocean-lit, sits on the floor near the chest.
    if (starfishTemplate) {
        const g = cloneModel(starfishTemplate);
        applyPlacement(g, config.starfish);
        applyOceanLighting(g, '_starfish');
        decorGroup.add(g);
        _starfishGroup = g;
    }

    // Crab — same lighting + its own animation mixer driven from Update().
    if (crabTemplate) {
        const g = cloneModel(crabTemplate);
        applyPlacement(g, config.crab);
        applyOceanLighting(g, '_crab');
        decorGroup.add(g);
        _crabGroup = g;
        if (crabAnimations.length > 0) {
            crabMixer = new AnimationMixer(g);
            const action = crabMixer.clipAction(crabAnimations[0]);
            action.play();
        }
    }

    // Two tiny clownfish that swim in a small circle around the anemone.
    // Pattern mirrors the working circular clownfish in Fish.ts exactly:
    //   - SkeletonUtils.clone (NOT Object3D.clone) so each instance has its
    //     own skeleton — without this the AnimationMixer has nothing of its
    //     own to drive and the model stays in the giant bind pose.
    //   - The clone is wrapped in a parent Group; scale is applied to the
    //     wrapper, position/rotation are animated per frame.
    if (clownfishTemplate) {
        const spawnFish = (cfg: { scale: number }): { wrapper: Group; mixer: AnimationMixer | null } => {
            const scene = _skeletonClone(clownfishTemplate!) as Group;
            applyOceanLighting(scene, '_anemfish');
            const wrapper = new Group();
            wrapper.add(scene);
            wrapper.scale.setScalar(cfg.scale);
            decorGroup.add(wrapper);
            let mixer: AnimationMixer | null = null;
            if (clownfishAnimations.length > 0) {
                mixer = new AnimationMixer(scene);
                const action = mixer.clipAction(clownfishAnimations[0]);
                action.setLoop(LoopRepeat, Infinity);
                action.play();
            }
            return { wrapper, mixer };
        };
        const f1 = spawnFish(config.anemoneFish1);
        _anemoneFish1Group = f1.wrapper;
        anemoneFish1Mixer = f1.mixer;
        const f2 = spawnFish(config.anemoneFish2);
        _anemoneFish2Group = f2.wrapper;
        anemoneFish2Mixer = f2.mixer;
    }
}

/** Re-apply transform from config to a specific extra prop (called by debug GUI). */
export function updateExtraCoralTransform(idx: 0 | 1 | 2 | 3): void {
    const g = _extraCorals[idx];
    if (!g) return;
    const cfgs = [config.coral1Left, config.coral1Right, config.coral2Left, config.coral2Right];
    applyPlacement(g, cfgs[idx]);
}
export function updateExtraCoralColor(idx: 0 | 1 | 2 | 3): void {
    const g = _extraCorals[idx];
    if (!g) return;
    const cfgs = [config.coral1Left, config.coral1Right, config.coral2Left, config.coral2Right];
    const c = cfgs[idx];
    applyCoralColor(g, c.r, c.g, c.b);
}
export function updateAnemoneTransform(): void { if (_anemoneGroup) applyPlacement(_anemoneGroup, config.anemone); }
export function updateStarfishTransform(): void { if (_starfishGroup) applyPlacement(_starfishGroup, config.starfish); }
export function updateCrabTransform(): void { if (_crabGroup) applyPlacement(_crabGroup, config.crab); }

// ── GLTF loading ───────────────────────────────────────────────────────────────
function loadModels(): void {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    type Entry = { path: string; onLoad: (gltf: { scene: Group; animations: import("three").AnimationClip[] }) => void };
    const entries: Entry[] = [
        { path: 'models/underwater/coral_rock1.glb', onLoad: g => { rockTemplates[0] = g.scene; } },
        { path: 'models/underwater/coral_rock2.glb', onLoad: g => { rockTemplates[1] = g.scene; } },
        { path: 'models/underwater/coral_rock3.glb', onLoad: g => { rockTemplates[2] = g.scene; } },
        { path: 'models/underwater/coral.glb',       onLoad: g => { coralTemplate = g.scene; } },
        { path: 'models/underwater/kelp.glb',        onLoad: g => { kelpTemplate  = g.scene; } },
        { path: 'models/underwater/coral1.glb',      onLoad: g => { coral1Template    = g.scene; } },
        { path: 'models/underwater/coral2.glb',      onLoad: g => { coral2Template    = g.scene; } },
        { path: 'models/underwater/anemone.glb',     onLoad: g => { anemoneTemplate   = g.scene; } },
        { path: 'models/underwater/starfish.glb',    onLoad: g => { starfishTemplate  = g.scene; } },
        { path: 'models/underwater/crab.glb',        onLoad: g => { crabTemplate      = g.scene; crabAnimations = g.animations; } },
        { path: 'models/underwater/clownfish.glb',   onLoad: g => { clownfishTemplate = g.scene; clownfishAnimations = g.animations; } },
    ];

    for (const entry of entries) {
        loader.load(entry.path, (gltf) => {
            entry.onLoad(gltf as any);
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
    _setupCoralInteraction();
}

export function Update(dt: number): void {
    kelpTimeUniform.value += dt * config.kelpSwaySpeed;
    kelpSwayUniform.value  = config.kelpSwayStrength;
    kelpFreqUniform.value  = config.kelpSwayFrequency;
    kelpTopYUniform.value  = config.kelpTopY;

    // Anemone sway — independent time/strength/freq from the kelp.
    anemoneTimeUniform.value += dt * config.anemoneSwaySpeed;
    anemoneSwayUniform.value  = config.anemoneSwayStrength;
    anemoneFreqUniform.value  = config.anemoneSwayFrequency;
    anemoneTopYUniform.value  = config.anemoneTopY;

    // Animated props
    if (crabMixer)         crabMixer.update(dt);
    if (anemoneFish1Mixer) anemoneFish1Mixer.update(dt);
    if (anemoneFish2Mixer) anemoneFish2Mixer.update(dt);

    // Circle each clownfish around the anemone using the same trajectory
    // pattern as Fish.ts's main clownFish — circleAngle advances with dt,
    // position = anemoneCenter + (cos, 0, sin) * swimRadius, rotation faces
    // tangent. `period` controls how fast the orbit completes; `phase` and
    // y offset stay user-tweakable from the GUI for vertical/start spread.
    _anemoneCircleTime += dt;
    if (_anemoneFish1Group) _updateAnemoneFishCircle(_anemoneFish1Group, config.anemoneFish1);
    if (_anemoneFish2Group) _updateAnemoneFishCircle(_anemoneFish2Group, config.anemoneFish2);

    updateCoralInteraction(dt);
}

// Single shared clock for both fish — each one offsets it via cfg.phase.
let _anemoneCircleTime = 0;
const ANEMONE_FISH_ROTATION_OFFSET = Math.PI * 2;
function _updateAnemoneFishCircle(wrapper: Group, cfg: { x: number; y: number; z: number; swimRadius: number; period: number; phase: number }): void {
    // Angular speed: one full lap every `period` seconds.
    const omega = (Math.PI * 2) / Math.max(0.5, cfg.period);
    const angle = _anemoneCircleTime * omega + cfg.phase;
    // Centre is the anemone in XZ; cfg.y stays the user-set vertical offset.
    wrapper.position.set(
        config.anemone.x + Math.cos(angle) * cfg.swimRadius,
        cfg.y,
        config.anemone.z + Math.sin(angle) * cfg.swimRadius,
    );
    // Same heading formula as Fish.ts: face tangent direction of the orbit.
    wrapper.rotation.y = -angle + ANEMONE_FISH_ROTATION_OFFSET;
}

/** Clear all decorations and re-spawn every model using current config values. */
export function respawn(): void {
    if (loadedCount < TOTAL_MODELS) {
        console.warn('[SeaFloorDecor] Models still loading — respawn queued for when they finish.');
        return;
    }
    spawnAll();
}

// ╔═══════════════════════════════════════════════════════════════════════════════
// ║  CORAL INTERACTION — hover scale, click sound + colour shift + bubbles
// ╚═══════════════════════════════════════════════════════════════════════════════

// Audio file mapping — one sound per coral (consistent)
const CORAL_SOUNDS = [
    'audio/nature/underwater/321802__lloydevans09__pvc_pipe_hit_4.mp3',
    'audio/nature/underwater/321805__lloydevans09__pvc_pipe_hit_1.mp3',
    'audio/nature/underwater/321808__lloydevans09__pvc_pipe_hit_3.mp3',
];

function _playCoralSound(idx: number): void {
    playCoralHitSound(idx);
}

// ── Colour palette ───────────────────────────────────────────────────────────
// Each coral cycles through these, then wraps back to its original colour.
// Palette is soft and warm — musical, not garish.
const COLOUR_PALETTE: Array<{ r: number; g: number; b: number }> = [
    { r: 1.00, g: 0.15, b: 0.55 },  // hot pink
    { r: 0.20, g: 0.45, b: 1.00 },  // vivid blue
    { r: 1.00, g: 0.75, b: 0.05 },  // bright amber
    { r: 0.05, g: 1.00, b: 0.55 },  // electric green
    { r: 0.70, g: 0.20, b: 1.00 },  // strong violet
];

// Per-coral state
interface CoralInteractionState {
    originalColor: { r: number; g: number; b: number };
    colourIndex: number;       // next palette index to tween toward
    tweenProgress: number;     // 0…1 (1 = done)
    tweenFrom: { r: number; g: number; b: number };
    tweenTo:   { r: number; g: number; b: number };
    isTweening: boolean;
    baseScale: number;         // from config
    scaleTarget: number;       // 1.0 (idle) or 1.15 (hovered)
    currentScale: number;      // smoothed
    // Bounce animation on click
    bounceTime: number;        // time into bounce (0 = no bounce)
}

const _coralStates: CoralInteractionState[] = [];

function _initCoralStates(): void {
    const cfgs = [config.coral1, config.coral2, config.coral3];
    _coralStates.length = 0;
    for (const c of cfgs) {
        _coralStates.push({
            originalColor: { r: c.r, g: c.g, b: c.b },
            colourIndex: 0,
            tweenProgress: 1,
            tweenFrom: { r: c.r, g: c.g, b: c.b },
            tweenTo:   { r: c.r, g: c.g, b: c.b },
            isTweening: false,
            baseScale: c.scale,
            scaleTarget: 1.0,
            currentScale: 1.0,
            bounceTime: 0,
        });
    }
    _updateCoralBoundingSpheres();
}
const _coralMouse = new Vector2();
let _hoveredCoralIdx = -1;
let _interactionSetUp = false;

// Bounding spheres used for world-space center only (radius unused).
const _coralSpheres: Sphere[] = [new Sphere(), new Sphere(), new Sphere()];
const _box3Scratch = new Box3();
const _coralScreenPos = new Vector3();
// Screen-space hit rectangle (NDC units, -1..1): narrow horizontal, taller vertical
const CORAL_HIT_HALF_W = 0.06;
const CORAL_HIT_HALF_H = 0.20;

function _updateCoralBoundingSpheres(): void {
    for (let i = 0; i < 3; i++) {
        const g = _corals[i];
        if (!g) continue;
        _box3Scratch.setFromObject(g);
        _box3Scratch.getBoundingSphere(_coralSpheres[i]);
    }
}

function _coralHit(i: number, mouseNDCX: number, mouseNDCY: number): boolean {
    if (_coralSpheres[i].radius <= 0) return false;
    _coralScreenPos.copy(_coralSpheres[i].center).project(camera);
    return Math.abs(mouseNDCX - _coralScreenPos.x) < CORAL_HIT_HALF_W
        && Math.abs(mouseNDCY - _coralScreenPos.y) < CORAL_HIT_HALF_H;
}

function _setupCoralInteraction(): void {
    if (_interactionSetUp) return;
    _interactionSetUp = true;
    const canvas = renderer.domElement;

    // Hover
    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        if (camera.position.y >= UNDERWATER_Y_THRESHOLD) {
            if (_hoveredCoralIdx >= 0) { _hoveredCoralIdx = -1; canvas.style.cursor = ''; _resetHoverScales(); }
            return;
        }
        _coralMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        _coralMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        let hitIdx = -1;
        for (let i = 0; i < 3; i++) {
            const g = _corals[i];
            if (!g) continue;
            if (_coralHit(i, _coralMouse.x, _coralMouse.y)) { hitIdx = i; break; }
        }
        if (hitIdx !== _hoveredCoralIdx) {
            _hoveredCoralIdx = hitIdx;
            canvas.style.cursor = hitIdx >= 0 ? 'pointer' : '';
            _resetHoverScales();
            if (hitIdx >= 0 && _coralStates[hitIdx]) _coralStates[hitIdx].scaleTarget = 1.15;
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (_hoveredCoralIdx >= 0) { _hoveredCoralIdx = -1; renderer.domElement.style.cursor = ''; _resetHoverScales(); }
    });

    // Click
    const onClick = (clientX: number, clientY: number) => {
        if (camera.position.y >= UNDERWATER_Y_THRESHOLD) return;
        _coralMouse.x = (clientX / window.innerWidth) * 2 - 1;
        _coralMouse.y = -(clientY / window.innerHeight) * 2 + 1;
        for (let i = 0; i < 3; i++) {
            const g = _corals[i];
            if (!g) continue;
            if (_coralHit(i, _coralMouse.x, _coralMouse.y)) {
                _onCoralClicked(i as 0 | 1 | 2);
                break;
            }
        }
    };

    canvas.addEventListener('click', (e: MouseEvent) => onClick(e.clientX, e.clientY));
    canvas.addEventListener('touchend', (e: TouchEvent) => {
        if (e.changedTouches.length > 0) {
            const t = e.changedTouches[0];
            onClick(t.clientX, t.clientY);
        }
    });
}

function _resetHoverScales(): void {
    for (const s of _coralStates) s.scaleTarget = 1.0;
}

// ── Click handler ────────────────────────────────────────────────────────────
const _bubblePos = new Vector3();
const CORAL_BUBBLE_COUNT = 5;

function _onCoralClicked(idx: 0 | 1 | 2): void {
    const st = _coralStates[idx];
    if (!st) return;

    // Sound
    _playCoralSound(idx);

    // Colour shift — pick next colour (palette, then wrap back to original)
    const totalSteps = COLOUR_PALETTE.length + 1; // palette + original
    const currentR = _getCurrentCoralColor(idx);
    st.tweenFrom = { ...currentR };

    st.colourIndex = (st.colourIndex + 1) % totalSteps;
    if (st.colourIndex === COLOUR_PALETTE.length) {
        // Loop back to original
        st.tweenTo = { ...st.originalColor };
    } else {
        st.tweenTo = { ...COLOUR_PALETTE[st.colourIndex] };
    }
    st.tweenProgress = 0;
    st.isTweening = true;

    // Bounce
    st.bounceTime = 0.001; // trigger bounce animation

    // Bubbles — emit a small burst from the coral's world position
    const g = _corals[idx];
    if (g) {
        g.getWorldPosition(_bubblePos);
        _bubblePos.y += 0.15; // slightly above center
        for (let b = 0; b < CORAL_BUBBLE_COUNT; b++) {
            const offset = new Vector3(
                (Math.random() - 0.5) * 0.12,
                Math.random() * 0.08,
                (Math.random() - 0.5) * 0.12
            );
            spawnBubble(_bubblePos.clone().add(offset));
        }
    }
}

function _getCurrentCoralColor(idx: number): { r: number; g: number; b: number } {
    const st = _coralStates[idx];
    if (!st) return { r: 1, g: 1, b: 1 };
    if (st.isTweening) {
        const t = st.tweenProgress;
        return {
            r: st.tweenFrom.r + (st.tweenTo.r - st.tweenFrom.r) * t,
            g: st.tweenFrom.g + (st.tweenTo.g - st.tweenFrom.g) * t,
            b: st.tweenFrom.b + (st.tweenTo.b - st.tweenFrom.b) * t,
        };
    }
    return { ...st.tweenTo };
}

// ── Per-frame update for tweens + scale ──────────────────────────────────────
const COLOUR_TWEEN_SPEED = 2.5;   // full transition in ~0.4s — snappy but visible
const SCALE_LERP_SPEED   = 8.0;   // responsive hover feel
const BOUNCE_DURATION    = 0.30;   // seconds
const BOUNCE_AMPLITUDE   = 0.12;  // extra scale multiplier at peak

export function updateCoralInteraction(dt: number): void {
    for (let i = 0; i < 3; i++) {
        const st = _coralStates[i];
        const g = _corals[i];
        if (!st || !g) continue;

        // Colour tween
        if (st.isTweening) {
            st.tweenProgress = Math.min(1, st.tweenProgress + dt * COLOUR_TWEEN_SPEED);
            // Smooth ease-out
            const t = 1 - Math.pow(1 - st.tweenProgress, 3);
            const r = st.tweenFrom.r + (st.tweenTo.r - st.tweenFrom.r) * t;
            const gC = st.tweenFrom.g + (st.tweenTo.g - st.tweenFrom.g) * t;
            const b = st.tweenFrom.b + (st.tweenTo.b - st.tweenFrom.b) * t;
            applyCoralColor(g, r, gC, b);
            if (st.tweenProgress >= 1) st.isTweening = false;
        }

        // Bounce animation
        let bounceMult = 1.0;
        if (st.bounceTime > 0) {
            st.bounceTime += dt;
            if (st.bounceTime >= BOUNCE_DURATION) {
                st.bounceTime = 0;
            } else {
                // Single smooth bump — sine half-wave
                const p = st.bounceTime / BOUNCE_DURATION;
                bounceMult = 1 + Math.sin(p * Math.PI) * BOUNCE_AMPLITUDE;
            }
        }

        // Scale smoothing (hover + bounce)
        st.currentScale += (st.scaleTarget - st.currentScale) * Math.min(1, dt * SCALE_LERP_SPEED);
        g.scale.setScalar(st.baseScale * st.currentScale * bounceMult);
    }
}

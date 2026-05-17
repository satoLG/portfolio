/**
 * SeaFloorDecor — 3 coral rocks, 3 corals, 3 kelps.
 * Each model is explicitly placed via SeaFloorConfig.ts.
 *
 * Call Start() once (loads GLTF models asynchronously).
 * Call Update(dt) every frame.
 * Add decorGroup to the Three.js scene from Scene.ts.
 */
import { Group, Mesh, Uniform, Vector2, Vector3, Box3, Sphere } from "three";
import { GLTFLoader }           from "three/examples/jsm/loaders/GLTFLoader";
import { oceanAbsorptionUniform, underwaterFogDistUniform, waveVelocity1Uniform, waveVelocity2Uniform } from "../materials/OceanMaterial";
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
    _initCoralStates();
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
    _setupCoralInteraction();
}

export function Update(dt: number): void {
    kelpTimeUniform.value += dt * config.kelpSwaySpeed;
    kelpSwayUniform.value  = config.kelpSwayStrength;
    kelpFreqUniform.value  = config.kelpSwayFrequency;
    kelpTopYUniform.value  = config.kelpTopY;
    updateCoralInteraction(dt);
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
    'audio/nature/underwater/321802__lloydevans09__pvc_pipe_hit_4.wav',
    'audio/nature/underwater/321805__lloydevans09__pvc_pipe_hit_1.wav',
    'audio/nature/underwater/321808__lloydevans09__pvc_pipe_hit_3.wav',
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

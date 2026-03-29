import { Group, Object3D, Mesh, LoadingManager, Uniform, Vector2, Vector3, Raycaster, SpriteMaterial, Sprite, CanvasTexture, AdditiveBlending, AnimationMixer, AnimationClip, AnimationAction, LoopRepeat, MeshDepthMaterial, RGBADepthPacking } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { oceanAbsorptionUniform, underwaterFogDistUniform, setFoamMask } from "../materials/OceanMaterial";
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial";
import { deltaTime, time } from "../scripts/Time";
import { getIsPlaying, expandPlayer, collapsePlayer, getIsExpanded, getMusicIntensity, getBeatKick } from "../scripts/MediaPlayer";
import { zoomToPug, zoomOutFromPug, isPugZoomActive, isRadioZoomActive, zoomToPhone, zoomOutFromPhone, isPhoneZoomActive } from "../scripts/Control";
import { showDialog, advanceDialog, dismissDialog, isDialogActive } from "../scripts/Dialog";
import type { DialogLine, ReplyOption } from "../scripts/Dialog";
import { isBreezeActive, playPugSnoreOnce, stopPugSnore } from "../scripts/Audio";
import { camera, renderer, scene as threeScene } from "../scripts/Scene";
import { generateFoamMask, getMaskTexture, getMaskCenter, getMaskSize } from "../effects/FoamMask";
import * as PhoneScreen from '../scripts/PhoneScreen';
import { UNDERWATER_Y_THRESHOLD } from "../effects/PostProcess";
import {
    islandPosition, firecampOffset, palmtreeOffset, radioOffset, swordOffset,
    pugOffset, tentOffset, dogBedOffset, littleRocksOffset, phoneOffset,
    islandScale, firecampScale, palmtreeScale, radioScale, swordScale, pugScale, tentScale, dogBedScale, littleRocksScale, phoneScale,
    palmtreeRotY, radioRotY, swordRot, pugRotY, tentRotY, dogBedRotY, littleRocksRot, phoneRot,
    CLUSTER_MAIN as CLUSTER_MAIN_CFG,
    CLUSTER_PALM as CLUSTER_PALM_CFG,
    GRASS_COUNT  as GRASS_COUNT_CFG,
    GRASS_COUNT_PALM as GRASS_COUNT_PALM_CFG,
    CLOVER_COUNT as CLOVER_COUNT_CFG,
    SURFACE_EDGE_PADDING,
} from './IslandConfig';

export const island = new Group();
export const firecamp = new Group();
export const palmtree = new Group();
export const radio = new Group();
export const sword = new Group();
export const pug = new Group();
export const tent = new Group();
export const dogBed = new Group();
export const littleRocks = new Group();
export const phone = new Group();

let phoneDropped = false;  // True after the cutscene sequence (runtime only, no localStorage)
export const grassPatches: Group[] = [];

// Store palm tree leaves for wind animation
const palmLeaves: Object3D[] = [];

// Island surface meshes — populated once the island glTF loads.
// Used by isOnIslandSurface() to confine foliage spawning to the island top.
const islandMeshes: Mesh[] = [];
const _spawnRaycaster = new Raycaster();
const _spawnOrigin    = new Vector3();
const _spawnDown      = new Vector3(0, -1, 0);

// SURFACE_EDGE_PADDING is imported from IslandConfig.ts

/**
 * Calls `callback` once islandMeshes has been populated.
 * Polls via requestAnimationFrame so it never blocks the main thread.
 */
function waitForIslandMeshes(callback: () => void): void {
    if (islandMeshes.length > 0) { callback(); return; }
    requestAnimationFrame(() => waitForIslandMeshes(callback));
}

/**
 * Returns true if world position (wx, wz) is directly above the island mesh
 * AND all four cardinal neighbours at SURFACE_EDGE_PADDING distance also hit
 * the island, ensuring the patch is not too close to any edge.
 * Falls back to true when island hasn't loaded yet so spawning isn't blocked.
 */
function isOnIslandSurface(wx: number, wz: number): boolean {
    if (islandMeshes.length === 0) return true;
    const p = SURFACE_EDGE_PADDING;
    const checks: [number, number][] = [
        [wx,     wz    ],  // center
        [wx + p, wz    ],  // east
        [wx - p, wz    ],  // west
        [wx,     wz + p],  // south
        [wx,     wz - p],  // north
    ];
    for (const [cx, cz] of checks) {
        _spawnOrigin.set(cx, 5, cz);
        _spawnRaycaster.set(_spawnOrigin, _spawnDown);
        if (_spawnRaycaster.intersectObjects(islandMeshes, false).length === 0) return false;
    }
    return true;
}

// Pug animation mixer & exported animation state
export let pugMixer: AnimationMixer | null = null;
export let pugAnimClips: AnimationClip[] = [];
export let pugCurrentAnimIndex = 3;
/** The animation index the pug returns to when idle (changes at night). */
export let pugDefaultAnimIndex = 3;

/** Duration (seconds) for crossfade blending between pug animations. */
const ANIM_CROSSFADE_DURATION = 0.35;

// ── Night-mode state ─────────────────────────────────────────────────────────
/** sunVisibility below this value counts as night — TWEAK */
const PUG_NIGHT_THRESHOLD = 0.35;
let _pugIsNight = false;
/** True while a music track is actively playing — suppresses sleep state. */
let _pugMusicWasPlaying = false;

/** Find the first clip whose name contains ANY of the given substrings (case-insensitive). */
function _findPugNightAnim(): number {
    const terms = ['idle_headlow', 'headlow', 'head_low', 'sleep', 'sleeping', 'low'];
    for (const term of terms) {
        const idx = pugAnimClips.findIndex(c => c.name.toLowerCase().includes(term));
        if (idx >= 0) {
            console.log(`[Pug] Night anim matched "${term}" → index ${idx}: "${pugAnimClips[idx].name}"`);
            return idx;
        }
    }
    console.warn('[Pug] Night animation not found. Available clips:', pugAnimClips.map((c, i) => `${i}: "${c.name}"`));
    return -1;
}

// ── Sleep-Z particle settings ─────────────────────────────────────────────────
/** How many Zs to spawn each time the sleep animation loops — TWEAK */
const PUG_Z_BURST_COUNT = 3;
/** Seconds between consecutive Zs in a burst — TWEAK */
const PUG_Z_BURST_DELAY = 0.65;
/** Rise speed (world units/sec) — TWEAK */
const PUG_Z_RISE_SPEED  = 0.065;
/** Lateral sine-wave amplitude (world units) — TWEAK */
const PUG_Z_WAVE_AMP    = 0.042;
/** Wave frequency (radians/sec) — TWEAK */
const PUG_Z_WAVE_FREQ   = 2.8;
/** Local-space head tip in the pug GLTF — TWEAK if spawn drifts off the snout */
const _pugHeadLocal = new Vector3(0, 0.65, 0.60);
const _pugHeadWorld = new Vector3();
let _pugZTexture: CanvasTexture | null = null;

/** Pending Z that hasn't been materialised into a sprite yet */
interface ZSpawnJob {
    countdown:   number;   // seconds until this Z should actually spawn
    burstIndex:  number;   // 0-based (determines size & phase)
    waveAxisX:   number;
    waveAxisZ:   number;
    headX:       number;   // world head position captured at burst time
    headY:       number;
    headZ:       number;
}
const _pugZSpawnQueue: ZSpawnJob[] = [];

interface ZParticle {
    sprite:      Sprite;
    age:         number;
    lifetime:    number;
    spawnX:      number;    // world X at spawn
    spawnY:      number;    // world Y at spawn
    spawnZ:      number;    // world Z at spawn
    waveAxisX:   number;    // world right direction (perpendicular to pug facing)
    waveAxisZ:   number;
    phaseOffset: number;    // stagger burst particles along the wave
    riseSpeed:   number;
    baseOpacity: number;
}
const _pugZParticles: ZParticle[] = [];

// Currently active AnimationAction — needed to crossfade from it
let _pugCurrentAction: AnimationAction | null = null;
// Pending loop-return listener — stored so it can be cancelled on re-entry
let _pugReturnListener: ((e: any) => void) | null = null;
// Sleep-Z burst listener — fires on every loop of the captured sleep action
let _pugSleepLoopListener: ((e: any) => void) | null = null;

/**
 * Crossfade to the clip at `index`, looping infinitely.
 * Cancels any pending auto-return scheduled by playPugAnimationThenReturn.
 */
export function setPugAnimation(index: number, crossfadeDuration = ANIM_CROSSFADE_DURATION): void {
    if (!pugMixer || pugAnimClips.length === 0) return;
    const clip = pugAnimClips[index];
    if (!clip) return;
    // Cancel any scheduled loop-return
    if (_pugReturnListener) {
        pugMixer.removeEventListener('loop', _pugReturnListener);
        _pugReturnListener = null;
    }
    pugCurrentAnimIndex = index;
    const next = pugMixer.clipAction(clip);
    next.setLoop(LoopRepeat, Infinity);
    if (_pugCurrentAction && _pugCurrentAction !== next) {
        next.reset().play();
        _pugCurrentAction.crossFadeTo(next, crossfadeDuration, true);
    } else {
        next.reset().play();
    }
    _pugCurrentAction = next;
}

/**
 * Play animation `index` for at least one full loop, then crossfade back to
 * `pugDefaultAnimIndex` (automatically correct for day / night state).
 * A second call before the first loop finishes cancels the previous return.
 */
export function playPugAnimationThenReturn(index: number): void {
    if (!pugMixer || pugAnimClips.length === 0) return;
    // Cancel previous pending return before starting a new one
    if (_pugReturnListener) {
        pugMixer.removeEventListener('loop', _pugReturnListener);
        _pugReturnListener = null;
    }
    setPugAnimation(index);
    const listenAction = _pugCurrentAction;
    _pugReturnListener = (e: { action: AnimationAction }) => {
        if (e.action !== listenAction) return;
        pugMixer!.removeEventListener('loop', _pugReturnListener!);
        _pugReturnListener = null;
        setPugAnimation(pugDefaultAnimIndex);
    };
    pugMixer.addEventListener('loop', _pugReturnListener as any);
}

// Music note particles for radio
interface MusicNote {
    sprite: Sprite;
    age: number;       // seconds alive
    lifetime: number;  // total seconds before removed
    vx: number;        // velocity X
    vy: number;        // velocity Y
    vz: number;        // velocity Z
    baseOpacity: number;
}
const musicNotes: MusicNote[] = [];
let noteSpawnTimer = 0;
let lastBeatKick = 0;  // Track previous beat kick to detect rising edge

// Pre-built note textures (3 variants, created once)
let noteTextures: CanvasTexture[] = [];

function buildNoteTextures(): void {
    if (noteTextures.length > 0) return;
    const symbols = ['\u266A', '\u266B', '\u2669'];  // ♪ ♫ ♩
    for (const sym of symbols) {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, size, size);
        ctx.font = `bold ${size * 0.7}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(sym, size / 2, size / 2);
        const tex = new CanvasTexture(canvas);
        tex.needsUpdate = true;
        noteTextures.push(tex);
    }
}

// Loading manager for progress tracking
const loadingManager = new LoadingManager();
let loadingProgress = 0;
let onLoadingProgress: ((progress: number) => void) | null = null;

loadingManager.onProgress = (_url, loaded, total) => {
    // Update progress based on items loaded
    loadingProgress = loaded / total;
    if (onLoadingProgress) {
        onLoadingProgress(loadingProgress);
    }
};

loadingManager.onLoad = () => {
    loadingProgress = 1;
    if (onLoadingProgress) {
        onLoadingProgress(1);
    }
};

// Export function to set loading callback
export function setLoadingCallback(callback: (progress: number) => void): void {
    onLoadingProgress = callback;
}

// Export to get current loading progress
export function getLoadingProgress(): number {
    return loadingProgress;
}

const loader = new GLTFLoader(loadingManager);

// Placement constants are imported from IslandConfig.ts — edit that file or
// use the debug panel's "Copy Config" button to regenerate it.

// Radio vibration settings
let radioTime = 0;
const radioBaseY = islandPosition.y + radioOffset.y;
const radioVibeStrength = 0.003;  // Very subtle bounce
const radioVibeSpeed = 15;  // Quick vibration

// GRASS/CLOVER SPAWN SETTINGS
// All positions and exclusion zones are in ABSOLUTE WORLD XZ space.
// Object world positions (for reference):
//   Firecamp  : X= 0.00  Z=-2.90   (islandPos + firecampOffset)  scale 1.4
//   Tent      : X= 0.48  Z=-3.65   (islandPos + tentOffset)       scale 1.8
//   Palm trunk: X=-0.35  Z=-3.60   (islandPos + palmtreeOffset)
//   Pug       : X= 0.65  Z=-2.30   (islandPos + pugOffset)
//   Radio     : X=-0.65  Z=-3.10   (islandPos + radioOffset)

// Spawn clusters ─ each cluster is a filled annulus (donut) in world XZ
// Mutable cluster objects — initialised from config, then mutated live by the debug panel
export const CLUSTER_MAIN = { ...CLUSTER_MAIN_CFG };
export const CLUSTER_PALM = { ...CLUSTER_PALM_CFG };

// Per-cluster patch lists — used by IslandDebug to shift patches when the center moves
export const clusterMainPatches: Group[] = [];
export const clusterPalmPatches: Group[] = [];
export const clusterCloverPatches: Group[] = [];

// Cached gltf source scenes for runtime respawning
let grassGltfScene: Group | null = null;
let cloverGltfScene: Group | null = null;
const GRASS_Y   = islandPosition.y + 0.90;  // World Y for grass placement
const CLOVER_Y  = islandPosition.y + 0.98;  // World Y for clover placement

// Exclusion zones — objects that should not have grass underneath them.
// Radii are intentionally generous so footprints are fully clear.
interface ExclusionZone { x: number; z: number; r: number; }
const SPAWN_EXCLUSION_ZONES: ExclusionZone[] = [
    { x:  0.00,  z: -2.90, r: 0.42 },  // Bonfire + sword + campfire footprint
    { x:  0.48,  z: -3.70, r: 0.42 },  // Tent + dog bed + dog bowl
    { x: -0.35,  z: -3.60, r: 0.14 },  // Palm trunk (small — palm-cluster grass grows around it)
    { x:  0.65,  z: -2.30, r: 0.34 },  // Pug
    { x: -0.65,  z: -3.10, r: 0.26 },  // Radio
    { x:  0.32,  z: -2.60, r: 0.20 },  // Little rocks + phone
];
const PATCH_MIN_SPACING  = 0.055;  // Min world-space gap between any two patches
const SPAWN_MAX_ATTEMPTS = 40;     // Retries per patch before giving up

// sx/sz are absolute world XZ coordinates
function isValidSpawnPos(sx: number, sz: number, placed: Array<{x: number; z: number}>): boolean {
    // Reject positions that don't land on the island surface
    if (!isOnIslandSurface(sx, sz)) return false;
    for (const zone of SPAWN_EXCLUSION_ZONES) {
        const dx = sx - zone.x, dz = sz - zone.z;
        if (dx * dx + dz * dz < zone.r * zone.r) return false;
    }
    for (const p of placed) {
        const dx = sx - p.x, dz = sz - p.z;
        if (dx * dx + dz * dz < PATCH_MIN_SPACING * PATCH_MIN_SPACING) return false;
    }
    return true;
}

// Shared placed-positions list so grass AND clover don't overlap each other
const foliageSpawnPlaced: Array<{x: number; z: number}> = [];

// Signals when both loader callbacks have finished so Scene.ts can stop polling
let _grassLoaded  = false;
let _cloverLoaded = false;
export function isFoliageLoaded(): boolean { return _grassLoaded && _cloverLoaded; }

// Mutable counts — initialised from config, then mutated live by the debug panel
export let GRASS_COUNT      = GRASS_COUNT_CFG;
export let GRASS_COUNT_PALM = GRASS_COUNT_PALM_CFG;
const grassScale = 0.2;
export let CLOVER_COUNT = CLOVER_COUNT_CFG;
const cloverScale = 0.08;

/** Setters — ES module bindings are read-only from outside, use these to mutate counts */
export function setGrassCount(n: number)     { GRASS_COUNT      = Math.max(0, Math.round(n)); }
export function setGrassPalmCount(n: number) { GRASS_COUNT_PALM = Math.max(0, Math.round(n)); }
export function setCloverCount(n: number)    { CLOVER_COUNT     = Math.max(0, Math.round(n)); }

// ─── Runtime respawn ─────────────────────────────────────────────────────────
export type FoliageCluster = 'grass-main' | 'grass-palm' | 'clover';

export function respawnFoliage(which: FoliageCluster): void {
    const sourceScene = which === 'clover' ? cloverGltfScene : grassGltfScene;
    if (!sourceScene) { console.warn('respawnFoliage: gltf not loaded yet'); return; }

    const targetPatches = which === 'grass-main' ? clusterMainPatches
                        : which === 'grass-palm'  ? clusterPalmPatches
                        : clusterCloverPatches;
    const cluster   = which === 'grass-palm' ? CLUSTER_PALM : CLUSTER_MAIN;
    const count     = which === 'grass-main' ? GRASS_COUNT
                    : which === 'grass-palm'  ? GRASS_COUNT_PALM
                    : CLOVER_COUNT;
    const yPos  = which === 'clover' ? CLOVER_Y : GRASS_Y;
    const scale = which === 'clover' ? cloverScale : grassScale;

    // Remove old patches from the Three.js scene and tracking arrays
    for (const p of targetPatches) {
        p.parent?.remove(p);
        const idx = grassPatches.indexOf(p);
        if (idx !== -1) grassPatches.splice(idx, 1);
    }
    targetPatches.length = 0;

    // Build placed list from ALL surviving patches (cross-cluster collision)
    const placed: Array<{x: number; z: number}> = grassPatches.map(p => ({ x: p.position.x, z: p.position.z }));

    // Spawn new patches
    for (let i = 0; i < count; i++) {
        for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const dist  = cluster.minR + Math.random() * (cluster.maxR - cluster.minR);
            const wx = cluster.wx + Math.cos(angle) * dist;
            const wz = cluster.wz + Math.sin(angle) * dist;
            if (!isValidSpawnPos(wx, wz, placed)) continue;

            placed.push({ x: wx, z: wz });
            const patch = new Group();
            const model = sourceScene.clone();
            applyFoliageWindShader(model);
            model.traverse(child => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            patch.add(model);
            patch.position.set(wx, yPos, wz);
            patch.scale.setScalar(scale);
            patch.rotation.y = Math.random() * Math.PI * 2;
            threeScene.add(patch);
            grassPatches.push(patch);
            targetPatches.push(patch);
            break;
        }
    }
    console.log(`[Island] Respawned ${targetPatches.length}/${count} ${which} patches`);
}

// PALM TREE WIND SETTINGS - easily tweakable
const PALM_WIND_STRENGTH = 0.03;    // TWEAK: How much leaves sway (0.05-0.3)
const PALM_WIND_SPEED = 0.5;       // TWEAK: Speed of wind oscillation (0.5-3.0)
const PALM_LEAF_START_Y = 3.0;     // TWEAK: Y height where leaves start swaying (local coords)
const PALM_LEAF_FULL_Y = 3.25;      // TWEAK: Y height where full sway happens

// Wind uniforms for shader
const palmWindTimeUniform = new Uniform(0.0);
const palmWindStrengthUniform = new Uniform(PALM_WIND_STRENGTH);
const palmLeafStartYUniform = new Uniform(PALM_LEAF_START_Y);
const palmLeafFullYUniform = new Uniform(PALM_LEAF_FULL_Y);

// FOLIAGE (GRASS/CLOVER) WIND SETTINGS - independent from palm
const FOLIAGE_WIND_STRENGTH = 0.035;  // TWEAK: Very subtle sway
// const FOLIAGE_WIND_SPEED = 0.8;       // TWEAK: Slow gentle movement
const foliageWindStrengthUniform = new Uniform(FOLIAGE_WIND_STRENGTH);

// Mouse interaction for grass
const raycaster = new Raycaster();
const mouse = new Vector2();
const mouseWorldPos = new Uniform(new Vector3(0, -100, 0));  // Far away by default
const mouseInfluenceRadius = new Uniform(0.50);   // Wide area — very gradual falloff
const mouseInfluenceStrength = new Uniform(0.018); // Very subtle — barely noticeable

// BREEZE-DRIVEN WIND SETTINGS
const BREEZE_RAMP_UP = 1.0;           // Seconds to ramp up wind when breeze starts
const BREEZE_RAMP_DOWN = 4.0;         // Seconds to fade out wind after breeze ends
const BREEZE_GRASS_STRENGTH = 0.08;   // How far grass patches sway (rotation radians)
let windTime = 0;
let breezeIntensity = 0;              // 0-1 smoothed breeze envelope

const oceanLightingPars = /*glsl*/`
    uniform vec3 uLight;
    uniform vec3 uAbsorption;
    uniform float uSunVisibility;
    uniform float uFogDist;
    const float DENSITY = 0.35;
    const float FOG_DISTANCE = 600.0;
`;

const oceanLightingFragment = /*glsl*/`
    vec3 worldPos = vWorldPosition;
    vec3 viewVec = worldPos - cameraPosition;
    float viewLen = length(viewVec);
    vec3 viewDir = viewVec / viewLen;
    
    if (worldPos.y > 0.0) {
        float fogStartLen = viewLen;
        if (cameraPosition.y < 0.0) {
            fogStartLen -= cameraPosition.y / -viewDir.y;
        }
        float fog = clamp(fogStartLen / FOG_DISTANCE, 0.0, 1.0);
        fog = fog * fog;
        vec3 horizonColor = mix(vec3(0.07, 0.13, 0.18), vec3(0.7, 0.85, 0.95), uSunVisibility);
        outgoingLight = mix(outgoingLight, horizonColor, fog);
    }
    else {
        float uwLen = viewLen;
        float originY = cameraPosition.y;
        if (cameraPosition.y > 0.0) {
            uwLen -= cameraPosition.y / -viewDir.y;
            originY = 0.0;
        }
        uwLen = min(uwLen, uFogDist);
        float sampleY = originY + viewDir.y * uwLen;
        vec3 underwaterLight = exp((sampleY - uwLen * DENSITY) * uAbsorption) * uLight;
        outgoingLight *= underwaterLight;
        float uwFog = min(uwLen / uFogDist, 1.0);
        outgoingLight = mix(outgoingLight, underwaterLight * 0.3, uwFog);
    }
`;

function applyOceanLightingToModel(model: Group): void {
    model.traverse((child) => {
        if ((child as any).isMesh && (child as any).material) {
            const mesh = child as any;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat: any) => {
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshBasicMaterial) {
                    mat.customProgramCacheKey = () => 'ocean_lighting';
                    mat.onBeforeCompile = (shader: any) => {
                        shader.uniforms.uLight = lightUniform;
                        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
                        shader.uniforms.uFogDist = underwaterFogDistUniform;
                        shader.uniforms.uSunVisibility = sunVisibilityUniform;
                        
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <common>',
                            `#include <common>
                            varying vec3 vWorldPosition;`
                        );
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <worldpos_vertex>',
                            `#include <worldpos_vertex>
                            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`
                        );
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
                }
            });
        }
    });
}

// Apply wind animation shader to palm tree
function applyPalmWindShader(model: Group): void {
    model.traverse((child) => {
        if ((child as any).isMesh && (child as any).material) {
            const mesh = child as any;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat: any) => {
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshBasicMaterial) {
                    // Force leaves into opaque pass (alpha-test) so they render
                    // at the same depth/visibility as the trunk — not blocked
                    // by the ocean surface when viewed from underwater
                    if (mat.transparent || mat.alphaMap || mat.map?.image) {
                        mat.transparent = false;
                        mat.depthWrite = true;
                        mat.alphaTest = 0.5;
                    }
                    mat.customProgramCacheKey = () => 'palm_wind';
                    mat.onBeforeCompile = (shader: any) => {
                        console.log('🌴 Palm wind shader compiling!');
                        // Add ocean lighting uniforms
                        shader.uniforms.uLight = lightUniform;
                        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
                        shader.uniforms.uSunVisibility = sunVisibilityUniform;
                        // Add wind uniforms
                        shader.uniforms.uWindTime = palmWindTimeUniform;
                        shader.uniforms.uWindStrength = palmWindStrengthUniform;
                        shader.uniforms.uLeafStartY = palmLeafStartYUniform;
                        shader.uniforms.uLeafFullY = palmLeafFullYUniform;
                        
                        // Vertex shader - add wind sway
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <common>',
                            `#include <common>
                            uniform float uWindTime;
                            uniform float uWindStrength;
                            uniform float uLeafStartY;
                            uniform float uLeafFullY;
                            varying vec3 vWorldPosition;`
                        );
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <begin_vertex>',
                            `#include <begin_vertex>
                            // Only leaves sway — smoothstep filters by vertex Y
                            float heightFactor = smoothstep(uLeafStartY, uLeafFullY, position.y);
                            // Multi-frequency flickering for natural chaotic wind
                            float flicker = sin(uWindTime * 2.5 + position.x * 2.0) * 0.5
                                          + sin(uWindTime * 5.8 + position.z * 1.5) * 0.3
                                          + sin(uWindTime * 9.2 + position.x * 0.8 + position.z) * 0.15;
                            float windSway = flicker * uWindStrength * heightFactor;
                            float windSwayZ = flicker * uWindStrength * 0.4 * heightFactor
                                            * cos(uWindTime * 3.1 + position.z * 1.8);
                            transformed.x += windSway;
                            transformed.z += windSwayZ;`
                        );
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <worldpos_vertex>',
                            `#include <worldpos_vertex>
                            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`
                        );
                        
                        // Fragment shader - ocean lighting
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
                }
            });
        }
    });
}

// Apply wind animation shader to grass/clover with mouse interaction
function applyFoliageWindShader(model: Group): void {
    model.traverse((child) => {
        if ((child as any).isMesh && (child as any).material) {
            const mesh = child as any;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat: any) => {
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshBasicMaterial) {
                    // Fix transparency/depth issues
                    mat.depthWrite = true;
                    mat.alphaTest = 0.5;
                    mat.transparent = false;  // Disable transparency to fix flickering
                    mesh.renderOrder = 1;  // Render after ground

                    // Custom depth material so the shadow map renderer uses alpha-test
                    // properly even when onBeforeCompile has modified the main shader.
                    const depthMat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, alphaTest: 0.5 });
                    if (mat.map) depthMat.map = mat.map;
                    mesh.customDepthMaterial = depthMat;
                    mat.customProgramCacheKey = () => 'foliage_wind';
                    mat.onBeforeCompile = (shader: any) => {
                        // Add ocean lighting uniforms
                        shader.uniforms.uLight = lightUniform;
                        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
                        shader.uniforms.uSunVisibility = sunVisibilityUniform;
                        // Add wind uniforms - independent for foliage
                        shader.uniforms.uWindTime = palmWindTimeUniform;
                        shader.uniforms.uWindStrength = foliageWindStrengthUniform;
                        // Add mouse interaction uniforms
                        shader.uniforms.uMouseWorldPos = mouseWorldPos;
                        shader.uniforms.uMouseRadius = mouseInfluenceRadius;
                        shader.uniforms.uMouseStrength = mouseInfluenceStrength;
                        
                        // Vertex shader - add wind sway with mouse interaction
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <common>',
                            `#include <common>
                            uniform float uWindTime;
                            uniform float uWindStrength;
                            uniform vec3 uMouseWorldPos;
                            uniform float uMouseRadius;
                            uniform float uMouseStrength;
                            varying vec3 vWorldPosition;`
                        );
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <begin_vertex>',
                            `#include <begin_vertex>
                            // Subtle wind sway - gentle tilt left/right only
                            float heightFactor = smoothstep(0.0, 0.15, position.y);  // Gradual height influence
                            float windSway = sin(uWindTime * 1.5 + position.x * 3.0) * uWindStrength * heightFactor;
                            transformed.x += windSway;
                            
                            // Mouse proximity — very soft Y-compression (blade gently bows down)
                            // Squared smoothstep gives an extremely gradual ramp-in so there
                            // is no visible snap when the cursor enters/leaves the radius.
                            vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
                            float mouseDist = length(worldPos4.xz - uMouseWorldPos.xz);
                            float t = smoothstep(uMouseRadius, 0.0, mouseDist);
                            float mouseInfluence = t * t * heightFactor;  // squared = very gentle
                            transformed.y -= mouseInfluence * uMouseStrength;`
                        );
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <worldpos_vertex>',
                            `#include <worldpos_vertex>
                            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`
                        );
                        
                        // Fragment shader - ocean lighting
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
                }
            });
        }
    });
}

export function Start(): void {
    loader.load(
        'models/surface/floating_island.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            // Enable shadow receiving on island meshes
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    (child as any).receiveShadow = true;
                    (child as any).castShadow = true;
                }
            });
            island.add(gltf.scene);
            island.position.set(islandPosition.x, islandPosition.y, islandPosition.z);
            island.scale.setScalar(islandScale);

            // Populate islandMeshes synchronously so waitForIslandMeshes() unblocks
            // even if grass/clover finish loading before the next animation frame.
            island.updateMatrixWorld(true);
            island.traverse((child) => {
                if ((child as any).isMesh) islandMeshes.push(child as Mesh);
            });

            // Foam mask needs the renderer so it still runs in the next frame.
            requestAnimationFrame(() => {
                generateFoamMask(renderer, island);
                const tex = getMaskTexture();
                if (tex) {
                    setFoamMask(tex.texture, getMaskCenter(), getMaskSize());
                }
            });
            
            console.log('Floating island loaded with ocean lighting');
        },
        (progress) => {
            console.log('Island loading:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => {
            console.error('Error loading floating island:', error);
        }
    );

    loader.load(
        'models/surface/bonfire.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            // Enable shadow casting and receiving for firecamp
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            firecamp.add(gltf.scene);
            firecamp.position.set(
                islandPosition.x + firecampOffset.x,
                islandPosition.y + firecampOffset.y,
                islandPosition.z + firecampOffset.z
            );
            firecamp.scale.setScalar(firecampScale);
            console.log('Firecamp loaded with ocean lighting and shadow casting');
        },
        (progress) => {
            console.log('Firecamp loading:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => {
            console.error('Error loading firecamp:', error);
        }
    );

    loader.load(
        'models/surface/tree.glb',
        (gltf) => {
            // Apply wind shader instead of just ocean lighting
            applyPalmWindShader(gltf.scene);
            // Enable shadow casting and receiving
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                    const mesh = child as any;
                    // Compute bounding box to see vertex Y range
                    mesh.geometry.computeBoundingBox();
                    const bbox = mesh.geometry.boundingBox;
                    // Log all mesh info for debugging
                    console.log('🌴 Palm mesh found:', {
                        name: child.name,
                        position: { x: mesh.position.x.toFixed(2), y: mesh.position.y.toFixed(2), z: mesh.position.z.toFixed(2) },
                        materialName: mesh.material?.name || 'unnamed',
                        vertexCount: mesh.geometry?.attributes?.position?.count || 0,
                        boundingBoxY: bbox ? { min: bbox.min.y.toFixed(2), max: bbox.max.y.toFixed(2) } : 'N/A'
                    });
                    // Try to identify leaves by name (common naming conventions)
                    const name = child.name.toLowerCase();
                    if (name.includes('leaf') || name.includes('leaves') || name.includes('frond') || name.includes('palm') && !name.includes('trunk')) {
                        palmLeaves.push(child);
                        console.log('  ↳ Identified as LEAF');
                    }
                }
            });
            // If no leaves found by name, use all meshes except the lowest one (trunk)
            if (palmLeaves.length === 0) {
                const meshes: Object3D[] = [];
                gltf.scene.traverse((child) => {
                    if ((child as any).isMesh) {
                        meshes.push(child);
                    }
                });
                // Sort by Y position, take upper meshes as leaves
                meshes.sort((a, b) => a.position.y - b.position.y);
                if (meshes.length > 1) {
                    // Skip the bottom mesh (trunk), add rest as leaves
                    for (let i = 1; i < meshes.length; i++) {
                        palmLeaves.push(meshes[i]);
                    }
                    console.log('Auto-detected', palmLeaves.length, 'palm leaf meshes');
                } else if (meshes.length === 1) {
                    // Only one mesh, animate the whole thing
                    palmLeaves.push(meshes[0]);
                    console.log('Single mesh palm tree, animating entire model');
                }
            }
            palmtree.add(gltf.scene);
            palmtree.position.set(
                islandPosition.x + palmtreeOffset.x,
                islandPosition.y + palmtreeOffset.y,
                islandPosition.z + palmtreeOffset.z
            );
            palmtree.scale.setScalar(palmtreeScale);
            palmtree.rotation.y = palmtreeRotY;
            console.log('Palm tree loaded with ocean lighting');
        },
        (progress) => {
            console.log('Palm tree loading:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => {
            console.error('Error loading palm tree:', error);
        }
    );

    // Load grass patches — two clusters: main island area + palm tree ring
    loader.load(
        'models/surface/grass.glb',
        (gltf) => {
            grassGltfScene = gltf.scene;  // cache for respawning

            // Defer placement until the island surface raycaster is ready.
            waitForIslandMeshes(() => {

            // Helper: place one patch from a given cluster annulus
            const spawnGrassPatch = (cluster: typeof CLUSTER_MAIN) => {
                for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist  = cluster.minR + Math.random() * (cluster.maxR - cluster.minR);
                    const wx = cluster.wx + Math.cos(angle) * dist;
                    const wz = cluster.wz + Math.sin(angle) * dist;
                    if (!isValidSpawnPos(wx, wz, foliageSpawnPlaced)) continue;

                    foliageSpawnPlaced.push({ x: wx, z: wz });
                    const grassPatch = new Group();
                    const grassModel = gltf.scene.clone();
                    applyFoliageWindShader(grassModel);
                    grassModel.traverse((child) => {
                        if ((child as any).isMesh) {
                            child.castShadow = true;
                            (child as any).receiveShadow = true;
                        }
                    });
                    grassPatch.add(grassModel);
                    grassPatch.position.set(wx, GRASS_Y, wz);
                    grassPatch.scale.setScalar(grassScale);
                    grassPatch.rotation.y = Math.random() * Math.PI * 2;
                    grassPatches.push(grassPatch);
                    // Track cluster membership for debug shifting
                    if (cluster === CLUSTER_MAIN) clusterMainPatches.push(grassPatch);
                    else clusterPalmPatches.push(grassPatch);
                    return true;
                }
                return false;  // Could not place
            };

            // Main cluster — broad island surface
            for (let i = 0; i < GRASS_COUNT; i++) spawnGrassPatch(CLUSTER_MAIN);
            // Palm cluster — ring of grass around the palm trunk
            for (let i = 0; i < GRASS_COUNT_PALM; i++) spawnGrassPatch(CLUSTER_PALM);

            _grassLoaded = true;
            console.log(`${grassPatches.length} grass patches placed (target ${GRASS_COUNT + GRASS_COUNT_PALM})`);

            }); // end waitForIslandMeshes
        },
        undefined,
        (error) => {
            console.error('Error loading grass:', error);
        }
    );

    // Load clover patches — main cluster only
    loader.load(
        'models/surface/clover.glb',
        (gltf) => {
            cloverGltfScene = gltf.scene;  // cache for respawning

            // Defer placement until the island surface raycaster is ready.
            waitForIslandMeshes(() => {

            const cloverStart = grassPatches.length;
            for (let i = 0; i < CLOVER_COUNT; i++) {
                let placed = false;
                for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist  = CLUSTER_MAIN.minR + Math.random() * (CLUSTER_MAIN.maxR - CLUSTER_MAIN.minR);
                    const wx = CLUSTER_MAIN.wx + Math.cos(angle) * dist;
                    const wz = CLUSTER_MAIN.wz + Math.sin(angle) * dist;
                    if (!isValidSpawnPos(wx, wz, foliageSpawnPlaced)) continue;

                    foliageSpawnPlaced.push({ x: wx, z: wz });
                    const cloverPatch = new Group();
                    const cloverModel = gltf.scene.clone();
                    applyFoliageWindShader(cloverModel);
                    cloverModel.traverse((child) => {
                        if ((child as any).isMesh) {
                            child.castShadow = true;
                            (child as any).receiveShadow = true;
                        }
                    });
                    cloverPatch.add(cloverModel);
                    cloverPatch.position.set(wx, CLOVER_Y, wz);
                    cloverPatch.scale.setScalar(cloverScale);
                    cloverPatch.rotation.y = Math.random() * Math.PI * 2;
                    grassPatches.push(cloverPatch);
                    clusterCloverPatches.push(cloverPatch);  // own array, separate from grass main
                    placed = true;
                    break;
                }
                if (!placed) console.warn('Clover: could not place patch after max attempts');
            }
            _cloverLoaded = true;
            console.log(`${grassPatches.length - cloverStart} clover patches placed (target ${CLOVER_COUNT})`);

            }); // end waitForIslandMeshes
        },
        undefined,
        (error) => {
            console.error('Error loading clover:', error);
        }
    );

    // Load radio in front of firecamp
    loader.load(
        'models/surface/radio.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            // Enable shadow casting and receiving for radio
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            radio.add(gltf.scene);
            radio.position.set(
                islandPosition.x + radioOffset.x,
                islandPosition.y + radioOffset.y,
                islandPosition.z + radioOffset.z
            );
            radio.scale.setScalar(radioScale);
            radio.rotation.y = radioRotY;
            console.log('Radio loaded with ocean lighting');
        },
        undefined,
        (error) => {
            console.error('Error loading radio:', error);
        }
    );

    // Load sword stuck in the middle of the bonfire
    loader.load(
        'models/surface/sword.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            // Enable shadow casting and receiving for sword
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            sword.add(gltf.scene);
            sword.position.set(
                islandPosition.x + swordOffset.x,
                islandPosition.y + swordOffset.y,
                islandPosition.z + swordOffset.z
            );
            sword.scale.setScalar(swordScale);
            sword.rotation.set(swordRot.x, swordRot.y, swordRot.z);
            console.log('Sword loaded with ocean lighting and shadow casting');
        },
        undefined,
        (error) => {
            console.error('Error loading sword:', error);
        }
    );

    // Load pug on the island (opposite side of radio)
    loader.load(
        'models/character/pug.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            // Enable shadow casting and receiving for pug
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            pug.add(gltf.scene);
            pug.position.set(
                islandPosition.x + pugOffset.x,
                islandPosition.y + pugOffset.y,
                islandPosition.z + pugOffset.z
            );
            pug.scale.setScalar(pugScale);
            pug.rotation.y = pugRotY;

            // Store all clips and setup idle animation
            pugAnimClips = gltf.animations ?? [];
            if (pugAnimClips.length > 0) {
                pugMixer = new AnimationMixer(gltf.scene);
                const startIdx = Math.min(3, pugAnimClips.length - 1);
                pugCurrentAnimIndex = startIdx;
                const idleClip = pugAnimClips[startIdx];
                const action = pugMixer.clipAction(idleClip);
                action.setLoop(LoopRepeat, Infinity);
                action.play();
                _pugCurrentAction = action;
                console.log(`Pug loaded — ${pugAnimClips.length} animations:`, pugAnimClips.map((c, i) => `${i}: "${c.name || '(unnamed)'}"`))
                // Apply correct anim immediately — handles page opened in night mode
                _restorePugNightState();
            } else {
                console.warn('Pug model has no animations');
            }
        },
        undefined,
        (error) => {
            console.error('Error loading pug:', error);
        }
    );

    // Load tent to the right of the palm tree
    loader.load(
        'models/surface/tent.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            tent.add(gltf.scene);
            tent.position.set(
                islandPosition.x + tentOffset.x,
                islandPosition.y + tentOffset.y,
                islandPosition.z + tentOffset.z
            );
            tent.scale.setScalar(tentScale);
            tent.rotation.y = tentRotY;
            console.log('Tent loaded');
        },
        undefined,
        (error) => { console.error('Error loading tent:', error); }
    );

    // Load dog bed inside the tent
    loader.load(
        'models/surface/dog_bed.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            dogBed.add(gltf.scene);
            dogBed.position.set(
                islandPosition.x + dogBedOffset.x,
                islandPosition.y + dogBedOffset.y,
                islandPosition.z + dogBedOffset.z
            );
            dogBed.scale.setScalar(dogBedScale);
            dogBed.rotation.y = dogBedRotY;
            console.log('Dog bed loaded');
        },
        undefined,
        (error) => { console.error('Error loading dog bed:', error); }
    );

    // Load little rocks (between pug and firecamp — phone leans on them)
    loader.load(
        'models/surface/little_rocks.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            littleRocks.add(gltf.scene);
            littleRocks.position.set(
                islandPosition.x + littleRocksOffset.x,
                islandPosition.y + littleRocksOffset.y,
                islandPosition.z + littleRocksOffset.z
            );
            littleRocks.scale.setScalar(littleRocksScale);
            littleRocks.rotation.set(littleRocksRot.x, littleRocksRot.y, littleRocksRot.z);
            threeScene.add(littleRocks);
            console.log('Little rocks loaded');
        },
        undefined,
        (error) => { console.error('Error loading little rocks:', error); }
    );

    // Phone model — always spawned on the little rocks
    loader.load(
        'models/overall/phone.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            phone.add(gltf.scene);
            phone.position.set(
                islandPosition.x + phoneOffset.x,
                islandPosition.y + phoneOffset.y,
                islandPosition.z + phoneOffset.z
            );
            phone.scale.setScalar(phoneScale);
            phone.rotation.set(phoneRot.x, phoneRot.y, phoneRot.z);
            threeScene.add(phone);
            // Phone is always visible — no cutscene gate
            phone.visible = true;
            PhoneScreen.init(threeScene);
            PhoneScreen.setVisible(true);
            console.log('Phone loaded (always visible on little rocks)');
        },
        undefined,
        (error) => { console.error('Error loading phone:', error); }
    );

    // Setup mouse/touch event listeners for grass interaction
    setupGrassInteraction();

    // Register multi-touch tracker (must run before interaction handlers)
    _setupMultiTouchTracker();

    // Setup radio click/hover interaction
    setupRadioInteraction();

    // Setup pug click/hover interaction
    setupPugInteraction();

    // Setup phone click/hover interaction
    setupPhoneInteraction();
}

// ── Multi-touch gesture tracker ─────────────────────────────────────────────
// Tracks whether 2+ fingers were ever active simultaneously during the current
// gesture. Prevents scroll-gesture finger-lifts from triggering click actions.
let _touchWasMulti = false;

function _setupMultiTouchTracker(): void {
    const canvas = renderer.domElement;
    canvas.addEventListener('touchstart', (e: TouchEvent) => {
        if (e.touches.length >= 2) _touchWasMulti = true;
    }, { passive: true });
    canvas.addEventListener('touchend', (e: TouchEvent) => {
        if (e.touches.length === 0) _touchWasMulti = false; // all fingers lifted — reset
    }, { passive: true });
}

// Setup mouse and touch events for grass interaction
function setupGrassInteraction(): void {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    // Mouse move handler
    const onMouseMove = (event: MouseEvent) => {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        updateMouseWorldPosition();
    };

    // Touch move handler
    const onTouchMove = (event: TouchEvent) => {
        if (event.touches.length > 0) {
            const touch = event.touches[0];
            mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
            updateMouseWorldPosition();
        }
    };

    // Mouse leave handler - reset position to far away
    const onMouseLeave = () => {
        mouseWorldPos.value.set(0, -100, 0);
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('touchmove', onTouchMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('touchend', onMouseLeave);
}

// Raycast to find mouse position on island/grass
function updateMouseWorldPosition(): void {
    if (!camera) return;
    
    raycaster.setFromCamera(mouse, camera);
    
    // Raycast against island and grass patches
    const targets: Object3D[] = [island, ...grassPatches];
    const intersects = raycaster.intersectObjects(targets, true);
    
    if (intersects.length > 0) {
        const hit = intersects[0];
        mouseWorldPos.value.copy(hit.point);
    } else {
        // If not hitting anything, move mouse position far away
        mouseWorldPos.value.set(0, -100, 0);
    }
}

// ============================================
// PUG CLICK/HOVER INTERACTION
// ============================================
const pugRaycaster = new Raycaster();
const pugMouse = new Vector2();
let isPugHovered = false;

// Reusable Vector3 for projecting pug world-pos to screen coords (avoids per-frame allocation)
const _pugScreenVec = new Vector3();

function _getPugScreenPos(): { x: number; y: number } | null {
    _pugScreenVec.copy(pug.position);
    _pugScreenVec.y += 0.35;  // project from well above pug head so bubble sits higher
    _pugScreenVec.project(camera);
    return {
        x: (_pugScreenVec.x * 0.5 + 0.5) * window.innerWidth,
        y: (-_pugScreenVec.y * 0.5 + 0.5) * window.innerHeight,
    };
}

// ── Configurable pug animation indices ────────────────────────────────────────
const PUG_ANIM_BARK = 4;   // bark / react animation clip index
const PUG_ANIM_WALK = 10;  // walk animation clip index
const PUG_ANIM_DROP = 0;   // drop / place item animation clip index
/** Walk animation playback speed during the phone drop cutscene — TWEAK (1.0 = normal) */
const PUG_CUTSCENE_WALK_SPEED = 0.55;

// ── Helper: build the "who's Leo?" branch (ends with phone drop cutscene) ────
function _buildLeoBranch(): DialogLine[] {
    return [
        {
            textKey: 'pug.day.leo.0',
            onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
        },
        {
            textKey: 'pug.day.leo.1',
            onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
        },
    ];
}

// ── Helper: build the "what is this place?" branch ───────────────────────────
function _buildPlaceBranch(): DialogLine[] {
    return [
        {
            textKey: 'pug.day.place.0',
            onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
        },
        {
            textKey: 'pug.day.place.1',
            onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
        },
        {
            textKey: 'pug.day.place.2',
            onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
        },
        {
            textKey: 'pug.day.place.3',
            onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
            replies: (() => {
                const opts: ReplyOption[] = [
                    {
                        textKey: 'pug.reply.likeit',
                        onSelect: () => {
                            showDialog([
                                {
                                    textKey: 'pug.reply.response.likeit',
                                    onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
                                },
                            ], _getPugScreenPos, _onPugDialogComplete);
                        },
                    } as ReplyOption,
                ];
                // Only offer "who's Leo?" before the phone has been dropped
                if (!phoneDropped) {
                    opts.push({
                        textKey: 'pug.reply.wholeo',
                        onSelect: () => {
                            showDialog(_buildLeoBranch(), _getPugScreenPos, () => {
                                // After "let me show you on my phone" — start the cutscene
                                _startPhoneDropSequence();
                            });
                        },
                    } as ReplyOption);
                }
                return opts;
            })(),
        },
    ];
}

// ── Helper: build the second-level replies (after "what?") ───────────────────
function _buildSecondLevelReplies(): ReplyOption[] {
    return [
        {
            textKey: 'pug.reply.thisplace',
            onSelect: () => {
                showDialog(_buildPlaceBranch(), _getPugScreenPos, _onPugDialogComplete);
            },
        } as ReplyOption,
        {
            textKey: 'pug.reply.youtalk',
            onSelect: () => {
                showDialog([
                    {
                        textKey: 'pug.reply.response.youtalk',
                        sound: '/audio/character/freesound_community-pug-woof-2-103762_PRIMEIRA.wav',
                        onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
                    },
                ], _getPugScreenPos, _onPugDialogComplete);
            },
        } as ReplyOption,
        {
            textKey: 'pug.reply.bye',
            onSelect: () => {
                dismissDialog();
                _onPugDialogComplete();
            },
        } as ReplyOption,
    ];
}

const PUG_DIALOG_LINES: DialogLine[] = [
    {
        textKey: 'pug.dialog.0',
        sound: '/audio/character/freesound_community-pug-woof-2-103762_PRIMEIRA.wav',
        onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
    },
    {
        textKey: 'pug.dialog.1',
        sound: '/audio/character/freesound_community-pug-woof-2-103762_SEGUNDA.wav',
        onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
        replies: [
            {
                textKey: 'pug.reply.hi',
                onSelect: () => {
                    // "hi" → pug responds "what?" → "hey..." → "what's up?" then 3 reply options
                    showDialog([
                        {
                            textKey: 'pug.reply.response.hi.day',
                            sound: '/audio/character/freesound_community-pug-woof-2-103762_PRIMEIRA.wav',
                            onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
                        },
                        {
                            textKey: 'pug.day.opa',
                            onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
                        },
                        {
                            textKey: 'pug.day.whatsup',
                            onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
                            replies: _buildSecondLevelReplies(),
                        },
                    ], _getPugScreenPos, _onPugDialogComplete);
                },
            } as ReplyOption,
            {
                textKey: 'pug.reply.bye',
                onSelect: () => {
                    dismissDialog();
                    _onPugDialogComplete();
                },
            } as ReplyOption,
        ],
    },
];

const PUG_NIGHT_DIALOG_LINES: DialogLine[] = [
    {
        textKey: 'pug.night.0',
        onLineStart: () => playPugSnoreOnce(),
    },
    {
        textKey: 'pug.night.1',
        onLineStart: () => playPugSnoreOnce(),
        replies: [
            {
                textKey: 'pug.reply.hi',
                onSelect: () => {
                    showDialog([
                        {
                            textKey: 'pug.reply.response.hi.night',
                            onLineStart: () => playPugSnoreOnce(),
                        },
                    ], _getPugScreenPos, _onPugDialogComplete);
                },
            } as ReplyOption,
            {
                textKey: 'pug.reply.bye',
                onSelect: () => {
                    dismissDialog();
                    _onPugDialogComplete();
                },
            } as ReplyOption,
        ],
    },
];

// ============================================
// PHONE DROP CUTSCENE
// ============================================

/** Simple promise-based delay (ms). */
function _delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Smooth tween helper — animates a numeric property over `duration` ms.
 * Uses requestAnimationFrame for smooth interpolation.
 */
function _tweenValue(
    from: number, to: number, duration: number,
    onUpdate: (v: number) => void
): Promise<void> {
    return new Promise(resolve => {
        const start = performance.now();
        function tick(now: number) {
            const elapsed = now - start;
            const t = Math.min(1, elapsed / duration);
            // Smooth ease-in-out (cubic)
            const eased = t < 0.5
                ? 4 * t * t * t
                : 1 - Math.pow(-2 * t + 2, 3) / 2;
            onUpdate(from + (to - from) * eased);
            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                resolve();
            }
        }
        requestAnimationFrame(tick);
    });
}

/**
 * Phone cutscene — pug walks to the phone, does a pointing gesture, camera
 * zooms into the phone, pug walks back.  Phone is always already visible.
 * Called after the "let me show you on my phone" dialog line completes.
 */
async function _startPhoneDropSequence(): Promise<void> {
    // ── 1. Release pug zoom & dismiss dialog so camera returns to orbit ──────
    zoomOutFromPug();
    dismissDialog();

    // ── 2. Save current pug position & rotation ──────────────────────────────
    const savedPosX = pug.position.x;
    const savedPosZ = pug.position.z;
    const savedRotY = pug.rotation.y;

    // Walk target: just beside the phone (slightly behind it so the pug faces it)
    const walkTargetX = phone.position.x + 0.12;
    const walkTargetZ = phone.position.z + 0.14;

    // ── 3. Walk to phone position ─────────────────────────────────────────────
    const dxWalk = walkTargetX - savedPosX;
    const dzWalk = walkTargetZ - savedPosZ;
    pug.rotation.y = Math.atan2(dxWalk, dzWalk);
    setPugAnimation(PUG_ANIM_WALK);
    if (_pugCurrentAction) _pugCurrentAction.timeScale = PUG_CUTSCENE_WALK_SPEED;

    await Promise.all([
        _tweenValue(savedPosX, walkTargetX, 1200, v => { pug.position.x = v; }),
        _tweenValue(savedPosZ, walkTargetZ, 1200, v => { pug.position.z = v; }),
    ]);

    // ── 4. Play drop/point animation (reused as "pointing at phone") ─────────
    setPugAnimation(PUG_ANIM_DROP);
    await _delay(500);  // let the pointing gesture start

    // ── 5. Zoom into the phone using the default zoom logic ──────────────────
    zoomToPhone();
    await _delay(300);

    // ── 6. Walk back to original position (while phone is zoomed in) ─────────
    const dxReturn = savedPosX - pug.position.x;
    const dzReturn = savedPosZ - pug.position.z;
    pug.rotation.y = Math.atan2(dxReturn, dzReturn);
    setPugAnimation(PUG_ANIM_WALK);
    if (_pugCurrentAction) _pugCurrentAction.timeScale = PUG_CUTSCENE_WALK_SPEED;

    await Promise.all([
        _tweenValue(pug.position.x, savedPosX, 1200, v => { pug.position.x = v; }),
        _tweenValue(pug.position.z, savedPosZ, 1200, v => { pug.position.z = v; }),
    ]);

    // ── 7. Restore idle and finish ───────────────────────────────────────────
    if (pugMixer && pugAnimClips[PUG_ANIM_WALK]) {
        pugMixer.clipAction(pugAnimClips[PUG_ANIM_WALK]).timeScale = 1;
    }
    pug.rotation.y = savedRotY;
    phoneDropped = true;
    _restorePugNightState();
}

// ============================================
// PHONE CLICK/HOVER INTERACTION
// ============================================
const phoneRaycaster = new Raycaster();
const phoneMouse = new Vector2();
let isPhoneHovered = false;

function setupPhoneInteraction(): void {
    const canvas = renderer.domElement;
    if (!canvas) return;

    const onPhoneClick = (clientX: number, clientY: number) => {
        // Ignore interactions while phone hasn't loaded yet
        if (!phone.visible) return;
        // Ignore interactions while underwater
        if (camera.position.y < UNDERWATER_Y_THRESHOLD) return;
        // Ignore clicks while pug or radio zoom is active
        if (isPugZoomActive() || isRadioZoomActive()) return;

        // If already zoomed into phone, zoom out only if the click missed the
        // phone model entirely — clicking on the model itself does nothing.
        if (isPhoneZoomActive()) {
            if (phone.children.length > 0) {
                phoneMouse.x = (clientX / window.innerWidth) * 2 - 1;
                phoneMouse.y = -(clientY / window.innerHeight) * 2 + 1;
                phoneRaycaster.setFromCamera(phoneMouse, camera);
                const hits = phoneRaycaster.intersectObjects(phone.children, true);
                if (hits.length > 0) return; // clicked on phone model — stay zoomed
            }
            zoomOutFromPhone();
            return;
        }

        if (phone.children.length === 0) return;

        phoneMouse.x = (clientX / window.innerWidth) * 2 - 1;
        phoneMouse.y = -(clientY / window.innerHeight) * 2 + 1;
        phoneRaycaster.setFromCamera(phoneMouse, camera);
        const intersects = phoneRaycaster.intersectObjects(phone.children, true);
        if (intersects.length > 0) {
            // Clear hover state before zoom
            isPhoneHovered = false;
            canvas.style.cursor = '';
            zoomToPhone();
        }
    };

    canvas.addEventListener('click', (e: MouseEvent) => {
        onPhoneClick(e.clientX, e.clientY);
    });

    canvas.addEventListener('touchend', (e: TouchEvent) => {
        if (_touchWasMulti) return;
        if (e.changedTouches.length > 0) {
            const touch = e.changedTouches[0];
            onPhoneClick(touch.clientX, touch.clientY);
        }
    });

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        if (!phone.visible || phone.children.length === 0
            || isPhoneZoomActive() || camera.position.y < UNDERWATER_Y_THRESHOLD) {
            if (isPhoneHovered) { isPhoneHovered = false; canvas.style.cursor = ''; }
            return;
        }
        phoneMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        phoneMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        phoneRaycaster.setFromCamera(phoneMouse, camera);
        const intersects = phoneRaycaster.intersectObjects(phone.children, true);
        if (intersects.length > 0) {
            if (!isPhoneHovered) { isPhoneHovered = true; canvas.style.cursor = 'pointer'; }
        } else {
            if (isPhoneHovered) { isPhoneHovered = false; canvas.style.cursor = ''; }
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isPhoneHovered) { isPhoneHovered = false; canvas.style.cursor = ''; }
    });
}

function _unregisterSleepLoopListener(): void {
    if (!pugMixer || !_pugSleepLoopListener) return;
    pugMixer.removeEventListener('loop', _pugSleepLoopListener);
    _pugSleepLoopListener = null;
}

function _registerSleepLoopListener(): void {
    if (!pugMixer || _pugSleepLoopListener) return;  // already registered
    const sleepAction = _pugCurrentAction;            // capture specific sleep action
    _pugSleepLoopListener = (e: { action: AnimationAction }) => {
        if (e.action !== sleepAction) return;         // ignore temp-anim loops
        if (!_pugIsNight || isDialogActive()) return;
        _spawnPugZBurst();
    };
    pugMixer.addEventListener('loop', _pugSleepLoopListener as any);
}

function _clearPugZParticles(): void {
    for (const z of _pugZParticles) {
        z.sprite.parent?.remove(z.sprite);
        (z.sprite.material as SpriteMaterial).dispose();
    }
    _pugZParticles.length = 0;
    _pugZSpawnQueue.length = 0;
    _unregisterSleepLoopListener();
    stopPugSnore();
}

/** Re-evaluate sun visibility and apply the correct idle animation. Safe to call any time. */
function _restorePugNightState(): void {
    const sunVis = sunVisibilityUniform.value as number;
    if (sunVis < PUG_NIGHT_THRESHOLD) {
        const idx = _findPugNightAnim();
        if (idx >= 0) {
            _pugIsNight = true;
            pugDefaultAnimIndex = idx;
            setPugAnimation(idx);
            _registerSleepLoopListener();  // start spawning Zs on each animation loop
        }
    } else {
        _pugIsNight = false;
        pugDefaultAnimIndex = 3;
        setPugAnimation(3);
        _unregisterSleepLoopListener();
        _clearPugZParticles();
        stopPugSnore();
    }
}

/** Shared onComplete for all pug dialogs — zooms out and restores the correct idle state. */
function _onPugDialogComplete(): void {
    zoomOutFromPug();
    if (_pugMusicWasPlaying) {
        pugDefaultAnimIndex = 4;
        setPugAnimation(4);
    } else {
        _restorePugNightState();
    }
}

function _startPugDialog(): void {
    // Night dialog only when it's actually night AND music isn't playing.
    // Music overrides night — pug wakes up to dance, so day dialog applies.
    const useNightDialog = _pugIsNight && !_pugMusicWasPlaying;

    // At night (no music) keep the sleeping animation; otherwise switch to idle/music anim
    if (!useNightDialog) {
        pugDefaultAnimIndex = _pugMusicWasPlaying ? 4 : 3;
        setPugAnimation(pugDefaultAnimIndex);
    }
    _clearPugZParticles();  // stops Z particles (and any residual snore state)

    const lines = useNightDialog ? PUG_NIGHT_DIALOG_LINES : PUG_DIALOG_LINES;

    showDialog(lines, _getPugScreenPos, _onPugDialogComplete);
}

function setupPugInteraction(): void {
    const canvas = renderer.domElement;
    if (!canvas) return;

    const onPugClick = (clientX: number, clientY: number) => {
        // Ignore interactions while underwater — models are above water
        if (camera.position.y < UNDERWATER_Y_THRESHOLD) return;
        // Ignore clicks while another zoom is active — let that handler close itself first
        if (isRadioZoomActive() || isPhoneZoomActive()) return;
        // If already zoomed in: advance dialog (which calls zoomOut when done) or just zoom out
        if (isPugZoomActive()) {
            if (isDialogActive()) {
                advanceDialog();
            } else {
                zoomOutFromPug();
            }
            return;
        }
        if (pug.children.length === 0) return;

        pugMouse.x = (clientX / window.innerWidth) * 2 - 1;
        pugMouse.y = -(clientY / window.innerHeight) * 2 + 1;
        pugRaycaster.setFromCamera(pugMouse, camera);
        const intersects = pugRaycaster.intersectObjects(pug.children, true);
        if (intersects.length > 0) {
            zoomToPug();
            _startPugDialog();
        }
    };

    canvas.addEventListener('click', (e: MouseEvent) => {
        onPugClick(e.clientX, e.clientY);
    });

    canvas.addEventListener('touchend', (e: TouchEvent) => {
        if (_touchWasMulti) return;  // was a 2-finger scroll gesture — skip click
        if (e.changedTouches.length > 0) {
            const touch = e.changedTouches[0];
            onPugClick(touch.clientX, touch.clientY);
        }
    });

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        if (pug.children.length === 0 || isPugZoomActive() || camera.position.y < UNDERWATER_Y_THRESHOLD) {
            if (isPugHovered) { isPugHovered = false; canvas.style.cursor = ''; }
            return;
        }
        pugMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        pugMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        pugRaycaster.setFromCamera(pugMouse, camera);
        const intersects = pugRaycaster.intersectObjects(pug.children, true);
        if (intersects.length > 0) {
            if (!isPugHovered) { isPugHovered = true; canvas.style.cursor = 'pointer'; }
        } else {
            if (isPugHovered) { isPugHovered = false; canvas.style.cursor = ''; }
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isPugHovered) { isPugHovered = false; canvas.style.cursor = ''; }
    });
}

// ============================================
// RADIO CLICK/HOVER INTERACTION
// ============================================
const radioRaycaster = new Raycaster();
const radioMouse = new Vector2();
const RADIO_HOVER_SCALE = 1.15;  // Scale multiplier on hover
const radioBaseScale = radioScale;
let isRadioHovered = false;

function setupRadioInteraction(): void {
    const canvas = renderer.domElement;
    if (!canvas) return;

    // Click handler — open media player when clicking on radio, close when clicking elsewhere
    const onRadioClick = (clientX: number, clientY: number) => {
        if (radio.children.length === 0) return;  // Not loaded yet
        // Ignore interactions while underwater — models are above water
        if (camera.position.y < UNDERWATER_Y_THRESHOLD) return;
        // Ignore clicks while another zoom is active — let that handler close itself first
        if (isPugZoomActive() || isPhoneZoomActive()) return;

        // Any canvas click while the player is open closes it.
        // Don't raycast here — the zoomed-in model fills most of the canvas so hitsRadio
        // would be true even when the user clearly clicked "outside" the player UI.
        if (getIsExpanded()) {
            collapsePlayer();
            return;
        }

        if (!document.body.classList.contains('music-visible')) return;  // Not ready yet

        radioMouse.x = (clientX / window.innerWidth) * 2 - 1;
        radioMouse.y = -(clientY / window.innerHeight) * 2 + 1;
        radioRaycaster.setFromCamera(radioMouse, camera);
        const hitsRadio = radioRaycaster.intersectObjects(radio.children, true).length > 0;

        if (hitsRadio) {
            // Force-clear hover state so scale and cursor reset instantly before zoom starts
            isRadioHovered = false;
            canvas.style.cursor = '';
            radio.scale.setScalar(radioBaseScale);
            expandPlayer();
        }
    };

    canvas.addEventListener('click', (e: MouseEvent) => {
        onRadioClick(e.clientX, e.clientY);
    });

    canvas.addEventListener('touchend', (e: TouchEvent) => {
        if (_touchWasMulti) return;  // was a 2-finger scroll gesture — skip click
        if (e.changedTouches.length > 0) {
            const touch = e.changedTouches[0];
            onRadioClick(touch.clientX, touch.clientY);
        }
    });

    // Hover handler — scale radio and change cursor
    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        if (radio.children.length === 0 || getIsExpanded() || camera.position.y < UNDERWATER_Y_THRESHOLD) {
            if (isRadioHovered) {
                isRadioHovered = false;
                canvas.style.cursor = '';
                radio.scale.setScalar(radioBaseScale);
            }
            return;
        }

        radioMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        radioMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

        radioRaycaster.setFromCamera(radioMouse, camera);
        const intersects = radioRaycaster.intersectObjects(radio.children, true);

        if (intersects.length > 0) {
            if (!isRadioHovered) {
                isRadioHovered = true;
                canvas.style.cursor = 'pointer';
            }
        } else {
            if (isRadioHovered) {
                isRadioHovered = false;
                canvas.style.cursor = '';
            }
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isRadioHovered) {
            isRadioHovered = false;
            canvas.style.cursor = '';
        }
    });
}

export function Update(): void {
    // Update palm tree wind shader time
    palmWindTimeUniform.value = time * PALM_WIND_SPEED;
    
    // Breeze-driven wind animation for grass and palm tree
    windTime += deltaTime;
    
    // Smooth breeze intensity envelope — ramps up when breeze audio plays, fades out after
    const breezeActive = isBreezeActive();
    if (breezeActive) {
        breezeIntensity = Math.min(1.0, breezeIntensity + deltaTime / BREEZE_RAMP_UP);
    } else {
        breezeIntensity = Math.max(0.0, breezeIntensity - deltaTime / BREEZE_RAMP_DOWN);
    }
    
    // Update shader uniforms so vertex wind also syncs with breeze
    palmWindTimeUniform.value = windTime;
    palmWindStrengthUniform.value = PALM_WIND_STRENGTH * breezeIntensity;
    foliageWindStrengthUniform.value = FOLIAGE_WIND_STRENGTH * breezeIntensity;
    
    // Flickering wind: overlapping inharmonic sine waves for chaotic, natural feel
    grassPatches.forEach((patch, i) => {
        const phase = i * 0.5;
        const flicker = Math.sin(windTime * 3.7 + phase) * 0.4
                       + Math.sin(windTime * 7.3 + phase * 1.3) * 0.25
                       + Math.sin(windTime * 11.1 + phase * 0.7) * 0.15
                       + Math.sin(windTime * 17.0 + phase * 2.1) * 0.1;
        const patchWind = flicker * breezeIntensity;
        patch.rotation.z = patchWind * BREEZE_GRASS_STRENGTH;
        patch.rotation.x = patchWind * BREEZE_GRASS_STRENGTH * 0.3;
    });
    
    // Palm tree wind is handled entirely by the vertex shader (applyPalmWindShader)
    // which uses smoothstep(uLeafStartY, uLeafFullY, position.y) to only move leaves,
    // not the trunk. No JS rotation needed here.
    
    // Radio vibration when music is playing
    if (radio.children.length > 0) {
        // Smooth hover scale
        const targetScale = isRadioHovered ? radioBaseScale * RADIO_HOVER_SCALE : radioBaseScale;
        const currentScale = radio.scale.x;
        const newScale = currentScale + (targetScale - currentScale) * Math.min(1, deltaTime * 10);
        radio.scale.setScalar(newScale);

        if (getIsPlaying()) {
            radioTime += deltaTime;
            
            // Music intensity (0-1) from the Web Audio analyser
            const intensity = getMusicIntensity();
            
            // Real music rarely exceeds ~0.45 raw intensity, so remap to use full range.
            // Clamp to 0-1 after stretching so 0.45 raw → 1.0 effective.
            const normalized = Math.min(1, intensity / 0.4);
            // Exponential curve for wider dynamic range:
            // Near 0 → almost no bounce, near 1 → very strong bounce
            const curved = normalized * normalized;
            // Map: 0.05 at silence → ~3.5 at max
            const intensityScale = 0.05 + curved * 3.45;
            
            // Multi-frequency vibration scaled by music energy
            const vibe1 = Math.sin(radioTime * radioVibeSpeed) * radioVibeStrength * intensityScale;
            const vibe2 = Math.sin(radioTime * radioVibeSpeed * 1.7) * radioVibeStrength * 0.5 * intensityScale;
            const vibe3 = Math.abs(Math.sin(radioTime * radioVibeSpeed * 0.5)) * radioVibeStrength * 0.3 * intensityScale;
            const totalVibe = vibe1 + vibe2 + vibe3;
            radio.position.y = radioBaseY + totalVibe;
            // Subtle rotation wobble
            radio.rotation.z = Math.sin(radioTime * radioVibeSpeed * 0.8) * 0.015 * intensityScale;
            
            // Spawn music note particles
            buildNoteTextures();
            const kick = getBeatKick();
            
            // Use same normalized intensity as bounce (real music tops ~0.4 raw)
            const normIntensity = Math.min(1, intensity / 0.4);
            
            // Base spawn rate: calm, steady output (every ~1.0s quiet, ~0.3s loud)
            const spawnInterval = 1.0 - normIntensity * 0.7;
            // Max particles: 4 at silence, 24 at max
            const maxNotes = Math.round(4 + normIntensity * 20);
            
            noteSpawnTimer += deltaTime;
            
            // Detect beat: rising edge of kick (crosses threshold from below)
            const beatHit = kick > 0.3 && lastBeatKick <= 0.3;
            lastBeatKick = kick;
            
            // Regular calm spawning on timer
            if (noteSpawnTimer >= spawnInterval && musicNotes.length < maxNotes) {
                noteSpawnTimer = 0;
                spawnMusicNote(normIntensity);
            }
            
            // Beat-triggered burst: spawn extra notes on detected beats
            if (beatHit && musicNotes.length < maxNotes) {
                // Number of burst notes scales with beat strength (2-5)
                const burstCount = Math.min(5, Math.round(2 + kick * 3));
                for (let b = 0; b < burstCount && musicNotes.length < maxNotes; b++) {
                    spawnMusicNote(Math.min(1, normIntensity + kick * 0.2));
                }
                // Reset timer so we don't double-spawn right after a beat
                noteSpawnTimer = 0;
            }
        } else {
            // Smoothly return to base position
            radio.position.y += (radioBaseY - radio.position.y) * 0.1;
            radio.rotation.z *= 0.9;
            noteSpawnTimer = 0;
        }
    }
    
    // Update pug animation mixer
    if (pugMixer) {
        pugMixer.update(deltaTime);
    }

    // ── Pug music-playing state: suppress sleep when music is on
    const _musicNowPlaying = getIsPlaying();
    if (_musicNowPlaying && !_pugMusicWasPlaying) {
        // Music just started — cancel sleep mode
        _pugMusicWasPlaying = true;
        _clearPugZParticles();
        stopPugSnore();
        pugDefaultAnimIndex = 4;  // treat as default so any temp anim returns here
        setPugAnimation(4);  // same clip used at dialog line start (onLineStart)
    } else if (!_musicNowPlaying && _pugMusicWasPlaying) {
        // Music just stopped — restore default idle based on day/night
        _pugMusicWasPlaying = false;
        _restorePugNightState();
    }

    // ── Pug night-mode: crossfade on day↔night transitions
    if (pugMixer && pugAnimClips.length > 0 && !isDialogActive() && !_pugMusicWasPlaying) {
        const sunVis = sunVisibilityUniform.value as number;
        const shouldBeNight = sunVis < PUG_NIGHT_THRESHOLD;
        if (shouldBeNight !== _pugIsNight) {
            _restorePugNightState();
        }
    }

    // ── Pug sleep Z particles — spawning is driven by the animation loop listener;
    //    here we only advance existing particles every frame.
    _updatePugZParticles();

    // Update music note particles
    updateMusicNotes();
}

// Spawn a music note particle along an invisible arch above the radio
function spawnMusicNote(intensity: number): void {
    if (noteTextures.length === 0) return;
    
    // Pick random note texture
    const tex = noteTextures[Math.floor(Math.random() * noteTextures.length)];
    
    const mat = new SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,  // starts invisible, fades in
        depthWrite: false,
        blending: AdditiveBlending,
    });
    const sprite = new Sprite(mat);
    
    // Size: 0.07 - 0.12
    const noteSize = 0.07 + Math.random() * 0.05;
    sprite.scale.set(noteSize, noteSize, 1);
    
    // Spawn position: along a wider arch above the radio, spread in X and Z
    // archAngle sweeps the XY arch, zAngle adds depth variation
    const archAngle = Math.random() * Math.PI;  // 0 to PI (left to right)
    const zAngle = (Math.random() - 0.5) * Math.PI * 0.6;  // ±54° depth spread
    const archRadius = 0.12 + Math.random() * 0.06;
    const spawnX = radio.position.x + Math.cos(archAngle) * archRadius;
    const spawnY = radio.position.y + 0.15 + Math.sin(archAngle) * archRadius * 0.6;
    const spawnZ = radio.position.z + Math.sin(zAngle) * archRadius * 0.5;
    sprite.position.set(spawnX, spawnY, spawnZ);
    
    // Velocity: fast initial launch, deceleration handled in update
    const speed = (0.12 + intensity * 0.18) * (0.8 + Math.random() * 0.4);
    const vx = Math.cos(archAngle) * speed * 0.8;  // outward to sides
    const vy = (0.5 + Math.sin(archAngle) * 0.5) * speed;  // always upward
    const vz = Math.sin(zAngle) * speed * 0.4;  // outward in depth
    
    // Lifetime: longer so notes travel further before fading
    const lifetime = 2.0 + (1 - intensity) * 1.0 + Math.random() * 0.5;
    
    // Base opacity scales with intensity: 0.4 at silence, 0.9 at max
    const baseOpacity = 0.4 + intensity * 0.5;
    
    radio.parent?.add(sprite);
    musicNotes.push({ sprite, age: 0, lifetime, vx, vy, vz, baseOpacity });
}

// Update all music note particles
function updateMusicNotes(): void {
    for (let i = musicNotes.length - 1; i >= 0; i--) {
        const note = musicNotes[i];
        note.age += deltaTime;
        
        if (note.age >= note.lifetime) {
            note.sprite.parent?.remove(note.sprite);
            (note.sprite.material as SpriteMaterial).dispose();
            musicNotes.splice(i, 1);
            continue;
        }
        
        const t = note.age / note.lifetime;  // 0 to 1
        
        // Move
        note.sprite.position.x += note.vx * deltaTime;
        note.sprite.position.y += note.vy * deltaTime;
        note.sprite.position.z += note.vz * deltaTime;
        
        // Deceleration curve: light drag early, heavy braking in last 40%
        // This keeps the fast launch feeling while notes slow to a float before fading
        const drag = t < 0.6 ? 0.998 : 0.96;
        note.vx *= drag;
        note.vy *= drag;
        note.vz *= drag;
        
        // Opacity: fade in quickly (first 10%), then fade out
        let opacity: number;
        if (t < 0.1) {
            opacity = note.baseOpacity * (t / 0.1);
        } else {
            opacity = note.baseOpacity * (1 - (t - 0.1) / 0.9);
        }
        (note.sprite.material as SpriteMaterial).opacity = opacity;
        
        // Gentle rotation for visual variety
        note.sprite.material.rotation += deltaTime * (i % 2 === 0 ? 0.5 : -0.5);
    }
}

// ─── Pug sleep Z particles ────────────────────────────────────────────────────

function _buildZTexture(): CanvasTexture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-0.35);         // slight tilt — classic comic-book Z angle
    ctx.font = `bold ${Math.round(size * 0.78)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Z', 0, 0);
    ctx.restore();
    const tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

/**
 * Queue a burst of Z particles — each trickles out PUG_Z_BURST_DELAY seconds apart.
 * Called by the sleep-animation loop listener — once per animation loop.
 */
function _spawnPugZBurst(): void {
    if (!_pugZTexture) _pugZTexture = _buildZTexture();

    // Resolve head world position from the pug's local model space.
    pug.localToWorld(_pugHeadWorld.copy(_pugHeadLocal));

    // Wave sweeps perpendicular to the pug's facing direction (local +Z → world).
    const ry = pug.rotation.y;
    const waveAxisX =  Math.cos(ry);
    const waveAxisZ = -Math.sin(ry);

    for (let i = 0; i < PUG_Z_BURST_COUNT; i++) {
        _pugZSpawnQueue.push({
            countdown:  i * PUG_Z_BURST_DELAY,
            burstIndex: i,
            waveAxisX, waveAxisZ,
            headX: _pugHeadWorld.x,
            headY: _pugHeadWorld.y,
            headZ: _pugHeadWorld.z,
        });
    }
}

/** Materialise one queued Z job into a live sprite + particle entry. */
function _spawnOneZ(job: ZSpawnJob): void {
    const i = job.burstIndex;
    const mat = new SpriteMaterial({
        map: _pugZTexture!,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
    });
    const sprite = new Sprite(mat);

    // Grow each successive Z a little larger so the trail reads naturally
    const baseSize = 0.045 + i * 0.012 + Math.random() * 0.010;
    sprite.scale.set(baseSize, baseSize, 1);

    // Tiny random jitter so they don't stack perfectly
    const spawnX = job.headX + (Math.random() - 0.5) * 0.025;
    const spawnY = job.headY + (Math.random() + 1.8) * 0.015;
    const spawnZ = job.headZ + (Math.random() - 0.5) * 0.025;
    sprite.position.set(spawnX, spawnY, spawnZ);

    // Each Z starts its wave at a consistent offset so the chain looks connected
    const phaseOffset = i * (Math.PI * 2 / PUG_Z_BURST_COUNT);

    const lifetime    = 2.6 + i * 0.28 + Math.random() * 0.3;
    const riseSpeed   = PUG_Z_RISE_SPEED * (0.85 + Math.random() * 0.30);
    const baseOpacity = 0.60 + Math.random() * 0.30;

    pug.parent?.add(sprite);
    _pugZParticles.push({
        sprite, age: 0, lifetime,
        spawnX, spawnY, spawnZ,
        waveAxisX: job.waveAxisX, waveAxisZ: job.waveAxisZ,
        phaseOffset, riseSpeed, baseOpacity,
    });
}

function _updatePugZParticles(): void {
    // Tick the spawn queue — materialise jobs whose countdown has elapsed
    for (let i = _pugZSpawnQueue.length - 1; i >= 0; i--) {
        _pugZSpawnQueue[i].countdown -= deltaTime;
        if (_pugZSpawnQueue[i].countdown <= 0) {
            _spawnOneZ(_pugZSpawnQueue[i]);
            _pugZSpawnQueue.splice(i, 1);
        }
    }

    for (let i = _pugZParticles.length - 1; i >= 0; i--) {
        const z = _pugZParticles[i];
        z.age += deltaTime;

        if (z.age >= z.lifetime) {
            z.sprite.parent?.remove(z.sprite);
            (z.sprite.material as SpriteMaterial).dispose();
            _pugZParticles.splice(i, 1);
            continue;
        }

        const t = z.age / z.lifetime;

        // ── Sine-wave path ────────────────────────────────────────────────────
        // All particles follow the exact same wave shape from their spawn point,
        // staggered by phaseOffset so the burst reads as a continuous stream.
        const waveOffset = PUG_Z_WAVE_AMP * Math.sin(PUG_Z_WAVE_FREQ * z.age + z.phaseOffset);
        z.sprite.position.x = z.spawnX + waveOffset * z.waveAxisX;
        z.sprite.position.y = z.spawnY + z.riseSpeed * z.age;
        z.sprite.position.z = z.spawnZ + waveOffset * z.waveAxisZ;

        // ── Opacity: fade in (0–15 %), hold (15–70 %), fade out (70–100 %) ──
        let opacity: number;
        if (t < 0.15) {
            opacity = z.baseOpacity * (t / 0.15);
        } else if (t < 0.70) {
            opacity = z.baseOpacity;
        } else {
            opacity = z.baseOpacity * (1 - (t - 0.70) / 0.30);
        }
        (z.sprite.material as SpriteMaterial).opacity = opacity;

        // Slow tumble — each particle rotates a tiny bit
        z.sprite.material.rotation += deltaTime * 0.20;
    }
}

import { Group, Object3D, Mesh, LoadingManager, Uniform, Vector2, Vector3, Raycaster, SpriteMaterial, Sprite, CanvasTexture, AdditiveBlending, AnimationMixer, AnimationClip, AnimationAction, LoopRepeat, LoopOnce, MeshDepthMaterial, RGBADepthPacking, PointLight, Color, MathUtils, PlaneGeometry, DoubleSide, MeshBasicMaterial, Box3, MeshStandardMaterial, ShaderChunk, Plane } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { config as sfDecorConfig } from './SeaFloorDecor';
import {
    oceanAbsorptionUniform,
    underwaterFogDistUniform,
    setFoamMask,
    waterlineYUniform,
} from "../materials/OceanMaterial";
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial";
import { deltaTime, time } from "../core/Time";
import { getIsPlaying, expandPlayer, collapsePlayer, getIsExpanded, getMusicIntensity, getBeatKick } from "../core/MediaPlayer";
import { zoomToPug, zoomOutFromPug, isPugZoomActive, isRadioZoomActive, zoomToPhone, zoomOutFromPhone, isPhoneZoomActive, zoomToChest, zoomOutFromChest, isChestZoomActive, zoomToCabana, isCabanaZoomActive, touchControls } from "../core/Control";
import { cabanaShadeX, cabanaShadeY, cabanaShadeZ, cabanaShadeRotY, cabanaShadeWidth, cabanaShadeHeight, cabanaShadeColor, cabanaShadeOpacity } from "./config/CabanaConfig";
import { showDialog, advanceDialog, dismissDialog, isDialogActive } from "../core/Dialog";
import * as CoinTooltip from '../core/CoinTooltip';
import type { DialogLine, ReplyOption } from "../core/Dialog";
import { isBreezeActive, playAppleImpactSound, playChestCloseSound, playChestOpenSound, playPugSnoreOnce, stopPugSnore } from "../core/Audio";
import { createGrassMesh, createPerlinTexture, createShadowFloorMesh, grassColorBase, grassColorTip, type GrassUniforms } from './ProceduralGrass';
import { camera, renderer, scene as threeScene, isMobile } from "../core/Scene";
import { generateFoamMask, getMaskTexture, getMaskCenter, getMaskSize } from "../effects/FoamMask";
import * as PhoneScreen from '../core/PhoneScreen';
import { UNDERWATER_Y_THRESHOLD } from "../effects/PostProcess";
import {
    islandPosition, firecampOffset, treeOffset, bushOffset, bushRadioOffset, bushRadio2Offset, bushPugOffset, radioOffset, swordOffset,
    pugOffset, tentOffset, dogBedOffset, littleRocksOffset, phoneOffset,
    apple1Offset, apple2Offset, apple3Offset,
    mossRock1Offset, mossRock2aOffset, mossRock2bOffset, mossRock3aOffset, mossRock3bOffset, mossRock3cOffset,
    foldingTrayTableOffset, tentDogBedOffset, rugRoundOffset, lanternOffset, dogBowlOffset, dogBiscuitOffset,
    islandScale, firecampScale, treeScale, bushScale, bushRadioScale, bushRadio2Scale, bushPugScale, radioScale, swordScale, pugScale, tentScale, dogBedScale, littleRocksScale, phoneScale,
    apple1Scale, apple2Scale, apple3Scale,
    mossRock1Scale, mossRock2aScale, mossRock2bScale, mossRock3aScale, mossRock3bScale, mossRock3cScale,
    foldingTrayTableScale, tentDogBedScale, rugRoundScale, lanternScale, dogBowlScale, dogBiscuitScale,
    treeRotY, bushRotY, bushRadioRotY, bushRadio2RotY, bushPugRotY, radioRotY, swordRot, pugRotY, tentRotY, dogBedRotY, littleRocksRot, phoneRot,
    apple1RotY, apple2RotY, apple3RotY,
    mossRock1Rot, mossRock2aRot, mossRock2bRot, mossRock3aRot, mossRock3bRot, mossRock3cRot,
    foldingTrayTableRot, tentDogBedRot, rugRoundRot, lanternRot, dogBowlRot, dogBiscuitRot,
    ISLAND_SURFACE_GRASS_COLOR,
    ISLAND_SURFACE_GRASS_STRENGTH,
    ISLAND_SURFACE_GRASS_GREEN_THRESHOLD,
    ISLAND_SURFACE_GRASS_NORMAL_THRESHOLD,
    ISLAND_SURFACE_GRASS_MASK_SOFTNESS,
    ISLAND_SURFACE_GRASS_TOP_FILL_STRENGTH,
    ISLAND_SURFACE_GRASS_TOP_FILL_NORMAL_THRESHOLD,
    ISLAND_SURFACE_POINT_LIGHT_INFLUENCE,
    ISLAND_CAMPFIRE_GROUND_COLOR,
    ISLAND_CAMPFIRE_GROUND_RADIUS,
    ISLAND_CAMPFIRE_GROUND_SOFTNESS,
    ISLAND_CAMPFIRE_GROUND_STRENGTH,
    ISLAND_CAMPFIRE_GROUND_NORMAL_THRESHOLD,
    ISLAND_ROCK_MATCH_COLOR,
    ISLAND_ROCK_MATCH_STRENGTH,
    ISLAND_ROCK_MATCH_SATURATION,
    ISLAND_ROCK_MATCH_BRIGHTNESS,
    ISLAND_ROCK_MATCH_COLOR_TINT,
    ISLAND_ROCK_MATCH_GREEN_THRESHOLD,
    ISLAND_ROCK_MATCH_GREEN_STRENGTH,
    ISLAND_ROCK_MATCH_GREEN_COLOR,
    bushFlowerColor, bushRadioFlowerColor, bushRadio2FlowerColor, bushPugFlowerColor,
    GRASS_COUNT  as GRASS_COUNT_CFG,
    SURFACE_EDGE_PADDING,
    EXCL_R_BONFIRE, EXCL_R_TENT, EXCL_R_TREE, EXCL_R_PUG, EXCL_R_RADIO, EXCL_R_ROCKS,
    GRASS_EDGE_FALLOFF_RADIUS as GRASS_EDGE_FALLOFF_RADIUS_CFG,
    GRASS_MIN_EDGE_SCALE      as GRASS_MIN_EDGE_SCALE_CFG,
    GRASS_SHADOW_OPACITY      as GRASS_SHADOW_OPACITY_CFG,
    GRASS_SHADOW_COLOR        as GRASS_SHADOW_COLOR_CFG,
    GRASS_SHADOW_Y_OFFSET     as GRASS_SHADOW_Y_OFFSET_CFG,
    GRASS_SHADOW_SPREAD       as GRASS_SHADOW_SPREAD_CFG,
    GRASS_WOBBLE_STRENGTH     as GRASS_WOBBLE_STRENGTH_CFG,
    GRASS_MAX_HEIGHT          as GRASS_MAX_HEIGHT_CFG,
    APPLE_WIND_STRENGTH       as APPLE_WIND_STRENGTH_CFG,
    APPLE_SWING_STIFFNESS,
    APPLE_SWING_DAMPING,
    APPLE_CLICK_IMPULSE,
    APPLE_RESPAWN_FADE_DURATION,
    APPLE_CLICK_COUNT_TO_FALL,
    MAX_GROUND_APPLES,
    APPLE_RESPAWN_DELAY,
    GOLDEN_APPLE_INTERVAL,
    GOLDEN_APPLE_COLOR,
    GOLDEN_APPLE_EMISSIVE,
    GOLDEN_APPLE_EMISSIVE_INTENSITY,
    GOLDEN_APPLE_COLOR_Y_CUTOFF,
    GOLDEN_APPLE_LIGHT_COLOR,
    GOLDEN_APPLE_LIGHT_INTENSITY,
    GOLDEN_APPLE_LIGHT_DISTANCE,
    GOLDEN_APPLE_LIGHT_DECAY,
} from './config/IslandConfig';
import { initPhysicsWorld, addAppleBody, initAppleBodyPool, removeAppleBody, stepPhysics, physicsConfig, updateDebugger, registerTreeMeshes, registerExtraStaticMeshes, getBodyContactNormals, getBodyMaxPenetration } from './Physics';
import { Body } from 'cannon-es';

export const island = new Group();
export const firecamp = new Group();
export const tree = new Group();
export const bush = new Group();
export const bushRadio = new Group();
export const bushRadio2 = new Group();
export const bushPug = new Group();
export const radio = new Group();
export const sword = new Group();
export const pug = new Group();
export const tent = new Group();
// Dark unlit plane over the tent opening — hides the interior (phone + props)
// from outside, day or night. Created when the tent GLB loads; faded out while
// the cabana zoom is active. Surface-only (gated in Scene.ts).
export let cabanaShade: Mesh | null = null;
let cabanaShadeMat: MeshBasicMaterial | null = null;
export const dogBed = new Group();
export const littleRocks = new Group();
export const phone = new Group();
export const chest = new Group();
export const apple1 = new Group();
export const apple2 = new Group();
export const apple3 = new Group();

// Moss rocks — six instances scattered around the island in the water.
// All share the apple-style waterline shader so each rock gets its own foam
// line right where it crosses the ocean surface, independent of placement.
export const mossRock1  = new Group();
export const mossRock2a = new Group();
export const mossRock2b = new Group();
export const mossRock3a = new Group();
export const mossRock3b = new Group();
export const mossRock3c = new Group();

// Surface props added in the visual_enhancements_2 branch.
export const foldingTrayTable  = new Group();
export const tentDogBed        = new Group();
export const rugRound          = new Group();
export const lantern           = new Group();
export const dogBowl           = new Group();
export const dogBiscuit        = new Group();
export let grassShadowMesh: Mesh | null = null;

// Grass edge falloff + shadow floor — runtime-mutable, initialised from config
export let grassEdgeFalloffRadius = GRASS_EDGE_FALLOFF_RADIUS_CFG;
export let grassMinEdgeScale      = GRASS_MIN_EDGE_SCALE_CFG;
export let grassShadowOpacity     = GRASS_SHADOW_OPACITY_CFG;
export let grassShadowColor       = GRASS_SHADOW_COLOR_CFG;
export let grassShadowYOffset     = GRASS_SHADOW_Y_OFFSET_CFG;
export let grassShadowSpread      = GRASS_SHADOW_SPREAD_CFG;
export let grassWobbleStrength    = GRASS_WOBBLE_STRENGTH_CFG;
export let grassMaxHeight         = GRASS_MAX_HEIGHT_CFG;

export function setGrassEdgeFalloffRadius(v: number): void { grassEdgeFalloffRadius = Math.max(0, v); }
export function setGrassMinEdgeScale(v: number): void      { grassMinEdgeScale = Math.max(0, Math.min(1, v)); }
export function setShadowFloorOpacity(v: number): void {
    grassShadowOpacity = v;
    if (grassShadowMesh) (grassShadowMesh.material as any).uniforms.uOpacity.value = v;
}
export function setShadowFloorYOffset(v: number): void  { grassShadowYOffset = v; }
export function setShadowFloorSpread(v: number): void   { grassShadowSpread  = Math.max(0.1, v); }
export function setShadowFloorColor(v: string): void    { grassShadowColor   = v; }
export function setGrassWobbleStrength(v: number): void {
    grassWobbleStrength = v;
    if (_grassUniforms) _grassUniforms.uWobbleStrength.value = v;
}
export function setGrassMaxHeight(v: number): void { grassMaxHeight = Math.max(0.01, v); }
export const grassPatches: Group[] = [];

// ── Procedural grass mesh (single draw call) ────────────────────────────────
export let proceduralGrassMesh: Mesh | null = null;
let _perlinTexture: ReturnType<typeof createPerlinTexture> | null = null;
let _grassUniforms: GrassUniforms | null = null;

// Procedural grass spawn points (cached for respawning)
let _grassSpawnPoints: Array<{ x: number; z: number; y: number; edgeFactor: number }> = [];

// Store tree leaves for wind animation
const treeLeaves: Object3D[] = [];
const treeTrunkMeshes: Mesh[] = [];

// Island surface meshes — populated once the island glTF loads.
// Used by isOnIslandSurface() to confine foliage spawning to the island top.
const islandMeshes: Mesh[] = [];
const _spawnRaycaster = new Raycaster();
const _spawnOrigin    = new Vector3();
const _spawnDown      = new Vector3(0, -1, 0);
let islandLowestY = islandPosition.y;

export function getLowestY(): number {
    return islandLowestY;
}

// SURFACE_EDGE_PADDING is imported from IslandConfig.ts

/** Mutable edge padding — how far inside the island edge blades must be rooted.
 * Updated live via setGrassEdgePadding(); triggers a full respawn. */
export let grassEdgePadding = SURFACE_EDGE_PADDING;
export function setGrassEdgePadding(v: number): void {
    grassEdgePadding = Math.max(0, v);
    respawnFoliage();
}
function getSurfaceY(wx: number, wz: number): number {
    if (islandMeshes.length === 0) return islandPosition.y + 1.0;
    _spawnOrigin.set(wx, 5, wz);
    _spawnRaycaster.set(_spawnOrigin, _spawnDown);
    const hits = _spawnRaycaster.intersectObjects(islandMeshes, false);
    return hits.length > 0 ? hits[0].point.y : (islandPosition.y + 1.0);
}

/**
 * Calls `callback` once islandMeshes has been populated.
 * Polls via requestAnimationFrame so it never blocks the main thread.
 */
function waitForIslandMeshes(callback: () => void): void {
    if (islandMeshes.length > 0) { callback(); return; }
    requestAnimationFrame(() => waitForIslandMeshes(callback));
}

/**
 * Returns how deep inside the island this point is (0 = on the very edge,
 * 1 = comfortably interior). Used to taper blade size near the island perimeter.
 */
function computeEdgeFactor(wx: number, wz: number): number {
    if (islandMeshes.length === 0) return 1.0;
    let hits = 0;
    const r = grassEdgeFalloffRadius;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    for (const [dx, dz] of dirs) {
        _spawnOrigin.set(wx + dx * r, 5, wz + dz * r);
        _spawnRaycaster.set(_spawnOrigin, _spawnDown);
        if (_spawnRaycaster.intersectObjects(islandMeshes, false).length > 0) hits++;
    }
    return hits / 4;
}

/**
 * Builds (or rebuilds) a dark transparent circle under the full grass cluster
 * to give the impression of a denser, shadow-under-foliage look.
 */
function buildShadowFloor(spawnPoints: Array<{ x: number; z: number; y?: number; edgeFactor?: number }>): void {
    if (grassShadowMesh) {
        (grassShadowMesh.material as any).dispose();
        grassShadowMesh.geometry.dispose();
        threeScene.remove(grassShadowMesh);
        grassShadowMesh = null;
    }
    if (spawnPoints.length === 0) return;

    // Average Y — island surface is shallow enough that a single cy is fine
    let totalY = 0;
    for (const sp of spawnPoints) totalY += (sp.y ?? 0);
    const cy = (totalY / spawnPoints.length) + grassShadowYOffset;

    // Disc radius = spreadRadius (0.12) * spread factor, scaled by edgeFactor per disc
    const instanceRadius = 0.12 * grassShadowSpread * (1 / 0.80);  // base: spreadRadius=0.12
    grassShadowMesh = createShadowFloorMesh(spawnPoints, cy, instanceRadius, grassShadowOpacity, grassShadowColor);
    threeScene.add(grassShadowMesh);
}

/**
 * AND all four cardinal neighbours at SURFACE_EDGE_PADDING distance also hit
 * the island, ensuring the patch is not too close to any edge.
 * Falls back to true when island hasn't loaded yet so spawning isn't blocked.
 */
function isOnIslandSurface(wx: number, wz: number): boolean {
    if (islandMeshes.length === 0) return true;
    const p = grassEdgePadding;
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

// Chest animation state
let chestMixer: AnimationMixer | null = null;
let chestOpenAction: AnimationAction | null = null;
let chestCloseAction: AnimationAction | null = null;
let chestIsOpen = false;
// Chest glow light (animates on open/close)
let chestGlowLight: PointLight | null = null;
let _chestGlowTarget = 0;
let _chestGlowReady  = false;  // true only after CHEST_GLOW_DELAY_MS has elapsed
// Chest Zelda-style ray beams
let _chestRayGroup: Group | null = null;
export function getChestRayMats(): MeshBasicMaterial[] { return _chestRayMats; }
const _chestRayMats: MeshBasicMaterial[] = [];
// Coins stored for live debug-GUI transforms
const _chestCoins: Group[] = [];
// Coin spring animation state (parallel arrays, one entry per coin)
const _coinCurrentScales: number[] = [];
const _coinVelocities:    number[] = [];
const _coinTargetScales:  number[] = []; // 0 = hidden, cfg.scale = revealed
const _coinRevealTimers:  number[] = []; // seconds remaining before reveal; -1 = idle
// Hover interaction (desktop scale + tooltip)
const _coinHoverScales:   number[] = [1, 1, 1]; // smooth 0→1 hover multiplier per coin
let   _hoveredCoinIdx:    number   = -1;          // which coin is under cursor (-1 = none)
// Mobile bounce interaction
let   _selectedCoinIdx:   number   = -1;          // which coin is bounce-selected (-1 = none)
const _coinBounceScales:  number[] = [1, 1, 1];   // spring-driven bounce multiplier per coin
const _coinBounceVels:    number[] = [0, 0, 0];   // bounce spring velocity
const _coinRaycaster = new Raycaster();
const _coinMouse     = new Vector2();
const _coinScreenVec = new Vector3();

export function beginPrewarmVariants(): () => void {
    const restoreFns: Array<() => void> = [];

    if (apple1.children.length > 0) {
        _applyGoldenTint(0);
        restoreFns.push(() => _removeGoldenTint(0));
    }

    const groundSlot = _groundAppleSlots[0];
    if (groundSlot) {
        const wasVisible = groundSlot.group.visible;
        const oldPos = groundSlot.group.position.clone();
        const oldQuat = groundSlot.group.quaternion.clone();
        const oldScale = groundSlot.group.scale.clone();
        const oldInUse = groundSlot.inUse;
        groundSlot.group.visible = true;
        groundSlot.group.position.copy(apple1.position).add(_appleVisualCenterOffsets[0]);
        groundSlot.group.scale.setScalar(appleStates[0].originalScale || 1);
        _setGroundSlotGolden(groundSlot, true);
        _acquireGoldenLight(groundSlot.group);
        restoreFns.push(() => {
            _releaseGoldenLight(groundSlot.group);
            _setGroundSlotGolden(groundSlot, false);
            groundSlot.group.visible = wasVisible;
            groundSlot.group.position.copy(oldPos);
            groundSlot.group.quaternion.copy(oldQuat);
            groundSlot.group.scale.copy(oldScale);
            groundSlot.inUse = oldInUse;
        });
    }

    if (chestGlowLight) {
        const oldIntensity = chestGlowLight.intensity;
        chestGlowLight.intensity = sfDecorConfig.chestGlowIntensity;
        restoreFns.push(() => { if (chestGlowLight) chestGlowLight.intensity = oldIntensity; });
    }

    const coinCfgs = [sfDecorConfig.chestCoin1, sfDecorConfig.chestCoin2, sfDecorConfig.chestCoin3];
    for (let i = 0; i < _chestCoins.length; i++) {
        const oldScale = _chestCoins[i].scale.clone();
        _chestCoins[i].scale.setScalar(coinCfgs[i].scale);
        restoreFns.push(() => _chestCoins[i]?.scale.copy(oldScale));
    }

    for (const mat of _chestRayMats) {
        const oldOpacity = mat.opacity;
        mat.opacity = Math.max(oldOpacity, sfDecorConfig.chestRayMaxOpacity);
        restoreFns.push(() => { mat.opacity = oldOpacity; });
    }

    if (chestOpenAction) {
        chestOpenAction.reset();
        chestOpenAction.time = chestOpenAction.getClip().duration * 0.5;
        chestOpenAction.play();
        chestMixer?.update(0);
        restoreFns.push(() => chestOpenAction?.stop());
    }

    return () => {
        for (let i = restoreFns.length - 1; i >= 0; i--) restoreFns[i]();
    };
}

export function updateChestTransform(): void {
    chest.position.set(sfDecorConfig.chest.x, sfDecorConfig.chest.y, sfDecorConfig.chest.z);
    chest.scale.setScalar(sfDecorConfig.chest.scale);
    chest.rotation.set(sfDecorConfig.chest.rx, sfDecorConfig.chest.ry, sfDecorConfig.chest.rz);
}

export function updateChestCoinTransforms(): void {
    const cfgs = [sfDecorConfig.chestCoin1, sfDecorConfig.chestCoin2, sfDecorConfig.chestCoin3];
    for (let i = 0; i < _chestCoins.length; i++) {
        const c = cfgs[i];
        _chestCoins[i].position.set(c.x, c.y, c.z);
        _chestCoins[i].rotation.set(c.rx, c.ry, c.rz);
        // Update target scale so the spring rides the new config value when revealed
        if (i < _coinTargetScales.length && _coinTargetScales[i] > 0) {
            _coinTargetScales[i] = c.scale;
        }
    }
}

/** Re-apply body/circle colours from sfDecorConfig to the already-loaded coin groups. */
function _applyChestCoinColor(group: Group, coinIdx: number): void {
    const colorCfgs = [sfDecorConfig.chestCoin1Color, sfDecorConfig.chestCoin2Color, sfDecorConfig.chestCoin3Color];
    const cc = colorCfgs[coinIdx];
    group.traverse((child) => {
        if (!(child as any).isMesh || !(child as any).material) return;
        const mesh = child as any;
        const wasArray = Array.isArray(mesh.material);
        const mats: any[] = wasArray ? mesh.material : [mesh.material];
        const updated = mats.map((mat: any) => {
            const m = mat.clone ? mat.clone() : mat;
            const isCircle = (m.name as string) === 'DarkYellow';
            const r = isCircle ? cc.circleR : cc.bodyR;
            const g = isCircle ? cc.circleG : cc.bodyG;
            const b = isCircle ? cc.circleB : cc.bodyB;
            m.color    = new Color(r, g, b);
            m.emissive = new Color(r * 0.15, g * 0.15, b * 0.15);
            m.needsUpdate = true;
            return m;
        });
        mesh.material = wasArray ? updated : updated[0];
    });
}

export function updateChestCoinColors(): void {
    for (let i = 0; i < _chestCoins.length; i++) {
        _applyChestCoinColor(_chestCoins[i], i);
    }
}

function _getCoinScreenPos(i: number): { x: number; y: number } | null {
    if (!_chestCoins[i]) return null;
    _coinScreenVec.setFromMatrixPosition(_chestCoins[i].matrixWorld);
    _coinScreenVec.project(camera);
    return {
        x: (_coinScreenVec.x *  0.5 + 0.5) * window.innerWidth,
        y: (_coinScreenVec.y * -0.5 + 0.5) * window.innerHeight,
    };
}

export function updateChestGlowTransform(): void {
    if (!chestGlowLight) return;
    chestGlowLight.position.set(sfDecorConfig.chestGlowX, sfDecorConfig.chestGlowY, sfDecorConfig.chestGlowZ);
    chestGlowLight.distance = sfDecorConfig.chestGlowDistance;
}

export function rebuildChestRays(): void {
    if (_chestRayGroup) {
        chest.remove(_chestRayGroup);
        _chestRayGroup = null;
    }
    _chestRayMats.length = 0;
    _buildChestRays();
    // Restore opacity to whatever state the chest is currently in
    const op = chestIsOpen ? sfDecorConfig.chestRayMaxOpacity * 0.8 : 0;
    for (const m of _chestRayMats) m.opacity = op;
}

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

// Pool of additive-blend sprite materials shared by music notes + Z particles.
// Both spawn paths previously allocated a fresh SpriteMaterial per particle and
// disposed it on expiry — at 4–24 music notes/second over a long radio session
// that's thousands of materials churned. Reusing a small pool eliminates the
// allocation pressure and the implicit shader-program cache lookups.
const _spriteMatPool: SpriteMaterial[] = [];

function _acquireSpriteMaterial(tex: CanvasTexture): SpriteMaterial {
    const mat = _spriteMatPool.pop();
    if (mat) {
        mat.map = tex;
        mat.opacity = 0;
        mat.rotation = 0;
        mat.needsUpdate = true;
        return mat;
    }
    return new SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
    });
}

function _releaseSpriteMaterial(mat: SpriteMaterial): void {
    _spriteMatPool.push(mat);
}

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
let _islandDownloadFraction = 0; // raw 0–1 download progress of Island's own GLBs
let onLoadingProgress: ((progress: number) => void) | null = null;

/** 0–1 download progress of the Island's GLBs — feeds the unified loading bar
 *  in Scene.getStartupProgress(). Reaches 1 when the manager's onLoad fires. */
export function getDownloadFraction(): number { return _islandDownloadFraction; }

// Optional async callback that runs AFTER all models load but BEFORE
// reporting 100% (used by Scene.ts to pre-compile shaders on the GPU).
let _onLoadCallback: (() => Promise<void>) | null = null;

/** Register an async callback to run after all models load (e.g. GPU prewarm). */
export function setOnLoadCallback(cb: () => Promise<void>): void {
    _onLoadCallback = cb;
}

loadingManager.onProgress = (_url, loaded, total) => {
    _islandDownloadFraction = total > 0 ? loaded / total : 0;
    // Reserve the last 10% of the progress bar for the GPU prewarm pass.
    loadingProgress = _islandDownloadFraction * 0.9;
    if (onLoadingProgress) {
        onLoadingProgress(loadingProgress);
    }
};

loadingManager.onLoad = async () => {
    // All Island models downloaded.  Run the prewarm callback (if registered)
    // before signalling 100% — this compiles shaders + uploads geometry while
    // the loading overlay is still visible.
    try {
        if (_onLoadCallback) {
            await _onLoadCallback();
        }
    } catch (err) {
        // A failed prewarm must NOT trap the loading bar at 90% forever. Log it
        // and still report 100% so the user can enter the scene — at worst the
        // first interaction has an un-warmed hitch instead of a hard freeze.
        console.error('[Island] GPU prewarm failed; entering scene without full prewarm:', err);
    } finally {
        _islandDownloadFraction = 1;
        loadingProgress = 1;
        if (onLoadingProgress) {
            onLoadingProgress(1);
        }
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
// EXT_meshopt_compression decoder — required for the GLBs that the prebuild
// script (scripts/optimize-assets.cjs) re-encoded with Meshopt. Without this
// they'd fail to load. Decoder is shared globally and awaits its own .ready
// promise internally.
loader.setMeshoptDecoder(MeshoptDecoder);

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
//   Tree trunk: X=-0.35  Z=-3.60   (islandPos + treeOffset)
//   Pug       : X= 0.65  Z=-2.30   (islandPos + pugOffset)
//   Radio     : X=-0.65  Z=-3.10   (islandPos + radioOffset)

// Per-cluster patch lists — kept for IslandDebug backward compat
export const clusterMainPatches: Group[] = [];
export const clusterTreePatches: Group[] = [];
export const clusterCloverPatches: Group[] = [];

const GRASS_Y   = islandPosition.y + 1.0;  // Fallback Y when raycast unavailable

/** Fine-tune how far above the raycasted surface blades are rooted (runtime, via debug GUI) */
export let grassYOffset = 0.0;
export let foliageWindStrength = 0.035;
export let appleWindStrength = APPLE_WIND_STRENGTH_CFG;
export function setAppleWindStrength(v: number): void { appleWindStrength = v; }
export let appleSwingStiffness = APPLE_SWING_STIFFNESS;
export function setAppleSwingStiffness(v: number): void { appleSwingStiffness = v; }
export let appleSwingDamping = APPLE_SWING_DAMPING;
export function setAppleSwingDamping(v: number): void { appleSwingDamping = v; }
export let appleClickImpulse = APPLE_CLICK_IMPULSE;
export function setAppleClickImpulse(v: number): void { appleClickImpulse = v; }
export let appleRespawnDelay = APPLE_RESPAWN_DELAY;
export function setAppleRespawnDelay(v: number): void {
    appleRespawnDelay = v;
}

// ── Apple interaction state (tree apples) ────────────────────────────────────
interface AppleState {
    clickCount: number;
    angleX:  number;    // current spring angle around X (radians)
    angleZ:  number;    // current spring angle around Z (radians)
    angVelX: number;    // angular velocity around X (rad/s)
    angVelZ: number;    // angular velocity around Z (rad/s)
    hidden: boolean;    // tree apple is invisible while waiting for ground clone to land
    respawning: boolean;     // spring scale-up after respawn
    respawnScale: number;
    respawnVelocity: number;
    originalPos: Vector3;
    originalRotY: number;
    originalScale: number;
}

const appleStates: AppleState[] = [
    { clickCount: 0, angleX: 0, angleZ: 0, angVelX: 0, angVelZ: 0, hidden: false, respawning: false, respawnScale: 1, respawnVelocity: 0, originalPos: new Vector3(), originalRotY: 0, originalScale: 1 },
    { clickCount: 0, angleX: 0, angleZ: 0, angVelX: 0, angVelZ: 0, hidden: false, respawning: false, respawnScale: 1, respawnVelocity: 0, originalPos: new Vector3(), originalRotY: 0, originalScale: 1 },
    { clickCount: 0, angleX: 0, angleZ: 0, angVelX: 0, angVelZ: 0, hidden: false, respawning: false, respawnScale: 1, respawnVelocity: 0, originalPos: new Vector3(), originalRotY: 0, originalScale: 1 },
];

// ── Golden apple easter egg ─────────────────────────────────────────────────
const MAX_GOLDEN_APPLES = 3; // hard cap — pool of 3 PointLights, reused
let _totalAppleRespawns = 0;  // global counter — incremented each time ANY tree apple respawns (not counting page-load)
export const goldenAppleConfig = {
    interval:          GOLDEN_APPLE_INTERVAL,
    color:             GOLDEN_APPLE_COLOR,
    emissive:          GOLDEN_APPLE_EMISSIVE,
    emissiveIntensity: GOLDEN_APPLE_EMISSIVE_INTENSITY,
    colorYCutoff:      GOLDEN_APPLE_COLOR_Y_CUTOFF,
    lightColor:        GOLDEN_APPLE_LIGHT_COLOR,
    lightIntensity:    GOLDEN_APPLE_LIGHT_INTENSITY,
    lightDistance:      GOLDEN_APPLE_LIGHT_DISTANCE,
    lightDecay:        GOLDEN_APPLE_LIGHT_DECAY,
};
interface _GoldenUniformSet {
    uGoldenColor: { value: Color };
    uGoldenEmissive: { value: Color };
    uGoldenEmissiveIntensity: { value: number };
    uGoldenCutoffY: { value: number };
    uGoldenFeather: { value: number };
}
interface _GoldenMatEntry {
    mesh: Mesh;
    normalMat: MeshStandardMaterial;
    goldenMat: MeshStandardMaterial;
    blendFactor: number;
    localMinY: number;
    localMaxY: number;
}
/** Pre-baked golden materials per apple (created once at load, swapped atomically). */
const _goldenMatCache: _GoldenMatEntry[][] = [[], [], []];
/** Per-apple bounding box (computed once at load, used for Y cutoff). */
const _appleBBoxes: Box3[] = [];
const _appleVisualCenterOffsets: Vector3[] = [new Vector3(), new Vector3(), new Vector3()];
/** Track which tree apple indices are currently golden. */
const _isGolden: boolean[] = [false, false, false];

// ── Apple hit — audio + cartoon impact streaks ────────────────────────────────
let _appleImpactBuffer: AudioBuffer | null = null;
let _appleImpactTexture: CanvasTexture | null = null;

interface AppleImpactStreak {
    sprite: Sprite;
    dir: Vector2;
    normal: Vector2;
    center: Vector3;
    age: number;
    delay: number;
    duration: number;
    startRadius: number;
    travel: number;
    curve: number;
    maxLength: number;
    maxWidth: number;
    baseOpacity: number;
}
const _appleImpactStreaks: AppleImpactStreak[] = [];
const _appleImpactRight = new Vector3();
const _appleImpactUp = new Vector3();
const _appleImpactPos = new Vector3();

function _playAppleImpactAudio(): void {
    playAppleImpactSound();
}

function _getAppleImpactTexture(): CanvasTexture {
    if (_appleImpactTexture) return _appleImpactTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0.00, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.16, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.72, 'rgba(255,255,255,1)');
    gradient.addColorStop(1.00, 'rgba(255,255,255,0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(14, 16);
    ctx.quadraticCurveTo(24, 4, 62, 4);
    ctx.lineTo(106, 4);
    ctx.quadraticCurveTo(124, 16, 106, 28);
    ctx.lineTo(62, 28);
    ctx.quadraticCurveTo(24, 28, 14, 16);
    ctx.closePath();
    ctx.fill();

    _appleImpactTexture = new CanvasTexture(canvas);
    _appleImpactTexture.needsUpdate = true;
    return _appleImpactTexture;
}

function _spawnAppleImpactBurst(appleIdx: number): void {
    const appleGroups = [apple1, apple2, apple3];
    const group = appleGroups[appleIdx];
    const worldCenter = new Vector3();

    group.updateMatrixWorld(true);
    const bbox = new Box3().setFromObject(group);
    if (!bbox.isEmpty()) bbox.getCenter(worldCenter);
    else if (_appleBBoxes[appleIdx]) _appleBBoxes[appleIdx].getCenter(worldCenter);
    else group.getWorldPosition(worldCenter);

    const size = bbox.getSize(new Vector3());
    const radius = Math.max(0.055, Math.min(0.13, size.length() * 0.38));
    const texture = _getAppleImpactTexture();
    const baseAngle = Math.random() * Math.PI * 2;
    const burstCount = 8;

    for (let i = 0; i < burstCount; i++) {
        const a = baseAngle + (i / burstCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.22;
        const dir = new Vector2(Math.cos(a), Math.sin(a)).normalize();
        const normal = new Vector2(-dir.y, dir.x);
        const mat = new SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            depthTest: false,
            blending: AdditiveBlending,
        });
        mat.rotation = a;

        const sprite = new Sprite(mat);
        sprite.renderOrder = 80;
        sprite.position.copy(worldCenter);
        sprite.scale.set(0.001, 0.001, 1);
        threeScene.add(sprite);

        _appleImpactStreaks.push({
            sprite,
            dir,
            normal,
            center: worldCenter.clone(),
            age: 0,
            delay: i * 0.008 + Math.random() * 0.018,
            duration: 0.20 + Math.random() * 0.08,
            startRadius: radius * (0.55 + Math.random() * 0.18),
            travel: radius * (1.15 + Math.random() * 0.65),
            curve: radius * (Math.random() - 0.5) * 0.34,
            maxLength: radius * (0.95 + Math.random() * 0.45),
            maxWidth: radius * (0.105 + Math.random() * 0.04),
            baseOpacity: 0.88 + Math.random() * 0.12,
        });
    }
}

function _updateAppleImpacts(): void {
    if (_appleImpactStreaks.length === 0) return;

    _appleImpactRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    _appleImpactUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

    for (let i = _appleImpactStreaks.length - 1; i >= 0; i--) {
        const streak = _appleImpactStreaks[i];
        streak.age += deltaTime;

        const localAge = streak.age - streak.delay;
        if (localAge < 0) continue;

        const t = Math.min(localAge / streak.duration, 1);
        if (t >= 1) {
            streak.sprite.parent?.remove(streak.sprite);
            (streak.sprite.material as SpriteMaterial).dispose();
            _appleImpactStreaks.splice(i, 1);
            continue;
        }

        const out = 1 - Math.pow(1 - t, 3);
        const pop = Math.sin(Math.min(1, t / 0.42) * Math.PI * 0.5);
        const fade = 1 - MathUtils.smoothstep(t, 0.46, 1);
        const dist = streak.startRadius + streak.travel * out;
        const bend = Math.sin(t * Math.PI) * streak.curve;

        _appleImpactPos.copy(streak.center)
            .addScaledVector(_appleImpactRight, streak.dir.x * dist + streak.normal.x * bend)
            .addScaledVector(_appleImpactUp, streak.dir.y * dist + streak.normal.y * bend);

        streak.sprite.position.copy(_appleImpactPos);
        streak.sprite.scale.set(
            streak.maxLength * (0.25 + pop * 0.75),
            streak.maxWidth * (0.75 + pop * 0.35),
            1,
        );
        const mat = streak.sprite.material as SpriteMaterial;
        mat.opacity = streak.baseOpacity * fade;
        mat.rotation += deltaTime * 1.8 * (streak.curve >= 0 ? 1 : -1);
    }
}

// ── PointLight pool (3 lights, pre-created at Start(), never add/removed) ───
const _goldenLightPool: PointLight[] = [];
/** Which apple group (or ground clone) each pooled light is currently attached to. null = available. */
const _goldenLightOwners: (Group | null)[] = [null, null, null];

/** Initialise the 3 pooled PointLights and add to scene (call once in Start()). */
function _initGoldenLightPool(): void {
    for (let i = 0; i < MAX_GOLDEN_APPLES; i++) {
        const light = new PointLight(
            new Color(goldenAppleConfig.lightColor), 0,
            goldenAppleConfig.lightDistance, goldenAppleConfig.lightDecay,
        );
        light.castShadow = false;
        // Add to threeScene at origin — intensity 0 means no visual impact
        // but the renderer compiles the shader with this light on the FIRST frame.
        threeScene.add(light);
        _goldenLightPool.push(light);
    }
}

/** Acquire a pooled light and attach to a group. Returns the light, or null if pool exhausted.
 *  Idempotent — if `owner` already holds a light, returns it without acquiring a second slot. */
function _acquireGoldenLight(owner: Group): PointLight | null {
    // Guard against double-acquire on the same owner — would burn a pool slot
    // and stack two lights on the same apple.
    for (let i = 0; i < MAX_GOLDEN_APPLES; i++) {
        if (_goldenLightOwners[i] === owner) return _goldenLightPool[i];
    }
    for (let i = 0; i < MAX_GOLDEN_APPLES; i++) {
        if (!_goldenLightOwners[i]) {
            const light = _goldenLightPool[i];
            // Reparent from scene root into the owner group
            threeScene.remove(light);
            owner.add(light);
            light.position.set(0, 0, 0);
            light.color.set(goldenAppleConfig.lightColor);
            light.intensity = goldenAppleConfig.lightIntensity;
            light.distance = goldenAppleConfig.lightDistance;
            light.decay = goldenAppleConfig.lightDecay;
            _goldenLightOwners[i] = owner;
            return light;
        }
    }
    return null; // all 3 in use
}

/** Release a pooled light back (park it at scene root with intensity 0). */
function _releaseGoldenLight(owner: Group): void {
    for (let i = 0; i < MAX_GOLDEN_APPLES; i++) {
        if (_goldenLightOwners[i] === owner) {
            const light = _goldenLightPool[i];
            owner.remove(light);
            threeScene.add(light);
            light.intensity = 0;
            _goldenLightOwners[i] = null;
            return;
        }
    }
}

/** Count how many golden apples currently exist (tree + ground). */
function _countGoldenApples(): number {
    let count = 0;
    for (let i = 0; i < 3; i++) if (_isGolden[i]) count++;
    for (const ga of groundApples) if (ga.isGolden) count++;
    return count;
}

/** Compute golden blend factor for a mesh based on its Y position relative to the apple bbox. */
function _goldenBlendFactor(mesh: Mesh, appleIndex: number): number {
    const bbox = _appleBBoxes[appleIndex];
    if (!bbox) return 1;
    const cutoff = goldenAppleConfig.colorYCutoff;
    if (cutoff >= 1) return 1;
    if (cutoff <= 0) return 0;

    // Get mesh center Y in world space
    mesh.updateWorldMatrix(true, false);
    const meshBBox = new Box3().setFromObject(mesh);
    const meshMinY = meshBBox.min.y;
    const meshMaxY = meshBBox.max.y;

    // cutoff maps to a Y position within the apple bbox (bottom = 0, top = 1)
    const appleMinY = bbox.min.y;
    const appleMaxY = bbox.max.y;
    const cutoffY = appleMinY + (appleMaxY - appleMinY) * cutoff;

    // If mesh is fully below cutoff — fully golden
    if (meshMaxY <= cutoffY) return 1;
    // If mesh is fully above cutoff — not golden
    if (meshMinY >= cutoffY) return 0;
    // Partially overlapping — blend based on how much of the mesh is below
    return (cutoffY - meshMinY) / (meshMaxY - meshMinY);
}

function _meshLocalYBounds(mesh: Mesh): { minY: number; maxY: number } {
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bbox = geometry.boundingBox;
    if (!bbox) return { minY: 0, maxY: 1 };
    return { minY: bbox.min.y, maxY: bbox.max.y };
}

function _createGoldenMaterial(normalMat: MeshStandardMaterial, minY: number, maxY: number): MeshStandardMaterial {
    const goldenMat = normalMat.clone();
    goldenMat.color.copy(normalMat.color);
    goldenMat.emissive.copy(normalMat.emissive);

    const uniforms: _GoldenUniformSet = {
        uGoldenColor: { value: new Color(goldenAppleConfig.color) },
        uGoldenEmissive: { value: new Color(goldenAppleConfig.emissive) },
        uGoldenEmissiveIntensity: { value: goldenAppleConfig.emissiveIntensity },
        uGoldenCutoffY: { value: minY + (maxY - minY) * MathUtils.clamp(goldenAppleConfig.colorYCutoff, 0, 1) },
        uGoldenFeather: { value: Math.max((maxY - minY) * 0.035, 0.0001) },
    };

    goldenMat.userData.goldenUniforms = uniforms;
    goldenMat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying float vGoldenAppleLocalY;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGoldenAppleLocalY = transformed.y;');
        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                '#include <common>\nuniform vec3 uGoldenColor;\nuniform vec3 uGoldenEmissive;\nuniform float uGoldenEmissiveIntensity;\nuniform float uGoldenCutoffY;\nuniform float uGoldenFeather;\nvarying float vGoldenAppleLocalY;'
            )
            .replace(
                'vec3 totalEmissiveRadiance = emissive;',
                'float goldenAppleMask = 1.0 - smoothstep(uGoldenCutoffY - uGoldenFeather, uGoldenCutoffY + uGoldenFeather, vGoldenAppleLocalY);\n\tvec3 totalEmissiveRadiance = mix(emissive, uGoldenEmissive * uGoldenEmissiveIntensity, goldenAppleMask);'
            )
            .replace(
                '#include <color_fragment>',
                '#include <color_fragment>\n\tdiffuseColor.rgb = mix(diffuseColor.rgb, uGoldenColor, goldenAppleMask);'
            );
    };
    goldenMat.customProgramCacheKey = () => 'golden-apple-local-y-mask-v1';
    return goldenMat;
}

function _refreshGoldenEntry(entry: _GoldenMatEntry, goldColor: Color, goldEmissive: Color): void {
    const uniforms = entry.goldenMat.userData.goldenUniforms as _GoldenUniformSet | undefined;
    const cutoff = MathUtils.clamp(goldenAppleConfig.colorYCutoff, 0, 1);
    entry.blendFactor = cutoff;
    if (!uniforms) return;
    const range = Math.max(entry.localMaxY - entry.localMinY, 0.0001);
    uniforms.uGoldenColor.value.copy(goldColor);
    uniforms.uGoldenEmissive.value.copy(goldEmissive);
    uniforms.uGoldenEmissiveIntensity.value = goldenAppleConfig.emissiveIntensity;
    uniforms.uGoldenCutoffY.value = entry.localMinY + range * cutoff;
    uniforms.uGoldenFeather.value = Math.max(range * 0.035, 0.0001);
}

function _prebakeGoldenMaterials(grp: Group, index: number): void {
    _goldenMatCache[index] = [];
    grp.traverse((child) => {
        if (!(child as any).isMesh) return;
        const mesh = child as Mesh;
        const normalMat = mesh.material as MeshStandardMaterial;
        if (!normalMat || !normalMat.color) return;
        const t = _goldenBlendFactor(mesh, index);
        const { minY, maxY } = _meshLocalYBounds(mesh);
        const goldenMat = _createGoldenMaterial(normalMat, minY, maxY);
        _goldenMatCache[index].push({ mesh, normalMat, goldenMat, blendFactor: t, localMinY: minY, localMaxY: maxY });
    });
}

function _applyGoldenTint(index: number): void {
    // Idempotent: calling twice without a matching _removeGoldenTint would
    // acquire a second PointLight from the pool while the first is still
    // attached to the same apple, leaking a slot and stacking glow on the
    // same fruit. Bail out if the apple is already in the golden state.
    if (_isGolden[index]) return;
    for (const entry of _goldenMatCache[index]) {
        entry.mesh.material = entry.goldenMat;
    }
    _isGolden[index] = true;
    const grp = [apple1, apple2, apple3][index];
    _acquireGoldenLight(grp);
}

function _removeGoldenTint(index: number): void {
    for (const entry of _goldenMatCache[index]) {
        entry.mesh.material = entry.normalMat;
    }
    if (_isGolden[index]) {
        const grp = [apple1, apple2, apple3][index];
        _releaseGoldenLight(grp);
    }
    _isGolden[index] = false;
}

function _setGroundSlotGolden(slot: GroundAppleSlot, golden: boolean): void {
    for (const entry of slot.goldenEntries) {
        entry.mesh.material = golden ? entry.goldenMat : entry.normalMat;
        const mat = entry.mesh.material as MeshStandardMaterial;
        mat.transparent = false;
        mat.opacity = 1;
    }
}

function _createGroundAppleSlot(source: Group, treeIndex: number): GroundAppleSlot {
    const group = source.clone(true);
    const goldenEntries: _GoldenMatEntry[] = [];

    group.traverse((child) => {
        if (!(child as any).isMesh) return;
        const mesh = child as Mesh;
        if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map((m) => (m as MeshStandardMaterial).clone());
        } else if (mesh.material) {
            mesh.material = (mesh.material as MeshStandardMaterial).clone();
        }
        const normalMat = mesh.material as MeshStandardMaterial;
        const t = _goldenBlendFactor(mesh, treeIndex);
        const { minY, maxY } = _meshLocalYBounds(mesh);
        const goldenMat = _createGoldenMaterial(normalMat, minY, maxY);
        goldenEntries.push({ mesh, normalMat, goldenMat, blendFactor: t, localMinY: minY, localMaxY: maxY });
    });

    const bbox = new Box3().setFromObject(group);
    const visualCenter = new Vector3();
    bbox.getCenter(visualCenter);
    const localOffset = visualCenter.clone().sub(group.position).divideScalar(source.scale.x || 1);
    group.children.forEach(child => child.position.sub(localOffset));

    group.visible = false;
    group.position.set(0, physicsConfig.safetyPlaneY, 0);
    threeScene.add(group);
    return { group, goldenEntries, inUse: false };
}

function _initGroundAppleVisualPool(appleGroups: Group[]): void {
    if (_groundAppleSlots.length > 0) return;
    for (let i = 0; i < MAX_GROUND_APPLES; i++) {
        const treeIndex = i % appleGroups.length;
        _groundAppleSlots.push(_createGroundAppleSlot(appleGroups[treeIndex], treeIndex));
    }
}

function _releaseGroundApple(ga: GroundApple): void {
    if (_groundAppleDrag.apple === ga) _endGroundAppleDrag();
    if (!ga.respawnTriggered) {
        ga.respawnTriggered = true;
        _startTreeAppleRespawn(ga.treeIndex);
    }
    if (ga.isGolden) _releaseGoldenLight(ga.clone);
    removeAppleBody(ga.physicsBody);
    ga.slot.inUse = false;
    ga.dragged = false;
    ga.clone.visible = false;
    ga.clone.position.set(0, physicsConfig.safetyPlaneY, 0);
    ga.clone.quaternion.set(0, 0, 0, 1);
    _setGroundSlotGolden(ga.slot, false);
}

function _acquireGroundAppleSlot(): GroundAppleSlot | null {
    let slot = _groundAppleSlots.find(s => !s.inUse) ?? null;
    if (slot) return slot;

    const oldest = groundApples.shift();
    if (!oldest) return null;
    _releaseGroundApple(oldest);
    slot = oldest.slot;
    return slot;
}

/** Live-update all currently golden apples (called from debug GUI). */
export function updateAllGoldenApples(): void {
    const goldColor = new Color(goldenAppleConfig.color);
    const goldEmissive = new Color(goldenAppleConfig.emissive);
    for (let i = 0; i < 3; i++) {
        for (const entry of _goldenMatCache[i]) {
            _refreshGoldenEntry(entry, goldColor, goldEmissive);
        }
    }
    for (const slot of _groundAppleSlots) {
        for (const entry of slot.goldenEntries) {
            _refreshGoldenEntry(entry, goldColor, goldEmissive);
        }
    }
    // Update all active pooled lights
    for (let i = 0; i < MAX_GOLDEN_APPLES; i++) {
        if (_goldenLightOwners[i]) {
            const light = _goldenLightPool[i];
            light.color.set(goldenAppleConfig.lightColor);
            light.intensity = goldenAppleConfig.lightIntensity;
            light.distance = goldenAppleConfig.lightDistance;
            light.decay = goldenAppleConfig.lightDecay;
        }
    }
}

/** Start the tree apple respawn animation + golden Easter egg check. */
function _startTreeAppleRespawn(treeIndex: number): void {
    const st = appleStates[treeIndex];
    if (!st.hidden) return;
    st.hidden = false;
    st.respawning = true;
    st.respawnScale = 0;
    st.respawnVelocity = 0;
    [apple1, apple2, apple3][treeIndex].scale.setScalar(0.001);

    // Golden apple Easter egg — every Nth respawn (capped at MAX_GOLDEN_APPLES)
    _totalAppleRespawns++;
    if (goldenAppleConfig.interval > 0
        && _totalAppleRespawns % goldenAppleConfig.interval === 0
        && _countGoldenApples() < MAX_GOLDEN_APPLES) {
        _applyGoldenTint(treeIndex);
    } else {
        _removeGoldenTint(treeIndex);
    }
}

// ── Ground apples (clones that fell and sit on the surface) ──────────────────
interface GroundApple {
    clone: Group;
    physicsBody: Body;
    slot: GroundAppleSlot;
    fading: boolean;
    fadeAlpha: number;
    landed: boolean;         // true once the first collision happened
    treeIndex: number;       // which tree apple spawned this clone
    respawnTimer: number;    // countdown after landing before tree apple respawns
    respawnTriggered: boolean; // true once tree respawn has been kicked off
    isGolden: boolean;       // true if this ground clone was golden when it fell
    dragged: boolean;
    stuckFrames: number;     // consecutive frames found penetrating a collider — triggers a fling
}
const groundApples: GroundApple[] = [];

interface GroundAppleSlot {
    group: Group;
    goldenEntries: _GoldenMatEntry[];
    inUse: boolean;
}
const _groundAppleSlots: GroundAppleSlot[] = [];

const appleRaycaster = new Raycaster();
const appleMouse = new Vector2();
let isAppleHovered = false;
const APPLE_TOUCH_RADIUS = 0.35; // world units — expand hit area on touch
const _appleTouchScratch = new Vector3();
// Spring-damper buoyancy with gravity cancellation.
// When submerged, gravity is counteracted so the spring alone positions the apple.
// This ensures the equilibrium sits exactly at the target — no gravity-induced sag.
// Spring stiffness kept at the original 10 — anything lower lets the apple
// sink too deep and the recovery stalls before it reaches the surface.
const APPLE_BUOYANCY_K = 10;            // spring strength (gentle — gravity is cancelled, so this only handles positioning)
// Linear drag bumped (was 1.8) so the spring is closer to critically damped:
// the bounce on water entry is roughly half what it used to be, and the
// persistent vertical wavering after settling dies out within a fraction of
// a second instead of pinging back and forth.
const APPLE_WATER_LINEAR_DRAG = 5.0;    // per-second linear velocity damping while submerged
const APPLE_WATER_ANGULAR_DRAG = 2.2;   // per-second angular velocity damping while submerged
// Target offset of the apple's visual center relative to the waterline.
// 0   = visual center exactly on waterline → roughly half the model below water.
// <0  = center sits below waterline (more submerged).
// >0  = center sits above waterline (rides higher).
const APPLE_FLOAT_OFFSET = 0;
const _groundAppleDragPlane = new Plane(new Vector3(0, 0, 1), 0);
const _groundAppleDragPoint = new Vector3();
const _groundAppleDragOffset = new Vector3();
const _groundApplePointer = new Vector2();
let _suppressNextAppleClick = false;
// Drag target — the body chases this position via velocity, staying DYNAMIC so collisions work.
const _dragTarget = new Vector3();
let _dragTargetValid = false;
const DRAG_CHASE_STIFFNESS = 30;  // velocity multiplier — how snappily the apple follows the pointer
// Hard cap on chase speed. With substeps of ~1/120s the apple moves at most
// DRAG_MAX_SPEED / 120 ≈ 0.05 m per step — small enough to never tunnel through
// the island trimesh (whose triangles are larger than that on every side).
const DRAG_MAX_SPEED = 6;
// Preventive padding around the apple during drag. Each frame we cast short
// rays from the body center in 14 directions; if any of them hits the island
// surface within DRAG_ISLAND_PADDING metres, the inward velocity component
// along that direction is removed. This stops the apple from getting close
// enough to the trimesh to clip into it (which would leave it stuck without
// any reported contacts for the normal-projection safeguard to grab onto).
// TWEAK THIS: larger = more clearance, but the apple feels like it bumps an
// invisible wall further from the island. 0.10–0.25 is a sane range.
const DRAG_ISLAND_PADDING = 0.18;

// ── Throw-on-release ─────────────────────────────────────────────────────────
// If the cursor was moving fast at the moment the drag ended, capture the
// recent world-space velocity of the drag target and apply it as an impulse
// to the apple body — so a quick flick tosses the apple, while a slow release
// just lets it drop.
const DRAG_SAMPLE_WINDOW_MS = 100;     // look back this many ms for release velocity
const DRAG_SAMPLE_MAX_COUNT = 12;      // ring buffer size (~200ms at 60fps)
const THROW_VELOCITY_THRESHOLD = 1.5;  // m/s of cursor motion required to trigger a throw
const THROW_VELOCITY_MULTIPLIER = 0.45;// scale captured velocity → body impulse (low = gentle toss)
const THROW_MAX_SPEED = 4.5;           // clamp absurdly fast flicks
const THROW_ANGULAR_SCALE = 0.6;       // rad/s of spin per m/s of throw speed
const _groundAppleDrag: {
    active: boolean;
    pointerId: number;
    apple: GroundApple | null;
    moved: boolean;
    startX: number;
    startY: number;
} = {
    active: false,
    pointerId: -1,
    apple: null,
    moved: false,
    startX: 0,
    startY: 0,
};

function _appleInTouchRadius(group: Group): boolean {
    if (!touchControls) return false;
    group.getWorldPosition(_appleTouchScratch);
    const ray = appleRaycaster.ray;
    const toApple = _appleTouchScratch.clone().sub(ray.origin);
    const dot = toApple.dot(ray.direction);
    if (dot < 0) return false; // behind camera
    const closest = ray.origin.clone().addScaledVector(ray.direction, dot);
    return closest.distanceTo(_appleTouchScratch) < APPLE_TOUCH_RADIUS;
}

function _setAppleRayFromClient(clientX: number, clientY: number): void {
    const rect = renderer.domElement.getBoundingClientRect();
    _groundApplePointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _groundApplePointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    appleRaycaster.setFromCamera(_groundApplePointer, camera);
}

function _findGroundAppleAtPointer(clientX: number, clientY: number): GroundApple | null {
    _setAppleRayFromClient(clientX, clientY);
    let best: { ga: GroundApple; distance: number } | null = null;
    for (const ga of groundApples) {
        if (ga.fading || !ga.clone.visible) continue;
        const hits = appleRaycaster.intersectObjects(ga.clone.children, true);
        if (hits.length > 0) {
            if (!best || hits[0].distance < best.distance) best = { ga, distance: hits[0].distance };
            continue;
        }
        if (touchControls) {
            ga.clone.getWorldPosition(_appleTouchScratch);
            const toApple = _appleTouchScratch.clone().sub(appleRaycaster.ray.origin);
            const dot = toApple.dot(appleRaycaster.ray.direction);
            if (dot < 0) continue;
            const closest = appleRaycaster.ray.origin.clone().addScaledVector(appleRaycaster.ray.direction, dot);
            const distance = closest.distanceTo(_appleTouchScratch);
            if (distance < APPLE_TOUCH_RADIUS && (!best || dot < best.distance)) best = { ga, distance: dot };
        }
    }
    return best?.ga ?? null;
}

// Ring buffer of recent drag-target world positions (used by _endGroundAppleDrag
// to derive a throw velocity on quick flicks).
interface DragSample { x: number; y: number; z: number; t: number; }
const _dragSamples: DragSample[] = [];

function _pushDragSample(x: number, y: number, z: number): void {
    _dragSamples.push({ x, y, z, t: performance.now() });
    if (_dragSamples.length > DRAG_SAMPLE_MAX_COUNT) _dragSamples.shift();
}

function _moveDraggedAppleToClient(clientX: number, clientY: number): void {
    if (!_groundAppleDrag.active || !_groundAppleDrag.apple) return;
    _setAppleRayFromClient(clientX, clientY);
    if (!appleRaycaster.ray.intersectPlane(_groundAppleDragPlane, _groundAppleDragPoint)) return;

    _groundAppleDragPoint.add(_groundAppleDragOffset);
    // Store the target — the physics pre-step will chase it via velocity.
    _dragTarget.set(
        _groundAppleDragPoint.x,
        _groundAppleDragPoint.y + physicsConfig.appleBodyYOffset,
        _groundAppleDragPoint.z
    );
    _dragTargetValid = true;
    // Record this position for the release-throw velocity calculation.
    _pushDragSample(_dragTarget.x, _dragTarget.y, _dragTarget.z);
}

/** Compute the release-throw velocity from the recent sample window. Returns
 *  null if motion was too slow (just a normal release). Otherwise returns the
 *  scaled, clamped impulse to apply to the body. */
function _computeReleaseThrow(): { vx: number; vy: number; vz: number; speed: number } | null {
    if (_dragSamples.length < 2) return null;
    const now = performance.now();
    // Oldest sample still inside the window
    let oldest: DragSample | null = null;
    for (const s of _dragSamples) {
        if (now - s.t <= DRAG_SAMPLE_WINDOW_MS) { oldest = s; break; }
    }
    const last = _dragSamples[_dragSamples.length - 1];
    if (!oldest || oldest === last) return null;
    const dt = (last.t - oldest.t) / 1000;
    if (dt < 0.01) return null;
    let vx = (last.x - oldest.x) / dt;
    let vy = (last.y - oldest.y) / dt;
    let vz = (last.z - oldest.z) / dt;
    let speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (speed < THROW_VELOCITY_THRESHOLD) return null;
    // Scale + clamp
    vx *= THROW_VELOCITY_MULTIPLIER;
    vy *= THROW_VELOCITY_MULTIPLIER;
    vz *= THROW_VELOCITY_MULTIPLIER;
    speed *= THROW_VELOCITY_MULTIPLIER;
    if (speed > THROW_MAX_SPEED) {
        const k = THROW_MAX_SPEED / speed;
        vx *= k; vy *= k; vz *= k; speed = THROW_MAX_SPEED;
    }
    return { vx, vy, vz, speed };
}

function _endGroundAppleDrag(): void {
    if (!_groundAppleDrag.active || !_groundAppleDrag.apple) return;
    const body = _groundAppleDrag.apple.physicsBody;

    // Quick flick? Toss the apple along the recent motion. Otherwise just let go.
    const throwImpulse = _computeReleaseThrow();
    if (throwImpulse) {
        body.velocity.x = throwImpulse.vx;
        body.velocity.y = throwImpulse.vy;
        body.velocity.z = throwImpulse.vz;
        // Spin proportional to throw speed so the toss looks lively.
        const s = throwImpulse.speed * THROW_ANGULAR_SCALE;
        body.angularVelocity.set(
            (Math.random() - 0.5) * s,
            (Math.random() - 0.5) * s,
            (Math.random() - 0.5) * s,
        );
    } else {
        body.velocity.setZero();
        body.angularVelocity.setZero();
    }
    body.wakeUp();
    _dragSamples.length = 0;
    _groundAppleDrag.apple.dragged = false;
    _dragTargetValid = false;
    _suppressNextAppleClick = true;
    window.setTimeout(() => { _suppressNextAppleClick = false; }, 250);
    _groundAppleDrag.active = false;
    _groundAppleDrag.pointerId = -1;
    _groundAppleDrag.apple = null;
    _groundAppleDrag.moved = false;
}

// 14-direction probe grid (6 face normals + 8 cube corners). Each cast looks
// outward from the apple's body center DRAG_ISLAND_PADDING metres; any island
// surface hit within that range strips the inward velocity component along
// that direction. Pre-built once at module load — no per-frame allocations.
const _padDirs: Vector3[] = (() => {
    const dirs: Vector3[] = [
        new Vector3( 1, 0, 0), new Vector3(-1, 0, 0),
        new Vector3( 0, 1, 0), new Vector3( 0,-1, 0),
        new Vector3( 0, 0, 1), new Vector3( 0, 0,-1),
    ];
    const s = 1 / Math.sqrt(3);
    for (const x of [-s, s]) for (const y of [-s, s]) for (const z of [-s, s]) {
        dirs.push(new Vector3(x, y, z));
    }
    return dirs;
})();
const _padRaycaster = new Raycaster();
const _padOrigin = new Vector3();

/**
 * Chase the drag target via velocity. The body stays DYNAMIC so cannon-es
 * resolves collisions normally. To guarantee the apple never penetrates any
 * surface — top, side, or underside of the island, tree trunk, radio, etc.:
 *   1. Cap the chase speed so a single physics substep can't tunnel through
 *      a triangle (DRAG_MAX_SPEED / substep_rate must stay smaller than the
 *      shallowest collider feature).
 *   2. Project the chase velocity against the actual contact normals reported
 *      by cannon-es from the previous step. Any component pointing INTO a
 *      surface currently in contact is removed, so the apple slides along
 *      that surface instead of pushing through it.
 *   3. PREVENTIVE padding: 14 short raycasts (DRAG_ISLAND_PADDING long) from
 *      the body center. Any island surface within that range strips the
 *      inward velocity component along that probe direction — so the apple
 *      stops getting close enough to the trimesh to clip into it in the first
 *      place. Catches gaps the contact-normal pass can't (cannon-es needs an
 *      active contact to report a normal; this works before that point).
 * No generic Y floor is imposed — the apple is free in empty space.
 */
function _applyDraggedAppleTarget(): void {
    if (!_groundAppleDrag.active || !_groundAppleDrag.apple || !_dragTargetValid) return;
    const body = _groundAppleDrag.apple.physicsBody;

    // Cancel gravity while dragging so the apple doesn't sag.
    body.velocity.y -= physicsConfig.gravity * deltaTime;

    // Desired velocity to reach the target this frame.
    let vx = (_dragTarget.x - body.position.x) * DRAG_CHASE_STIFFNESS;
    let vy = (_dragTarget.y - body.position.y) * DRAG_CHASE_STIFFNESS;
    let vz = (_dragTarget.z - body.position.z) * DRAG_CHASE_STIFFNESS;

    // Cap magnitude — anti-tunneling.
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (speed > DRAG_MAX_SPEED) {
        const k = DRAG_MAX_SPEED / speed;
        vx *= k; vy *= k; vz *= k;
    }

    // PREVENTIVE PADDING: 14 short raycasts around the body. Any island surface
    // hit within DRAG_ISLAND_PADDING strips the outward (toward-the-surface)
    // velocity component along that probe direction. The probes point AWAY
    // from the body center, so an "inward toward the surface" velocity has a
    // POSITIVE dot product with the probe direction.
    if (islandMeshes.length > 0) {
        _padOrigin.set(body.position.x, body.position.y, body.position.z);
        _padRaycaster.far = DRAG_ISLAND_PADDING;
        for (const dir of _padDirs) {
            _padRaycaster.set(_padOrigin, dir);
            const hits = _padRaycaster.intersectObjects(islandMeshes, false);
            if (hits.length === 0) continue;
            const into = vx * dir.x + vy * dir.y + vz * dir.z;
            if (into > 0) {
                vx -= dir.x * into;
                vy -= dir.y * into;
                vz -= dir.z * into;
            }
        }
        _padRaycaster.far = Infinity;
    }

    // Remove any inward component along surfaces the apple is currently touching.
    // Contact normals from getBodyContactNormals point AWAY from the surface.
    const normals = getBodyContactNormals(body);
    for (const n of normals) {
        const into = vx * n.nx + vy * n.ny + vz * n.nz;
        if (into < 0) {
            vx -= n.nx * into;
            vy -= n.ny * into;
            vz -= n.nz * into;
        }
    }

    body.velocity.x = vx;
    body.velocity.y = vy;
    body.velocity.z = vz;

    // Kill angular spin during drag for a clean feel.
    body.angularVelocity.setZero();
    body.wakeUp();
}

// ── Stuck-apple fling: thresholds + impulse parameters ──────────────────────
// An apple counts as "stuck" once it has been overlapping a static collider
// at >= STUCK_DEPTH_THRESHOLD for STUCK_FRAMES_TO_FLING consecutive frames.
// Normal resting contact resolves within 1–2 frames, so these values catch
// genuinely stuck apples without disturbing apples that just landed.
const STUCK_DEPTH_THRESHOLD = 0.001;   // 1 mm — anything deeper than this is suspect
const STUCK_FRAMES_TO_FLING = 6;       // ~100 ms at 60 fps before we eject
const FLING_LAUNCH_SPEED = 6;          // m/s outward — pure impulse, no teleport
const FLING_UPWARD_BIAS = 3;           // extra upward m/s so apples don't fling sideways into other geometry
const FLING_ANGULAR_SPEED = 8;         // rad/s — adds spin so the toss looks lively
const RESCUE_LAUNCH_SPEED = 12;        // stronger pure-velocity escape for fully-embedded bodies

/** Ejects a stuck apple by applying a pure outward impulse — no teleport. The
 *  body physically flies along the resulting velocity vector, which resolves
 *  any shallow overlap within a frame or two through ordinary motion. */
function _flingApple(ga: GroundApple, nx: number, ny: number, nz: number, speed: number = FLING_LAUNCH_SPEED): void {
    const body = ga.physicsBody;
    body.velocity.x = nx * speed;
    body.velocity.y = ny * speed + FLING_UPWARD_BIAS;
    body.velocity.z = nz * speed;
    body.angularVelocity.set(
        (Math.random() - 0.5) * FLING_ANGULAR_SPEED,
        (Math.random() - 0.5) * FLING_ANGULAR_SPEED,
        (Math.random() - 0.5) * FLING_ANGULAR_SPEED,
    );
    body.wakeUp();
    ga.stuckFrames = 0;
    // Break any active drag — otherwise the chase yanks the apple right back.
    if (_groundAppleDrag.active && _groundAppleDrag.apple === ga) {
        _endGroundAppleDrag();
    }
}

// Dedicated raycaster + scratch vectors for the deep-overlap rescue check.
const _rescueRaycaster = new Raycaster();
const _rescueOrigin = new Vector3();
const _rescueUp = new Vector3(0, 1, 0);
const _rescueDown = new Vector3(0, -1, 0);
const RESCUE_INSIDE_MARGIN = 0.05;   // body must be at least this far below the top to count as "inside"

/**
 * Detects an apple that ended up fully embedded inside the island trimesh
 * (where cannon-es stops generating contacts because no triangle touches the
 * collision spheres anymore) and pops it back onto the top surface.
 *
 * "Inside" = at the apple's xz position there is both island geometry ABOVE
 * the body center and island geometry BELOW it. That excludes the legitimate
 * case of an apple hovering in mid-air over the open ocean.
 */
function _rescueAppleIfInsideIsland(ga: GroundApple): void {
    if (islandMeshes.length === 0 || ga.fading) return;
    const body = ga.physicsBody;

    // Top surface at this xz.
    _rescueOrigin.set(body.position.x, body.position.y + 100, body.position.z);
    _rescueRaycaster.set(_rescueOrigin, _rescueDown);
    _rescueRaycaster.far = 200;
    const downHits = _rescueRaycaster.intersectObjects(islandMeshes, false);
    if (downHits.length === 0) { _rescueRaycaster.far = Infinity; return; }
    const topY = downHits[0].point.y;

    // Body is at or above the top surface — nothing to rescue.
    if (body.position.y >= topY - RESCUE_INSIDE_MARGIN) {
        _rescueRaycaster.far = Infinity;
        return;
    }

    // Confirm there's also island geometry BELOW the body — otherwise the body
    // is hanging in empty space under the island, not inside it.
    _rescueOrigin.set(body.position.x, body.position.y - 100, body.position.z);
    _rescueRaycaster.set(_rescueOrigin, _rescueUp);
    _rescueRaycaster.far = 200;
    const upHits = _rescueRaycaster.intersectObjects(islandMeshes, false);
    _rescueRaycaster.far = Infinity;
    if (upHits.length === 0) return;
    const bottomY = upHits[0].point.y;
    if (body.position.y < bottomY) return; // below the underside, in open water

    // Embedded inside the island volume — apply a strong upward impulse with
    // spin. No teleport: pure physics. The launch speed is high enough that
    // the body crosses the remaining geometry by inertia within a few frames,
    // arcing up and out the top surface like it was thrown.
    _flingApple(ga, 0, 1, 0, RESCUE_LAUNCH_SPEED);
}

function _applyAppleBuoyancy(ga: GroundApple): void {
    if (ga.dragged || ga.fading) return;
    const body = ga.physicsBody;
    const waterY = waterlineYUniform.value as number;
    // Target body Y where the visual center sits APPLE_FLOAT_OFFSET above the waterline.
    // With gravity cancelled below, the spring equilibrium sits exactly here.
    const targetBodyY = waterY + APPLE_FLOAT_OFFSET + physicsConfig.appleBodyYOffset;
    const submersion = targetBodyY - body.position.y;

    if (submersion <= 0) return; // above water — let gravity act normally

    // Order matters: apply drag FIRST to the existing motion, then add
    // gravity-cancellation and the spring impulse. If drag is applied after
    // the gravity cancel, the drag eats part of the cancel and the apple
    // settles BELOW the waterline (the higher the drag, the deeper the sag).
    // This split keeps the equilibrium exactly at submersion=0 regardless of
    // drag strength, so we can tune damping freely without lowering the rest
    // position of the apple.
    const linDrag = Math.max(0, 1 - APPLE_WATER_LINEAR_DRAG * deltaTime);
    body.velocity.x *= linDrag;
    body.velocity.y *= linDrag;
    body.velocity.z *= linDrag;

    // Cancel gravity so the spring alone determines the equilibrium position.
    // cannon-es applies gravity during world.step(), so we pre-add the inverse.
    body.velocity.y -= physicsConfig.gravity * deltaTime;

    // Spring force pushing the apple toward the waterline target.
    body.velocity.y += submersion * APPLE_BUOYANCY_K * deltaTime;

    const angDrag = Math.max(0, 1 - APPLE_WATER_ANGULAR_DRAG * deltaTime);
    body.angularVelocity.scale(angDrag, body.angularVelocity);

    body.wakeUp();
    ga.landed = true;
}

function _updateGroundApples(): void {
    for (const ga of groundApples) _applyAppleBuoyancy(ga);
    _applyDraggedAppleTarget();

    stepPhysics(deltaTime);
    // NOTE: do NOT re-apply drag target after stepping — that would undo
    // cannon's collision response and cause trembling against surfaces.

    // STUCK-APPLE FLING (shallow overlap): nudging an apple by depth+epsilon
    // every frame fights gravity/drag and produces the visible trembling
    // ("stuck and shaking 1 mm into the ground") the user reported. Instead,
    // accumulate frames of sustained overlap; once an apple has been stuck for
    // long enough to rule out a transient resting contact, kick it OUT with a
    // real outward impulse so it visibly flies away rather than re-snapping.
    for (const ga of groundApples) {
        if (ga.fading) { ga.stuckFrames = 0; continue; }
        const pen = getBodyMaxPenetration(ga.physicsBody);
        if (pen && pen.depth >= STUCK_DEPTH_THRESHOLD) {
            ga.stuckFrames++;
            // Dragged apples need to escape FAST — the chase keeps re-pushing
            // them into the surface, so they only need a couple of frames of
            // overlap to count as stuck. Idle apples use the slower threshold
            // to avoid disturbing resting contacts that resolve naturally.
            const framesNeeded = ga.dragged ? 2 : STUCK_FRAMES_TO_FLING;
            if (ga.stuckFrames >= framesNeeded) {
                // Speed scales with how deeply embedded the apple is, but never
                // below FLING_LAUNCH_SPEED (so the toss is always decisive —
                // pen.depth alone is millimetres and produces ~zero motion).
                const speed = Math.max(FLING_LAUNCH_SPEED, pen.depth * 600);
                _flingApple(ga, pen.nx, pen.ny, pen.nz, speed);
            }
        } else {
            ga.stuckFrames = 0;
        }
    }

    // DEEP overlap rescue: a body fully inside the trimesh stops generating
    // contacts at all (no triangle touches the sphere shell), so the fling
    // logic above has nothing to work with. Detect this case geometrically
    // via raycasts and eject the apple straight up from the top surface.
    for (const ga of groundApples) _rescueAppleIfInsideIsland(ga);

    updateDebugger();

    for (let i = groundApples.length - 1; i >= 0; i--) {
        const ga = groundApples[i];

        const bp = ga.physicsBody.position;
        const bq = ga.physicsBody.quaternion;
        ga.clone.position.set(bp.x, bp.y - physicsConfig.appleBodyYOffset, bp.z);
        ga.clone.quaternion.set(bq.x, bq.y, bq.z, bq.w);

        if (ga.landed && !ga.respawnTriggered) {
            ga.respawnTimer -= deltaTime;
            if (ga.respawnTimer <= 0) {
                ga.respawnTriggered = true;
                _startTreeAppleRespawn(ga.treeIndex);
            }
        }

        if (ga.fading) {
            ga.fadeAlpha -= deltaTime / APPLE_RESPAWN_FADE_DURATION;
            const alpha = Math.max(0, ga.fadeAlpha);
            ga.clone.traverse((child) => {
                if ((child as any).isMesh) {
                    const mat = (child as any).material;
                    if (mat) { mat.transparent = true; mat.opacity = alpha; }
                }
            });
            if (ga.fadeAlpha <= 0) {
                if (!ga.respawnTriggered) {
                    ga.respawnTriggered = true;
                    _startTreeAppleRespawn(ga.treeIndex);
                }
                _releaseGroundApple(ga);
                groundApples.splice(i, 1);
            }
        }
    }
}
export function setGrassYOffset(v: number): void {
    grassYOffset = v;
    if (_grassUniforms) _grassUniforms.uYOffset.value = v;
}

export function setGrassColorBase(r: number, g: number, b: number): void {
    grassColorBase.setRGB(r, g, b);
    // Colors baked in vertex colors — caller must respawnFoliage() to apply
}
export function setGrassColorTip(r: number, g: number, b: number): void {
    grassColorTip.setRGB(r, g, b);
    // Colors baked in vertex colors — caller must respawnFoliage() to apply
}
export function setFoliageWindStrength(v: number): void {
    foliageWindStrength = v;
    foliageWindStrengthUniform.value = v;
}

// Exclusion zones — objects that should not have grass underneath them.
// Radii are intentionally generous so footprints are fully clear.
interface ExclusionZone { x: number; z: number; r: number; }
const SPAWN_EXCLUSION_ZONES: ExclusionZone[] = [
    { x:  0.00,  z: -2.90, r: EXCL_R_BONFIRE },  // Bonfire + sword + campfire footprint
    { x:  0.48,  z: -3.65, r: EXCL_R_TENT    },  // Custom tent
    { x: -0.35,  z: -3.60, r: EXCL_R_TREE    },  // Tree trunk
    { x:  0.65,  z: -2.30, r: EXCL_R_PUG     },  // Pug
    { x: -0.65,  z: -3.10, r: EXCL_R_RADIO   },  // Radio
    { x:  0.32,  z: -2.60, r: EXCL_R_ROCKS   },  // Little rocks + phone
];

/** Mutable live exclusion radii — mutated by the debug GUI, read by isValidSpawnPos() */
export const exclRadii = {
    bonfire: EXCL_R_BONFIRE,
    tent:    EXCL_R_TENT,
    tree:    EXCL_R_TREE,
    pug:     EXCL_R_PUG,
    radio:   EXCL_R_RADIO,
    rocks:   EXCL_R_ROCKS,
};

/** Update both the live object and the corresponding zone entry, then respawn all foliage. */
export function setExclRadius(key: keyof typeof exclRadii, v: number): void {
    exclRadii[key] = v;
    const IDX: Record<keyof typeof exclRadii, number> = {
        bonfire: 0, tent: 1, tree: 2, pug: 3, radio: 4, rocks: 5,
    };
    SPAWN_EXCLUSION_ZONES[IDX[key]].r = v;
}
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

// Shared placed-positions list so blades don't stack on top of each other
const foliageSpawnPlaced: Array<{x: number; z: number}> = [];

// Signals when grass has finished generating
let _grassLoaded = false;
export function isFoliageLoaded(): boolean { return _grassLoaded; }

// Mutable count — initialised from config, then mutated live by the debug panel
export let GRASS_COUNT = GRASS_COUNT_CFG;
export function setGrassCount(n: number) { GRASS_COUNT = Math.max(0, Math.round(n)); }

// Bounding box for full-surface scatter (generous — isOnIslandSurface filters out edges)
const SPAWN_BBOX = {
    xMin: islandPosition.x - 2.5,
    xMax: islandPosition.x + 2.5,
    zMin: islandPosition.z - 2.5,
    zMax: islandPosition.z + 2.5,
};

// ─── Runtime respawn ─────────────────────────────────────────────────────────
export type FoliageCluster = 'grass';

export function respawnFoliage(_which: FoliageCluster = 'grass'): void {
    if (!_perlinTexture) { console.warn('respawnFoliage: procedural system not ready'); return; }

    foliageSpawnPlaced.length = 0;
    _grassSpawnPoints = [];

    for (let i = 0; i < GRASS_COUNT; i++) {
        for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
            const wx = SPAWN_BBOX.xMin + Math.random() * (SPAWN_BBOX.xMax - SPAWN_BBOX.xMin);
            const wz = SPAWN_BBOX.zMin + Math.random() * (SPAWN_BBOX.zMax - SPAWN_BBOX.zMin);
            if (!isValidSpawnPos(wx, wz, foliageSpawnPlaced)) continue;
            foliageSpawnPlaced.push({ x: wx, z: wz });
            _grassSpawnPoints.push({ x: wx, z: wz, y: getSurfaceY(wx, wz), edgeFactor: computeEdgeFactor(wx, wz) });
            break;
        }
    }

    if (proceduralGrassMesh) {
        proceduralGrassMesh.geometry.dispose();
        threeScene.remove(proceduralGrassMesh);
    }
    if (_grassUniforms) {
        proceduralGrassMesh = createGrassMesh(_grassSpawnPoints, GRASS_Y, _grassUniforms, oceanLightingPars, oceanLightingFragment, { minEdgeScale: grassMinEdgeScale, bladeHeight: grassMaxHeight });
        threeScene.add(proceduralGrassMesh);
    }
    buildShadowFloor(_grassSpawnPoints);
    console.log(`[Island] Respawned grass: ${_grassSpawnPoints.length} spawn points`);
}

// TREE WIND SETTINGS - easily tweakable
const TREE_WIND_STRENGTH = 0.03;    // TWEAK: How much leaves sway (0.05-0.3)
const TREE_WIND_SPEED = 0.5;       // TWEAK: Speed of wind oscillation (0.5-3.0)
const TREE_LEAF_START_Y = 3.0;     // TWEAK: Y height where leaves start swaying (local coords)
const TREE_LEAF_FULL_Y = 3.25;      // TWEAK: Y height where full sway happens
const BUSH_WIND_STRENGTH = 0.018;   // TWEAK: very subtle bush leaf distortion
const BUSH_FLOWER_COLOR_STRENGTH = 1.0; // 1 = configured hue wins, 0 = original texture hue
const BUSH_FLOWER_SHADE_MIN = 0.78;     // Higher = less muddy/dark flower recolor
const BUSH_FLOWER_SHADE_MAX = 1.18;     // Higher = brighter flower highlights
const BUSH_FLOWER_EMISSIVE_INTENSITY = 0.08; // Small color lift after scene lighting

// Wind uniforms for shader
const treeWindTimeUniform = new Uniform(0.0);
const treeWindStrengthUniform = new Uniform(TREE_WIND_STRENGTH);
const treeLeafStartYUniform = new Uniform(TREE_LEAF_START_Y);
const treeLeafFullYUniform = new Uniform(TREE_LEAF_FULL_Y);
const bushWindStrengthUniform = new Uniform(BUSH_WIND_STRENGTH);

export const bushFlowerConfig = {
    main:  bushFlowerColor,
    radio: bushRadioFlowerColor,
    radio2: bushRadio2FlowerColor,
    pug:   bushPugFlowerColor,
};
export type BushFlowerKey = keyof typeof bushFlowerConfig;

// FOLIAGE (GRASS/CLOVER) WIND SETTINGS - independent from tree
const FOLIAGE_WIND_STRENGTH = 0.035;  // TWEAK: Very subtle sway
// const FOLIAGE_WIND_SPEED = 0.8;       // TWEAK: Slow gentle movement
const foliageWindStrengthUniform = new Uniform(FOLIAGE_WIND_STRENGTH);
const grassWobbleStrengthUniform = new Uniform(GRASS_WOBBLE_STRENGTH_CFG);

// Mouse interaction for grass
const raycaster = new Raycaster();
const mouse = new Vector2();
const mouseWorldPos = new Uniform(new Vector3(0, -100, 0));  // Far away by default
const mouseInfluenceRadius = new Uniform(0.50);   // Wide area — very gradual falloff
const mouseInfluenceStrength = new Uniform(0.018); // Very subtle — barely noticeable

// BREEZE-DRIVEN WIND SETTINGS
const BREEZE_RAMP_UP = 1.0;           // Seconds to ramp up wind when breeze starts
const BREEZE_RAMP_DOWN = 4.0;         // Seconds to fade out wind after breeze ends
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


export let islandSurfaceGrassColor = ISLAND_SURFACE_GRASS_COLOR;
export let islandSurfaceGrassStrength = ISLAND_SURFACE_GRASS_STRENGTH;
export let islandSurfaceGrassGreenThreshold = ISLAND_SURFACE_GRASS_GREEN_THRESHOLD;
export let islandSurfaceGrassNormalThreshold = ISLAND_SURFACE_GRASS_NORMAL_THRESHOLD;
export let islandSurfaceGrassMaskSoftness = ISLAND_SURFACE_GRASS_MASK_SOFTNESS;
export let islandSurfaceGrassTopFillStrength = ISLAND_SURFACE_GRASS_TOP_FILL_STRENGTH;
export let islandSurfaceGrassTopFillNormalThreshold = ISLAND_SURFACE_GRASS_TOP_FILL_NORMAL_THRESHOLD;
export let islandSurfacePointLightInfluence = ISLAND_SURFACE_POINT_LIGHT_INFLUENCE;
export let islandCampfireGroundColor = ISLAND_CAMPFIRE_GROUND_COLOR;
export let islandCampfireGroundRadius = ISLAND_CAMPFIRE_GROUND_RADIUS;
export let islandCampfireGroundSoftness = ISLAND_CAMPFIRE_GROUND_SOFTNESS;
export let islandCampfireGroundStrength = ISLAND_CAMPFIRE_GROUND_STRENGTH;
export let islandCampfireGroundNormalThreshold = ISLAND_CAMPFIRE_GROUND_NORMAL_THRESHOLD;
export let islandRockMatchColor = ISLAND_ROCK_MATCH_COLOR;
export let islandRockMatchStrength = ISLAND_ROCK_MATCH_STRENGTH;
export let islandRockMatchSaturation = ISLAND_ROCK_MATCH_SATURATION;
export let islandRockMatchBrightness = ISLAND_ROCK_MATCH_BRIGHTNESS;
export let islandRockMatchColorTint = ISLAND_ROCK_MATCH_COLOR_TINT;
export let islandRockMatchGreenThreshold = ISLAND_ROCK_MATCH_GREEN_THRESHOLD;
export let islandRockMatchGreenStrength = ISLAND_ROCK_MATCH_GREEN_STRENGTH;
export let islandRockMatchGreenColor = ISLAND_ROCK_MATCH_GREEN_COLOR;

const islandSurfaceGrassColorUniform = new Uniform(new Color(islandSurfaceGrassColor));
const islandSurfaceGrassStrengthUniform = new Uniform(islandSurfaceGrassStrength);
const islandSurfaceGrassGreenThresholdUniform = new Uniform(islandSurfaceGrassGreenThreshold);
const islandSurfaceGrassNormalThresholdUniform = new Uniform(islandSurfaceGrassNormalThreshold);
const islandSurfaceGrassMaskSoftnessUniform = new Uniform(islandSurfaceGrassMaskSoftness);
const islandSurfaceGrassTopFillStrengthUniform = new Uniform(islandSurfaceGrassTopFillStrength);
const islandSurfaceGrassTopFillNormalThresholdUniform = new Uniform(islandSurfaceGrassTopFillNormalThreshold);
const islandSurfacePointLightInfluenceUniform = new Uniform(islandSurfacePointLightInfluence);
const islandCampfireGroundColorUniform = new Uniform(new Color(islandCampfireGroundColor));
const islandCampfireGroundRadiusUniform = new Uniform(islandCampfireGroundRadius);
const islandCampfireGroundSoftnessUniform = new Uniform(islandCampfireGroundSoftness);
const islandCampfireGroundStrengthUniform = new Uniform(islandCampfireGroundStrength);
const islandCampfireGroundNormalThresholdUniform = new Uniform(islandCampfireGroundNormalThreshold);
const islandCampfireGroundCenterUniform = new Uniform(new Vector2());
const islandRockMatchColorUniform = new Uniform(new Color(islandRockMatchColor));
const islandRockMatchStrengthUniform = new Uniform(islandRockMatchStrength);
const islandRockMatchSaturationUniform = new Uniform(islandRockMatchSaturation);
const islandRockMatchBrightnessUniform = new Uniform(islandRockMatchBrightness);
const islandRockMatchColorTintUniform = new Uniform(islandRockMatchColorTint);
const islandRockMatchGreenThresholdUniform = new Uniform(islandRockMatchGreenThreshold);
const islandRockMatchGreenStrengthUniform = new Uniform(islandRockMatchGreenStrength);
const islandRockMatchGreenColorUniform = new Uniform(new Color(islandRockMatchGreenColor));

export function setIslandRockMatchGreenThreshold(v: number): void {
    islandRockMatchGreenThreshold = MathUtils.clamp(v, -0.5, 0.8);
    islandRockMatchGreenThresholdUniform.value = islandRockMatchGreenThreshold;
}

export function setIslandRockMatchGreenStrength(v: number): void {
    islandRockMatchGreenStrength = MathUtils.clamp(v, 0, 1);
    islandRockMatchGreenStrengthUniform.value = islandRockMatchGreenStrength;
}

export function setIslandRockMatchGreenColor(color: string): void {
    islandRockMatchGreenColor = color;
    islandRockMatchGreenColorUniform.value.set(color);
}

export function setIslandRockMatchColor(color: string): void {
    islandRockMatchColor = color;
    islandRockMatchColorUniform.value.set(color);
}

export function setIslandRockMatchStrength(v: number): void {
    islandRockMatchStrength = MathUtils.clamp(v, 0, 1);
    islandRockMatchStrengthUniform.value = islandRockMatchStrength;
}

export function setIslandRockMatchSaturation(v: number): void {
    islandRockMatchSaturation = MathUtils.clamp(v, 0, 1);
    islandRockMatchSaturationUniform.value = islandRockMatchSaturation;
}

export function setIslandRockMatchBrightness(v: number): void {
    islandRockMatchBrightness = MathUtils.clamp(v, 0, 2);
    islandRockMatchBrightnessUniform.value = islandRockMatchBrightness;
}

export function setIslandRockMatchColorTint(v: number): void {
    islandRockMatchColorTint = MathUtils.clamp(v, 0, 1);
    islandRockMatchColorTintUniform.value = islandRockMatchColorTint;
}

export function setIslandSurfaceGrassColor(color: string): void {
    islandSurfaceGrassColor = color;
    islandSurfaceGrassColorUniform.value.set(color);
}

export function setIslandSurfaceGrassStrength(v: number): void {
    islandSurfaceGrassStrength = MathUtils.clamp(v, 0, 1);
    islandSurfaceGrassStrengthUniform.value = islandSurfaceGrassStrength;
}

export function setIslandSurfaceGrassGreenThreshold(v: number): void {
    islandSurfaceGrassGreenThreshold = MathUtils.clamp(v, -0.5, 0.8);
    islandSurfaceGrassGreenThresholdUniform.value = islandSurfaceGrassGreenThreshold;
}

export function setIslandSurfaceGrassNormalThreshold(v: number): void {
    islandSurfaceGrassNormalThreshold = MathUtils.clamp(v, -1, 1);
    islandSurfaceGrassNormalThresholdUniform.value = islandSurfaceGrassNormalThreshold;
}

export function setIslandSurfaceGrassMaskSoftness(v: number): void {
    islandSurfaceGrassMaskSoftness = Math.max(0.001, v);
    islandSurfaceGrassMaskSoftnessUniform.value = islandSurfaceGrassMaskSoftness;
}

export function setIslandSurfaceGrassTopFillStrength(v: number): void {
    islandSurfaceGrassTopFillStrength = MathUtils.clamp(v, 0, 1);
    islandSurfaceGrassTopFillStrengthUniform.value = islandSurfaceGrassTopFillStrength;
}

export function setIslandSurfaceGrassTopFillNormalThreshold(v: number): void {
    islandSurfaceGrassTopFillNormalThreshold = MathUtils.clamp(v, -1, 1);
    islandSurfaceGrassTopFillNormalThresholdUniform.value = islandSurfaceGrassTopFillNormalThreshold;
}

export function setIslandSurfacePointLightInfluence(v: number): void {
    islandSurfacePointLightInfluence = MathUtils.clamp(v, 0, 1);
    islandSurfacePointLightInfluenceUniform.value = islandSurfacePointLightInfluence;
}

export function setIslandCampfireGroundColor(color: string): void {
    islandCampfireGroundColor = color;
    islandCampfireGroundColorUniform.value.set(color);
}

export function setIslandCampfireGroundRadius(v: number): void {
    islandCampfireGroundRadius = Math.max(0, v);
    islandCampfireGroundRadiusUniform.value = islandCampfireGroundRadius;
}

export function setIslandCampfireGroundSoftness(v: number): void {
    islandCampfireGroundSoftness = Math.max(0.001, v);
    islandCampfireGroundSoftnessUniform.value = islandCampfireGroundSoftness;
}

export function setIslandCampfireGroundStrength(v: number): void {
    islandCampfireGroundStrength = MathUtils.clamp(v, 0, 1);
    islandCampfireGroundStrengthUniform.value = islandCampfireGroundStrength;
}

export function setIslandCampfireGroundNormalThreshold(v: number): void {
    islandCampfireGroundNormalThreshold = MathUtils.clamp(v, -1, 1);
    islandCampfireGroundNormalThresholdUniform.value = islandCampfireGroundNormalThreshold;
}

function applyIslandSurfaceFilterShader(model: Group): void {
    model.traverse((child) => {
        if ((child as any).isMesh && (child as any).material) {
            const mesh = child as any;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat: any) => {
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshBasicMaterial) {
                    mat.customProgramCacheKey = () => 'island_surface_grass_filter';
                    mat.onBeforeCompile = (shader: any) => {
                        shader.uniforms.uLight = lightUniform;
                        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
                        shader.uniforms.uFogDist = underwaterFogDistUniform;
                        shader.uniforms.uSunVisibility = sunVisibilityUniform;
                        shader.uniforms.uIslandSurfaceGrassColor = islandSurfaceGrassColorUniform;
                        shader.uniforms.uIslandSurfaceGrassStrength = islandSurfaceGrassStrengthUniform;
                        shader.uniforms.uIslandSurfaceGrassGreenThreshold = islandSurfaceGrassGreenThresholdUniform;
                        shader.uniforms.uIslandSurfaceGrassNormalThreshold = islandSurfaceGrassNormalThresholdUniform;
                        shader.uniforms.uIslandSurfaceGrassMaskSoftness = islandSurfaceGrassMaskSoftnessUniform;
                        shader.uniforms.uIslandSurfaceGrassTopFillStrength = islandSurfaceGrassTopFillStrengthUniform;
                        shader.uniforms.uIslandSurfaceGrassTopFillNormalThreshold = islandSurfaceGrassTopFillNormalThresholdUniform;
                        shader.uniforms.uIslandSurfacePointLightInfluence = islandSurfacePointLightInfluenceUniform;
                        shader.uniforms.uIslandCampfireGroundColor = islandCampfireGroundColorUniform;
                        shader.uniforms.uIslandCampfireGroundRadius = islandCampfireGroundRadiusUniform;
                        shader.uniforms.uIslandCampfireGroundSoftness = islandCampfireGroundSoftnessUniform;
                        shader.uniforms.uIslandCampfireGroundStrength = islandCampfireGroundStrengthUniform;
                        shader.uniforms.uIslandCampfireGroundNormalThreshold = islandCampfireGroundNormalThresholdUniform;
                        shader.uniforms.uIslandCampfireGroundCenter = islandCampfireGroundCenterUniform;
                        shader.uniforms.uIslandRockMatchColor = islandRockMatchColorUniform;
                        shader.uniforms.uIslandRockMatchStrength = islandRockMatchStrengthUniform;
                        shader.uniforms.uIslandRockMatchSaturation = islandRockMatchSaturationUniform;
                        shader.uniforms.uIslandRockMatchBrightness = islandRockMatchBrightnessUniform;
                        shader.uniforms.uIslandRockMatchColorTint = islandRockMatchColorTintUniform;
                        shader.uniforms.uIslandRockMatchGreenThreshold = islandRockMatchGreenThresholdUniform;
                        shader.uniforms.uIslandRockMatchGreenStrength = islandRockMatchGreenStrengthUniform;
                        shader.uniforms.uIslandRockMatchGreenColor = islandRockMatchGreenColorUniform;
                        shader.uniforms.uWaterlineY = waterlineYUniform;

                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <common>',
                            `#include <common>
                            varying vec3 vWorldPosition;
                            varying vec3 vWorldNormal;`
                        );
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <beginnormal_vertex>',
                            `#include <beginnormal_vertex>
                            vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
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
                            varying vec3 vWorldNormal;
                            uniform vec3 uIslandSurfaceGrassColor;
                            uniform float uIslandSurfaceGrassStrength;
                            uniform float uIslandSurfaceGrassGreenThreshold;
                            uniform float uIslandSurfaceGrassNormalThreshold;
                            uniform float uIslandSurfaceGrassMaskSoftness;
                            uniform float uIslandSurfaceGrassTopFillStrength;
                            uniform float uIslandSurfaceGrassTopFillNormalThreshold;
                            uniform float uIslandSurfacePointLightInfluence;
                            uniform vec3 uIslandCampfireGroundColor;
                            uniform float uIslandCampfireGroundRadius;
                            uniform float uIslandCampfireGroundSoftness;
                            uniform float uIslandCampfireGroundStrength;
                            uniform float uIslandCampfireGroundNormalThreshold;
                            uniform vec2 uIslandCampfireGroundCenter;
                            uniform vec3 uIslandRockMatchColor;
                            uniform float uIslandRockMatchStrength;
                            uniform float uIslandRockMatchSaturation;
                            uniform float uIslandRockMatchBrightness;
                            uniform float uIslandRockMatchColorTint;
                            uniform float uIslandRockMatchGreenThreshold;
                            uniform float uIslandRockMatchGreenStrength;
                            uniform vec3 uIslandRockMatchGreenColor;
                            uniform float uWaterlineY;
                            ${oceanLightingPars}`
                        );
                        shader.fragmentShader = shader.fragmentShader.replace(
                            '#include <map_fragment>',
                            `#include <map_fragment>
                            vec3 islandSurfaceSample = diffuseColor.rgb;
                            float islandGreenDominance = islandSurfaceSample.g - max(islandSurfaceSample.r, islandSurfaceSample.b);
                            float islandGreenMask = smoothstep(
                                uIslandSurfaceGrassGreenThreshold,
                                uIslandSurfaceGrassGreenThreshold + uIslandSurfaceGrassMaskSoftness,
                                islandGreenDominance
                            );
                            float islandUpMask = smoothstep(
                                uIslandSurfaceGrassNormalThreshold,
                                min(uIslandSurfaceGrassNormalThreshold + uIslandSurfaceGrassMaskSoftness, 1.0),
                                normalize(vWorldNormal).y
                            );
                            float islandTopFillMask = smoothstep(
                                uIslandSurfaceGrassTopFillNormalThreshold,
                                min(uIslandSurfaceGrassTopFillNormalThreshold + uIslandSurfaceGrassMaskSoftness, 1.0),
                                normalize(vWorldNormal).y
                            ) * uIslandSurfaceGrassTopFillStrength;
                            float islandGrassMask = max(islandGreenMask * islandUpMask, islandTopFillMask) * uIslandSurfaceGrassStrength;
                            float islandSurfaceLuma = dot(islandSurfaceSample, vec3(0.299, 0.587, 0.114));
                            vec3 islandTintedGrass = uIslandSurfaceGrassColor * max(islandSurfaceLuma, 0.22);
                            diffuseColor.rgb = mix(diffuseColor.rgb, islandTintedGrass, islandGrassMask);

                            // Detect moss green on ANY facing (the grass mask above only catches
                            // up-facing top grass; the underside moss points down/sideways). Protect
                            // these pixels from the gray grade so they don't get painted gray.
                            float islandAnyGreenMask = smoothstep(
                                uIslandRockMatchGreenThreshold,
                                uIslandRockMatchGreenThreshold + uIslandSurfaceGrassMaskSoftness,
                                islandGreenDominance
                            );

                            // Below-water gate: the rock-match grade and underside moss tint are an
                            // UNDERWATER look only. The island's top (above the ocean surface) already
                            // has its own color filters that must be respected 100%, so confine both
                            // effects to geometry below the waterline with a thin soft band to avoid
                            // a hard seam at the surface.
                            float islandBelowWaterMask = 1.0 - smoothstep(uWaterlineY - 0.06, uWaterlineY + 0.06, vWorldPosition.y);

                            // Rock-match grade: nudge the non-grass STONE tones toward the standalone
                            // rock models' palette (darker, cool blue-gray). Excludes both the top
                            // grass and any moss green so only bare stone is regraded.
                            float islandRockMask = (1.0 - islandGrassMask) * (1.0 - islandAnyGreenMask) * uIslandRockMatchStrength * islandBelowWaterMask;
                            float islandRockLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                            vec3 islandRockGraded = mix(vec3(islandRockLuma), diffuseColor.rgb, uIslandRockMatchSaturation);
                            islandRockGraded *= uIslandRockMatchBrightness;
                            vec3 islandRockTint = uIslandRockMatchColor * max(islandRockLuma, 0.08);
                            islandRockGraded = mix(islandRockGraded, islandRockTint, uIslandRockMatchColorTint);
                            diffuseColor.rgb = mix(diffuseColor.rgb, islandRockGraded, islandRockMask);

                            // Underside moss: tint the green that the top-grass mask missed toward a
                            // moss color so it reads green (matching the surface grass), not gray.
                            float islandUnderGreenMask = islandAnyGreenMask * (1.0 - islandGrassMask) * uIslandRockMatchGreenStrength * islandBelowWaterMask;
                            vec3 islandUnderGreenTint = uIslandRockMatchGreenColor * max(islandSurfaceLuma, 0.38);
                            diffuseColor.rgb = mix(diffuseColor.rgb, islandUnderGreenTint, islandUnderGreenMask);

                            float islandCampfireDist = distance(vWorldPosition.xz, uIslandCampfireGroundCenter);
                            float islandCampfireInner = max(uIslandCampfireGroundRadius - uIslandCampfireGroundSoftness, 0.0);
                            float islandCampfireMask = 1.0 - smoothstep(islandCampfireInner, uIslandCampfireGroundRadius, islandCampfireDist);
                            float islandCampfireUpMask = smoothstep(
                                uIslandCampfireGroundNormalThreshold,
                                min(uIslandCampfireGroundNormalThreshold + uIslandSurfaceGrassMaskSoftness, 1.0),
                                normalize(vWorldNormal).y
                            );
                            islandCampfireMask *= islandCampfireUpMask;
                            islandCampfireMask *= uIslandCampfireGroundStrength;
                            float islandCampfireLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                            vec3 islandCampfireTint = uIslandCampfireGroundColor * max(islandCampfireLuma, 0.32);
                            diffuseColor.rgb = mix(diffuseColor.rgb, islandCampfireTint, islandCampfireMask);`
                        );
                        const pointLightReducedChunk = (ShaderChunk as any).lights_fragment_begin.replace(
                            'getPointLightInfo( pointLight, geometryPosition, directLight );',
                            `getPointLightInfo( pointLight, geometryPosition, directLight );
		directLight.color *= uIslandSurfacePointLightInfluence;`
                        );
                        shader.fragmentShader = shader.fragmentShader.replace(
                            '#include <lights_fragment_begin>',
                            pointLightReducedChunk
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

/** Load a moss rock GLB, wire it up with the standard ocean lighting, then
 *  position/scale/rotate it relative to the island. Edge foam is handled
 *  ocean-side via depth-intersection (see SceneDepth + OceanShaders). The
 *  first call per path loads the GLB; subsequent calls with the same path
 *  clone the cached scene (geometry + materials shared, shader injection only
 *  happens once). `moss_rock1.glb` is currently used by 3 instances and
 *  `moss_rock3.glb` by 3 instances — without the cache each instance held its
 *  own GPU upload. */
const _mossRockTemplates = new Map<string, Group>();
const _mossRockPending = new Map<string, Array<(s: Group) => void>>();

function _loadMossRock(
    path: string,
    group: Group,
    offset: { x: number; y: number; z: number },
    scale: number,
    rot: { x: number; y: number; z: number },
): void {
    const place = (template: Group) => {
        const instance = template.clone(true);
        instance.traverse((child) => {
            if ((child as any).isMesh) {
                child.castShadow = true;
                (child as any).receiveShadow = true;
            }
        });
        group.add(instance);
        group.position.set(
            islandPosition.x + offset.x,
            islandPosition.y + offset.y,
            islandPosition.z + offset.z,
        );
        group.scale.setScalar(scale);
        group.rotation.set(rot.x, rot.y, rot.z);
        threeScene.add(group);
    };

    const cached = _mossRockTemplates.get(path);
    if (cached) { place(cached); return; }

    const pending = _mossRockPending.get(path);
    if (pending) { pending.push(place); return; }

    _mossRockPending.set(path, [place]);
    loader.load(
        path,
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            _mossRockTemplates.set(path, gltf.scene as Group);
            const queue = _mossRockPending.get(path) || [];
            _mossRockPending.delete(path);
            for (const apply of queue) apply(gltf.scene as Group);
            console.log(`Moss rock loaded once: ${path} (${queue.length} instances)`);
        },
        undefined,
        (err) => { console.error(`Error loading moss rock ${path}:`, err); },
    );
}

/** Generic surface prop loader: ocean lighting + waterline + shadows + transform.
 *  Mirrors the moss-rock loader but skips the per-object waterline shader since
 *  most tent-interior props sit well above the waterline. */
function _loadSurfaceProp(
    path: string,
    group: Group,
    offset: { x: number; y: number; z: number },
    scale: number,
    rot: { x: number; y: number; z: number },
): void {
    loader.load(
        path,
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            group.add(gltf.scene);
            group.position.set(
                islandPosition.x + offset.x,
                islandPosition.y + offset.y,
                islandPosition.z + offset.z,
            );
            group.scale.setScalar(scale);
            group.rotation.set(rot.x, rot.y, rot.z);
            threeScene.add(group);
            console.log(`Surface prop loaded: ${path}`);
        },
        undefined,
        (err) => { console.error(`Error loading surface prop ${path}:`, err); },
    );
}

// Apply wind animation shader to tree
function applyTreeWindShader(model: Group): void {
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
                    mat.customProgramCacheKey = () => 'tree_wind';
                    mat.onBeforeCompile = (shader: any) => {
                        console.log('🌳 Tree wind shader compiling!');
                        // Add ocean lighting uniforms
                        shader.uniforms.uLight = lightUniform;
                        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
                        shader.uniforms.uFogDist = underwaterFogDistUniform;
                        shader.uniforms.uSunVisibility = sunVisibilityUniform;
                        // Add wind uniforms
                        shader.uniforms.uWindTime = treeWindTimeUniform;
                        shader.uniforms.uWindStrength = treeWindStrengthUniform;
                        shader.uniforms.uLeafStartY = treeLeafStartYUniform;
                        shader.uniforms.uLeafFullY = treeLeafFullYUniform;
                        
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

function isBushFlowerMaterial(mat: any): boolean {
    return typeof mat?.name === 'string' && mat.name.toLowerCase().includes('flower');
}

function applyBushFlowerColor(group: Group, color: string): void {
    const flowerColor = new Color(color);
    group.traverse((child) => {
        if (!(child as any).isMesh || !(child as any).material) return;
        const mesh = child as Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat: any) => {
            if (!isBushFlowerMaterial(mat)) return;
            mat.userData.flowerColor = color;
            mat.color?.set(flowerColor);
            mat.emissive?.set(flowerColor);
            if ('emissiveIntensity' in mat) mat.emissiveIntensity = BUSH_FLOWER_EMISSIVE_INTENSITY;
            mat.userData.flowerColorUniform?.value.set(flowerColor);
            mat.needsUpdate = true;
        });
    });
}

export function setBushFlowerColor(key: BushFlowerKey, color: string): void {
    bushFlowerConfig[key] = color;
    const group = key === 'main' ? bush : key === 'radio' ? bushRadio : key === 'radio2' ? bushRadio2 : bushPug;
    applyBushFlowerColor(group, color);
}

function applyBushWindShader(model: Group, flowerColor: string): void {
    model.traverse((child) => {
        if ((child as any).isMesh && (child as any).material) {
            const mesh = child as Mesh;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat: any) => {
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshBasicMaterial) {
                    const isFlower = isBushFlowerMaterial(mat);
                    if (isFlower) {
                        mat.userData.flowerColor = flowerColor;
                        mat.color?.set(flowerColor);
                        mat.emissive?.set(flowerColor);
                        if ('emissiveIntensity' in mat) mat.emissiveIntensity = BUSH_FLOWER_EMISSIVE_INTENSITY;
                    }
                    mat.transparent = false;
                    mat.depthWrite = true;
                    mat.depthTest = true;
                    if (mat.alphaMap || mat.map?.image || mat.alphaTest > 0) {
                        mat.alphaTest = Math.max(mat.alphaTest || 0, 0.5);
                    }

                    mat.customProgramCacheKey = () => isFlower ? 'bush_wind_flower' : 'bush_wind';
                    mat.onBeforeCompile = (shader: any) => {
                        shader.uniforms.uLight = lightUniform;
                        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
                        shader.uniforms.uFogDist = underwaterFogDistUniform;
                        shader.uniforms.uSunVisibility = sunVisibilityUniform;
                        shader.uniforms.uWindTime = treeWindTimeUniform;
                        shader.uniforms.uWindStrength = bushWindStrengthUniform;
                        if (isFlower) {
                            mat.userData.flowerColorUniform = new Uniform(new Color(mat.userData.flowerColor));
                            shader.uniforms.uFlowerColor = mat.userData.flowerColorUniform;
                        }

                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <common>',
                            `#include <common>
                            uniform float uWindTime;
                            uniform float uWindStrength;
                            varying vec3 vWorldPosition;`
                        );
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <begin_vertex>',
                            `#include <begin_vertex>
                            float heightFactor = smoothstep(-0.05, 0.55, position.y);
                            float leafNoise = sin(uWindTime * 1.7 + position.x * 4.1 + position.z * 1.3)
                                            + sin(uWindTime * 2.6 + position.z * 3.4) * 0.45;
                            transformed.x += leafNoise * uWindStrength * heightFactor;
                            transformed.z += leafNoise * uWindStrength * 0.35 * heightFactor;`
                        );
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <worldpos_vertex>',
                            `#include <worldpos_vertex>
                            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`
                        );
                        if (isFlower) {
                            shader.fragmentShader = shader.fragmentShader.replace(
                                '#include <common>',
                                `#include <common>
                                uniform vec3 uFlowerColor;`
                            );
                            shader.fragmentShader = shader.fragmentShader.replace(
                                '#include <map_fragment>',
                                `#include <map_fragment>
                                float flowerLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                                float flowerShade = mix(${BUSH_FLOWER_SHADE_MIN.toFixed(3)}, ${BUSH_FLOWER_SHADE_MAX.toFixed(3)}, smoothstep(0.05, 0.95, flowerLuma));
                                vec3 recoloredFlower = uFlowerColor * flowerShade;
                                diffuseColor.rgb = mix(diffuseColor.rgb, recoloredFlower, ${BUSH_FLOWER_COLOR_STRENGTH.toFixed(3)});`
                            );
                        }
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
    // Pre-create golden apple PointLights so the renderer compiles the shader
    // on the very first frame (behind the loading screen) — no mid-game stutter.
    _initGoldenLightPool();

    loader.load(
        'models/surface/floating_island.glb',
        (gltf) => {
            applyIslandSurfaceFilterShader(gltf.scene);
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
            island.updateMatrixWorld(true);
            islandLowestY = new Box3().setFromObject(island).min.y;

            // Populate islandMeshes synchronously so waitForIslandMeshes() unblocks
            // even if grass/clover finish loading before the next animation frame.
            island.traverse((child) => {
                if ((child as any).isMesh) islandMeshes.push(child as Mesh);
            });

            // Foam mask needs the renderer so it still runs in the next frame.
            requestAnimationFrame(() => {
                generateFoamMask(renderer, island);
                const tex = getMaskTexture();
                if (tex) {
                    setFoamMask(tex, getMaskCenter(), getMaskSize());
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
            applyTreeWindShader(gltf.scene);
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
                    console.log('🌳 Tree mesh found:', {
                        name: child.name,
                        position: { x: mesh.position.x.toFixed(2), y: mesh.position.y.toFixed(2), z: mesh.position.z.toFixed(2) },
                        materialName: mesh.material?.name || 'unnamed',
                        vertexCount: mesh.geometry?.attributes?.position?.count || 0,
                        boundingBoxY: bbox ? { min: bbox.min.y.toFixed(2), max: bbox.max.y.toFixed(2) } : 'N/A'
                    });
                    // Try to identify leaves by name (common naming conventions)
                    const name = child.name.toLowerCase();
                    if (name.includes('leaf') || name.includes('leaves') || name.includes('frond') || name.includes('palm') && !name.includes('trunk')) {
                        treeLeaves.push(child);
                        console.log('  ↳ Identified as LEAF');
                    }
                }
            });
            // If no leaves found by name, use all meshes except the lowest one (trunk)
            if (treeLeaves.length === 0) {
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
                        treeLeaves.push(meshes[i]);
                    }
                    console.log('Auto-detected', treeLeaves.length, 'tree leaf meshes');
                } else if (meshes.length === 1) {
                    // Only one mesh, animate the whole thing
                    treeLeaves.push(meshes[0]);
                    console.log('Single mesh tree, animating entire model');
                }
            }
            tree.add(gltf.scene);
            tree.position.set(
                islandPosition.x + treeOffset.x,
                islandPosition.y + treeOffset.y,
                islandPosition.z + treeOffset.z
            );
            tree.scale.setScalar(treeScale);
            tree.rotation.y = treeRotY;

            // Collect tree trunk meshes for physics collisions
            tree.updateMatrixWorld(true);
            tree.traverse((child) => {
                if ((child as any).isMesh) treeTrunkMeshes.push(child as Mesh);
            });
            // Register with physics world (may trigger rebuild if world already exists)
            registerTreeMeshes(treeTrunkMeshes);
            console.log('Tree loaded with ocean lighting');
        },
        (progress) => {
            console.log('Tree loading:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => {
            console.error('Error loading tree:', error);
        }
    );

    // Load three tweakable bushes. Content is lifted so each group's Y value
    // remains the floor contact point for debug tuning.
    loader.load(
        'models/surface/bush.glb',
        (gltf) => {
            const configs = [
                { group: bush,      offset: bushOffset,      scale: bushScale,      rotY: bushRotY,      flowerColor: bushFlowerConfig.main,  label: 'Bush' },
                { group: bushRadio, offset: bushRadioOffset, scale: bushRadioScale, rotY: bushRadioRotY, flowerColor: bushFlowerConfig.radio, label: 'Radio bush' },
                { group: bushRadio2, offset: bushRadio2Offset, scale: bushRadio2Scale, rotY: bushRadio2RotY, flowerColor: bushFlowerConfig.radio2, label: 'Radio bush 2' },
                { group: bushPug,   offset: bushPugOffset,   scale: bushPugScale,   rotY: bushPugRotY,   flowerColor: bushFlowerConfig.pug,   label: 'Pug bush' },
            ] as const;

            for (const cfg of configs) {
                const bushScene = gltf.scene.clone(true) as Group;
                bushScene.traverse((child) => {
                    if ((child as any).isMesh && (child as any).material) {
                        const mesh = child as Mesh;
                        if (Array.isArray(mesh.material)) {
                            mesh.material = mesh.material.map((mat) => mat.clone());
                        } else {
                            mesh.material = mesh.material.clone();
                        }
                        child.castShadow = true;
                        (child as any).receiveShadow = true;
                    }
                });
                applyBushWindShader(bushScene, cfg.flowerColor);

                const contentGroup = new Group();
                contentGroup.add(bushScene);
                const box = new Box3().setFromObject(bushScene);
                contentGroup.position.y = -box.min.y;
                cfg.group.add(contentGroup);
                cfg.group.position.set(
                    islandPosition.x + cfg.offset.x,
                    islandPosition.y + cfg.offset.y,
                    islandPosition.z + cfg.offset.z
                );
                cfg.group.scale.setScalar(cfg.scale);
                cfg.group.rotation.y = cfg.rotY;
                console.log(`${cfg.label} loaded`);
            }
        },
        undefined,
        (error) => { console.error('Error loading bush:', error); }
    );

    // ── Procedural grass ──────────────────────────────────────────────────────
    // Scattered over the full island surface (1 draw call, raycasted Y per blade).
    // Deferred until island mesh is ready for raycasting validation.
    waitForIslandMeshes(() => {
        // Create shared Perlin noise texture for wind
        _perlinTexture = createPerlinTexture();

        // ── Scatter spawn points across the full island surface ─────────
        _grassSpawnPoints = [];
        for (let i = 0; i < GRASS_COUNT; i++) {
            for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
                const wx = SPAWN_BBOX.xMin + Math.random() * (SPAWN_BBOX.xMax - SPAWN_BBOX.xMin);
                const wz = SPAWN_BBOX.zMin + Math.random() * (SPAWN_BBOX.zMax - SPAWN_BBOX.zMin);
                if (!isValidSpawnPos(wx, wz, foliageSpawnPlaced)) continue;
                foliageSpawnPlaced.push({ x: wx, z: wz });
                _grassSpawnPoints.push({ x: wx, z: wz, y: getSurfaceY(wx, wz), edgeFactor: computeEdgeFactor(wx, wz) });
                break;
            }
        }

        // ── Create grass uniforms (shared with existing scene uniforms) ─
        _grassUniforms = {
            uWindTime:       treeWindTimeUniform,
            uWindStrength:   foliageWindStrengthUniform,
            uWobbleStrength: grassWobbleStrengthUniform,
            uNoiseTexture:   new Uniform(_perlinTexture),
            uNoiseScale:    new Uniform(0.5),
            uMouseWorldPos: mouseWorldPos,
            uMouseRadius:   mouseInfluenceRadius,
            uMouseStrength: mouseInfluenceStrength,
            uLight:         lightUniform,
            uAbsorption:    oceanAbsorptionUniform,
            uSunVisibility: sunVisibilityUniform,
            uFogDist:       underwaterFogDistUniform,
            uYOffset:       new Uniform(grassYOffset),
        };

        proceduralGrassMesh = createGrassMesh(_grassSpawnPoints, GRASS_Y, _grassUniforms, oceanLightingPars, oceanLightingFragment, { minEdgeScale: grassMinEdgeScale, bladeHeight: grassMaxHeight });
        threeScene.add(proceduralGrassMesh);
        console.log(`[ProceduralGrass] ${_grassSpawnPoints.length} spawn points → ${_grassSpawnPoints.length * 40} blades (1 draw call)`);

        buildShadowFloor(_grassSpawnPoints);

        _grassLoaded = true;
    });

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

            // Register radio meshes as physics colliders
            radio.updateMatrixWorld(true);
            const radioMeshes: Mesh[] = [];
            radio.traverse((child) => {
                if ((child as any).isMesh) radioMeshes.push(child as Mesh);
            });
            registerExtraStaticMeshes(radioMeshes);
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

    // Load custom tent to the right of the palm tree
    loader.load(
        'models/surface/custom_tent.glb',
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

    // Dark entrance shade — an unlit plane over the tent opening so the interior
    // can't be seen from outside (day or night). MeshBasicMaterial ignores scene
    // lights, so it stays the same dark tone regardless of time of day. Faded out
    // while inside (see Update). Added straight to the scene like the phone.
    cabanaShadeMat = new MeshBasicMaterial({
        color: cabanaShadeColor,
        transparent: true,
        opacity: cabanaShadeOpacity,
        depthWrite: false,   // don't pollute the foam depth target / occlude oddly
        side: DoubleSide,    // visible whichever way the camera approaches
        fog: false,
    });
    cabanaShade = new Mesh(new PlaneGeometry(cabanaShadeWidth, cabanaShadeHeight), cabanaShadeMat);
    cabanaShade.position.set(
        islandPosition.x + cabanaShadeX,
        islandPosition.y + cabanaShadeY,
        islandPosition.z + cabanaShadeZ,
    );
    cabanaShade.rotation.y = cabanaShadeRotY;
    cabanaShade.renderOrder = 2;  // draw after opaque interior so it actually hides it
    threeScene.add(cabanaShade);

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

    // Moss rocks scattered around the island in the water. Each rock gets the
    // apple-style waterline shader so a foam line is drawn exactly where the
    // mesh crosses the ocean surface — independent of placement.
    _loadMossRock('models/surface/moss_rock1.glb',  mossRock1,  mossRock1Offset,  mossRock1Scale,  mossRock1Rot);
    _loadMossRock('models/surface/moss_rock1.glb',  mossRock2a, mossRock2aOffset, mossRock2aScale, mossRock2aRot);
    _loadMossRock('models/surface/moss_rock1.glb',  mossRock2b, mossRock2bOffset, mossRock2bScale, mossRock2bRot);
    _loadMossRock('models/surface/moss_rock3.glb',  mossRock3a, mossRock3aOffset, mossRock3aScale, mossRock3aRot);
    _loadMossRock('models/surface/moss_rock3.glb',  mossRock3b, mossRock3bOffset, mossRock3bScale, mossRock3bRot);
    _loadMossRock('models/surface/moss_rock3.glb',  mossRock3c, mossRock3cOffset, mossRock3cScale, mossRock3cRot);

    // ── Extra surface props (tent interior) ───────────────────────────────────
    _loadSurfaceProp('models/surface/folding_tray_table.glb',  foldingTrayTable, foldingTrayTableOffset, foldingTrayTableScale, foldingTrayTableRot);
    _loadSurfaceProp('models/surface/dog_bed.glb',             tentDogBed,       tentDogBedOffset,       tentDogBedScale,       tentDogBedRot);
    _loadSurfaceProp('models/surface/rug_round.glb',           rugRound,         rugRoundOffset,         rugRoundScale,         rugRoundRot);
    _loadSurfaceProp('models/surface/lantern.glb',             lantern,          lanternOffset,          lanternScale,          lanternRot);
    _loadSurfaceProp('models/surface/dog_bowl.glb',            dogBowl,          dogBowlOffset,          dogBowlScale,          dogBowlRot);
    _loadSurfaceProp('models/surface/dog_biscuit.glb',         dogBiscuit,       dogBiscuitOffset,       dogBiscuitScale,       dogBiscuitRot);

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

    // Load treasure chest model (underwater, among coral rocks)
    loader.load(
        'models/overall/gold_chest.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            chest.add(gltf.scene);
            chest.position.set(
                sfDecorConfig.chest.x,
                sfDecorConfig.chest.y,
                sfDecorConfig.chest.z
            );
            chest.scale.setScalar(sfDecorConfig.chest.scale);
            chest.rotation.set(sfDecorConfig.chest.rx, sfDecorConfig.chest.ry, sfDecorConfig.chest.rz);

            // Setup animations: gold_chest [1] = open, [0] = close  (both LoopOnce, clamp at end)
            if (gltf.animations.length > 0) {
                chestMixer = new AnimationMixer(gltf.scene);
                if (gltf.animations.length >= 2) {
                    chestOpenAction = chestMixer.clipAction(gltf.animations[1]);
                    chestOpenAction.setLoop(LoopOnce, 1);
                    chestOpenAction.clampWhenFinished = true;
                    chestOpenAction.timeScale = 0.5;   // half-speed for a slower, weighty open
                }
                if (gltf.animations.length >= 1) {
                    chestCloseAction = chestMixer.clipAction(gltf.animations[0]);
                    chestCloseAction.setLoop(LoopOnce, 1);
                    chestCloseAction.clampWhenFinished = true;
                }
            }

            // Interior glow light — smoothly animates to target intensity on open/close
            chestGlowLight = new PointLight(0xFFCC33, 0, sfDecorConfig.chestGlowDistance);
            chestGlowLight.position.set(
                sfDecorConfig.chestGlowX,
                sfDecorConfig.chestGlowY,
                sfDecorConfig.chestGlowZ
            );
            chest.add(chestGlowLight);
            _buildChestRays();

            console.log('Chest loaded with ocean lighting (' + gltf.animations.length + ' animations)');
            // Load extra coins (blue, black, white) placed inside the chest.
            // coin.glb has two material primitives:
            //   "Yellow"     = outer ring + raised star (one combined mesh)
            //   "DarkYellow" = flat inner circle disc
            const coinCfgs = [
                sfDecorConfig.chestCoin1,
                sfDecorConfig.chestCoin2,
                sfDecorConfig.chestCoin3,
            ];
            loader.load(
                'models/overall/coin.glb',
                (coinGltf) => {
                    for (let ci = 0; ci < 3; ci++) {
                        const coinScene = coinGltf.scene.clone(true);
                        const cfg = coinCfgs[ci];
                        _applyChestCoinColor(coinScene as Group, ci);
                        applyOceanLightingToModel(coinScene as Group);
                        coinScene.position.set(cfg.x, cfg.y, cfg.z);
                        coinScene.scale.setScalar(0);  // start hidden; spring reveals on open
                        coinScene.rotation.set(cfg.rx, cfg.ry, cfg.rz);
                        chest.add(coinScene);
                        _chestCoins.push(coinScene as Group);
                        _coinCurrentScales.push(0);
                        _coinVelocities.push(0);
                        _coinTargetScales.push(0);
                        _coinRevealTimers.push(-1);
                    }
                },
                undefined,
                (err) => console.warn('[Chest] Failed to load coin.glb:', err)
            );
        },
        undefined,
        (error) => { console.error('Error loading chest:', error); }
    );

    // ── Apples — three independent instances near the palm tree ──────────────
    const appleConfigs = [
        { group: apple1, offset: apple1Offset, scale: apple1Scale, rotY: apple1RotY, label: 'apple1' },
        { group: apple2, offset: apple2Offset, scale: apple2Scale, rotY: apple2RotY, label: 'apple2' },
        { group: apple3, offset: apple3Offset, scale: apple3Scale, rotY: apple3RotY, label: 'apple3' },
    ] as const;
    loader.load(
        'models/surface/apple.glb',
        (gltf) => {
            for (const cfg of appleConfigs) {
                const clone = gltf.scene.clone(true);
                applyOceanLightingToModel(clone);
                // Deep-clone materials so golden tint on one apple doesn't affect others
                clone.traverse((child) => {
                    if ((child as any).isMesh) {
                        const mesh = child as Mesh;
                        if (Array.isArray(mesh.material)) {
                            mesh.material = mesh.material.map((m) => m.clone());
                        } else if (mesh.material) {
                            mesh.material = mesh.material.clone();
                        }
                        child.castShadow = true;
                        (child as any).receiveShadow = true;
                    }
                });
                // Wrap clone in an inner group offset downward so cfg.group's
                // local Y=0 sits at the TOP of the apple (stem attachment point).
                // Rotating cfg.group then swings the apple from the top, like a pendulum.
                const contentGroup = new Group();
                contentGroup.add(clone);
                const box = new Box3().setFromObject(clone);
                contentGroup.position.y = -box.max.y; // pull content down so top aligns with pivot
                cfg.group.add(contentGroup);
                cfg.group.position.set(
                    islandPosition.x + cfg.offset.x,
                    islandPosition.y + cfg.offset.y,
                    islandPosition.z + cfg.offset.z,
                );
                cfg.group.scale.setScalar(cfg.scale);
                cfg.group.rotation.y = cfg.rotY;
                threeScene.add(cfg.group);
                console.log(`${cfg.label} loaded`);
            }
            // Cache original positions for respawn
            const appleGroups = [apple1, apple2, apple3];
            for (let i = 0; i < 3; i++) {
                appleStates[i].originalPos.copy(appleGroups[i].position);
                appleStates[i].originalRotY = appleGroups[i].rotation.y;
                appleStates[i].originalScale = appleGroups[i].scale.x;

                // Cache bounding box for golden Y cutoff, then pre-bake golden materials
                appleGroups[i].updateMatrixWorld(true);
                _appleBBoxes[i] = new Box3().setFromObject(appleGroups[i]);
                _appleBBoxes[i].getCenter(_appleVisualCenterOffsets[i]);
                _appleVisualCenterOffsets[i].sub(appleGroups[i].position);
                _prebakeGoldenMaterials(appleGroups[i], i);
            }
            _initGroundAppleVisualPool(appleGroups);
        },
        undefined,
        (error) => { console.error('Error loading apple.glb:', error); }
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

    // Setup cabana (tent) click/hover interaction → zoom into the interior
    setupCabanaInteraction();

    // Setup chest click/hover interaction (underwater)
    setupChestInteraction();

    // Setup coin hover/tap tooltips
    setupCoinInteraction();

    // Setup apple click/hover interaction
    setupAppleInteraction();

    // Init cannon-es physics world for falling apples (after island meshes are ready)
    waitForIslandMeshes(() => {
        initPhysicsWorld(islandMeshes, treeTrunkMeshes);
        initAppleBodyPool(MAX_GROUND_APPLES);
    });
}

// ── Apple click/hover interaction ───────────────────────────────────────────
function setupAppleInteraction(): void {
    const canvas = renderer.domElement;
    if (!canvas) return;
    const appleGroups = [apple1, apple2, apple3];

    const onAppleClick = (clientX: number, clientY: number) => {
        if (_suppressNextAppleClick) {
            _suppressNextAppleClick = false;
            return;
        }
        if (camera.position.y < UNDERWATER_Y_THRESHOLD) return;
        if (isPugZoomActive() || isRadioZoomActive() || isPhoneZoomActive() || isChestZoomActive()) return;

        appleMouse.x = (clientX / window.innerWidth) * 2 - 1;
        appleMouse.y = -(clientY / window.innerHeight) * 2 + 1;
        appleRaycaster.setFromCamera(appleMouse, camera);

        for (let i = 0; i < 3; i++) {
            const st = appleStates[i];
            if (st.hidden || st.respawning) continue;
            if (appleGroups[i].children.length === 0) continue;
            const hits = appleRaycaster.intersectObjects(appleGroups[i].children, true);
            if (hits.length > 0 || _appleInTouchRadius(appleGroups[i])) {
                st.clickCount++;
                _playAppleImpactAudio();
                _spawnAppleImpactBurst(i);

                // Apply angular impulse away from camera
                const appleWorldPos = appleGroups[i].getWorldPosition(new Vector3());
                const awayX = appleWorldPos.x - camera.position.x;
                const awayZ = appleWorldPos.z - camera.position.z;
                const awayLen = Math.sqrt(awayX * awayX + awayZ * awayZ) || 1;
                st.angVelX += (-awayZ / awayLen) * appleClickImpulse;
                st.angVelZ += ( awayX / awayLen) * appleClickImpulse;
                if (st.clickCount >= APPLE_CLICK_COUNT_TO_FALL) {
                    triggerAppleFall(i);
                }
                break; // only one apple per click
            }
        }
    };

    canvas.addEventListener('click', (e: MouseEvent) => { onAppleClick(e.clientX, e.clientY); });
    canvas.addEventListener('touchend', (e: TouchEvent) => {
        if (_touchWasMulti || _touchDragged) return;
        if (_groundAppleDrag.active || _suppressNextAppleClick) return;
        if (e.changedTouches.length > 0) {
            const t = e.changedTouches[0];
            onAppleClick(t.clientX, t.clientY);
        }
    });

    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
        if (isMobile) return;   // Apple drag is desktop-only — taps on mobile still trigger the fall click handler
        if (_groundAppleDrag.active) return;
        if (isPugZoomActive() || isRadioZoomActive() || isPhoneZoomActive() || isChestZoomActive()) return;
        const ga = _findGroundAppleAtPointer(e.clientX, e.clientY);
        if (!ga) return;

        _setAppleRayFromClient(e.clientX, e.clientY);
        _groundAppleDragPlane.set(new Vector3(0, 0, 1), -ga.clone.position.z);
        if (!appleRaycaster.ray.intersectPlane(_groundAppleDragPlane, _groundAppleDragPoint)) return;

        _groundAppleDrag.active = true;
        _groundAppleDrag.pointerId = e.pointerId;
        _groundAppleDrag.apple = ga;
        _groundAppleDrag.moved = false;
        _groundAppleDrag.startX = e.clientX;
        _groundAppleDrag.startY = e.clientY;
        _groundAppleDragOffset.copy(ga.clone.position).sub(_groundAppleDragPoint);
        _groundAppleDragOffset.z = 0;
        ga.dragged = true;
        _dragTargetValid = false;

        // Keep body DYNAMIC so collisions are respected during drag.
        ga.physicsBody.velocity.setZero();
        ga.physicsBody.angularVelocity.setZero();
        ga.physicsBody.wakeUp();
        canvas.setPointerCapture?.(e.pointerId);
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
    });

    canvas.addEventListener('pointermove', (e: PointerEvent) => {
        if (!_groundAppleDrag.active || e.pointerId !== _groundAppleDrag.pointerId) return;
        const dx = e.clientX - _groundAppleDrag.startX;
        const dy = e.clientY - _groundAppleDrag.startY;
        if (Math.sqrt(dx * dx + dy * dy) > 3) {
            _groundAppleDrag.moved = true;
            _touchDragged = true;
        }
        _moveDraggedAppleToClient(e.clientX, e.clientY);
        e.preventDefault();
    });

    const finishPointerDrag = (e: PointerEvent) => {
        if (!_groundAppleDrag.active || e.pointerId !== _groundAppleDrag.pointerId) return;
        canvas.releasePointerCapture?.(e.pointerId);
        canvas.style.cursor = isAppleHovered ? 'pointer' : '';
        _endGroundAppleDrag();
        e.preventDefault();
    };
    canvas.addEventListener('pointerup', finishPointerDrag);
    canvas.addEventListener('pointercancel', finishPointerDrag);

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        if (camera.position.y < UNDERWATER_Y_THRESHOLD) {
            if (isAppleHovered) { isAppleHovered = false; canvas.style.cursor = ''; }
            return;
        }
        appleMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        appleMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        appleRaycaster.setFromCamera(appleMouse, camera);
        let anyHit = false;
        for (let i = 0; i < 3; i++) {
            if (appleStates[i].hidden || appleStates[i].respawning) continue;
            if (appleGroups[i].children.length === 0) continue;
            if (appleRaycaster.intersectObjects(appleGroups[i].children, true).length > 0) {
                anyHit = true; break;
            }
        }
        if (anyHit) {
            if (!isAppleHovered) { isAppleHovered = true; canvas.style.cursor = 'pointer'; }
        } else {
            if (isAppleHovered) { isAppleHovered = false; canvas.style.cursor = ''; }
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isAppleHovered) { isAppleHovered = false; canvas.style.cursor = ''; }
    });
}

function triggerAppleFall(index: number): void {
    const appleGroups = [apple1, apple2, apple3];
    const group = appleGroups[index];
    const st = appleStates[index];

    // Get world position before cloning
    const worldPos = new Vector3();
    group.getWorldPosition(worldPos);

    const slot = _acquireGroundAppleSlot();
    if (!slot) return;
    slot.inUse = true;

    const clone = slot.group;
    const visualCenter = worldPos.clone().add(_appleVisualCenterOffsets[index]);
    clone.position.copy(visualCenter);
    clone.rotation.set(0, st.originalRotY, 0);
    clone.scale.setScalar(st.originalScale);
    clone.visible = true;
    _setGroundSlotGolden(slot, _isGolden[index]);

    // Create physics body at the visual center of the apple fruit
    let body: Body;
    try {
        body = addAppleBody(visualCenter);
    } catch {
        slot.inUse = false;
        clone.visible = false;
        return;
    }

    const wasGolden = _isGolden[index];
    const ga: GroundApple = { clone, physicsBody: body, slot, fading: false, fadeAlpha: 1, landed: false, treeIndex: index, respawnTimer: appleRespawnDelay, respawnTriggered: false, isGolden: wasGolden, dragged: false, stuckFrames: 0 };
    groundApples.push(ga);

    // If the tree apple was golden, transfer the pooled light to the ground clone
    if (wasGolden) {
        const grp = [apple1, apple2, apple3][index];
        _releaseGoldenLight(grp);
        _acquireGoldenLight(clone);
    }

    // Pooled physics bodies keep one stable listener; point it at this visual.
    (body as any).__groundApple = ga;

    // Evict oldest ground apples if over the limit
    let groundCount = 0;
    for (const g of groundApples) if (!g.fading) groundCount++;
    while (groundCount > MAX_GROUND_APPLES) {
        for (const g of groundApples) {
            if (!g.fading) { g.fading = true; groundCount--; break; }
        }
    }

    // Hide the tree apple until the ground clone lands + delay elapses
    _removeGoldenTint(index); // clear any golden tint before hiding
    st.clickCount = 0;
    st.angleX = 0; st.angleZ = 0;
    st.angVelX = 0; st.angVelZ = 0;
    st.hidden = true;
    group.scale.setScalar(0.001);
}

// ── Multi-touch gesture tracker ─────────────────────────────────────────────
// Tracks whether 2+ fingers were active (multi-touch), or single finger dragged
// significantly — both prevent tap interactions from firing on finger lift.
let _touchWasMulti  = false;
let _touchDragged   = false;
let _touchStartX    = 0;
let _touchStartY    = 0;
const _TOUCH_DRAG_THRESHOLD_PX = 10;

function _setupMultiTouchTracker(): void {
    const canvas = renderer.domElement;
    canvas.addEventListener('touchstart', (e: TouchEvent) => {
        if (e.touches.length >= 2) _touchWasMulti = true;
        if (e.touches.length === 1) {
            _touchStartX  = e.touches[0].clientX;
            _touchStartY  = e.touches[0].clientY;
            _touchDragged = false;
        }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e: TouchEvent) => {
        if (!_touchWasMulti && e.touches.length === 1) {
            const dx = e.touches[0].clientX - _touchStartX;
            const dy = e.touches[0].clientY - _touchStartY;
            if (Math.sqrt(dx * dx + dy * dy) > _TOUCH_DRAG_THRESHOLD_PX) _touchDragged = true;
        }
    }, { passive: true });
    canvas.addEventListener('touchend', (e: TouchEvent) => {
        if (e.touches.length === 0) { _touchWasMulti = false; _touchDragged = false; }
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
    
    // Raycast against island surface only (procedural grass has no individual meshes)
    const targets: Object3D[] = [island];
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
            replies: [
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
            ],
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
                        sound: '/audio/character/pug/freesound_community-pug-woof-2-103762_PRIMEIRA.mp3',
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
        sound: '/audio/character/pug/freesound_community-pug-woof-2-103762_PRIMEIRA.mp3',
        onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
    },
    {
        textKey: 'pug.dialog.1',
        sound: '/audio/character/pug/freesound_community-pug-woof-2-103762_SEGUNDA.mp3',
        onLineStart: () => playPugAnimationThenReturn(PUG_ANIM_BARK),
        replies: [
            {
                textKey: 'pug.reply.hi',
                onSelect: () => {
                    // "hi" → pug responds "what?" → "hey..." → "what's up?" then 3 reply options
                    showDialog([
                        {
                            textKey: 'pug.reply.response.hi.day',
                            sound: '/audio/character/pug/freesound_community-pug-woof-2-103762_PRIMEIRA.mp3',
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

        // The phone zoom is the INNER level — only reachable from inside the
        // cabana. From outside the phone is hidden by the shade and not zoomable.
        if (!isCabanaZoomActive()) return;

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
        if (_touchWasMulti || _touchDragged) return;
        if (e.changedTouches.length > 0) {
            const touch = e.changedTouches[0];
            onPhoneClick(touch.clientX, touch.clientY);
        }
    });

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        // Only show the phone hover cursor while inside the cabana (the phone is
        // only zoomable from there).
        if (!phone.visible || phone.children.length === 0 || !isCabanaZoomActive()
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

// ============================================
// CABANA (TENT) CLICK/HOVER INTERACTION
// ============================================
const cabanaRaycaster = new Raycaster();
const cabanaMouse = new Vector2();
let isCabanaHovered = false;

function setupCabanaInteraction(): void {
    const canvas = renderer.domElement;
    if (!canvas) return;

    const onCabanaClick = (clientX: number, clientY: number) => {
        if (tent.children.length === 0) return;             // not loaded yet
        if (camera.position.y < UNDERWATER_Y_THRESHOLD) return;  // above water only
        // Ignore while any zoom is already active (incl. already inside the cabana).
        if (isPugZoomActive() || isRadioZoomActive() || isPhoneZoomActive()
            || isChestZoomActive() || isCabanaZoomActive()) return;

        cabanaMouse.x = (clientX / window.innerWidth) * 2 - 1;
        cabanaMouse.y = -(clientY / window.innerHeight) * 2 + 1;
        cabanaRaycaster.setFromCamera(cabanaMouse, camera);
        const intersects = cabanaRaycaster.intersectObjects(tent.children, true);
        if (intersects.length > 0) {
            isCabanaHovered = false;
            canvas.style.cursor = '';
            zoomToCabana();
        }
    };

    canvas.addEventListener('click', (e: MouseEvent) => {
        onCabanaClick(e.clientX, e.clientY);
    });

    canvas.addEventListener('touchend', (e: TouchEvent) => {
        if (_touchWasMulti || _touchDragged) return;  // was a scroll gesture — skip click
        if (e.changedTouches.length > 0) {
            const touch = e.changedTouches[0];
            onCabanaClick(touch.clientX, touch.clientY);
        }
    });

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        if (tent.children.length === 0 || camera.position.y < UNDERWATER_Y_THRESHOLD
            || isPugZoomActive() || isRadioZoomActive() || isPhoneZoomActive()
            || isChestZoomActive() || isCabanaZoomActive()) {
            if (isCabanaHovered) { isCabanaHovered = false; canvas.style.cursor = ''; }
            return;
        }
        cabanaMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        cabanaMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        cabanaRaycaster.setFromCamera(cabanaMouse, camera);
        const intersects = cabanaRaycaster.intersectObjects(tent.children, true);
        if (intersects.length > 0) {
            if (!isCabanaHovered) { isCabanaHovered = true; canvas.style.cursor = 'pointer'; }
        } else {
            if (isCabanaHovered) { isCabanaHovered = false; canvas.style.cursor = ''; }
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isCabanaHovered) { isCabanaHovered = false; canvas.style.cursor = ''; }
    });
}

// ── Chest ray beam helpers (Zelda-style glow rays) ────────────────────────────
function _makeRayTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    // Top of canvas (y=0) → UV v=1 → TOP of plane = transparent
    // Bottom of canvas (y=127) → UV v=0 → BOTTOM of plane = bright gold
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0,    'rgba(255, 215, 30, 0)');
    grad.addColorStop(0.45, 'rgba(255, 210, 20, 0.45)');
    grad.addColorStop(1,    'rgba(255, 235, 70, 0.9)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 128);
    // Horizontal taper: fade left/right edges to transparent
    const imageData = ctx.getImageData(0, 0, 32, 128);
    const data = imageData.data;
    for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 32; x++) {
            const t = x / 31;
            const dist = Math.abs(t - 0.5) * 2; // 0 at center, 1 at edges
            const mask = 1.0 - dist * dist; // smooth falloff
            const idx = (y * 32 + x) * 4;
            data[idx + 3] = Math.round(data[idx + 3] * mask);
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return new CanvasTexture(canvas);
}

function _buildChestRays(): void {
    const group = new Group();
    _chestRayGroup = group;
    const tex = _makeRayTexture();
    const COUNT  = 8;
    const RAY_W  = 0.30;   // narrow beam width
    const RAY_H  = 3.5;    // beam height
    const RING_R = sfDecorConfig.chestRayRadius;  // configurable XZ offset
    const baseY  = 0.2;    // start just above chest floor
    const centerY = baseY + RAY_H * 0.5;
    for (let i = 0; i < COUNT; i++) {
        const mat = new MeshBasicMaterial({
            map: tex,
            transparent: true,
            blending: AdditiveBlending,
            depthWrite: false,
            side: DoubleSide,
            opacity: 0,
        });
        _chestRayMats.push(mat);
        const plane = new Mesh(new PlaneGeometry(RAY_W, RAY_H), mat);
        const angle = (i / COUNT) * Math.PI * 2;
        plane.position.set(
            Math.sin(angle) * RING_R,
            centerY,
            Math.cos(angle) * RING_R
        );
        // Tilt each plane outward ~12° so they lean away from center
        plane.rotation.y = angle;
        plane.rotation.x = -0.21;  // slight backward lean for a 'cone' effect
        group.add(plane);
    }
    chest.add(group);
}

// ── Chest interaction (underwater) ──────────────────────────────────────────
const chestRaycaster = new Raycaster();
const chestMouse = new Vector2();
let isChestHovered = false;

function _chestRayHit2(clientX: number, clientY: number): boolean {
    if (chest.children.length === 0) return false;
    chestMouse.x = (clientX / window.innerWidth) * 2 - 1;
    chestMouse.y = -(clientY / window.innerHeight) * 2 + 1;
    chestRaycaster.setFromCamera(chestMouse, camera);
    return chestRaycaster.intersectObjects(chest.children, true).length > 0;
}

function _hitAnyCoin(clientX: number, clientY: number): boolean {
    if (_chestCoins.length === 0) return false;
    _coinMouse.x =  (clientX / window.innerWidth)  * 2 - 1;
    _coinMouse.y = -(clientY / window.innerHeight) * 2 + 1;
    _coinRaycaster.setFromCamera(_coinMouse, camera);
    for (let i = 0; i < _chestCoins.length; i++) {
        if (_coinCurrentScales[i] < 0.05) continue;
        if (_coinRaycaster.intersectObjects(_chestCoins[i].children, true).length > 0) return true;
    }
    return false;
}

// ── Chest audio ───────────────────────────────────────────────────────────────

/** How many milliseconds before chestCloseAction starts the reversed sound begins.
 *  Increase to hear more of the sound synced with the lid movement. */
const CHEST_CLOSE_SOUND_LEAD_MS = 100;

/** Fraction (0–1) of the reversed audio to play on close.
 *  1.0 = full clip; 0.6 = stop at 60% of the reversed buffer's length. */
const CHEST_CLOSE_SOUND_CUTOFF_RATIO = 0.60;

function _playChestSound(reverse: boolean): void {
    if (reverse) {
        playChestCloseSound(CHEST_CLOSE_SOUND_CUTOFF_RATIO);
    } else {
        playChestOpenSound();
    }
}

/** How many milliseconds after the open animation starts before the glow light fades in.
 *  Tune to match the moment the lid actually swings open. */
const CHEST_GLOW_DELAY_MS = 700;
let _coinRevealTimeoutId: number | null = null;
let _coinHideTimeoutId: number | null = null;

function _clearCoinRevealTimeout(): void {
    if (_coinRevealTimeoutId === null) return;
    clearTimeout(_coinRevealTimeoutId);
    _coinRevealTimeoutId = null;
}

function _clearCoinHideTimeout(): void {
    if (_coinHideTimeoutId === null) return;
    clearTimeout(_coinHideTimeoutId);
    _coinHideTimeoutId = null;
}

function openChest(): void {
    if (chestIsOpen || !chestOpenAction) return;
    chestIsOpen = true;
    _clearCoinRevealTimeout();
    _clearCoinHideTimeout();
    // Delay glow so it activates when the lid is actually open, not at the start of the animation
    _chestGlowReady = false;
    setTimeout(() => {
        if (!chestIsOpen) return;
        _chestGlowReady  = true;
        _chestGlowTarget = sfDecorConfig.chestGlowIntensity;
    }, CHEST_GLOW_DELAY_MS);
    // Collapse any coins that may still be visible (e.g. re-open after partial close)
    for (let i = 0; i < _coinRevealTimers.length; i++) _coinRevealTimers[i] = -1;
    // Start revealing coins partway through the lid animation (not waiting for full finish)
    const STAGGER = 0.12; // seconds between each coin pop
    _coinRevealTimeoutId = window.setTimeout(() => {
        _coinRevealTimeoutId = null;
        if (!chestIsOpen) return; // chest was closed before timer fired
        for (let i = 0; i < _chestCoins.length; i++) {
            _coinRevealTimers[i] = i * STAGGER;
        }
    }, Math.max(0, sfDecorConfig.chestCoinRevealDelay) * 1000);
    if (chestCloseAction) { chestCloseAction.stop(); }
    chestOpenAction.reset();
    chestOpenAction.play();
    _playChestSound(false);
}

function closeChest(): void {
    if (!chestIsOpen || !chestCloseAction) return;
    chestIsOpen      = false;
    _clearCoinRevealTimeout();
    _clearCoinHideTimeout();
    _chestGlowReady  = false;
    _chestGlowTarget = 0;
    _selectedCoinIdx = -1;
    // Cancel pending reveals immediately, then keep visible coins around until
    // the lid has closed enough for them to scale down behind it.
    for (let i = 0; i < _coinRevealTimers.length; i++) _coinRevealTimers[i] = -1;
    _coinHideTimeoutId = window.setTimeout(() => {
        _coinHideTimeoutId = null;
        if (chestIsOpen) return;
        for (let i = 0; i < _coinTargetScales.length; i++) {
            _coinTargetScales[i] = 0;
        }
    }, Math.max(0, sfDecorConfig.chestCoinHideDelay) * 1000);
    // Fire the reversed sound CHEST_CLOSE_SOUND_LEAD_MS before the animation
    // starts so the audio lines up better with the lid movement.
    // Keep chestOpenAction running (clamped at end) until the close animation
    // takes over — stopping it early snaps the chest to its default pose.
    _playChestSound(true);
    const _closeAction = chestCloseAction;
    setTimeout(() => {
        if (chestIsOpen) return; // re-opened before timer fired
        if (chestOpenAction) { chestOpenAction.stop(); }
        _closeAction.reset();
        _closeAction.play();
    }, CHEST_CLOSE_SOUND_LEAD_MS);
}

function setupChestInteraction(): void {
    const canvas = renderer.domElement;
    if (!canvas) return;

    const onChestClick = (clientX: number, clientY: number) => {
        if (chest.children.length === 0) return;
        // Only interact when underwater
        if (camera.position.y >= UNDERWATER_Y_THRESHOLD) return;
        // Ignore if another zoom is active (radio, pug, phone)
        if (isRadioZoomActive() || isPugZoomActive() || isPhoneZoomActive()) return;

        // If already zoomed into chest, click outside a coin → close + zoom out
        if (isChestZoomActive()) {
            // Check if a coin was tapped — if so, let the coin handler deal with it
            if (_hitAnyCoin(clientX, clientY)) return;
            closeChest();
            zoomOutFromChest();
            return;
        }

        // Not zoomed — check if click hit the chest
        if (_chestRayHit2(clientX, clientY)) {
            isChestHovered = false;
            canvas.style.cursor = '';
            openChest();
            setTimeout(() => zoomToChest(), 350); // slight delay so zoom starts after the lid begins to lift
        }
    };

    canvas.addEventListener('click', (e: MouseEvent) => {
        onChestClick(e.clientX, e.clientY);
    });

    canvas.addEventListener('touchend', (e: TouchEvent) => {
        if (_touchWasMulti || _touchDragged) return;
        if (e.changedTouches.length > 0) {
            const touch = e.changedTouches[0];
            onChestClick(touch.clientX, touch.clientY);
        }
    });

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        if (chest.children.length === 0
            || isChestZoomActive() || camera.position.y >= UNDERWATER_Y_THRESHOLD) {
            if (isChestHovered) { isChestHovered = false; canvas.style.cursor = ''; }
            return;
        }
        const hit = _chestRayHit2(e.clientX, e.clientY);
        if (hit) {
            if (!isChestHovered) { isChestHovered = true; canvas.style.cursor = 'pointer'; }
        } else {
            if (isChestHovered) { isChestHovered = false; canvas.style.cursor = ''; }
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isChestHovered) { isChestHovered = false; canvas.style.cursor = ''; }
    });
}

// ── Coin hover / tap interaction ─────────────────────────────────────────────

function setupCoinInteraction(): void {
    const canvas = renderer.domElement;
    if (!canvas) return;

    let _mobileJustOpened = false;

    // ── Desktop: mousemove → raycast → show/hide tooltip ──────────────────
    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        if (CoinTooltip.IS_TOUCH_DEVICE) return;
        if (_chestCoins.length === 0) return;

        _coinMouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
        _coinMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        _coinRaycaster.setFromCamera(_coinMouse, camera);

        let hit = -1;
        for (let i = 0; i < _chestCoins.length; i++) {
            if (_coinCurrentScales[i] < 0.05) continue;
            if (_coinRaycaster.intersectObjects(_chestCoins[i].children, true).length > 0) {
                hit = i;
                break;
            }
        }

        if (hit !== _hoveredCoinIdx) {
            _hoveredCoinIdx = hit;
            if (hit >= 0) {
                canvas.style.cursor = 'pointer';
                const pos = _getCoinScreenPos(hit);
                if (pos) CoinTooltip.showCoinTooltip(hit, pos.x, pos.y);
            } else {
                canvas.style.cursor = '';
                CoinTooltip.hideCoinTooltip();
            }
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (!CoinTooltip.IS_TOUCH_DEVICE && _hoveredCoinIdx >= 0) {
            _hoveredCoinIdx = -1;
            canvas.style.cursor = '';
            CoinTooltip.hideCoinTooltip();
        }
    });

    // ── Desktop: click on coin → open link directly ────────────────────────
    canvas.addEventListener('click', (e: MouseEvent) => {
        if (CoinTooltip.IS_TOUCH_DEVICE) return;
        if (_hoveredCoinIdx >= 0) {
            CoinTooltip.openCoinLink(_hoveredCoinIdx);
        }
    });

    // ── Mobile: touchend on coin → show tooltip ────────────────────────────
    canvas.addEventListener('touchend', (e: TouchEvent) => {
        if (!CoinTooltip.IS_TOUCH_DEVICE) return;
        if (_touchWasMulti || _touchDragged) return;
        if (_chestCoins.length === 0) return;
        if (e.changedTouches.length === 0) return;

        const touch = e.changedTouches[0];
        _coinMouse.x =  (touch.clientX / window.innerWidth)  * 2 - 1;
        _coinMouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
        _coinRaycaster.setFromCamera(_coinMouse, camera);

        let hit = -1;
        for (let i = 0; i < _chestCoins.length; i++) {
            if (_coinCurrentScales[i] < 0.05) continue;
            if (_coinRaycaster.intersectObjects(_chestCoins[i].children, true).length > 0) {
                hit = i;
                break;
            }
        }

        if (hit >= 0) {
            e.preventDefault();
            // Trigger bounce on newly selected coin, deselect previous
            if (_selectedCoinIdx !== hit) {
                if (_selectedCoinIdx >= 0) {
                    _coinBounceVels[_selectedCoinIdx] = 0; // stop old bounce
                }
                _selectedCoinIdx = hit;
                _coinBounceVels[hit] = 6; // kick the spring upward
            }
            const pos = _getCoinScreenPos(hit);
            if (pos) {
                _mobileJustOpened = true;
                CoinTooltip.showCoinTooltip(hit, pos.x, pos.y);
                setTimeout(() => { _mobileJustOpened = false; }, 60);
            }
        }
    }, { passive: false });

    // ── Mobile: tap outside tooltip → close ───────────────────────────────
    document.addEventListener('touchend', () => {
        if (!CoinTooltip.IS_TOUCH_DEVICE) return;
        if (_mobileJustOpened) return;
        if (CoinTooltip.isCoinTooltipVisible()) CoinTooltip.hideCoinTooltip();
    }, { capture: true });
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
        _releaseSpriteMaterial(z.sprite.material as SpriteMaterial);
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
        if (_touchWasMulti || _touchDragged) return;  // was a scroll gesture — skip click
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
        if (_touchWasMulti || _touchDragged) return;  // was a scroll gesture — skip click
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

export function Update(isUnderwater = false): void {
  _updateAppleImpacts();
  islandCampfireGroundCenterUniform.value.set(firecamp.position.x, firecamp.position.z);
  _updateGroundApples();

  // Fade the cabana entrance shade out while inside (reveals the interior) and
  // back to full when outside (hides the phone + props, day or night).
  if (cabanaShadeMat) {
      const shadeTarget = isCabanaZoomActive() ? 0 : cabanaShadeOpacity;
      cabanaShadeMat.opacity = MathUtils.damp(cabanaShadeMat.opacity, shadeTarget, 6, deltaTime);
  }

  if (!isUnderwater) {
    // Update palm tree wind shader time
    treeWindTimeUniform.value = time * TREE_WIND_SPEED;
    
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
    treeWindTimeUniform.value = windTime;
    treeWindStrengthUniform.value = TREE_WIND_STRENGTH * breezeIntensity;
    bushWindStrengthUniform.value = BUSH_WIND_STRENGTH * breezeIntensity;
    foliageWindStrengthUniform.value = foliageWindStrength * breezeIntensity;

    // ── Apple pendulum sway / fall / respawn ─────────────────────────────────
    const APPLE_PHASES = [0.00, 1.37, 2.71];
    const appleGroups  = [apple1, apple2, apple3];

    // ── Tree apples: sway + respawn spring ──────────────────────────────────
    for (let i = 0; i < 3; i++) {
        const st = appleStates[i];
        const grp = appleGroups[i];

        // Spring-damper pendulum integration. Hidden/respawning apples keep this
        // simulation warm so they scale back in already moving naturally.
        const accX = -appleSwingStiffness * st.angleX - appleSwingDamping * st.angVelX;
        const accZ = -appleSwingStiffness * st.angleZ - appleSwingDamping * st.angVelZ;
        st.angVelX += accX * deltaTime;
        st.angVelZ += accZ * deltaTime;
        st.angleX  += st.angVelX * deltaTime;
        st.angleZ  += st.angVelZ * deltaTime;

        // Wind sway layered on top
        const ph = APPLE_PHASES[i];
        const t  = windTime;
        const windAmp = 0.008 + appleWindStrength * breezeIntensity;
        const windX = (Math.sin(t * 2.3 + ph) * 0.65 + Math.sin(t * 5.1 + ph * 1.4 + 0.6) * 0.35) * windAmp;
        const windZ = (Math.sin(t * 1.9 + ph + 1.2) * 0.65 + Math.sin(t * 4.7 + ph * 2.3 + 2.0) * 0.35) * windAmp;

        grp.rotation.x = st.angleX + windX;
        grp.rotation.z = st.angleZ + windZ;

        // Hidden: waiting for ground clone to land before respawn kicks in
        if (st.hidden) {
            grp.scale.setScalar(0.001);
            continue;
        }

        // Respawn spring-scale animation
        if (st.respawning) {
            const SPRING_K = 120;
            const SPRING_D = 10;
            const target = 1.0;
            const clampedDt = Math.min(deltaTime, 0.05); // prevent overshoot on lag spikes
            const displacement = st.respawnScale - target;
            const springForce = -SPRING_K * displacement - SPRING_D * st.respawnVelocity;
            st.respawnVelocity += springForce * clampedDt;
            st.respawnScale += st.respawnVelocity * clampedDt;
            st.respawnScale = Math.min(st.respawnScale, 1.3); // hard cap
            grp.scale.setScalar(st.originalScale * Math.max(0.001, st.respawnScale));
            if (Math.abs(displacement) < 0.005 && Math.abs(st.respawnVelocity) < 0.01) {
                st.respawnScale = 1;
                st.respawning = false;
                grp.scale.setScalar(st.originalScale);
            }
        } else {
            grp.scale.setScalar(st.originalScale);
        }
    }

    // Procedural grass wind is handled entirely in the vertex shader via
    // Perlin noise texture sampling — no per-patch JS rotation needed.

    // Fire lighting on grass is now automatic via MeshStandardMaterial + PointLight
  }
    
    // Palm tree wind is handled entirely by the vertex shader (applyTreeWindShader)
    // which uses smoothstep(uLeafStartY, uLeafFullY, position.y) to only move leaves,
    // not the trunk. No JS rotation needed here.
    
  if (!isUnderwater) {
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
    
    // Update pug animation mixer — clamp delta to avoid fast-forward on frame-skips
    if (pugMixer) {
        pugMixer.update(Math.min(deltaTime, 0.1));
    }
  } // end !isUnderwater gate (wind, radio, pug mixer)

    // Update chest animation mixer
    if (chestMixer) {
        chestMixer.update(Math.min(deltaTime, 0.1));
    }
    // Animate chest glow light
    if (chestGlowLight) {
        // Keep target in sync with live config (so debug slider works).
        // Only after the delay has elapsed (_chestGlowReady) so the glow
        // doesn't fire at the very first frame of the open animation.
        if (chestIsOpen && _chestGlowReady) _chestGlowTarget = sfDecorConfig.chestGlowIntensity;
        const dt = Math.min(deltaTime, 0.1);
        chestGlowLight.intensity = MathUtils.damp(chestGlowLight.intensity, _chestGlowTarget, 4, dt);
    }
    // Animate Zelda-style ray beams using configurable max opacity
    if (_chestRayMats.length > 0) {
        const maxOp = sfDecorConfig.chestRayMaxOpacity;
        if (chestIsOpen) {
            const op = maxOp * (0.6 + 0.4 * Math.sin(time * 1.8));
            for (const m of _chestRayMats) m.opacity = op;
        } else {
            const dt = Math.min(deltaTime, 0.1);
            for (const m of _chestRayMats) {
                m.opacity = m.opacity > 0.002 ? MathUtils.damp(m.opacity, 0, 4, dt) : 0;
            }
        }
    }
    // Tick coin reveal timers and spring-animate coin scales
    if (_chestCoins.length > 0) {
        const dt = Math.min(deltaTime, 0.05);
        const SPRING_K = 160;
        const SPRING_D = 13;
        const coinCfgs = [sfDecorConfig.chestCoin1, sfDecorConfig.chestCoin2, sfDecorConfig.chestCoin3];
        for (let i = 0; i < _chestCoins.length; i++) {
            // Count down per-coin reveal timer
            if (_coinRevealTimers[i] >= 0) {
                _coinRevealTimers[i] -= deltaTime;
                if (_coinRevealTimers[i] < 0) {
                    // Timer expired — reveal this coin
                    _coinTargetScales[i] = coinCfgs[i].scale;
                }
            }
            // Spring integration
            const target = _coinTargetScales[i];
            const err    = target - _coinCurrentScales[i];
            const force  = SPRING_K * err - SPRING_D * _coinVelocities[i];
            _coinVelocities[i]    += force * dt;
            _coinCurrentScales[i] += _coinVelocities[i] * dt;
            // Snap to rest when near zero to avoid float accumulation
            if (target === 0 && Math.abs(_coinCurrentScales[i]) < 0.001 && Math.abs(_coinVelocities[i]) < 0.001) {
                _coinCurrentScales[i] = 0;
                _coinVelocities[i]    = 0;
            }
            const _hoverTarget = (_hoveredCoinIdx === i) ? 1.12 : 1.0;
            _coinHoverScales[i] += (_hoverTarget - _coinHoverScales[i]) * Math.min(1, deltaTime * 12);

            // Mobile bounce spring (selected coin pops up then settles)
            const BOUNCE_K = 120;
            const BOUNCE_D = 8;
            const bounceTarget = (_selectedCoinIdx === i) ? 1.18 : 1.0;
            const bounceErr  = bounceTarget - _coinBounceScales[i];
            const bounceF    = BOUNCE_K * bounceErr - BOUNCE_D * _coinBounceVels[i];
            _coinBounceVels[i]   += bounceF * dt;
            _coinBounceScales[i] += _coinBounceVels[i] * dt;
            if (Math.abs(bounceErr) < 0.001 && Math.abs(_coinBounceVels[i]) < 0.001) {
                _coinBounceScales[i] = bounceTarget;
                _coinBounceVels[i]   = 0;
            }

            _chestCoins[i].scale.setScalar(Math.max(0, _coinCurrentScales[i]) * _coinHoverScales[i] * _coinBounceScales[i]);
        }
    }

    // ── Coin tooltip: reposition each frame + auto-hide when not in chest zoom
    if (CoinTooltip.isCoinTooltipVisible()) {
        if (!isChestZoomActive()) {
            _hoveredCoinIdx = -1;
            _selectedCoinIdx = -1;
            CoinTooltip.hideCoinTooltip();
        } else {
            const ttIdx = CoinTooltip.getCoinTooltipIdx();
            if (ttIdx >= 0) {
                const pos = _getCoinScreenPos(ttIdx);
                if (pos) CoinTooltip.repositionCoinTooltip(pos.x, pos.y);
            }
        }
    }

  if (!isUnderwater) {
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
  } // end !isUnderwater gate (pug state, music notes)
}

// Spawn a music note particle along an invisible arch above the radio
function spawnMusicNote(intensity: number): void {
    if (noteTextures.length === 0) return;

    // Pick random note texture
    const tex = noteTextures[Math.floor(Math.random() * noteTextures.length)];
    const mat = _acquireSpriteMaterial(tex);
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
            _releaseSpriteMaterial(note.sprite.material as SpriteMaterial);
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
    const mat = _acquireSpriteMaterial(_pugZTexture!);
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
            _releaseSpriteMaterial(z.sprite.material as SpriteMaterial);
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

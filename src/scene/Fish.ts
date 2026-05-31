import { Group, AnimationMixer, AnimationClip, LoopRepeat, Vector3, Color, MeshStandardMaterial, Mesh, Vector2, MathUtils, PointLight } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — r137 @types declares a namespace but the module exports clone directly
import { clone as _skeletonClone } from "three/examples/jsm/utils/SkeletonUtils";
import { deltaTime } from "../core/Time";
// `scene` is aliased because createPoolEntry below has a local `scene`
// variable (the cloned GLB Group). Without the alias the local shadows the
// import and `scene.add(light)` silently adds to the cloned model graph
// instead of the renderer scene root — the exact bug that left jelly lights
// nested inside genericFishContainer and caused the +21 dive recompiles.
import { camera, renderer, scene as rootScene } from "../core/Scene";
import { getDayNightBlend, isDayTime } from "./Skybox";
import { jellyfishLightConfig } from "./config/OceanConfig";
import { defaultCameraZ, defaultFov, mobileFov } from "./config/CameraConfig";

// Local mobile check — avoids circular-dependency TDZ crash when importing
// isMobile from Scene.ts (Scene imports Fish at module scope).
const _isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;

// Clown & Dori fish settings (circling the island)
const CIRCLE_FISH_SCALE = 0.03;
const CIRCLE_RADIUS = 1.6;       // increased from 1.2
const CIRCLE_SPEED = 0.3;
const CIRCLE_Y_LEVEL = -0.7;
const FISH_SEPARATION = 0.3;
const CIRCLE_FISH_ROTATION_OFFSET = Math.PI * 2;

// ── Dori lazy-zone (camera-facing arc) ───────────────────────────────────────
// The front of the circle (closest to camera) is where sin(angle) = +1  →  angle ≈ π/2.
// When the clown crosses this arc, Dori slows down, falls behind, then speeds back up.
const DORI_LAZY_CENTER  = Math.PI / 2;  // angle at camera-facing apex
const DORI_LAZY_HALF    = Math.PI * 0.5; // half-width of the lazy zone (90° each side = full front-half)
const DORI_LAZY_MAX_LAG = 0.65;         // peak extra angular lag (radians) at zone centre

/**
 * Returns the extra angular lag Dori has BEHIND the clown at a given circleAngle.
 * Uses a smooth (cos²) bell centred on DORI_LAZY_CENTER so the slowdown and
 * catch-up feel organic rather than abrupt.
 */
function _doriLag(angle: number): number {
    // Normalise to [0, 2π)
    const tau = Math.PI * 2;
    const norm = ((angle % tau) + tau) % tau;
    // Signed angular distance from the lazy-zone centre, wrapped to [−π, π]
    let delta = norm - DORI_LAZY_CENTER;
    if (delta >  Math.PI) delta -= tau;
    if (delta < -Math.PI) delta += tau;
    // Outside the zone: zero lag
    if (Math.abs(delta) >= DORI_LAZY_HALF) return 0;
    // Smooth bell: cos²(π*t/2) gives 1 at centre and 0 at ±half-width
    const t = delta / DORI_LAZY_HALF;          // −1 … +1
    const bell = Math.cos((t * Math.PI) / 2);  // 1 at 0, 0 at ±1
    return bell * bell * DORI_LAZY_MAX_LAG;
}

// Generic fish spawn settings
const GENERIC_FISH_SCALE = 0.03;
const GENERIC_FISH_Y_MIN = -7;           // min spawn height
const GENERIC_FISH_Y_MAX = -5;           // max spawn height
const GENERIC_FISH_Z_MIN = -4.0;         // farthest Z from camera
const GENERIC_FISH_Z_MAX = 0.0;         // closest Z to camera
const GENERIC_FISH_SPEED_MIN = 0.3;      // slowest swim speed
const GENERIC_FISH_SPEED_MAX = 0.5;      // fastest swim speed
const SPAWN_INTERVAL = 2.0;              // seconds between spawn waves
const SPAWN_COUNT_MIN = 1;               // min fish per wave
const SPAWN_COUNT_MAX = 3;               // max fish per wave
const GROUP_SIZE_MIN = 1;                // min fish per same-color group
const GROUP_SIZE_MAX = 3;                // max fish per same-color group
const GROUP_Y_SPREAD = 0.15;             // Y scatter within a group
const GROUP_Z_SPREAD = 0.3;              // Z scatter within a group
const GROUP_X_SPREAD = 0.3;              // X stagger within a group
const GROUP_SPEED_SPREAD = 0.05;         // speed variation within a group
const FISH_MIN_Y_GAP = 0.4;             // min vertical gap between groups in same wave
// World units the respawn X extends BEYOND the right frustum edge. Fish that
// despawn at the left edge are placed at a random X anywhere in this band, so
// the wave that despawned together re-enters the visible area at staggered
// times (each fish has its own travel distance + speed). Without this, fish
// would stack into a tight cluster at spawnX and cross the screen as a wave.
// 1.5 = ~3-5s of off-screen transit at average speed; large enough to break
// up the cluster, small enough that ≥90% of fish are visible at any moment.
const RESPAWN_X_JITTER = 1.5;
const FISH_SCALE_MIN = 0.8;              // min scale multiplier
const FISH_SCALE_MAX = 1.2;              // max scale multiplier
const SCREEN_MARGIN = 0.5;               // extra world units past screen edge

// Jellyfish settings — scattered static positions with gentle vertical bob.
// Y range intentionally matches the generic fish Y range so jellies always sit
// at heights where fish actually pass through — guarantees the PointLights
// have a chance to illuminate them.
const JELLYFISH_SCALE = 0.001;           // base scale for jellyfish
const JELLY_Y_MIN = GENERIC_FISH_Y_MIN;  // overlap with fish stream lower bound
const JELLY_Y_MAX = GENERIC_FISH_Y_MAX;  // overlap with fish stream upper bound
const JELLY_Z_MIN = -4.0;                // farthest Z
const JELLY_Z_MAX = 0.0;                 // closest Z
const JELLY_POOL_SIZE = _isMobile ? 6 : 10;
const JELLY_FLOAT_AMPLITUDE = 0.18;      // vertical bob amplitude (world units)
const JELLY_FLOAT_SPEED_MIN = 0.35;      // rad/s
const JELLY_FLOAT_SPEED_MAX = 0.75;      // rad/s
// Static X scatter is fitted to the device frustum at each jelly's Z so all
// spawned jellies are guaranteed to be visible. The vertical FOV alone is too
// narrow — horizontal extent depends on aspect ratio, otherwise jellies bunch
// up near X=0 on widescreen viewports.
const JELLY_X_FRUSTUM_FRACTION = 0.95;   // keep a small margin from screen edges
const _jellyHalfFovRad = ((_isMobile ? mobileFov : defaultFov) * Math.PI / 180) * 0.5;
const _jellyTanHalfFov = Math.tan(_jellyHalfFovRad);
function getJellyXHalfWidth(jellyZ: number): number {
    const depth = Math.max(0.5, defaultCameraZ - jellyZ);
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    return depth * _jellyTanHalfFov * aspect * JELLY_X_FRUSTUM_FRACTION;
}

// Jellyfish bioluminescence settings — DECOUPLED from PointLight intensity.
// The jelly's own visual glow is driven purely by JELLY_EMISSIVE_INTENSITY *
// renderVisibility, NOT by jellyfishLightConfig.intensity. Otherwise pumping
// up the PointLight to dominate the fish would also blow out the jelly to
// pure white. The PointLight only affects surrounding surfaces.
const JELLY_EMISSIVE_INTENSITY = 1.1;
const JELLY_OPACITY = 0.55;              // semi-transparent (0 = invisible, 1 = opaque)
const JELLY_LIGHT_DECAY = 2;             // physical inverse-square falloff
// One real PointLight per jellyfish — count is FIXED for the session so the
// WebGLRenderer never recompiles PBR materials for a different light count.
// Lights are added to the scene at Start() with intensity=0 so they're already
// part of the scene graph when prewarmGPU's renderer.compile() walks materials.

// Night-time albedo darkening for non-jelly fish — multiplies material.color
// each frame by (1 - nightBlend * FISH_NIGHT_DARKEN). Pushes fish toward
// silhouettes at night so the jelly PointLights are visually the dominant
// source on them. 0 = no darkening, ~1 = nearly black at full night.
// 0.95 = ~5% albedo at full night → fish are essentially shadows far from
// any jelly. The jelly light contribution scales with albedo too, but the
// PointLight intensity slider (0-10 in Debug GUI) lets you push the local
// pop higher if the fall-off feels too aggressive.
const FISH_NIGHT_DARKEN = 0.95;

// Fish avoidance settings
const AVOIDANCE_RADIUS = 0.15;            // world units — how close the pointer must be to scare fish
const AVOIDANCE_STRENGTH = 0.5;          // vertical push force away from pointer
const RETURN_SPEED = 0.8;               // how fast fish return to their base Y
const VELOCITY_DAMPING = 0.8;            // drag on vertical velocity
const MAX_TILT_ANGLE = 0.8;              // max rotation.z tilt in radians (~34°)
const TILT_SMOOTHING = 8.0;              // how fast the tilt follows velocity

// Object pool settings
const POOL_SIZE = _isMobile ? 10 : 25;                    // max simultaneous fish — prevents unbounded memory growth

// Fish color tint variants (multiplied on top of base texture)
const FISH_COLOR_TINTS: Color[] = [
    new Color(1.0, 1.0, 1.0),   // no filter (original)
    new Color(0.2, 0.4, 1.5),   // vibrant blue
    new Color(1.5, 1.3, 0.1),   // vibrant yellow
    new Color(0.1, 1.4, 0.2),   // vibrant green
    new Color(1.5, 0.15, 0.15), // vibrant red
];

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

// Circle fish
export const clownFish = new Group();
export const doriFish = new Group();
let clownMixer: AnimationMixer | null = null;
let doriMixer: AnimationMixer | null = null;
let circleAngle = 0;
const islandCenter = { x: 0, z: -3.3 };

// Generic fish spawn system
export const genericFishContainer = new Group();
let genericFishTemplate: Group | null = null;
let genericFishAnimations: AnimationClip[] = [];

// Jellyfish spawn system (night mode)
let jellyfishTemplate: Group | null = null;
let jellyfishAnimations: AnimationClip[] = [];

interface PooledFish {
    group: Group;
    scene: Group;             // the cloned skeleton scene inside the group
    materials: MeshStandardMaterial[];  // pre-cloned materials for tint reuse
    baseTintColors: Color[];  // original colors before tinting (for reset)
    activeTintColors: Color[]; // current day/base color after random tint
    lightColor: Color;        // jellyfish-only: tint copied into the real PointLight
    light: PointLight | null; // jellyfish-only: real point light parented to group
    mixer: AnimationMixer;
    clip: AnimationClip | null;
    isJellyfish: boolean;     // true = belongs to jellyPool, false = fishPool
    actionStarted: boolean;
}

interface SwimmingFish {
    pool: PooledFish;         // reference back to pool entry for recycling
    speed: number;
    baseScale: number;
    baseY: number;
    velocityY: number;
    currentTilt: number;
    // Jellyfish-only: stationary vertical bob
    floatPhase: number;       // current phase of the sin bob (rad)
    floatSpeed: number;       // rad/s
    floatAmp: number;         // world units
}

const fishPool: PooledFish[] = [];       // available (inactive) day fish
const jellyPool: PooledFish[] = [];      // available (inactive) night jellyfish
const activeFish: SwimmingFish[] = [];   // in-scene swimming creatures
let fishPoolInitialized = false;
let jellyPoolInitialized = false;
let fishModelsLoaded = 0;
let fixedLoopsInitialized = false;
let underwaterView = false;
let shallowVisibilityMinY = Number.POSITIVE_INFINITY;

// Jellyfish color tints — light-blue palette. ALL channels <= 1.0 so the
// emissive ((tint × glowIntensity)) doesn't blow out to white after tone
// mapping. Blue is the dominant channel; red/green sit below so the hue
// reads as cool/cyan rather than neutral.
const JELLY_COLOR_TINTS: Color[] = [
    new Color(0.40, 0.70, 1.00),
    new Color(0.45, 0.75, 0.98),
    new Color(0.50, 0.72, 1.00),
    new Color(0.42, 0.78, 0.95),
];

// Pointer tracking — screen NDC coords updated each frame
const pointerNDC = new Vector2(9999, 9999); // off-screen by default
let pointerActive = false;

function onPointerMove(e: PointerEvent): void {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNDC.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    pointerActive = true;
}

function onPointerLeave(): void {
    pointerActive = false;
    pointerNDC.set(9999, 9999);
}

function getJellyVisibility(): number {
    return smooth01(getDayNightBlend());
}

function setJellyfishGlow(entry: PooledFish, visibility: number): void {
    if (!entry.isJellyfish) return;
    const renderVisibility = underwaterView ? visibility : 0;
    const opacity = JELLY_OPACITY * renderVisibility;
    // Decoupled from PointLight intensity — see comment on
    // JELLY_EMISSIVE_INTENSITY. Keeps the jelly mesh a saturated light-blue
    // even when the PointLight is cranked up to dominate the fish.
    const glowIntensity = JELLY_EMISSIVE_INTENSITY * renderVisibility;
    for (let i = 0; i < entry.materials.length; i++) {
        entry.materials[i].opacity = opacity;
        entry.materials[i].emissiveIntensity = glowIntensity;
    }
    if (entry.light) {
        // Real PBR-pipeline PointLight: gets specular, env integration, full
        // BRDF. Intensity goes to 0 (not visible=false) so the light's slot in
        // the global pointLights uniform array never changes — no recompile.
        entry.light.intensity = jellyfishLightConfig.intensity * renderVisibility;
        entry.light.distance = jellyfishLightConfig.distance;
        entry.light.color.copy(entry.lightColor);
    }
}

/** Unproject pointer NDC to world position at a given Z plane */
const _pointerWorld = new Vector3();
const _refPoint = new Vector3();  // reusable — avoids allocation per call
function getPointerWorldAtZ(z: number): Vector3 {
    _refPoint.set(0, 0, z);
    _refPoint.project(camera);
    _pointerWorld.set(pointerNDC.x, pointerNDC.y, _refPoint.z).unproject(camera);
    return _pointerWorld;
}

/** Pre-create a single pool entry from the template */
function createPoolEntry(template: Group, animations: AnimationClip[], jellyfish = false): PooledFish {
    const scene = _skeletonClone(template) as Group;
    const materials: MeshStandardMaterial[] = [];
    const baseTintColors: Color[] = [];
    const activeTintColors: Color[] = [];
    scene.traverse((child) => {
        if (child instanceof Mesh && child.material) {
            const srcMat = child.material as MeshStandardMaterial;
            const mat = srcMat.clone();
            // Pre-configure jellyfish materials for transparency so the shader
            // variant is compiled once at pool creation, not on first activation
            if (jellyfish) {
                mat.transparent = true;
                mat.depthWrite = false;  // transparent objects shouldn't write depth
                mat.opacity = 0;         // invisible until activated
            }
            child.material = mat;
            materials.push(mat);
            baseTintColors.push(mat.color.clone());
            activeTintColors.push(mat.color.clone());
        }
    });
    const group = new Group();
    group.add(scene);
    group.rotation.order = 'YXZ';
    group.rotation.y = -Math.PI / 2;
    group.visible = false;  // hidden until activated

    const mixer = new AnimationMixer(scene);
    const clip = animations.length > 0 ? animations[0] : null;

    // One real PointLight per jellyfish — parented to the scene ROOT (not the
    // jelly group / genericFishContainer). This is critical: the underwater
    // two-pass renderer in [Scene.renderSceneFrame] toggles
    // genericFishContainer.visible to split opaque/transparent passes. If the
    // light lived inside it, the opaque pass would see 0 PointLights and the
    // transparent pass N PointLights — forcing every PBR material in the
    // scene to need two program variants and triggering compile-on-demand on
    // the first dive (massive stutter). At scene root the light stays
    // visible for both passes, so each material has one stable variant.
    let light: PointLight | null = null;
    if (jellyfish) {
        light = new PointLight(0xffffff, 0, jellyfishLightConfig.distance, JELLY_LIGHT_DECAY);
        light.castShadow = false;
        // CRITICAL CONTRACT: this light's `visible` must stay TRUE for the
        // entire session. Toggling it (or having an invisible ancestor) makes
        // Three.js drop it from the per-frame pointLights uniform array,
        // changing the array length and forcing PBR materials to recompile
        // their program variants on the fly — that's the dive stutter. Only
        // `intensity` is allowed to change at runtime (0 = effectively off).
        light.visible = true;
        rootScene.add(light);
    }

    return {
        group,
        scene,
        materials,
        baseTintColors,
        activeTintColors,
        lightColor: new Color(1, 1, 1),
        light,
        mixer,
        clip,
        isJellyfish: jellyfish,
        actionStarted: false,
    };
}

function ensureLoopAction(entry: PooledFish): void {
    if (entry.actionStarted || !entry.clip) return;
    const action = entry.mixer.clipAction(entry.clip);
    action.setLoop(LoopRepeat, Infinity);
    action.play();
    entry.actionStarted = true;
}

/** Build entire fish pool synchronously inside the loader callback.
 *  All entries exist at prewarm time so their shaders compile then, not on first dive. */
function initFishPool(): void {
    if (fishPoolInitialized || !genericFishTemplate) return;
    fishPoolInitialized = true;
    for (let i = 0; i < POOL_SIZE; i++) {
        const entry = createPoolEntry(genericFishTemplate, genericFishAnimations, false);
        genericFishContainer.add(entry.group);
        fishPool.push(entry);
    }
    initFixedCreatureLoops();
}

/** Build entire jellyfish pool synchronously inside the loader callback. */
function initJellyPool(): void {
    if (jellyPoolInitialized || !jellyfishTemplate) return;
    jellyPoolInitialized = true;
    for (let i = 0; i < JELLY_POOL_SIZE; i++) {
        const entry = createPoolEntry(jellyfishTemplate, jellyfishAnimations, true);
        genericFishContainer.add(entry.group);
        jellyPool.push(entry);
    }
    initFixedCreatureLoops();
}

/** No-op kept for call-site compatibility — pool is now built synchronously at load. */
function tickPoolCreation(): void {}

/** Take a creature from the correct pool, apply tint/position/scale, activate it */
function activatePooledFish(
    tint: Color, x: number, y: number, z: number,
    speed: number, scale: number, useJellyfish: boolean
): void {
    const pool = useJellyfish ? jellyPool : fishPool;
    if (pool.length === 0) return;  // pool exhausted — skip silently
    const entry = pool.pop()!;

    // Apply tint to pre-cloned materials (reset base color first)
    for (let i = 0; i < entry.materials.length; i++) {
        entry.materials[i].color.copy(entry.baseTintColors[i]).multiply(tint);
        entry.activeTintColors[i].copy(entry.materials[i].color);
        // Jellyfish get emissive glow matching their tint + transparency
        if (entry.isJellyfish) {
            entry.materials[i].emissive.copy(tint);
            entry.materials[i].emissiveIntensity = JELLY_EMISSIVE_INTENSITY;
            entry.materials[i].opacity = JELLY_OPACITY;
        }
    }
    entry.lightColor.copy(tint);
    setJellyfishGlow(entry, getJellyVisibility());

    entry.group.position.set(x, y, z);
    entry.group.scale.setScalar(scale);
    entry.group.rotation.x = 0;  // reset tilt
    entry.group.visible = true;

    ensureLoopAction(entry);

    activeFish.push({
        pool: entry,
        speed,
        baseScale: scale,
        baseY: y,
        velocityY: 0,
        currentTilt: 0,
        floatPhase: 0,
        floatSpeed: 0,
        floatAmp: 0,
    });
}

/** Return a creature to the correct pool */
function deactivateFish(index: number): void {
    const fish = activeFish[index];
    fish.pool.group.visible = false;
    // Reset emissive and transparency on materials
    if (fish.pool.isJellyfish) {
        for (let i = 0; i < fish.pool.materials.length; i++) {
            fish.pool.materials[i].emissive.setScalar(0);
            fish.pool.materials[i].emissiveIntensity = 0;
            fish.pool.materials[i].opacity = 0;
        }
    }
    if (fish.pool.isJellyfish) {
        jellyPool.push(fish.pool);
    } else {
        fishPool.push(fish.pool);
    }
    activeFish.splice(index, 1);
}

function resetLoopingCreature(entry: PooledFish, progress = 0): SwimmingFish {
    const jelly = entry.isJellyfish;
    const tints = jelly ? JELLY_COLOR_TINTS : FISH_COLOR_TINTS;
    const baseScale = jelly ? JELLYFISH_SCALE : GENERIC_FISH_SCALE;

    const tint = tints[Math.floor(Math.random() * tints.length)];
    for (let i = 0; i < entry.materials.length; i++) {
        entry.materials[i].color.copy(entry.baseTintColors[i]).multiply(tint);
        entry.activeTintColors[i].copy(entry.materials[i].color);
        if (entry.isJellyfish) {
            entry.materials[i].emissive.copy(tint);
            entry.materials[i].emissiveIntensity = 0;
            entry.materials[i].opacity = 0;
        }
    }
    entry.lightColor.copy(tint);
    setJellyfishGlow(entry, getJellyVisibility());

    const scaleMult = FISH_SCALE_MIN + Math.random() * (FISH_SCALE_MAX - FISH_SCALE_MIN);
    const scale = baseScale * scaleMult;

    if (jelly) {
        // Stationary scatter: random Y/Z anywhere in the jelly volume; X is
        // sampled from the current device's frustum at the picked Z so every
        // jelly is guaranteed to be on-screen regardless of mobile vs desktop.
        const y = JELLY_Y_MIN + Math.random() * (JELLY_Y_MAX - JELLY_Y_MIN);
        const z = JELLY_Z_MIN + Math.random() * (JELLY_Z_MAX - JELLY_Z_MIN);
        const xHalf = getJellyXHalfWidth(z);
        const x = (Math.random() * 2 - 1) * xHalf;
        entry.group.position.set(x, y, z);
        entry.group.scale.setScalar(scale);
        entry.group.rotation.x = 0;
        entry.group.visible = shouldShowCreature(entry);
        if (entry.light) entry.light.position.set(x, y, z);
        ensureLoopAction(entry);

        return {
            pool: entry,
            speed: 0,
            baseScale: scale,
            baseY: y,
            velocityY: 0,
            currentTilt: 0,
            floatPhase: Math.random() * Math.PI * 2,
            floatSpeed: JELLY_FLOAT_SPEED_MIN + Math.random() * (JELLY_FLOAT_SPEED_MAX - JELLY_FLOAT_SPEED_MIN),
            floatAmp: JELLY_FLOAT_AMPLITUDE * (0.7 + Math.random() * 0.6),
        };
    }

    const zMin = GENERIC_FISH_Z_MIN;
    const zMax = GENERIC_FISH_Z_MAX;
    const speedMin = GENERIC_FISH_SPEED_MIN;
    const speedMax = GENERIC_FISH_SPEED_MAX;

    // Respawn: progress≈1 means the fish just despawned and is being placed
    // back at the right edge. Pick a Y that isn't crowding any other fish
    // already sitting near the spawn edge. For initial seed (progress<1, called
    // from seedInitialFish) the caller controls Y explicitly via baseY/index.
    const z = zMin + Math.random() * (zMax - zMin);
    const edges = getFrustumEdgesX(z);
    // Fallback when the camera is mid-transition / outside-frustum and the
    // unprojection returned a non-finite value — pinning to a known good
    // right-edge keeps fish from getting NaN'd out of existence.
    const spawnX = Number.isFinite(edges.spawnX) ? edges.spawnX : 5.5;
    // Place the respawn slightly beyond spawnX with a small random jitter so
    // the wave of fish that just despawned re-enters the visible area at
    // staggered times instead of as a synchronized cluster. See
    // RESPAWN_X_JITTER for the why.
    const x = spawnX + Math.random() * RESPAWN_X_JITTER;
    const y = pickRespawnY(x);
    entry.group.position.set(x, y, z);
    entry.group.scale.setScalar(scale);
    entry.group.rotation.x = 0;
    entry.group.visible = shouldShowCreature(entry);

    ensureLoopAction(entry);

    return {
        pool: entry,
        speed: speedMin + Math.random() * (speedMax - speedMin),
        baseScale: scale,
        baseY: y,
        velocityY: 0,
        currentTilt: 0,
        floatPhase: 0,
        floatSpeed: 0,
        floatAmp: 0,
    };
}

/** Pick a Y in the fish range that keeps FISH_MIN_Y_GAP from any other fish
 *  currently close to spawnX (so newcomers don't visually stack on each other
 *  at the right edge). Falls back to pure random after a few tries. */
function pickRespawnY(spawnX: number): number {
    const yMin = GENERIC_FISH_Y_MIN;
    const yMax = GENERIC_FISH_Y_MAX;
    for (let tries = 0; tries < 8; tries++) {
        const y = yMin + Math.random() * (yMax - yMin);
        let ok = true;
        for (let i = 0; i < activeFish.length; i++) {
            const other = activeFish[i].pool;
            if (other.isJellyfish) continue;
            const op = other.group.position;
            // Only check fish still close to the spawn edge.
            if (Math.abs(op.x - spawnX) > 1.5) continue;
            if (Math.abs(op.y - y) < FISH_MIN_Y_GAP) { ok = false; break; }
        }
        if (ok) return y;
    }
    return yMin + Math.random() * (yMax - yMin);
}

/** Initial layout for the whole fish pool. Seeds at the *steady state* the
 *  scene reaches after a few seconds of normal play: X uniformly random across
 *  the full frustum (not a deterministic ladder — that visibly bunches into
 *  the left half because the Update loop keeps advancing fish even while the
 *  player is at the surface and they're invisible). Y is stratified across
 *  the band with jitter so the pool never starts clustered vertically. */
function seedInitialFish(entry: PooledFish, index: number, total: number): SwimmingFish {
    const jelly = entry.isJellyfish;
    if (jelly) return resetLoopingCreature(entry, index / Math.max(1, total));

    const tints = FISH_COLOR_TINTS;
    const tint = tints[Math.floor(Math.random() * tints.length)];
    for (let i = 0; i < entry.materials.length; i++) {
        entry.materials[i].color.copy(entry.baseTintColors[i]).multiply(tint);
        entry.activeTintColors[i].copy(entry.materials[i].color);
    }
    entry.lightColor.copy(tint);

    const scaleMult = FISH_SCALE_MIN + Math.random() * (FISH_SCALE_MAX - FISH_SCALE_MIN);
    const scale = GENERIC_FISH_SCALE * scaleMult;

    const z = GENERIC_FISH_Z_MIN + Math.random() * (GENERIC_FISH_Z_MAX - GENERIC_FISH_Z_MIN);
    const { spawnX, despawnX } = getFrustumEdgesX(z);
    // X: uniform across the FULL cycle — visible band [despawnX, spawnX] PLUS
    // the off-screen-right transit band [spawnX, spawnX + RESPAWN_X_JITTER].
    // Seeding only within the visible band makes every fish enter its cycle in
    // sync (they all drift left together, all hit despawnX in a tight window,
    // all respawn together → cluster). Including the transit band starts the
    // pool already at steady state — some fish are off-screen waiting to
    // enter, others mid-screen, others about to despawn. No synchronized wave.
    const x = despawnX + Math.random() * (spawnX - despawnX + RESPAWN_X_JITTER);
    // Y: stratified across the full range, then jittered. The +0.5 offset and
    // small jitter avoid both edge clustering and exact grid alignment.
    const stratY = (index % total + 0.5) / total;
    const jitter = (Math.random() - 0.5) * (1 / total) * 0.6;
    const yT = MathUtils.clamp(stratY + jitter, 0, 1);
    const y = GENERIC_FISH_Y_MIN + yT * (GENERIC_FISH_Y_MAX - GENERIC_FISH_Y_MIN);

    entry.group.position.set(x, y, z);
    entry.group.scale.setScalar(scale);
    entry.group.rotation.x = 0;
    entry.group.visible = shouldShowCreature(entry);
    ensureLoopAction(entry);

    return {
        pool: entry,
        speed: GENERIC_FISH_SPEED_MIN + Math.random() * (GENERIC_FISH_SPEED_MAX - GENERIC_FISH_SPEED_MIN),
        baseScale: scale,
        baseY: y,
        velocityY: 0,
        currentTilt: 0,
        floatPhase: 0,
        floatSpeed: 0,
        floatAmp: 0,
    };
}

function isObjectAboveShallowCutoff(group: Group): boolean {
    return group.position.y >= shallowVisibilityMinY;
}

function shouldShowCircleFish(group: Group): boolean {
    return underwaterView || isObjectAboveShallowCutoff(group);
}

function smooth01(value: number): number {
    const t = MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}

function isCreatureInCameraRange(entry: PooledFish): boolean {
    return underwaterView || isObjectAboveShallowCutoff(entry.group);
}

function shouldShowCreature(entry: PooledFish): boolean {
    if (entry.isJellyfish) return true;
    return isCreatureInCameraRange(entry);
}

export function beginJellyfishPrewarm(): () => void {
    const savedContainerVisible = genericFishContainer.visible;
    const savedEntries: Array<{
        entry: PooledFish;
        visible: boolean;
        opacity: number[];
        emissiveIntensity: number[];
        lightIntensity: number;
    }> = [];

    genericFishContainer.visible = true;
    for (let i = 0; i < activeFish.length; i++) {
        const entry = activeFish[i].pool;
        if (!entry.isJellyfish) continue;

        savedEntries.push({
            entry,
            visible: entry.group.visible,
            opacity: entry.materials.map(mat => mat.opacity),
            emissiveIntensity: entry.materials.map(mat => mat.emissiveIntensity),
            lightIntensity: entry.light ? entry.light.intensity : 0,
        });

        entry.group.visible = true;
        for (let m = 0; m < entry.materials.length; m++) {
            entry.materials[m].opacity = JELLY_OPACITY;
            entry.materials[m].emissiveIntensity = JELLY_EMISSIVE_INTENSITY;
        }
        // CRITICAL: activate the real PointLight at full intensity during the
        // prewarm renders so ANGLE (Windows/Chrome) generates the actual GPU
        // shader binary for "PointLight contributing". Without this, the
        // driver appears to defer the per-light fragment path until first
        // non-zero render → that's the dive stutter. The chest light follows
        // the same pattern in Island.beginPrewarmVariants.
        if (entry.light) {
            entry.light.intensity = jellyfishLightConfig.intensity;
        }
    }

    return () => {
        genericFishContainer.visible = savedContainerVisible;
        for (const saved of savedEntries) {
            saved.entry.group.visible = saved.visible;
            for (let i = 0; i < saved.entry.materials.length; i++) {
                saved.entry.materials[i].opacity = saved.opacity[i];
                saved.entry.materials[i].emissiveIntensity = saved.emissiveIntensity[i];
            }
            if (saved.entry.light) saved.entry.light.intensity = saved.lightIntensity;
        }
    };
}

function initFixedCreatureLoops(): void {
    if (fixedLoopsInitialized || !fishPoolInitialized || !jellyPoolInitialized) return;
    fixedLoopsInitialized = true;

    const fishEntries = fishPool.splice(0);
    // Shuffle so the deterministic Y stratification isn't paired with a fixed
    // order of pool entries (pool entries are clones — they're interchangeable,
    // but shuffling makes color distribution independent of Y ladder).
    for (let i = fishEntries.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [fishEntries[i], fishEntries[j]] = [fishEntries[j], fishEntries[i]];
    }
    for (let i = 0; i < fishEntries.length; i++) {
        activeFish.push(seedInitialFish(fishEntries[i], i, fishEntries.length));
    }

    const jellyEntries = jellyPool.splice(0);
    for (let i = 0; i < jellyEntries.length; i++) {
        activeFish.push(resetLoopingCreature(jellyEntries[i], i / Math.max(1, jellyEntries.length)));
    }
}

export function isReady(): boolean {
    return fishModelsLoaded >= 4 && fixedLoopsInitialized;
}

/** 0–1 download progress. fishModelsLoaded advances on both success and
 *  failure (see onLoadError) so it always reaches 1 — feeds the unified
 *  loading bar in Scene.getStartupProgress(). */
export function getDownloadFraction(): number {
    return Math.min(fishModelsLoaded / 4, 1);
}

/** Debug snapshot — used by `window.__diag()` to inspect fish state. */
export function getDiagState() {
    let visibleFish = 0, visibleJellies = 0, nanX = 0;
    const xs: number[] = [];
    for (const f of activeFish) {
        const x = f.pool.group.position.x;
        if (!Number.isFinite(x)) nanX++;
        if (f.pool.isJellyfish) {
            if (f.pool.group.visible) visibleJellies++;
        } else {
            xs.push(x);
            if (f.pool.group.visible) visibleFish++;
        }
    }
    xs.sort((a, b) => a - b);
    return {
        activeFish: activeFish.length,
        visibleFish,
        visibleJellies,
        nanX,
        fishXMin: xs[0],
        fishXMax: xs[xs.length - 1],
        fishXSamples: xs.length > 0 ? [xs[0], xs[Math.floor(xs.length / 2)], xs[xs.length - 1]].map(v => v.toFixed(2)) : [],
    };
}

export function Start(): void {
    // Register pointer tracking
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.addEventListener('pointerup', onPointerLeave);

    // A failed load must still advance fishModelsLoaded — otherwise the
    // loading-screen prewarm (Scene.waitForModels) can hang forever at 90%
    // waiting on a count that never completes. Better to start with a fish
    // missing than to freeze. (A failed pool *template* still leaves
    // isReady() false because its pool can't init — the waitForModels timeout
    // is the backstop for that case.)
    const onLoadError = (path: string) => (err: unknown) => {
        console.error(`[Fish] Failed to load ${path}:`, err);
        fishModelsLoaded++;
    };

    // Load clown fish
    loader.load(
        'models/underwater/clownfish.glb',
        (gltf) => {
            clownFish.add(gltf.scene);
            clownFish.scale.setScalar(CIRCLE_FISH_SCALE);
            clownMixer = new AnimationMixer(gltf.scene);
            if (gltf.animations.length > 0) {
                clownMixer.clipAction(gltf.animations[0]).play();
            }
            fishModelsLoaded++;
        },
        undefined,
        onLoadError('models/underwater/clownfish.glb'),
    );

    // Load dori fish
    loader.load(
        'models/underwater/dorifish.glb',
        (gltf) => {
            doriFish.add(gltf.scene);
            doriFish.scale.setScalar(CIRCLE_FISH_SCALE);
            doriMixer = new AnimationMixer(gltf.scene);
            if (gltf.animations.length > 0) {
                doriMixer.clipAction(gltf.animations[0]).play();
            }
            fishModelsLoaded++;
        },
        undefined,
        onLoadError('models/underwater/dorifish.glb'),
    );

    // Load generic fish template (day)
    loader.load(
        'models/underwater/genericfish.glb',
        (gltf) => {
            genericFishTemplate = gltf.scene;
            genericFishAnimations = gltf.animations;
            fishModelsLoaded++;
            initFishPool();
        },
        undefined,
        onLoadError('models/underwater/genericfish.glb'),
    );

    // Load jellyfish template (night)
    loader.load(
        'models/underwater/jellyfish.glb',
        (gltf) => {
            jellyfishTemplate = gltf.scene;
            jellyfishAnimations = gltf.animations;
            fishModelsLoaded++;
            initJellyPool();
        },
        undefined,
        onLoadError('models/underwater/jellyfish.glb'),
    );

}

// Reusable temp vectors for frustum edge calculation (zero per-frame allocation)
const _vecRight = new Vector3();
const _vecLeft = new Vector3();
const _fishWorldPos = new Vector3();
const _projected = new Vector3();

/** Get world-space X extents of the camera frustum at the fish depth plane */
function getFrustumEdgesX(z: number): { spawnX: number; despawnX: number } {
    _fishWorldPos.set(0, (GENERIC_FISH_Y_MIN + GENERIC_FISH_Y_MAX) * 0.5, z);
    _projected.copy(_fishWorldPos).project(camera);
    const depthNDC = _projected.z;

    // Right edge of screen in NDC = +1, unproject to world
    _vecRight.set(1, 0, depthNDC).unproject(camera);
    // Left edge of screen in NDC = -1, unproject to world
    _vecLeft.set(-1, 0, depthNDC).unproject(camera);

    const rightX = _vecRight.x + SCREEN_MARGIN;
    const leftX = _vecLeft.x - SCREEN_MARGIN;

    return { spawnX: rightX, despawnX: leftX };
}

export function Update(): void {
    const jellyVisibility = getJellyVisibility();
    // Same shape as jellyVisibility for now (both derived from day/night
    // blend), but keep as separate variable in case we want to decouple later.
    const fishAlbedoFactor = 1 - jellyVisibility * FISH_NIGHT_DARKEN;

    // Update animations
    if (clownMixer) clownMixer.update(deltaTime);
    if (doriMixer) doriMixer.update(deltaTime);
    
    // Circle fish movement
    circleAngle += CIRCLE_SPEED * deltaTime;

    const clownAngle = circleAngle;
    clownFish.position.set(
        islandCenter.x + Math.cos(clownAngle) * CIRCLE_RADIUS,
        CIRCLE_Y_LEVEL,
        islandCenter.z + Math.sin(clownAngle) * CIRCLE_RADIUS
    );
    clownFish.rotation.y = -clownAngle + CIRCLE_FISH_ROTATION_OFFSET;

    // Dori: normal separation PLUS a lazy-zone lag that peaks when facing the camera
    const doriAngle = circleAngle - FISH_SEPARATION - _doriLag(circleAngle);
    doriFish.position.set(
        islandCenter.x + Math.cos(doriAngle) * (CIRCLE_RADIUS + 0.08),
        CIRCLE_Y_LEVEL - 0.03,
        islandCenter.z + Math.sin(doriAngle) * (CIRCLE_RADIUS + 0.08)
    );
    doriFish.rotation.y = -doriAngle + CIRCLE_FISH_ROTATION_OFFSET;
    clownFish.visible = shouldShowCircleFish(clownFish);
    doriFish.visible = shouldShowCircleFish(doriFish);

    // Lazy-init pools if templates loaded after Start()
    if (!fishPoolInitialized && genericFishTemplate) initFishPool();
    if (!jellyPoolInitialized && jellyfishTemplate) initJellyPool();

    // Drip-feed pool creation (one entry per frame to avoid stutter)
    tickPoolCreation();

    // Move and cull active creatures
    for (let i = activeFish.length - 1; i >= 0; i--) {
        const fish = activeFish[i];
        const group = fish.pool.group;
        group.scale.setScalar(fish.baseScale);
        setJellyfishGlow(fish.pool, jellyVisibility);
        if (!fish.pool.isJellyfish) {
            // Albedo darkens with night so ambient/directional fall off the
            // fish; the jelly PointLights (which scale with night too, but
            // multiplied by the dim albedo) end up as the dominant local
            // source. Both intensity and FISH_NIGHT_DARKEN are tunable.
            for (let m = 0; m < fish.pool.materials.length; m++) {
                fish.pool.materials[m].color
                    .copy(fish.pool.activeTintColors[m])
                    .multiplyScalar(fishAlbedoFactor);
            }
        }
        group.visible = shouldShowCreature(fish.pool);
        fish.pool.mixer.update(deltaTime);

        if (fish.pool.isJellyfish) {
            // Stationary jellyfish: no horizontal motion, no pointer avoidance,
            // no despawn. Just a gentle vertical bob around baseY while the
            // skeleton animation continues to loop in the mixer above.
            fish.floatPhase += fish.floatSpeed * deltaTime;
            group.position.y = fish.baseY + Math.sin(fish.floatPhase) * fish.floatAmp;
            // Light lives at scene root — sync world position from the group.
            if (fish.pool.light) fish.pool.light.position.copy(group.position);
            continue;
        }

        group.position.x -= fish.speed * deltaTime;

        // Pointer avoidance
        if (pointerActive) {
            const pw = getPointerWorldAtZ(group.position.z);
            const dx = group.position.x - pw.x;
            const dy = group.position.y - pw.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < AVOIDANCE_RADIUS && dist > 0.01) {
                // Push vertically away from pointer, strength falls off with distance
                const force = (1.0 - dist / AVOIDANCE_RADIUS) * AVOIDANCE_STRENGTH;
                const dirY = dy / dist; // normalized vertical direction away
                fish.velocityY += dirY * force * deltaTime * 10;
            }
        }

        // Spring return to base Y
        const yDiff = fish.baseY - group.position.y;
        fish.velocityY += yDiff * RETURN_SPEED * deltaTime;

        // Damping
        fish.velocityY *= Math.max(0, 1 - VELOCITY_DAMPING * deltaTime);

        // Apply vertical movement
        group.position.y += fish.velocityY * deltaTime;

        // Tilt based on vertical velocity (fish pitches nose up/down)
        // With rotation.y = -PI/2 the fish faces -X, so rotation.x is pitch
        const targetTilt = Math.max(-MAX_TILT_ANGLE, Math.min(MAX_TILT_ANGLE, -fish.velocityY * 0.8));
        fish.currentTilt += (targetTilt - fish.currentTilt) * Math.min(1, TILT_SMOOTHING * deltaTime);
        group.rotation.x = fish.currentTilt;

        const { despawnX } = getFrustumEdgesX(group.position.z);
        if (group.position.x < despawnX) {
            activeFish[i] = resetLoopingCreature(fish.pool, 1);
        }
    }
}

/** Toggle visibility of all fish groups (GPU-side culling for surface/underwater gating). */
export function setVisible(visible: boolean): void {
    setCameraVisibility(visible, visible ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY);
}

export function setCameraVisibility(isUnderwater: boolean, shallowMinY: number): void {
    underwaterView = isUnderwater;
    shallowVisibilityMinY = shallowMinY;
    genericFishContainer.visible = true;
    clownFish.visible = shouldShowCircleFish(clownFish);
    doriFish.visible = shouldShowCircleFish(doriFish);
    for (let i = 0; i < activeFish.length; i++) {
        activeFish[i].pool.group.visible = shouldShowCreature(activeFish[i].pool);
    }
}

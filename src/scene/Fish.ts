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
import { defaultCameraX, defaultCameraZ, defaultFov, mobileFov } from "./config/CameraConfig";

// Local mobile check — avoids circular-dependency TDZ crash when importing
// isMobile from Scene.ts (Scene imports Fish at module scope).
const _isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;

// ── Patrol pair (clownfish leads, dori follows) ──────────────────────────────
// The pair used to orbit the island. They now cruise a very flat oval laid out
// BETWEEN the camera and the island — right to left and back again — so they
// stay in the same screen band the whole time and are always present for the
// user while underwater.
//
// Why an oval and not a segment retraced in reverse: a segment forces the fish
// to stop dead and flip 180° in place, which never reads as a swimming animal.
// On the oval the fish keeps moving FORWARD through the turn (down the near
// side, back up the far side), so the U-turn is a real banked arc — and the
// speed profile below slows it through the apex the way a fish actually turns.
const PATROL_FISH_SCALE = 0.03;
const PATROL_Y          = -0.55;  // raised a touch from the old -0.7
const PATROL_Z          = -0.80;  // camera sits at z≈1.78, island centre at z≈-3.3
const PATROL_Z_ARC      = 0.34;   // half-depth of the oval = width of each U-turn
const PATROL_SPEED      = 0.30;   // world units/s on the straights (old orbit ≈0.48)
const PATROL_TURN_SPEED_FACTOR = 0.45;  // speed at the turn apex, as a fraction of cruise
// Horizontal reach is fitted to the DEVICE frustum at PATROL_Z, so the pair
// sweeps the full width of whatever viewport has the site open and turns just
// inside the edges instead of vanishing off-screen.
const PATROL_X_FRUSTUM_FRACTION = 0.78;
const PATROL_X_HALF_MIN = 0.85;   // floor for very narrow viewports
const PATROL_BOB_AMP    = 0.05;
const PATROL_BOB_SPEED  = 1.1;    // rad/s
const PATROL_YAW_FOLLOW = 8.0;    // how fast the body swings onto the new heading
const PATROL_BANK       = 1.1;    // roll (rad) per rad/s of yaw rate
const PATROL_MAX_BANK   = 0.50;
const PATROL_MAX_PITCH  = 0.35;
const PATROL_ORIENT_SMOOTHING = 5.0;  // roll/pitch follow rate

// ── Follower behaviour ───────────────────────────────────────────────────────
// Dori replays the clownfish's own path from a variable number of seconds ago.
// Because the path is replayed rather than recomputed, Dori reproduces every
// turn exactly as the leader took it — including the banked U-turns — for free.
// Growing the delay makes Dori fall behind; shrinking it makes Dori catch up.
const FOLLOW_DELAY_BASE   = 0.90; // seconds behind while cruising
const FOLLOW_LAG_EXTRA    = 1.80; // extra delay at the peak of a "fell behind" episode
// Ramp durations must stay long enough that the delay never grows faster than
// 1 s/s — at exactly 1 the follower would freeze in place, beyond it he'd swim
// backwards. smoothstep peaks at 1.5× the average rate, so the guard is
// 1.5 * FOLLOW_LAG_EXTRA / FOLLOW_LAG_IN < 1.
const FOLLOW_LAG_IN       = 3.20; // seconds spent drifting back
const FOLLOW_LAG_HOLD_MIN = 1.50;
const FOLLOW_LAG_HOLD_MAX = 3.50;
const FOLLOW_LAG_OUT      = 3.40; // seconds spent catching back up
const FOLLOW_IDLE_MIN     = 7.0;  // seconds of tight following between episodes
const FOLLOW_IDLE_MAX     = 15.0;
const FOLLOW_OFFSET_Y     = -0.04;
const FOLLOW_OFFSET_Z     =  0.07;

// Leader path history. Sampled at a fixed cadence (not per frame) so the memory
// cost is the same at 30 fps and 144 fps, and must span the largest possible
// delay with headroom.
const TRAIL_SAMPLE_DT = 1 / 60;
const TRAIL_CAPACITY  = Math.ceil((FOLLOW_DELAY_BASE + FOLLOW_LAG_EXTRA + 1) / TRAIL_SAMPLE_DT);

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

// ── Sea turtles ──────────────────────────────────────────────────────────────
// Three turtles ride the same right-to-left stream as the generic fish (same Y
// band, same Z band, same respawn/avoidance logic) — they're just bigger,
// slower, and they drop to a crawl at night.
const TURTLE_COUNT = 3;
const TURTLE_SCALE = 0.22;               // model is ~1.43 units long at scale 1
const TURTLE_SPEED_MIN = 0.16;
const TURTLE_SPEED_MAX = 0.24;
const TURTLE_NIGHT_SPEED_FACTOR = 0.45;  // speed multiplier at full night
const TURTLE_ANIM_SPEED_MIN = 0.75;      // clip timeScale so the flippers vary per turtle
const TURTLE_ANIM_SPEED_MAX = 1.0;
// Night also slows the flipper stroke, otherwise a crawling turtle paddles
// like it's sprinting.
const TURTLE_NIGHT_ANIM_FACTOR = 0.55;

// ── Whale ────────────────────────────────────────────────────────────────────
// A single whale far behind everything else, crossing LEFT to RIGHT just below
// the generic-fish band, on a loop that restarts once it has fully cleared the
// right edge. Nearly invisible at night (smooth fade), so it reads as a
// daylight-only silhouette in the distance.
const WHALE_SCALE = 0.35;                // model is ~10.2 units long at scale 1
// Off-screen margin at each end of the run. The group's origin sits near the
// whale's middle, so slightly over half its length is enough for it to be fully
// gone before the loop resets — any more is just dead time with an empty stage.
const WHALE_MARGIN = 10.2 * WHALE_SCALE * 0.75;
const WHALE_Y = -7.8;                    // a touch below the generic fish band (-7 … -5)
const WHALE_Z = -9.0;                    // way back — well behind the fish/jelly volume
const WHALE_SPEED = 0.18;                // world units/s — a slow cruise
const WHALE_BOB_AMP = 0.10;
const WHALE_BOB_SPEED = 0.35;            // rad/s
const WHALE_NIGHT_OPACITY = 0.05;        // "almost invisible" at full night
const WHALE_X_FRUSTUM_FRACTION = 1.0;    // full frustum width; the length margin does the rest

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
function getViewHalfWidth(planeZ: number, fraction: number): number {
    const depth = Math.max(0.5, defaultCameraZ - planeZ);
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    return depth * _jellyTanHalfFov * aspect * fraction;
}
function getJellyXHalfWidth(jellyZ: number): number {
    return getViewHalfWidth(jellyZ, JELLY_X_FRUSTUM_FRACTION);
}

// ── Jellyfish scatter ────────────────────────────────────────────────────────
// Picking X/Y/Z independently at random is what made the jellies clump: with
// only ~10 of them, uniform sampling routinely leaves half the volume empty and
// stacks three in one corner. Each jelly instead gets a reserved slot —
// a jittered column in X, and a golden-ratio (low-discrepancy) offset in Y and
// Z — so the set covers the volume evenly at any pool size while still looking
// hand-scattered rather than gridded.
const JELLY_X_JITTER = 0.38;             // ± fraction of a column width
const JELLY_YZ_JITTER = 0.30;            // ± fraction of the Y/Z stratum
const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

// ── Jellyfish dodge (hover / touch) ──────────────────────────────────────────
// Jellies sit in front of the card carousel, so the point of this is purely
// "let me get it out of my way": once the pointer comes near, the jelly commits
// to a FULL vertical clearance (up or down, never sideways) and stays there
// while the pointer lingers, then drifts back. Triggering off the jelly's BASE
// position — not its dodged position — is what makes it commit: testing the
// live position would let it settle halfway out, right where it still blocks.
const JELLY_DODGE_RADIUS = 0.55;         // world units at the jelly's Z plane
const JELLY_DODGE_DISTANCE = 0.95;       // how far it clears
const JELLY_DODGE_SPEED = 3.2;           // approach rate (fast — get out of the way)
const JELLY_DODGE_RETURN_SPEED = 0.9;    // return rate (slow, unhurried drift back)
const JELLY_DODGE_SETTLED = 0.02;        // below this the dodge is considered finished
// Y band the dodge is allowed to leave the jelly in — keeps a dodging jelly
// from wandering out of the lit fish band entirely.
const JELLY_DODGE_Y_MIN = JELLY_Y_MIN - JELLY_DODGE_DISTANCE;
const JELLY_DODGE_Y_MAX = JELLY_Y_MAX + JELLY_DODGE_DISTANCE;
// A tap is a pointerdown/up in a few ms — without a linger the jelly would
// barely twitch on touch devices. Keep the last touch point "live" for this
// long so a tap produces the same full dodge a hover does.
const TOUCH_LINGER_SECONDS = 1.6;

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

// GLBs loaded by this module: clownfish, dorifish, genericfish, jellyfish,
// seaturtle, whale. Feeds isReady()/getDownloadFraction().
const FISH_MODEL_COUNT = 6;

// Fish color tint variants (multiplied on top of base texture)
const FISH_COLOR_TINTS: Color[] = [
    new Color(1.0, 1.0, 1.0),   // no filter (original)
    new Color(0.2, 0.4, 1.5),   // vibrant blue
    new Color(1.5, 1.3, 0.1),   // vibrant yellow
    new Color(0.1, 1.4, 0.2),   // vibrant green
    new Color(1.5, 0.15, 0.15), // vibrant red
];

// Identity tint — used by creatures that keep their authored colours (turtles).
const _noTint = new Color(1, 1, 1);

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

// Patrol pair
export const clownFish = new Group();
export const doriFish = new Group();
let clownMixer: AnimationMixer | null = null;
let doriMixer: AnimationMixer | null = null;

// Generic fish spawn system
export const genericFishContainer = new Group();
let genericFishTemplate: Group | null = null;
let genericFishAnimations: AnimationClip[] = [];

// Jellyfish spawn system (night mode)
let jellyfishTemplate: Group | null = null;
let jellyfishAnimations: AnimationClip[] = [];

// Sea turtle stream (shares the generic-fish flow)
let turtleTemplate: Group | null = null;
let turtleAnimations: AnimationClip[] = [];

/** Which stream a pooled clone belongs to. Drives scale, speed, tinting and
 *  whether the entry moves at all (jellies are stationary). */
type CreatureKind = 'fish' | 'jelly' | 'turtle';

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
    kind: CreatureKind;
    isJellyfish: boolean;     // convenience alias for kind === 'jelly'
    isTurtle: boolean;        // convenience alias for kind === 'turtle'
    actionStarted: boolean;
}

interface SwimmingFish {
    pool: PooledFish;         // reference back to pool entry for recycling
    speed: number;
    baseScale: number;
    baseY: number;
    velocityY: number;
    currentTilt: number;
    animSpeed: number;        // clip timeScale at full day (turtles vary it)
    // Jellyfish-only: stationary vertical bob
    floatPhase: number;       // current phase of the sin bob (rad)
    floatSpeed: number;       // rad/s
    floatAmp: number;         // world units
    // Jellyfish-only: pointer dodge (vertical clearance, see JELLY_DODGE_*)
    dodgeOffsetY: number;     // current vertical displacement from baseY
    dodgeDir: number;         // 0 = disengaged, ±1 = committed up/down
}

const fishPool: PooledFish[] = [];       // available (inactive) day fish
const jellyPool: PooledFish[] = [];      // available (inactive) night jellyfish
const turtlePool: PooledFish[] = [];     // available (inactive) sea turtles
const activeFish: SwimmingFish[] = [];   // in-scene swimming creatures
let fishPoolInitialized = false;
let jellyPoolInitialized = false;
let turtlePoolInitialized = false;
let fishModelsLoaded = 0;
let fixedLoopsInitialized = false;  // true once the generic-fish stream is seeded (isReady gate)
let fishLoopsSeeded = false;        // generic fish seeded into activeFish
let jellyLoopsSeeded = false;       // jellyfish seeded into activeFish
let turtleLoopsSeeded = false;      // sea turtles seeded into activeFish
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
// Seconds a lifted touch stays "live" for. A mouse hovers continuously, but a
// tap is over in milliseconds — without this the jelly dodge would never have
// time to play out on a phone. Counted down in Update().
let pointerLinger = 0;

function onPointerMove(e: PointerEvent): void {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNDC.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    pointerActive = true;
    pointerLinger = 0;
}

function onPointerLeave(e?: PointerEvent): void {
    // Touch/pen: keep the last point alive briefly instead of dropping it the
    // instant the finger lifts. Mouse: leaving the canvas really is "gone".
    if (e && e.pointerType !== 'mouse') {
        pointerLinger = TOUCH_LINGER_SECONDS;
        return;
    }
    pointerActive = false;
    pointerLinger = 0;
    pointerNDC.set(9999, 9999);
}

function tickPointerLinger(dt: number): void {
    if (pointerLinger <= 0) return;
    pointerLinger -= dt;
    if (pointerLinger <= 0) {
        pointerLinger = 0;
        pointerActive = false;
        pointerNDC.set(9999, 9999);
    }
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
function createPoolEntry(template: Group, animations: AnimationClip[], kind: CreatureKind = 'fish'): PooledFish {
    const jellyfish = kind === 'jelly';
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
        kind,
        isJellyfish: jellyfish,
        isTurtle: kind === 'turtle',
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
        const entry = createPoolEntry(genericFishTemplate, genericFishAnimations, 'fish');
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
        const entry = createPoolEntry(jellyfishTemplate, jellyfishAnimations, 'jelly');
        genericFishContainer.add(entry.group);
        jellyPool.push(entry);
    }
    initFixedCreatureLoops();
}

/** Build the sea-turtle pool synchronously inside the loader callback. */
function initTurtlePool(): void {
    if (turtlePoolInitialized || !turtleTemplate) return;
    turtlePoolInitialized = true;
    for (let i = 0; i < TURTLE_COUNT; i++) {
        const entry = createPoolEntry(turtleTemplate, turtleAnimations, 'turtle');
        genericFishContainer.add(entry.group);
        turtlePool.push(entry);
    }
    initFixedCreatureLoops();
}

/** No-op kept for call-site compatibility — pool is now built synchronously at load. */
function tickPoolCreation(): void {}

/** Low-discrepancy position in [0,1) for slot `i` — successive values land in
 *  the largest remaining gap, so N slots always cover the range evenly. */
function goldenSlot(i: number, offset: number): number {
    return (offset + i * GOLDEN_RATIO_CONJUGATE) % 1;
}

/** Place one jellyfish in its reserved slot of the scatter volume.
 *  See the JELLY_X_JITTER / GOLDEN_RATIO_CONJUGATE comments for why this isn't
 *  three independent Math.random() draws. */
function placeJellyInSlot(entry: PooledFish, slot: number, slotCount: number): { x: number; y: number; z: number } {
    const total = Math.max(1, slotCount);
    // Y and Z: golden-ratio sequence with different offsets so the two axes
    // don't correlate into a diagonal line.
    const yT = goldenSlot(slot, 0.13) + (Math.random() - 0.5) * JELLY_YZ_JITTER / total;
    const zT = goldenSlot(slot, 0.71) + (Math.random() - 0.5) * JELLY_YZ_JITTER / total;
    const y = JELLY_Y_MIN + MathUtils.clamp(yT, 0, 1) * (JELLY_Y_MAX - JELLY_Y_MIN);
    const z = JELLY_Z_MIN + MathUtils.clamp(zT, 0, 1) * (JELLY_Z_MAX - JELLY_Z_MIN);
    // X: one jittered column per jelly across the frustum width at that Z, so
    // the horizontal spread is guaranteed rather than hoped for.
    const xHalf = getJellyXHalfWidth(z);
    const column = (slot + 0.5) / total;                       // 0…1 across the band
    const jitter = (Math.random() - 0.5) * (JELLY_X_JITTER / total);
    const x = (MathUtils.clamp(column + jitter, 0, 1) * 2 - 1) * xHalf;
    entry.group.position.set(x, y, z);
    return { x, y, z };
}

function resetLoopingCreature(entry: PooledFish, slot = 0, slotCount = 1): SwimmingFish {
    const jelly = entry.isJellyfish;
    const turtle = entry.isTurtle;
    // Turtles keep their own shell colouring — running them through the fish
    // tint palette would turn them electric blue/red alongside the fish.
    const tints = jelly ? JELLY_COLOR_TINTS : FISH_COLOR_TINTS;
    const baseScale = jelly ? JELLYFISH_SCALE : (turtle ? TURTLE_SCALE : GENERIC_FISH_SCALE);

    const tint = turtle ? _noTint : tints[Math.floor(Math.random() * tints.length)];
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

    // Turtles are all the same size by design — only the fish vary.
    const scaleMult = turtle ? 1 : FISH_SCALE_MIN + Math.random() * (FISH_SCALE_MAX - FISH_SCALE_MIN);
    const scale = baseScale * scaleMult;

    if (jelly) {
        const { x, y, z } = placeJellyInSlot(entry, slot, slotCount);
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
            animSpeed: 1,
            floatPhase: Math.random() * Math.PI * 2,
            floatSpeed: JELLY_FLOAT_SPEED_MIN + Math.random() * (JELLY_FLOAT_SPEED_MAX - JELLY_FLOAT_SPEED_MIN),
            floatAmp: JELLY_FLOAT_AMPLITUDE * (0.7 + Math.random() * 0.6),
            dodgeOffsetY: 0,
            dodgeDir: 0,
        };
    }

    const zMin = GENERIC_FISH_Z_MIN;
    const zMax = GENERIC_FISH_Z_MAX;
    const speedMin = turtle ? TURTLE_SPEED_MIN : GENERIC_FISH_SPEED_MIN;
    const speedMax = turtle ? TURTLE_SPEED_MAX : GENERIC_FISH_SPEED_MAX;

    // Respawn: the creature just despawned at the left edge and is being placed
    // back beyond the right one. Pick a Y that isn't crowding anything else
    // already sitting near the spawn edge.
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
        animSpeed: turtle
            ? TURTLE_ANIM_SPEED_MIN + Math.random() * (TURTLE_ANIM_SPEED_MAX - TURTLE_ANIM_SPEED_MIN)
            : 1,
        floatPhase: 0,
        floatSpeed: 0,
        floatAmp: 0,
        dodgeOffsetY: 0,
        dodgeDir: 0,
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
    if (entry.isJellyfish) return resetLoopingCreature(entry, index, total);

    const turtle = entry.isTurtle;
    const tint = turtle ? _noTint : FISH_COLOR_TINTS[Math.floor(Math.random() * FISH_COLOR_TINTS.length)];
    for (let i = 0; i < entry.materials.length; i++) {
        entry.materials[i].color.copy(entry.baseTintColors[i]).multiply(tint);
        entry.activeTintColors[i].copy(entry.materials[i].color);
    }
    entry.lightColor.copy(tint);

    const scaleMult = turtle ? 1 : FISH_SCALE_MIN + Math.random() * (FISH_SCALE_MAX - FISH_SCALE_MIN);
    const scale = (turtle ? TURTLE_SCALE : GENERIC_FISH_SCALE) * scaleMult;

    const z = GENERIC_FISH_Z_MIN + Math.random() * (GENERIC_FISH_Z_MAX - GENERIC_FISH_Z_MIN);
    const _edges = getFrustumEdgesX(z);
    // Guard against a degenerate camera projection at seed time. This runs from
    // the async GLB-load callback during the loading screen, before the camera is
    // necessarily set up, so the unprojection can return a non-finite edge. That
    // would seed the fish at x = NaN — and because `NaN < despawnX` is always
    // false the fish would NEVER despawn/respawn, staying invisible for the whole
    // session (the intermittent "generic fish don't render" bug). resetLooping-
    // Creature already guards the same way; this is the one seed path that didn't.
    const spawnX   = Number.isFinite(_edges.spawnX)   ? _edges.spawnX   :  5.5;
    const despawnX = Number.isFinite(_edges.despawnX) ? _edges.despawnX : -5.5;
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

    const speedMin = turtle ? TURTLE_SPEED_MIN : GENERIC_FISH_SPEED_MIN;
    const speedMax = turtle ? TURTLE_SPEED_MAX : GENERIC_FISH_SPEED_MAX;

    return {
        pool: entry,
        speed: speedMin + Math.random() * (speedMax - speedMin),
        baseScale: scale,
        baseY: y,
        velocityY: 0,
        currentTilt: 0,
        animSpeed: turtle
            ? TURTLE_ANIM_SPEED_MIN + Math.random() * (TURTLE_ANIM_SPEED_MAX - TURTLE_ANIM_SPEED_MIN)
            : 1,
        floatPhase: 0,
        floatSpeed: 0,
        floatAmp: 0,
        dodgeOffsetY: 0,
        dodgeDir: 0,
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

// Z-plane (depth into the scene) the prewarm grid is parked on — inside the
// generic-fish / jelly Z band so getFrustumEdgesX gives sane horizontal extents.
const CREATURE_PREWARM_Z = -2.0;

/** Force every pooled creature clone (generic fish AND jellyfish) to be DRAWN
 *  in-frustum once during the loading-screen prewarm, so each clone's per-instance
 *  GPU buffers upload now rather than on first dive/scroll.
 *
 *  renderer.compile() warms shader PROGRAMS for the whole scene, but geometry
 *  VBOs, per-instance skinned-mesh BONE TEXTURES and cloned-material textures only
 *  upload when an object is actually rendered while inside the frustum. The
 *  pooled clones sit at scattered positions that the fixed prewarm camera passes
 *  don't cover, so without this they upload lazily on the first real frame they
 *  enter view — that's the dive/fish-band stutter (made worse by reseedActiveFishX,
 *  which teleports the whole generic stream into view at once on dive).
 *
 *  Parks all clones in a grid directly in front of the camera (which it points at a
 *  deterministic underwater pose), makes them visible/opaque, poses their skeletons,
 *  then the caller renders one underwater frame. The returned closure restores every
 *  touched transform / visibility / material / light value. The camera pose is
 *  restored by prewarmGPU's outer finally. Follows beginJellyfishPrewarm's
 *  save/restore pattern and the jelly PointLight contract (never toggle light.visible). */
export function beginCreaturePrewarm(): () => void {
    const savedContainerVisible = genericFishContainer.visible;
    genericFishContainer.visible = true;

    // Aim the camera straight down -Z at the fish Y band so the parked grid is
    // unambiguously in-frustum and the frustum-edge math reads a clean projection.
    const yMid = (GENERIC_FISH_Y_MIN + GENERIC_FISH_Y_MAX) * 0.5;
    camera.position.set(0, yMid, defaultCameraZ);
    camera.lookAt(0, yMid, CREATURE_PREWARM_Z);
    camera.updateProjectionMatrix();

    // Collect every clone: pools are spliced empty once seeded into activeFish, so
    // union all three sources and dedup by identity (belt-and-suspenders).
    const entries = new Set<PooledFish>();
    for (const e of fishPool) entries.add(e);
    for (const e of jellyPool) entries.add(e);
    for (const e of turtlePool) entries.add(e);
    for (const f of activeFish) entries.add(f.pool);
    const clones = [...entries];

    // Horizontal extent of the frustum at the grid plane, with a small margin.
    const { spawnX, despawnX } = getFrustumEdgesX(CREATURE_PREWARM_Z);
    const rightX = Number.isFinite(spawnX)   ? spawnX   - SCREEN_MARGIN :  4.0;
    const leftX  = Number.isFinite(despawnX) ? despawnX + SCREEN_MARGIN : -4.0;

    const cols = Math.max(1, Math.ceil(Math.sqrt(clones.length)));
    const rows = Math.max(1, Math.ceil(clones.length / cols));

    const saved: Array<{
        entry: PooledFish;
        position: Vector3;
        scale: Vector3;
        rotX: number; rotY: number; rotZ: number;
        visible: boolean;
        opacity: number[];
        emissiveIntensity: number[];
        lightIntensity: number;
        lightPos: Vector3 | null;
    }> = [];

    for (let i = 0; i < clones.length; i++) {
        const entry = clones[i];
        const group = entry.group;
        saved.push({
            entry,
            position: group.position.clone(),
            scale: group.scale.clone(),
            rotX: group.rotation.x, rotY: group.rotation.y, rotZ: group.rotation.z,
            visible: group.visible,
            opacity: entry.materials.map(m => m.opacity),
            emissiveIntensity: entry.materials.map(m => m.emissiveIntensity),
            lightIntensity: entry.light ? entry.light.intensity : 0,
            lightPos: entry.light ? entry.light.position.clone() : null,
        });

        // Grid cell position on the parking plane.
        const col = i % cols;
        const row = Math.floor(i / cols);
        const fx = cols > 1 ? col / (cols - 1) : 0.5;
        const fy = rows > 1 ? row / (rows - 1) : 0.5;
        const x = leftX + (rightX - leftX) * fx;
        const y = GENERIC_FISH_Y_MIN + (GENERIC_FISH_Y_MAX - GENERIC_FISH_Y_MIN) * fy;
        group.position.set(x, y, CREATURE_PREWARM_Z);
        group.scale.setScalar(entry.isJellyfish ? JELLYFISH_SCALE : (entry.isTurtle ? TURTLE_SCALE : GENERIC_FISH_SCALE));
        group.visible = true;

        if (entry.isJellyfish) {
            for (const mat of entry.materials) {
                mat.opacity = JELLY_OPACITY;
                mat.emissiveIntensity = JELLY_EMISSIVE_INTENSITY;
            }
            // Warm the lit per-light fragment path (see beginJellyfishPrewarm).
            // Only intensity may change — never light.visible (Fish.ts contract).
            if (entry.light) {
                entry.light.intensity = jellyfishLightConfig.intensity;
                entry.light.position.copy(group.position);
            }
        }

        // Pose the skeleton so the bone texture is populated before the draw.
        ensureLoopAction(entry);
        entry.mixer.update(0);
    }

    // The whale is a single fixed-position mesh rather than a pool entry, but it
    // still has geometry/bone-texture uploads that would otherwise land on the
    // frame it first drifts into view. Park it on the same plane.
    const savedWhale = {
        position: whaleGroup.position.clone(),
        scale: whaleGroup.scale.clone(),
        visible: whaleGroup.visible,
    };
    whaleGroup.position.set(0, GENERIC_FISH_Y_MIN, CREATURE_PREWARM_Z);
    // Shrunk so a 3.5-unit whale doesn't eclipse the parked creature grid it
    // shares the plane with — the point is the upload, not the framing.
    whaleGroup.scale.setScalar(WHALE_SCALE * 0.25);
    whaleGroup.visible = whaleReady;
    if (whaleMixer) whaleMixer.update(0);

    return () => {
        genericFishContainer.visible = savedContainerVisible;
        whaleGroup.position.copy(savedWhale.position);
        whaleGroup.scale.copy(savedWhale.scale);
        whaleGroup.visible = savedWhale.visible;
        for (const s of saved) {
            const group = s.entry.group;
            group.position.copy(s.position);
            group.scale.copy(s.scale);
            group.rotation.set(s.rotX, s.rotY, s.rotZ);
            group.visible = s.visible;
            for (let i = 0; i < s.entry.materials.length; i++) {
                s.entry.materials[i].opacity = s.opacity[i];
                s.entry.materials[i].emissiveIntensity = s.emissiveIntensity[i];
            }
            if (s.entry.light) {
                s.entry.light.intensity = s.lightIntensity;
                if (s.lightPos) s.entry.light.position.copy(s.lightPos);
            }
        }
    };
}

function initFixedCreatureLoops(): void {
    // Seed the generic-fish and jellyfish streams INDEPENDENTLY. They used to
    // share one gate that required BOTH pools (`!fishPoolInitialized ||
    // !jellyPoolInitialized → return`), so a failed/slow jellyfish.glb load
    // (onLoadError leaves jellyPoolInitialized false forever) silently left the
    // scene with no generic fish at all. Decoupled, the generic fish spawn as
    // soon as their own pool is ready, regardless of the jellyfish.
    if (!fishLoopsSeeded && fishPoolInitialized) {
        fishLoopsSeeded = true;
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
        // isReady()/prewarm gate — the generic fish are the critical stream; the
        // jellyfish are night-only and may legitimately never load.
        fixedLoopsInitialized = true;
    }

    if (!jellyLoopsSeeded && jellyPoolInitialized) {
        jellyLoopsSeeded = true;
        const jellyEntries = jellyPool.splice(0);
        for (let i = 0; i < jellyEntries.length; i++) {
            activeFish.push(resetLoopingCreature(jellyEntries[i], i, jellyEntries.length));
        }
    }

    if (!turtleLoopsSeeded && turtlePoolInitialized) {
        turtleLoopsSeeded = true;
        const turtleEntries = turtlePool.splice(0);
        for (let i = 0; i < turtleEntries.length; i++) {
            activeFish.push(seedInitialFish(turtleEntries[i], i, turtleEntries.length));
        }
    }
}

export function isReady(): boolean {
    return fishModelsLoaded >= FISH_MODEL_COUNT && fixedLoopsInitialized;
}

/** 0–1 download progress. fishModelsLoaded advances on both success and
 *  failure (see onLoadError) so it always reaches 1 — feeds the unified
 *  loading bar in Scene.getStartupProgress(). */
export function getDownloadFraction(): number {
    return Math.min(fishModelsLoaded / FISH_MODEL_COUNT, 1);
}

// ── Active jellyfish lights (consumed by effects/CardCarousel) ───────────────
// Snapshot of every jellyfish PointLight that is currently contributing light
// (intensity already includes day/night + underwater visibility, so consumers
// get 0-length results during the day for free). The array and its slots are
// reused across calls — treat the result as read-only and don't hold on to it.
export interface ActiveJellyLight { x: number; y: number; z: number; color: Color; intensity: number; }
const _jellyLightsOut: ActiveJellyLight[] = [];
export function getActiveJellyLights(): ActiveJellyLight[] {
    let n = 0;
    for (let i = 0; i < activeFish.length; i++) {
        const pool = activeFish[i].pool;
        if (!pool.isJellyfish || !pool.light) continue;
        if (pool.light.intensity <= 0.01 || !pool.group.visible) continue;
        if (n >= _jellyLightsOut.length) {
            _jellyLightsOut.push({ x: 0, y: 0, z: 0, color: new Color(), intensity: 0 });
        }
        const slot = _jellyLightsOut[n++];
        slot.x = pool.light.position.x;
        slot.y = pool.light.position.y;
        slot.z = pool.light.position.z;
        slot.color.copy(pool.lightColor);
        slot.intensity = pool.light.intensity;
    }
    _jellyLightsOut.length = n;
    return _jellyLightsOut;
}

/** Debug snapshot — used by `window.__diag()` to inspect fish state. */
export function getDiagState() {
    let visibleFish = 0, visibleJellies = 0, visibleTurtles = 0, nanX = 0;
    const xs: number[] = [];
    for (const f of activeFish) {
        const x = f.pool.group.position.x;
        if (!Number.isFinite(x)) nanX++;
        if (f.pool.isJellyfish) {
            if (f.pool.group.visible) visibleJellies++;
        } else {
            xs.push(x);
            if (f.pool.group.visible) {
                if (f.pool.isTurtle) visibleTurtles++; else visibleFish++;
            }
        }
    }
    xs.sort((a, b) => a - b);
    return {
        activeFish: activeFish.length,
        visibleFish,
        visibleJellies,
        visibleTurtles,
        whaleVisible: whaleGroup.visible,
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

    // The patrol reach and the whale's run length are fitted to the viewport, so
    // they have to be refitted when it changes.
    window.addEventListener('resize', refitViewportExtents);
    refitViewportExtents();
    startPatrol();

    // Reserve the whale's slot in genericFishContainer NOW, before the pooled
    // creatures are added. sortObjects is false, so the transparent pass draws
    // this container's children in add order — the whale sits far behind
    // everything else and must be painted first or it would overwrite the fish
    // and jellies in front of it.
    clownFish.rotation.order = 'YXZ';
    doriFish.rotation.order = 'YXZ';
    whaleGroup.rotation.order = 'YXZ';
    whaleGroup.visible = false;
    genericFishContainer.add(whaleGroup);

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
            clownFish.scale.setScalar(PATROL_FISH_SCALE);
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
            doriFish.scale.setScalar(PATROL_FISH_SCALE);
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

    // Load sea turtle template — joins the generic-fish stream
    loader.load(
        'models/underwater/seaturtle.glb',
        (gltf) => {
            turtleTemplate = gltf.scene;
            turtleAnimations = gltf.animations;
            fishModelsLoaded++;
            initTurtlePool();
        },
        undefined,
        onLoadError('models/underwater/seaturtle.glb'),
    );

    // Load the background whale
    loader.load(
        'models/underwater/whale.glb',
        (gltf) => {
            setupWhale(gltf.scene, gltf.animations);
            fishModelsLoaded++;
        },
        undefined,
        onLoadError('models/underwater/whale.glb'),
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

// ╔════════════════════════════════════════════════════════════════════════════
// ║  PATROL PAIR — clownfish leads, dori follows, right↔left in front of the island
// ╚════════════════════════════════════════════════════════════════════════════

// Both the patrol reach and the whale's run length are measured against the
// RESTING camera (fixed z/fov from CameraConfig) rather than the live one. The
// live camera scrolls through 13 world units of depth-of-field every session;
// deriving the extents from it would make the fish visibly stretch and snap
// their turn-around points as the user scrolls. Refitted on resize only.
let patrolHalfWidth = 2.0;
let whaleHalfWidth  = 6.0;

function refitViewportExtents(): void {
    patrolHalfWidth = Math.max(PATROL_X_HALF_MIN, getViewHalfWidth(PATROL_Z, PATROL_X_FRUSTUM_FRACTION));
    whaleHalfWidth  = getViewHalfWidth(WHALE_Z, WHALE_X_FRUSTUM_FRACTION);
}

/** Body orientation carried between frames for one swimmer. */
interface SwimPose {
    yaw: number; roll: number; pitch: number;
    px: number; py: number; pz: number;
    seeded: boolean;
}
function newSwimPose(): SwimPose {
    return { yaw: 0, roll: 0, pitch: 0, px: 0, py: 0, pz: 0, seeded: false };
}
const clownPose = newSwimPose();
const doriPose  = newSwimPose();

/** Move `group` to (x,y,z) and orient it from the motion that took it there:
 *  yaw onto the heading, roll banked INTO the turn, pitch from the climb rate.
 *  The banking is what sells the U-turns — a fish that changes heading without
 *  rolling reads as a sprite being rotated, not an animal turning. */
function applySwimPose(group: Group, pose: SwimPose, x: number, y: number, z: number, dt: number): void {
    const vx = pose.seeded ? x - pose.px : 0;
    const vy = pose.seeded ? y - pose.py : 0;
    const vz = pose.seeded ? z - pose.pz : 0;
    pose.px = x; pose.py = y; pose.pz = z;

    const horizontal = Math.hypot(vx, vz);
    let yawRate = 0;
    if (horizontal > 1e-5) {
        // The model's nose is local +Z (same convention the pooled fish use via
        // their -π/2 yaw), so the heading is atan2(x, z).
        const targetYaw = Math.atan2(vx, vz);
        let delta = targetYaw - pose.yaw;
        while (delta >  Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        if (!pose.seeded) {
            pose.yaw = targetYaw;
        } else {
            const step = delta * Math.min(1, PATROL_YAW_FOLLOW * dt);
            pose.yaw += step;
            yawRate = dt > 1e-5 ? step / dt : 0;
        }
    }
    pose.seeded = true;

    // Nose-forward is +Z and right is +X, so an increasing yaw is a RIGHT turn
    // and banking into it means dropping the right wing → negative roll.
    const targetRoll = MathUtils.clamp(-yawRate * PATROL_BANK, -PATROL_MAX_BANK, PATROL_MAX_BANK);
    const targetPitch = MathUtils.clamp(
        -Math.atan2(vy, Math.max(horizontal, 1e-4)),
        -PATROL_MAX_PITCH, PATROL_MAX_PITCH,
    );
    const follow = Math.min(1, PATROL_ORIENT_SMOOTHING * dt);
    pose.roll  += (targetRoll  - pose.roll)  * follow;
    pose.pitch += (targetPitch - pose.pitch) * follow;

    group.position.set(x, y, z);
    group.rotation.set(pose.pitch, pose.yaw, pose.roll);
}

// ── Leader state ─────────────────────────────────────────────────────────────
let patrolTheta = 0;   // parameter along the oval
let patrolClock = 0;   // seconds since the patrol started; also the trail timebase

// ── Leader path history (fixed-cadence ring buffer) ──────────────────────────
const _trailT = new Float32Array(TRAIL_CAPACITY);
const _trailX = new Float32Array(TRAIL_CAPACITY);
const _trailY = new Float32Array(TRAIL_CAPACITY);
const _trailZ = new Float32Array(TRAIL_CAPACITY);
let _trailHead = -1;      // index of the newest sample
let _trailLength = 0;     // samples currently held (≤ TRAIL_CAPACITY)
let _trailNextAt = 0;     // patrolClock at which the next sample is due

function pushTrail(t: number, x: number, y: number, z: number): void {
    if (_trailLength > 0 && t < _trailNextAt) return;
    _trailNextAt = t + TRAIL_SAMPLE_DT;
    _trailHead = (_trailHead + 1) % TRAIL_CAPACITY;
    _trailT[_trailHead] = t;
    _trailX[_trailHead] = x;
    _trailY[_trailHead] = y;
    _trailZ[_trailHead] = z;
    if (_trailLength < TRAIL_CAPACITY) _trailLength++;
}

const _trailOut = new Vector3();
/** Leader position at absolute time `t`, linearly interpolated between samples.
 *  Times older than the buffer clamp to its oldest sample (only reachable in
 *  the first fraction of a second, before the prefill in startPatrol lands). */
function sampleTrail(t: number): Vector3 {
    if (_trailLength === 0) { _trailOut.set(0, PATROL_Y, PATROL_Z); return _trailOut; }
    let newer = _trailHead;
    for (let step = 0; step < _trailLength; step++) {
        const idx = (_trailHead - step + TRAIL_CAPACITY) % TRAIL_CAPACITY;
        if (_trailT[idx] <= t) {
            if (step === 0) { _trailOut.set(_trailX[idx], _trailY[idx], _trailZ[idx]); return _trailOut; }
            const span = _trailT[newer] - _trailT[idx];
            const f = span > 1e-6 ? (t - _trailT[idx]) / span : 0;
            _trailOut.set(
                _trailX[idx] + (_trailX[newer] - _trailX[idx]) * f,
                _trailY[idx] + (_trailY[newer] - _trailY[idx]) * f,
                _trailZ[idx] + (_trailZ[newer] - _trailZ[idx]) * f,
            );
            return _trailOut;
        }
        newer = idx;
    }
    const oldest = (_trailHead - _trailLength + 1 + TRAIL_CAPACITY) % TRAIL_CAPACITY;
    _trailOut.set(_trailX[oldest], _trailY[oldest], _trailZ[oldest]);
    return _trailOut;
}

// ── Follower lag episodes ────────────────────────────────────────────────────
type LagPhase = 'idle' | 'fallingBehind' | 'trailing' | 'catchingUp';
let lagPhase: LagPhase = 'idle';
let lagTimer = 0;
let lagAmount = 0;   // 0 = tight on the leader's tail, 1 = fully lagged

function randRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function updateFollowerLag(dt: number): number {
    lagTimer -= dt;
    switch (lagPhase) {
        case 'idle':
            if (lagTimer <= 0) { lagPhase = 'fallingBehind'; lagTimer = FOLLOW_LAG_IN; }
            break;
        case 'fallingBehind':
            lagAmount = 1 - Math.max(0, lagTimer) / FOLLOW_LAG_IN;
            if (lagTimer <= 0) {
                lagAmount = 1;
                lagPhase = 'trailing';
                lagTimer = randRange(FOLLOW_LAG_HOLD_MIN, FOLLOW_LAG_HOLD_MAX);
            }
            break;
        case 'trailing':
            if (lagTimer <= 0) { lagPhase = 'catchingUp'; lagTimer = FOLLOW_LAG_OUT; }
            break;
        case 'catchingUp':
            lagAmount = Math.max(0, lagTimer) / FOLLOW_LAG_OUT;
            if (lagTimer <= 0) {
                lagAmount = 0;
                lagPhase = 'idle';
                lagTimer = randRange(FOLLOW_IDLE_MIN, FOLLOW_IDLE_MAX);
            }
            break;
    }
    return FOLLOW_DELAY_BASE + FOLLOW_LAG_EXTRA * smooth01(lagAmount);
}

/** Advance the leader along the oval by `dt` and record the new point. */
function stepLeader(dt: number): void {
    const cosT = Math.cos(patrolTheta);
    const sinT = Math.sin(patrolTheta);

    // Arc-length stepping: dθ is scaled by the local |dP/dθ| so the fish holds a
    // real world-space speed instead of racing down the straights and stalling
    // in the (much tighter) turns. On top of that the speed itself eases down
    // through each turn — |cos θ| is 1 mid-straight and 0 at the apex.
    const tangentX = cosT * patrolHalfWidth;
    const tangentZ = -sinT * PATROL_Z_ARC;
    const tangentLen = Math.max(1e-4, Math.hypot(tangentX, tangentZ));
    const speed = PATROL_SPEED * (PATROL_TURN_SPEED_FACTOR + (1 - PATROL_TURN_SPEED_FACTOR) * Math.abs(cosT));

    patrolTheta += (speed / tangentLen) * dt;
    if (patrolTheta > Math.PI * 2) patrolTheta -= Math.PI * 2;
    patrolClock += dt;

    pushTrail(
        patrolClock,
        defaultCameraX + Math.sin(patrolTheta) * patrolHalfWidth,
        PATROL_Y + Math.sin(patrolClock * PATROL_BOB_SPEED) * PATROL_BOB_AMP,
        PATROL_Z + Math.cos(patrolTheta) * PATROL_Z_ARC,
    );
}

/** Pre-roll the leader so the trail already spans the longest follow delay by
 *  the first rendered frame. Without it Dori would sit frozen on the leader's
 *  spawn point until enough history accumulated. */
function startPatrol(): void {
    // Start a third of the way down the first straight, heading right-to-left.
    patrolTheta = Math.PI * 0.5;
    lagTimer = randRange(FOLLOW_IDLE_MIN, FOLLOW_IDLE_MAX);
    const prerollSteps = Math.ceil((FOLLOW_DELAY_BASE + FOLLOW_LAG_EXTRA + 0.5) / TRAIL_SAMPLE_DT);
    for (let i = 0; i < prerollSteps; i++) stepLeader(TRAIL_SAMPLE_DT);
}

function updatePatrol(dt: number): void {
    stepLeader(dt);

    const lead = sampleTrail(patrolClock);
    applySwimPose(clownFish, clownPose, lead.x, lead.y, lead.z, dt);

    const delay = updateFollowerLag(dt);
    const follow = sampleTrail(patrolClock - delay);
    applySwimPose(
        doriFish, doriPose,
        follow.x, follow.y + FOLLOW_OFFSET_Y, follow.z + FOLLOW_OFFSET_Z,
        dt,
    );

    clownFish.visible = shouldShowCircleFish(clownFish);
    doriFish.visible = shouldShowCircleFish(doriFish);
}

// ╔════════════════════════════════════════════════════════════════════════════
// ║  WHALE — one slow left→right pass far behind the scene, looping
// ╚════════════════════════════════════════════════════════════════════════════

export const whaleGroup = new Group();
let whaleMixer: AnimationMixer | null = null;
const whaleMaterials: MeshStandardMaterial[] = [];
let whaleX = 0;
let whaleClock = 0;
let whaleReady = false;

function whaleStartX(): number { return -(whaleHalfWidth + WHALE_MARGIN); }
function whaleEndX(): number   { return  (whaleHalfWidth + WHALE_MARGIN); }

function setupWhale(model: Group, animations: AnimationClip[]): void {
    model.traverse((child) => {
        if (!(child instanceof Mesh) || !child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        const cloned = mats.map((m) => {
            const mat = (m as MeshStandardMaterial).clone();
            // Transparency is configured ONCE here, never toggled at runtime:
            // flipping `transparent` mid-session forces a shader recompile, and
            // the night fade needs to run every frame. depthWrite stays on so
            // the whale's own far-side geometry doesn't show through its body
            // while it's still mostly opaque.
            mat.transparent = true;
            mat.depthWrite = true;
            mat.opacity = 1;
            return mat;
        });
        child.material = cloned.length === 1 ? cloned[0] : cloned;
        for (const mat of cloned) whaleMaterials.push(mat);
    });

    whaleGroup.add(model);
    whaleGroup.scale.setScalar(WHALE_SCALE);
    // Nose is local +Z, so +π/2 yaw points it along +X — the direction it swims.
    whaleGroup.rotation.set(0, Math.PI / 2, 0);
    whaleX = whaleStartX();
    whaleGroup.position.set(whaleX, WHALE_Y, WHALE_Z);

    if (animations.length > 0) {
        whaleMixer = new AnimationMixer(model);
        const action = whaleMixer.clipAction(animations[0]);
        action.setLoop(LoopRepeat, Infinity);
        action.play();
    }
    whaleReady = true;
}

function updateWhale(dt: number, nightBlend: number): void {
    if (!whaleReady) return;

    whaleClock += dt;
    whaleX += WHALE_SPEED * dt;
    // Loop only once the whale has fully cleared the right edge, so the reset
    // never happens on screen.
    if (whaleX > whaleEndX()) whaleX = whaleStartX();

    whaleGroup.position.set(
        whaleX,
        WHALE_Y + Math.sin(whaleClock * WHALE_BOB_SPEED) * WHALE_BOB_AMP,
        WHALE_Z,
    );
    if (whaleMixer) whaleMixer.update(dt);

    // Smooth day→night fade to "almost invisible". nightBlend is already the
    // eased day/night blend, so the opacity tracks the sky transition exactly.
    const opacity = 1 + (WHALE_NIGHT_OPACITY - 1) * nightBlend;
    for (let i = 0; i < whaleMaterials.length; i++) whaleMaterials[i].opacity = opacity;

    whaleGroup.visible = shouldShowCircleFish(whaleGroup);
}

export function Update(): void {
    const jellyVisibility = getJellyVisibility();
    // Same shape as jellyVisibility for now (both derived from day/night
    // blend), but keep as separate variable in case we want to decouple later.
    const fishAlbedoFactor = 1 - jellyVisibility * FISH_NIGHT_DARKEN;

    tickPointerLinger(deltaTime);

    // Update animations
    if (clownMixer) clownMixer.update(deltaTime);
    if (doriMixer) doriMixer.update(deltaTime);

    // Patrol pair + background whale
    updatePatrol(deltaTime);
    updateWhale(deltaTime, jellyVisibility);

    // Lazy-init pools if templates loaded after Start()
    if (!fishPoolInitialized && genericFishTemplate) initFishPool();
    if (!jellyPoolInitialized && jellyfishTemplate) initJellyPool();
    if (!turtlePoolInitialized && turtleTemplate) initTurtlePool();

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
        // Turtles ease off their stroke at night to match the slower cruise.
        const animScale = fish.pool.isTurtle
            ? fish.animSpeed * (1 + (TURTLE_NIGHT_ANIM_FACTOR - 1) * jellyVisibility)
            : fish.animSpeed;
        fish.pool.mixer.update(deltaTime * animScale);

        if (fish.pool.isJellyfish) {
            // Stationary jellyfish: no horizontal motion, no despawn. A gentle
            // vertical bob around baseY, plus the pointer dodge — which is
            // purely vertical so the user can clear a path through them.
            fish.floatPhase += fish.floatSpeed * deltaTime;
            updateJellyDodge(fish, group.position.x, group.position.z, deltaTime);
            group.position.y = MathUtils.clamp(
                fish.baseY + Math.sin(fish.floatPhase) * fish.floatAmp + fish.dodgeOffsetY,
                JELLY_DODGE_Y_MIN, JELLY_DODGE_Y_MAX,
            );
            // Light lives at scene root — sync world position from the group.
            if (fish.pool.light) fish.pool.light.position.copy(group.position);
            continue;
        }

        // Night slows the turtles down — the fish keep their pace.
        const speedScale = fish.pool.isTurtle
            ? 1 + (TURTLE_NIGHT_SPEED_FACTOR - 1) * jellyVisibility
            : 1;
        group.position.x -= fish.speed * speedScale * deltaTime;

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
        // Recycle when the fish drifts past the left edge — OR if its position
        // ever went non-finite. A NaN x never satisfies `x < despawnX`, so without
        // this self-heal such a fish would be stuck invisible forever; reseeding
        // it through resetLoopingCreature (which clamps to a valid right edge)
        // brings it back. Belt-and-suspenders for getDiagState().nanX.
        if (!Number.isFinite(group.position.x) || group.position.x < despawnX) {
            activeFish[i] = resetLoopingCreature(fish.pool);
        }
    }
}

/** Vertical-only "get out of my way" dodge for one jellyfish.
 *
 *  Triggering off the jelly's RESTING position rather than its live one is the
 *  whole trick: with a live test the jelly would drift until it left the
 *  trigger radius and then stop — parking itself halfway, still in the way.
 *  Anchored to the base position it commits to the full clearance and holds it
 *  for as long as the pointer stays put, then drifts back at its own pace. */
function updateJellyDodge(fish: SwimmingFish, x: number, z: number, dt: number): void {
    let target = 0;
    if (pointerActive) {
        const pw = getPointerWorldAtZ(z);
        const dx = x - pw.x;
        const dy = fish.baseY - pw.y;
        if (Math.hypot(dx, dy) < JELLY_DODGE_RADIUS) {
            // Direction is latched on first contact so a pointer hovering right
            // at the jelly's height can't make it flip-flop up and down.
            if (fish.dodgeDir === 0) fish.dodgeDir = dy >= 0 ? 1 : -1;
            target = fish.dodgeDir * JELLY_DODGE_DISTANCE;
        }
    }

    const rate = target !== 0 ? JELLY_DODGE_SPEED : JELLY_DODGE_RETURN_SPEED;
    fish.dodgeOffsetY += (target - fish.dodgeOffsetY) * Math.min(1, rate * dt);
    if (target === 0 && Math.abs(fish.dodgeOffsetY) < JELLY_DODGE_SETTLED) {
        fish.dodgeOffsetY = 0;
        fish.dodgeDir = 0;
    }
}

/** Toggle visibility of all fish groups (GPU-side culling for surface/underwater gating). */
export function setVisible(visible: boolean): void {
    setCameraVisibility(visible, visible ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY);
}

/** Spread the active generic fish across the CURRENT frustum band. Called on the
 *  surface→underwater transition: the fish advance/recycle every frame against
 *  the live camera frustum, which at the surface (and during the intro descent,
 *  where they're first seeded) is far wider/offset than underwater — so on a dive
 *  most fish sit off-screen and only wander into view over a minute-plus. This
 *  makes a dive show a populated scene immediately. Jellyfish are stationary —
 *  left untouched. */
function reseedActiveFishX(): void {
    for (let i = 0; i < activeFish.length; i++) {
        const entry = activeFish[i].pool;
        if (entry.isJellyfish) continue;
        const edges = getFrustumEdgesX(entry.group.position.z);
        const spawnX   = Number.isFinite(edges.spawnX)   ? edges.spawnX   :  5.5;
        const despawnX = Number.isFinite(edges.despawnX) ? edges.despawnX : -5.5;
        entry.group.position.x = despawnX + Math.random() * (spawnX - despawnX + RESPAWN_X_JITTER);
    }
}

export function setCameraVisibility(isUnderwater: boolean, shallowMinY: number): void {
    const enteringUnderwater = isUnderwater && !underwaterView;
    underwaterView = isUnderwater;
    shallowVisibilityMinY = shallowMinY;
    genericFishContainer.visible = true;
    // Populate the dive immediately instead of waiting for fish to drift in from
    // the wide surface/intro frustum (the "fish missing for ~2 min" bug).
    if (enteringUnderwater) reseedActiveFishX();
    clownFish.visible = shouldShowCircleFish(clownFish);
    doriFish.visible = shouldShowCircleFish(doriFish);
    whaleGroup.visible = whaleReady && shouldShowCircleFish(whaleGroup);
    for (let i = 0; i < activeFish.length; i++) {
        activeFish[i].pool.group.visible = shouldShowCreature(activeFish[i].pool);
    }
}

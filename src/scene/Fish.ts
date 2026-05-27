import { Group, AnimationMixer, AnimationClip, LoopRepeat, Vector3, Color, MeshStandardMaterial, Mesh, Vector2, MathUtils } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — r137 @types declares a namespace but the module exports clone directly
import { clone as _skeletonClone } from "three/examples/jsm/utils/SkeletonUtils";
import { deltaTime } from "../core/Time";
import { camera, renderer } from "../core/Scene";
import { getDayNightBlend, isDayTime } from "./Skybox";
import { jellyfishLightConfig, fishNightLightingConfig } from "./config/OceanConfig";

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
const FISH_SCALE_MIN = 0.8;              // min scale multiplier
const FISH_SCALE_MAX = 1.2;              // max scale multiplier
const SCREEN_MARGIN = 0.5;               // extra world units past screen edge

// Jellyfish settings — scattered static positions with gentle vertical bob
const JELLYFISH_SCALE = 0.001;           // base scale for jellyfish
const JELLY_Y_MIN = -8.5;                // min Y of scattered area (deeper than fish)
const JELLY_Y_MAX = -4.5;                // max Y of scattered area
const JELLY_Z_MIN = -4.0;                // farthest Z
const JELLY_Z_MAX = 0.0;                 // closest Z
const JELLY_X_MIN = -3.5;                // left edge of scatter area
const JELLY_X_MAX = 3.5;                 // right edge of scatter area
const JELLY_POOL_SIZE = _isMobile ? 5 : 12;
const JELLY_FLOAT_AMPLITUDE = 0.18;      // vertical bob amplitude (world units)
const JELLY_FLOAT_SPEED_MIN = 0.35;      // rad/s
const JELLY_FLOAT_SPEED_MAX = 0.75;      // rad/s

// Jellyfish bioluminescence settings
const JELLY_EMISSIVE_INTENSITY = 2.0;    // how bright the glow is
const JELLY_OPACITY = 0.45;              // semi-transparent (0 = invisible, 1 = opaque)
const JELLY_VISIBILITY_THRESHOLD = 0.02;
const MAX_FAKE_JELLY_LIGHTS = JELLY_POOL_SIZE;

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
    fakeLightColor: Color;     // jellyfish-only: cached tint used for fake fish lighting
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

// Jellyfish color tints — uniform light-blue palette (tiny variation for life)
const JELLY_COLOR_TINTS: Color[] = [
    new Color(0.55, 0.85, 1.35),
    new Color(0.50, 0.90, 1.40),
    new Color(0.60, 0.88, 1.30),
    new Color(0.52, 0.82, 1.45),
];

const _fakeJellyLightPositions = Array.from({ length: MAX_FAKE_JELLY_LIGHTS }, () => new Vector3(9999, 9999, 9999));
const _fakeJellyLightColors = Array.from({ length: MAX_FAKE_JELLY_LIGHTS }, () => new Color(0, 0, 0));
const _fishLightUniformStates: FishLightUniformState[] = [];

interface FishLightUniformState {
    sceneLight: { value: number };
    nightBlend: { value: number };
    jellyVisibility: { value: number };
    jellyIntensity: { value: number };
    jellyInfluence: { value: number };
    jellyRadiusSq: { value: number };
    jellyCount: { value: number };
    jellyPositions: { value: Vector3[] };
    jellyColors: { value: Color[] };
}

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

function updateFakeJellyLightUniforms(nightBlend: number, jellyVisibility: number): void {
    const sceneLight = MathUtils.lerp(1, fishNightLightingConfig.nonJellyLightInfluence, nightBlend);
    const jellyRadius = Math.max(0.0001, jellyfishLightConfig.distance);
    const jellyRadiusSq = jellyRadius * jellyRadius;
    let jellyCount = 0;

    for (let i = 0; i < activeFish.length && jellyCount < MAX_FAKE_JELLY_LIGHTS; i++) {
        const jelly = activeFish[i].pool;
        if (!jelly.isJellyfish) continue;
        _fakeJellyLightPositions[jellyCount].copy(jelly.group.position);
        _fakeJellyLightColors[jellyCount].copy(jelly.fakeLightColor);
        jellyCount++;
    }
    for (let i = jellyCount; i < MAX_FAKE_JELLY_LIGHTS; i++) {
        _fakeJellyLightPositions[i].set(9999, 9999, 9999);
        _fakeJellyLightColors[i].setRGB(0, 0, 0);
    }

    for (let i = 0; i < _fishLightUniformStates.length; i++) {
        const state = _fishLightUniformStates[i];
        state.sceneLight.value = sceneLight;
        state.nightBlend.value = nightBlend;
        state.jellyVisibility.value = underwaterView ? jellyVisibility : 0;
        state.jellyIntensity.value = jellyfishLightConfig.intensity;
        state.jellyInfluence.value = fishNightLightingConfig.jellyLightInfluence;
        state.jellyRadiusSq.value = jellyRadiusSq;
        state.jellyCount.value = jellyCount;
    }
}

function applyFishLightShader(mat: MeshStandardMaterial): void {
    if ((mat.userData as any).fishLightShaderApplied) return;
    (mat.userData as any).fishLightShaderApplied = true;
    mat.customProgramCacheKey = () => `fish-local-jelly-light-v2-${MAX_FAKE_JELLY_LIGHTS}`;
    mat.onBeforeCompile = (shader: any) => {
        const state: FishLightUniformState = {
            sceneLight: { value: 1 },
            nightBlend: { value: 0 },
            jellyVisibility: { value: 0 },
            jellyIntensity: { value: jellyfishLightConfig.intensity },
            jellyInfluence: { value: fishNightLightingConfig.jellyLightInfluence },
            jellyRadiusSq: { value: jellyfishLightConfig.distance * jellyfishLightConfig.distance },
            jellyCount: { value: 0 },
            jellyPositions: { value: _fakeJellyLightPositions },
            jellyColors: { value: _fakeJellyLightColors },
        };

        shader.uniforms.uFishSceneLight = state.sceneLight;
        shader.uniforms.uFishNightBlend = state.nightBlend;
        shader.uniforms.uFishJellyVisibility = state.jellyVisibility;
        shader.uniforms.uFishJellyIntensity = state.jellyIntensity;
        shader.uniforms.uFishJellyInfluence = state.jellyInfluence;
        shader.uniforms.uFishJellyRadiusSq = state.jellyRadiusSq;
        shader.uniforms.uFishJellyCount = state.jellyCount;
        shader.uniforms.uFishJellyPositions = state.jellyPositions;
        shader.uniforms.uFishJellyColors = state.jellyColors;
        _fishLightUniformStates.push(state);

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vFishWorldPosition;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
            vFishWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            #define FISH_JELLY_LIGHT_MAX ${MAX_FAKE_JELLY_LIGHTS}
            varying vec3 vFishWorldPosition;
            uniform float uFishSceneLight;
            uniform float uFishNightBlend;
            uniform float uFishJellyVisibility;
            uniform float uFishJellyIntensity;
            uniform float uFishJellyInfluence;
            uniform float uFishJellyRadiusSq;
            uniform int uFishJellyCount;
            uniform vec3 uFishJellyPositions[FISH_JELLY_LIGHT_MAX];
            uniform vec3 uFishJellyColors[FISH_JELLY_LIGHT_MAX];`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            diffuseColor.rgb *= uFishSceneLight;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            vec3 fishJellyLight = vec3(0.0);
            if (uFishJellyVisibility > 0.001 && uFishJellyInfluence > 0.001 && uFishJellyIntensity > 0.001) {
                vec3 fishWorldNormal = normalize(inverseTransformDirection(normal, viewMatrix));
                for (int i = 0; i < FISH_JELLY_LIGHT_MAX; i++) {
                    if (i >= uFishJellyCount) break;
                    vec3 toJelly = uFishJellyPositions[i] - vFishWorldPosition;
                    float distSq = dot(toJelly, toJelly);
                    float radial = clamp(1.0 - distSq / max(uFishJellyRadiusSq, 0.0001), 0.0, 1.0);
                    radial = radial * radial * (3.0 - 2.0 * radial);
                    vec3 lightDir = normalize(toJelly);
                    float facing = clamp(dot(fishWorldNormal, lightDir) * 0.5 + 0.5, 0.0, 1.0);
                    facing = facing * facing;
                    fishJellyLight += uFishJellyColors[i] * radial * facing;
                }
                totalEmissiveRadiance += fishJellyLight * uFishJellyIntensity * uFishJellyInfluence * uFishNightBlend * uFishJellyVisibility;
            }`
        );
    };
    mat.needsUpdate = true;
}

function setJellyfishGlow(entry: PooledFish, visibility: number): void {
    if (!entry.isJellyfish) return;
    const renderVisibility = underwaterView ? visibility : 0;
    const opacity = JELLY_OPACITY * renderVisibility;
    const glowIntensity = JELLY_EMISSIVE_INTENSITY * jellyfishLightConfig.intensity * renderVisibility;
    for (let i = 0; i < entry.materials.length; i++) {
        entry.materials[i].opacity = opacity;
        entry.materials[i].emissiveIntensity = glowIntensity;
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
            } else {
                applyFishLightShader(mat);
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

    return {
        group,
        scene,
        materials,
        baseTintColors,
        activeTintColors,
        fakeLightColor: new Color(1, 1, 1),
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
    entry.fakeLightColor.copy(tint);
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
    entry.fakeLightColor.copy(tint);
    setJellyfishGlow(entry, getJellyVisibility());

    const scaleMult = FISH_SCALE_MIN + Math.random() * (FISH_SCALE_MAX - FISH_SCALE_MIN);
    const scale = baseScale * scaleMult;

    if (jelly) {
        // Stationary scatter: random X/Y/Z anywhere in the jelly volume,
        // independent of the camera frustum or wave system.
        const x = JELLY_X_MIN + Math.random() * (JELLY_X_MAX - JELLY_X_MIN);
        const y = JELLY_Y_MIN + Math.random() * (JELLY_Y_MAX - JELLY_Y_MIN);
        const z = JELLY_Z_MIN + Math.random() * (JELLY_Z_MAX - JELLY_Z_MIN);
        entry.group.position.set(x, y, z);
        entry.group.scale.setScalar(scale);
        entry.group.rotation.x = 0;
        entry.group.visible = shouldShowCreature(entry);
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

    const yMin = GENERIC_FISH_Y_MIN;
    const yMax = GENERIC_FISH_Y_MAX;
    const zMin = GENERIC_FISH_Z_MIN;
    const zMax = GENERIC_FISH_Z_MAX;
    const speedMin = GENERIC_FISH_SPEED_MIN;
    const speedMax = GENERIC_FISH_SPEED_MAX;

    const y = yMin + Math.random() * (yMax - yMin);
    const z = zMin + Math.random() * (zMax - zMin);
    const { spawnX, despawnX } = getFrustumEdgesX(z);
    const x = despawnX + (spawnX - despawnX) * progress + Math.random() * GROUP_X_SPREAD;
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
        });

        entry.group.visible = true;
        for (let m = 0; m < entry.materials.length; m++) {
            entry.materials[m].opacity = JELLY_OPACITY;
            entry.materials[m].emissiveIntensity = JELLY_EMISSIVE_INTENSITY;
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
        }
    };
}

function initFixedCreatureLoops(): void {
    if (fixedLoopsInitialized || !fishPoolInitialized || !jellyPoolInitialized) return;
    fixedLoopsInitialized = true;

    const fishEntries = fishPool.splice(0);
    for (let i = 0; i < fishEntries.length; i++) {
        activeFish.push(resetLoopingCreature(fishEntries[i], i / Math.max(1, fishEntries.length)));
    }

    const jellyEntries = jellyPool.splice(0);
    for (let i = 0; i < jellyEntries.length; i++) {
        activeFish.push(resetLoopingCreature(jellyEntries[i], i / Math.max(1, jellyEntries.length)));
    }
}

export function isReady(): boolean {
    return fishModelsLoaded >= 4 && fixedLoopsInitialized;
}

export function Start(): void {
    // Register pointer tracking
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.addEventListener('pointerup', onPointerLeave);

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
        }
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
        }
    );

    // Load generic fish template (day)
    loader.load(
        'models/underwater/genericfish.glb',
        (gltf) => {
            genericFishTemplate = gltf.scene;
            genericFishAnimations = gltf.animations;
            fishModelsLoaded++;
            initFishPool();
        }
    );

    // Load jellyfish template (night)
    loader.load(
        'models/underwater/jellyfish.glb',
        (gltf) => {
            jellyfishTemplate = gltf.scene;
            jellyfishAnimations = gltf.animations;
            fishModelsLoaded++;
            initJellyPool();
        }
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
    const nightBlend = smooth01(getDayNightBlend());

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
    updateFakeJellyLightUniforms(nightBlend, jellyVisibility);

    // Move and cull active creatures
    for (let i = activeFish.length - 1; i >= 0; i--) {
        const fish = activeFish[i];
        const group = fish.pool.group;
        group.scale.setScalar(fish.baseScale);
        setJellyfishGlow(fish.pool, jellyVisibility);
        group.visible = shouldShowCreature(fish.pool);
        fish.pool.mixer.update(deltaTime);

        if (fish.pool.isJellyfish) {
            // Stationary jellyfish: no horizontal motion, no pointer avoidance,
            // no despawn. Just a gentle vertical bob around baseY while the
            // skeleton animation continues to loop in the mixer above.
            fish.floatPhase += fish.floatSpeed * deltaTime;
            group.position.y = fish.baseY + Math.sin(fish.floatPhase) * fish.floatAmp;
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

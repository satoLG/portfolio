import { Group, AnimationMixer, AnimationClip, LoopRepeat, Vector3, Color, MeshStandardMaterial, Mesh, Vector2 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { deltaTime } from "../scripts/Time";
import { camera, renderer } from "../scripts/Scene";
import { isDayTime } from "./Skybox";

// Clown & Dori fish settings (circling the island)
const CIRCLE_FISH_SCALE = 0.03;
const CIRCLE_RADIUS = 1.2;
const CIRCLE_SPEED = 0.3;
const CIRCLE_Y_LEVEL = -0.7;
const FISH_SEPARATION = 0.3;
const CIRCLE_FISH_ROTATION_OFFSET = Math.PI * 2;

// Generic fish spawn settings
const GENERIC_FISH_SCALE = 0.03;
const GENERIC_FISH_Y_MIN = -5;           // min spawn height
const GENERIC_FISH_Y_MAX = -3;           // max spawn height
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

// Jellyfish spawn settings (night mode — slower, fewer, bioluminescent)
const JELLYFISH_SCALE = 0.001;           // base scale for jellyfish
const JELLY_SPEED_MIN = 0.05;            // very slow drift
const JELLY_SPEED_MAX = 0.12;            // still slow
const JELLY_SPAWN_INTERVAL = 3.5;        // seconds between spawn waves
const JELLY_SPAWN_COUNT_MIN = 1;         // min jellyfish per wave
const JELLY_SPAWN_COUNT_MAX = 2;         // max jellyfish per wave
const JELLY_GROUP_SIZE_MIN = 1;          // usually solo
const JELLY_GROUP_SIZE_MAX = 1;          // usually solo
const JELLY_Y_MIN = -5;                  // min spawn height
const JELLY_Y_MAX = -2.5;                // max spawn height (higher than fish)
const JELLY_Z_MIN = -4.0;               // farthest Z
const JELLY_Z_MAX = 0.0;                // closest Z
const JELLY_SPEED_SPREAD = 0.02;         // speed variation
const JELLY_POOL_SIZE = 10;              // fewer simultaneous jellyfish

// Jellyfish bioluminescence settings
const JELLY_EMISSIVE_INTENSITY = 2.0;    // how bright the glow is
const JELLY_OPACITY = 0.45;              // semi-transparent (0 = invisible, 1 = opaque)

// Fish avoidance settings
const AVOIDANCE_RADIUS = 0.15;            // world units — how close the pointer must be to scare fish
const AVOIDANCE_STRENGTH = 0.5;          // vertical push force away from pointer
const RETURN_SPEED = 0.8;               // how fast fish return to their base Y
const VELOCITY_DAMPING = 0.8;            // drag on vertical velocity
const MAX_TILT_ANGLE = 0.8;              // max rotation.z tilt in radians (~34°)
const TILT_SMOOTHING = 8.0;              // how fast the tilt follows velocity

// Object pool settings
const POOL_SIZE = 25;                    // max simultaneous fish — prevents unbounded memory growth

// Fish color tint variants (multiplied on top of base texture)
const FISH_COLOR_TINTS: Color[] = [
    new Color(1.0, 1.0, 1.0),   // no filter (original)
    new Color(0.2, 0.4, 1.5),   // vibrant blue
    new Color(1.5, 1.3, 0.1),   // vibrant yellow
    new Color(0.1, 1.4, 0.2),   // vibrant green
    new Color(1.5, 0.15, 0.15), // vibrant red
];

const loader = new GLTFLoader();

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
    mixer: AnimationMixer;
    clip: AnimationClip | null;
    isJellyfish: boolean;     // true = belongs to jellyPool, false = fishPool
}

interface SwimmingFish {
    pool: PooledFish;         // reference back to pool entry for recycling
    speed: number;
    baseY: number;
    velocityY: number;
    currentTilt: number;
}

const fishPool: PooledFish[] = [];       // available (inactive) day fish
const jellyPool: PooledFish[] = [];      // available (inactive) night jellyfish
const activeFish: SwimmingFish[] = [];   // in-scene swimming creatures
let fishPoolInitialized = false;
let jellyPoolInitialized = false;
let spawnTimer = 0;
let jellySpawnTimer = 0;

// Jellyfish color tints (bioluminescent night palette)
const JELLY_COLOR_TINTS: Color[] = [
    new Color(0.3, 0.8, 1.5),   // bioluminescent blue
    new Color(0.8, 0.2, 1.5),   // purple glow
    new Color(0.2, 1.5, 0.8),   // cyan-green
    new Color(1.2, 0.3, 0.8),   // pink
    new Color(0.5, 1.2, 1.5),   // light cyan
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
    const scene = skeletonClone(template) as Group;
    const materials: MeshStandardMaterial[] = [];
    const baseTintColors: Color[] = [];
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
        }
    });
    const group = new Group();
    group.add(scene);
    group.rotation.order = 'YXZ';
    group.rotation.y = -Math.PI / 2;
    group.visible = false;  // hidden until activated

    const mixer = new AnimationMixer(scene);
    const clip = animations.length > 0 ? animations[0] : null;

    return { group, scene, materials, baseTintColors, mixer, clip, isJellyfish: jellyfish };
}

// Staggered pool initialization — create one entry per frame to avoid a massive spike
let _fishPoolQueue = 0;
let _jellyPoolQueue = 0;

/** Populate the day fish object pool, one entry per frame */
function initFishPool(): void {
    if (fishPoolInitialized || !genericFishTemplate) return;
    fishPoolInitialized = true;
    _fishPoolQueue = POOL_SIZE;
}

/** Populate the night jellyfish object pool, one entry per frame */
function initJellyPool(): void {
    if (jellyPoolInitialized || !jellyfishTemplate) return;
    jellyPoolInitialized = true;
    _jellyPoolQueue = JELLY_POOL_SIZE;
}

/** Drip-feed pool creation — call once per Update() */
function tickPoolCreation(): void {
    if (_fishPoolQueue > 0 && genericFishTemplate) {
        const entry = createPoolEntry(genericFishTemplate, genericFishAnimations, false);
        genericFishContainer.add(entry.group);
        fishPool.push(entry);
        _fishPoolQueue--;
    }
    if (_jellyPoolQueue > 0 && jellyfishTemplate) {
        const entry = createPoolEntry(jellyfishTemplate, jellyfishAnimations, true);
        genericFishContainer.add(entry.group);
        jellyPool.push(entry);
        _jellyPoolQueue--;
    }
}

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
        // Jellyfish get emissive glow matching their tint + transparency
        if (entry.isJellyfish) {
            entry.materials[i].emissive.copy(tint);
            entry.materials[i].emissiveIntensity = JELLY_EMISSIVE_INTENSITY;
            entry.materials[i].opacity = JELLY_OPACITY;
        }
    }

    entry.group.position.set(x, y, z);
    entry.group.scale.setScalar(scale);
    entry.group.rotation.x = 0;  // reset tilt
    entry.group.visible = true;

    // Restart animation
    entry.mixer.stopAllAction();
    if (entry.clip) {
        const action = entry.mixer.clipAction(entry.clip);
        action.setLoop(LoopRepeat, Infinity);
        action.play();
    }

    activeFish.push({
        pool: entry,
        speed,
        baseY: y,
        velocityY: 0,
        currentTilt: 0,
    });
}

/** Return a creature to the correct pool */
function deactivateFish(index: number): void {
    const fish = activeFish[index];
    fish.pool.mixer.stopAllAction();
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

export function Start(): void {
    // Register pointer tracking
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);

    // Load clown fish
    loader.load(
        'models/clownfish.glb',
        (gltf) => {
            clownFish.add(gltf.scene);
            clownFish.scale.setScalar(CIRCLE_FISH_SCALE);
            clownMixer = new AnimationMixer(gltf.scene);
            if (gltf.animations.length > 0) {
                clownMixer.clipAction(gltf.animations[0]).play();
            }
        }
    );
    
    // Load dori fish
    loader.load(
        'models/dorifish.glb',
        (gltf) => {
            doriFish.add(gltf.scene);
            doriFish.scale.setScalar(CIRCLE_FISH_SCALE);
            doriMixer = new AnimationMixer(gltf.scene);
            if (gltf.animations.length > 0) {
                doriMixer.clipAction(gltf.animations[0]).play();
            }
        }
    );

    // Load generic fish template (day)
    loader.load(
        'models/genericfish.glb',
        (gltf) => {
            genericFishTemplate = gltf.scene;
            genericFishAnimations = gltf.animations;
            initFishPool();
        }
    );

    // Load jellyfish template (night)
    loader.load(
        'models/jellyfish.glb',
        (gltf) => {
            jellyfishTemplate = gltf.scene;
            jellyfishAnimations = gltf.animations;
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

function spawnCreatures(): void {
    const night = !isDayTime();
    const pool = night ? jellyPool : fishPool;
    const initialized = night ? jellyPoolInitialized : fishPoolInitialized;
    if (!initialized || pool.length === 0) return;

    const tints = night ? JELLY_COLOR_TINTS : FISH_COLOR_TINTS;
    const baseScale = night ? JELLYFISH_SCALE : GENERIC_FISH_SCALE;
    const yMin = night ? JELLY_Y_MIN : GENERIC_FISH_Y_MIN;
    const yMax = night ? JELLY_Y_MAX : GENERIC_FISH_Y_MAX;
    const zMin = night ? JELLY_Z_MIN : GENERIC_FISH_Z_MIN;
    const zMax = night ? JELLY_Z_MAX : GENERIC_FISH_Z_MAX;
    const speedMin = night ? JELLY_SPEED_MIN : GENERIC_FISH_SPEED_MIN;
    const speedMax = night ? JELLY_SPEED_MAX : GENERIC_FISH_SPEED_MAX;
    const speedSpread = night ? JELLY_SPEED_SPREAD : GROUP_SPEED_SPREAD;
    const countMin = night ? JELLY_SPAWN_COUNT_MIN : SPAWN_COUNT_MIN;
    const countMax = night ? JELLY_SPAWN_COUNT_MAX : SPAWN_COUNT_MAX;
    const grpMin = night ? JELLY_GROUP_SIZE_MIN : GROUP_SIZE_MIN;
    const grpMax = night ? JELLY_GROUP_SIZE_MAX : GROUP_SIZE_MAX;

    const count = countMin + Math.floor(Math.random() * (countMax - countMin + 1));

    const range = yMax - yMin;
    const slotSize = range / count;
    const maxJitter = Math.max(0, (slotSize - FISH_MIN_Y_GAP) * 0.5);

    for (let n = 0; n < count; n++) {
        if (pool.length === 0) return;

        const slotCenter = yMin + slotSize * (n + 0.5);
        const baseY = slotCenter + (Math.random() * 2 - 1) * maxJitter;
        const baseZ = zMin + Math.random() * (zMax - zMin);
        const baseSpeed = speedMin + Math.random() * (speedMax - speedMin);

        const tint = tints[Math.floor(Math.random() * tints.length)];
        const groupSize = grpMin + Math.floor(Math.random() * (grpMax - grpMin + 1));

        for (let g = 0; g < groupSize; g++) {
            if (pool.length === 0) return;

            const y = baseY + (Math.random() * 2 - 1) * GROUP_Y_SPREAD;
            const z = baseZ + (Math.random() * 2 - 1) * GROUP_Z_SPREAD;
            const speed = baseSpeed + (Math.random() * 2 - 1) * speedSpread;
            const scaleMult = FISH_SCALE_MIN + Math.random() * (FISH_SCALE_MAX - FISH_SCALE_MIN);
            const { spawnX } = getFrustumEdgesX(z);
            const x = spawnX + Math.random() * GROUP_X_SPREAD;

            activatePooledFish(tint, x, y, z, speed, baseScale * scaleMult, night);
        }
    }
}

export function Update(): void {
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
    
    const doriAngle = circleAngle - FISH_SEPARATION;
    doriFish.position.set(
        islandCenter.x + Math.cos(doriAngle) * (CIRCLE_RADIUS + 0.08),
        CIRCLE_Y_LEVEL - 0.03,
        islandCenter.z + Math.sin(doriAngle) * (CIRCLE_RADIUS + 0.08)
    );
    doriFish.rotation.y = -doriAngle + CIRCLE_FISH_ROTATION_OFFSET;

    // Lazy-init pools if templates loaded after Start()
    if (!fishPoolInitialized && genericFishTemplate) initFishPool();
    if (!jellyPoolInitialized && jellyfishTemplate) initJellyPool();

    // Drip-feed pool creation (one entry per frame to avoid stutter)
    tickPoolCreation();

    // Spawn fish (day) or jellyfish (night) with separate timers
    const night = !isDayTime();
    if (night) {
        jellySpawnTimer += deltaTime;
        if (jellySpawnTimer >= JELLY_SPAWN_INTERVAL) {
            jellySpawnTimer = 0;
            spawnCreatures();
        }
    } else {
        spawnTimer += deltaTime;
        if (spawnTimer >= SPAWN_INTERVAL) {
            spawnTimer = 0;
            spawnCreatures();
        }
    }

    // Move and cull active generic fish
    for (let i = activeFish.length - 1; i >= 0; i--) {
        const fish = activeFish[i];
        const group = fish.pool.group;
        fish.pool.mixer.update(deltaTime);
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
            deactivateFish(i);  // return to pool instead of leaking
        }
    }
}

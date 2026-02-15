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

// Fish avoidance settings
const AVOIDANCE_RADIUS = 0.15;            // world units — how close the pointer must be to scare fish
const AVOIDANCE_STRENGTH = 0.5;          // vertical push force away from pointer
const RETURN_SPEED = 0.8;               // how fast fish return to their base Y
const VELOCITY_DAMPING = 0.8;            // drag on vertical velocity
const MAX_TILT_ANGLE = 0.8;              // max rotation.z tilt in radians (~34°)
const TILT_SMOOTHING = 8.0;              // how fast the tilt follows velocity

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

interface SwimmingFish {
    group: Group;
    mixer: AnimationMixer;
    speed: number;
    baseY: number;
    velocityY: number;
    currentTilt: number;
}
const activeFish: SwimmingFish[] = [];
let spawnTimer = 0;

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
function getPointerWorldAtZ(z: number): Vector3 {
    // Get a point at z in NDC to find the depth
    const refPoint = new Vector3(0, 0, z);
    refPoint.project(camera);
    _pointerWorld.set(pointerNDC.x, pointerNDC.y, refPoint.z).unproject(camera);
    return _pointerWorld;
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

    // Load generic fish template
    loader.load(
        'models/genericfish.glb',
        (gltf) => {
            genericFishTemplate = gltf.scene;
            genericFishAnimations = gltf.animations;
        }
    );

}

// Temp vectors for frustum edge calculation
const _vecRight = new Vector3();
const _vecLeft = new Vector3();

/** Get world-space X extents of the camera frustum at the fish depth plane */
function getFrustumEdgesX(z: number): { spawnX: number; despawnX: number } {
    // Fish world position in camera's view
    const fishWorldPos = new Vector3(0, (GENERIC_FISH_Y_MIN + GENERIC_FISH_Y_MAX) * 0.5, z);
    // Project to NDC to get the depth (z) at the fish plane
    const projected = fishWorldPos.clone().project(camera);
    const depthNDC = projected.z;

    // Right edge of screen in NDC = +1, unproject to world
    _vecRight.set(1, 0, depthNDC).unproject(camera);
    // Left edge of screen in NDC = -1, unproject to world
    _vecLeft.set(-1, 0, depthNDC).unproject(camera);

    const rightX = _vecRight.x + SCREEN_MARGIN;
    const leftX = _vecLeft.x - SCREEN_MARGIN;

    return { spawnX: rightX, despawnX: leftX };
}

function spawnGenericFish(): void {
    if (!genericFishTemplate) return;

    const count = SPAWN_COUNT_MIN + Math.floor(Math.random() * (SPAWN_COUNT_MAX - SPAWN_COUNT_MIN + 1));

    // Divide the Y range into evenly spaced slots, then jitter each slot
    // so groups never overlap vertically
    const range = GENERIC_FISH_Y_MAX - GENERIC_FISH_Y_MIN;
    const slotSize = range / count;
    const maxJitter = Math.max(0, (slotSize - FISH_MIN_Y_GAP) * 0.5);

    for (let n = 0; n < count; n++) {
        const slotCenter = GENERIC_FISH_Y_MIN + slotSize * (n + 0.5);
        const baseY = slotCenter + (Math.random() * 2 - 1) * maxJitter;
        const baseZ = GENERIC_FISH_Z_MIN + Math.random() * (GENERIC_FISH_Z_MAX - GENERIC_FISH_Z_MIN);
        const baseSpeed = GENERIC_FISH_SPEED_MIN + Math.random() * (GENERIC_FISH_SPEED_MAX - GENERIC_FISH_SPEED_MIN);

        // Pick one color for the whole group
        const tint = FISH_COLOR_TINTS[Math.floor(Math.random() * FISH_COLOR_TINTS.length)];
        const groupSize = GROUP_SIZE_MIN + Math.floor(Math.random() * (GROUP_SIZE_MAX - GROUP_SIZE_MIN + 1));

        for (let g = 0; g < groupSize; g++) {
            spawnSingleCreature(genericFishTemplate, genericFishAnimations, tint,
                baseY, baseZ, baseSpeed,
                GENERIC_FISH_SCALE, FISH_SCALE_MIN, FISH_SCALE_MAX,
                GROUP_Y_SPREAD, GROUP_Z_SPREAD, GROUP_X_SPREAD, GROUP_SPEED_SPREAD);
        }
    }
}

function spawnSingleCreature(
    template: Group, animations: AnimationClip[], tint: Color,
    baseY: number, baseZ: number, baseSpeed: number,
    baseScale: number, scaleMin: number, scaleMax: number,
    ySpread: number, zSpread: number, xSpread: number, speedSpread: number
): void {
    const y = baseY + (Math.random() * 2 - 1) * ySpread;
    const z = baseZ + (Math.random() * 2 - 1) * zSpread;
    const speed = baseSpeed + (Math.random() * 2 - 1) * speedSpread;
    const scaleMult = scaleMin + Math.random() * (scaleMax - scaleMin);

    const { spawnX } = getFrustumEdgesX(z);
    const x = spawnX + Math.random() * xSpread;

    const scene = skeletonClone(template);
    scene.traverse((child) => {
        if (child instanceof Mesh && child.material) {
            // Clone material to avoid shared state
            const srcMat = child.material as MeshStandardMaterial;
            const mat = srcMat.clone();
            mat.color.multiply(tint);
            child.material = mat;
        }
    });

    const group = new Group();
    group.add(scene);
    group.scale.setScalar(baseScale * scaleMult);
    group.position.set(x, y, z);
    group.rotation.order = 'YXZ';
    group.rotation.y = -Math.PI / 2;

    const mixer = new AnimationMixer(scene);
    if (animations.length > 0) {
        const action = mixer.clipAction(animations[0]);
        action.setLoop(LoopRepeat, Infinity);
        action.play();
    }

    genericFishContainer.add(group);
    activeFish.push({ group, mixer, speed, baseY: y, velocityY: 0, currentTilt: 0 });
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

    // Only spawn fish during daytime
    if (isDayTime()) {
        spawnTimer += deltaTime;
        if (spawnTimer >= SPAWN_INTERVAL) {
            spawnTimer = 0;
            spawnGenericFish();
        }
    }

    // Move and cull active generic fish
    for (let i = activeFish.length - 1; i >= 0; i--) {
        const fish = activeFish[i];
        fish.mixer.update(deltaTime);
        fish.group.position.x -= fish.speed * deltaTime;

        // Pointer avoidance
        if (pointerActive) {
            const pw = getPointerWorldAtZ(fish.group.position.z);
            const dx = fish.group.position.x - pw.x;
            const dy = fish.group.position.y - pw.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < AVOIDANCE_RADIUS && dist > 0.01) {
                // Push vertically away from pointer, strength falls off with distance
                const force = (1.0 - dist / AVOIDANCE_RADIUS) * AVOIDANCE_STRENGTH;
                const dirY = dy / dist; // normalized vertical direction away
                fish.velocityY += dirY * force * deltaTime * 10;
            }
        }

        // Spring return to base Y
        const yDiff = fish.baseY - fish.group.position.y;
        fish.velocityY += yDiff * RETURN_SPEED * deltaTime;

        // Damping
        fish.velocityY *= Math.max(0, 1 - VELOCITY_DAMPING * deltaTime);

        // Apply vertical movement
        fish.group.position.y += fish.velocityY * deltaTime;

        // Tilt based on vertical velocity (fish pitches nose up/down)
        // With rotation.y = -PI/2 the fish faces -X, so rotation.x is pitch
        const targetTilt = Math.max(-MAX_TILT_ANGLE, Math.min(MAX_TILT_ANGLE, -fish.velocityY * 0.8));
        fish.currentTilt += (targetTilt - fish.currentTilt) * Math.min(1, TILT_SMOOTHING * deltaTime);
        fish.group.rotation.x = fish.currentTilt;

        const { despawnX } = getFrustumEdgesX(fish.group.position.z);
        if (fish.group.position.x < despawnX) {
            genericFishContainer.remove(fish.group);
            fish.mixer.stopAllAction();
            activeFish.splice(i, 1);
        }
    }
}

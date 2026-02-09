import {
    Mesh,
    SphereGeometry,
    MeshBasicMaterial,
    Vector3,
    Group
} from "three";
import { camera, scene } from "../scripts/Scene";
import { deltaTime, time } from "../scripts/Time";
import { UNDERWATER_Y_THRESHOLD } from "./Underwater";
import { playDiveSound } from "../scripts/Audio";

// ============================================
// BUBBLE SETTINGS (tweak these!)
// ============================================
export const BUBBLE_COUNT = 50;           // Max bubbles at once
export const BUBBLE_SIZE_MIN = 0.005;     // Minimum bubble radius
export const BUBBLE_SIZE_MAX = 0.015;     // Maximum bubble radius
export const BUBBLE_RISE_SPEED = 0.3;     // How fast bubbles rise
export const BUBBLE_WOBBLE = 0.08;        // Horizontal wobble amount
export const BUBBLE_LIFETIME = 2.5;       // Seconds before fade
export const BUBBLE_SPAWN_RATE = 0.02;    // Seconds between spawns
export const BUBBLE_SPAWN_DISTANCE = 0.8; // Distance from camera to spawn
export const BUBBLE_SPREAD = 0.05;        // Random spread at spawn

// Ambient underwater bubble settings
export const AMBIENT_BUBBLE_INTERVAL = 2.0;   // Seconds between ambient bubble groups
export const AMBIENT_BUBBLE_GROUP_SIZE = 12;   // Bubbles per ambient group (2-3)
export const AMBIENT_SOUND_INTERVAL = 10.0;   // Seconds between bubble sounds
export const ENTRY_BUBBLE_COUNT = 35;          // Bubbles to spawn when entering water
// ============================================

interface Bubble {
    mesh: Mesh;
    velocity: Vector3;
    life: number;
    maxLife: number;
}

const bubbles: Bubble[] = [];
const bubbleGroup = new Group();
const sphereGeo = new SphereGeometry(1, 8, 6);

let initialized = false;
let lastSpawnTime = 0;
let isUnderwater = false;
let wasUnderwater = false;

// Ambient bubble timing
let lastAmbientBubbleTime = 0;
let lastAmbientSoundTime = 0;

// Track mouse position
const mousePosition = { x: 0, y: 0 };
const lastMousePosition = { x: 0, y: 0 };
let mouseInitialized = false;

export function Start(): void {
    // Pre-create bubble meshes (pooling)
    for (let i = 0; i < BUBBLE_COUNT; i++) {
        const size = BUBBLE_SIZE_MIN + Math.random() * (BUBBLE_SIZE_MAX - BUBBLE_SIZE_MIN);
        const material = new MeshBasicMaterial({
            color: 0x88ccff,
            transparent: true,
            opacity: 0
        });
        const mesh = new Mesh(sphereGeo, material);
        mesh.scale.setScalar(size);
        mesh.visible = false;
        bubbleGroup.add(mesh);
        
        bubbles.push({
            mesh,
            velocity: new Vector3(),
            life: 0,
            maxLife: BUBBLE_LIFETIME
        });
    }
    
    scene.add(bubbleGroup);
    
    // Track mouse
    document.addEventListener('mousemove', (e) => {
        if (!mouseInitialized) {
            lastMousePosition.x = e.clientX;
            lastMousePosition.y = e.clientY;
            mouseInitialized = true;
        }
        mousePosition.x = e.clientX;
        mousePosition.y = e.clientY;
    });
    
    document.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
            if (!mouseInitialized) {
                lastMousePosition.x = e.touches[0].clientX;
                lastMousePosition.y = e.touches[0].clientY;
                mouseInitialized = true;
            }
            mousePosition.x = e.touches[0].clientX;
            mousePosition.y = e.touches[0].clientY;
        }
    });
    
    initialized = true;
}

function spawnBubble(position: Vector3): void {
    // Find inactive bubble
    for (const bubble of bubbles) {
        if (bubble.life <= 0) {
            bubble.mesh.position.copy(position);
            bubble.mesh.visible = true;
            bubble.life = BUBBLE_LIFETIME * (0.7 + Math.random() * 0.6);
            bubble.maxLife = bubble.life;
            bubble.velocity.set(
                (Math.random() - 0.5) * BUBBLE_WOBBLE,
                BUBBLE_RISE_SPEED * (0.8 + Math.random() * 0.4),
                (Math.random() - 0.5) * BUBBLE_WOBBLE
            );
            
            // Randomize size
            const size = BUBBLE_SIZE_MIN + Math.random() * (BUBBLE_SIZE_MAX - BUBBLE_SIZE_MIN);
            bubble.mesh.scale.setScalar(size);
            
            const mat = bubble.mesh.material as MeshBasicMaterial;
            mat.opacity = 0.6;
            
            return;
        }
    }
}

// Get a spawn position at given screen coordinates (NDC: -1 to 1)
function getSpawnPositionAtNDC(ndcX: number, ndcY: number): Vector3 {
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    
    const fovRad = (camera.fov * Math.PI) / 180;
    const halfHeight = Math.tan(fovRad / 2) * BUBBLE_SPAWN_DISTANCE;
    const halfWidth = halfHeight * camera.aspect;
    
    const offsetX = ndcX * halfWidth;
    const offsetY = ndcY * halfHeight;
    
    const pos = camera.position.clone()
        .add(forward.clone().multiplyScalar(BUBBLE_SPAWN_DISTANCE))
        .add(right.clone().multiplyScalar(offsetX))
        .add(up.clone().multiplyScalar(offsetY));
    
    pos.add(new Vector3(
        (Math.random() - 0.5) * BUBBLE_SPREAD,
        (Math.random() - 0.5) * BUBBLE_SPREAD,
        (Math.random() - 0.5) * BUBBLE_SPREAD
    ));
    
    return pos;
}

// Spawn bubbles spread across the screen (for water entry)
function spawnEntryBubbles(): void {
    for (let i = 0; i < ENTRY_BUBBLE_COUNT; i++) {
        // Random position across the screen
        const ndcX = (Math.random() - 0.5) * 1.6; // Spread across 80% of screen width
        const ndcY = (Math.random() - 0.5) * 1.6; // Spread across 80% of screen height
        const pos = getSpawnPositionAtNDC(ndcX, ndcY);
        
        if (pos.y < UNDERWATER_Y_THRESHOLD) {
            spawnBubble(pos);
        }
    }
}

// Spawn a small group of ambient bubbles at a random screen position
function spawnAmbientBubbleGroup(): void {
    // Random position on screen (avoid edges)
    const ndcX = (Math.random() - 0.5) * 1.4;
    const ndcY = (Math.random() - 0.5) * 1.4;
    
    // Spawn 2-3 bubbles close together
    const groupSize = 2 + Math.floor(Math.random() * 2); // 2 or 3
    for (let i = 0; i < groupSize; i++) {
        const offsetX = ndcX + (Math.random() - 0.5) * 0.15;
        const offsetY = ndcY + (Math.random() - 0.5) * 0.15;
        const pos = getSpawnPositionAtNDC(offsetX, offsetY);
        
        if (pos.y < UNDERWATER_Y_THRESHOLD) {
            spawnBubble(pos);
        }
    }
}

function getSpawnPosition(): Vector3 | null {
    if (!mouseInitialized) return null;
    
    // Get camera basis vectors
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    
    // Convert mouse to NDC (-1 to 1)
    const ndcX = (mousePosition.x / window.innerWidth) * 2 - 1;
    const ndcY = -((mousePosition.y / window.innerHeight) * 2 - 1);
    
    // Calculate offset based on FOV and aspect ratio
    const fovRad = (camera.fov * Math.PI) / 180;
    const halfHeight = Math.tan(fovRad / 2) * BUBBLE_SPAWN_DISTANCE;
    const halfWidth = halfHeight * camera.aspect;
    
    // Calculate world offset from center of screen
    const offsetX = ndcX * halfWidth;
    const offsetY = ndcY * halfHeight;
    
    // Spawn at distance from camera, offset by mouse position
    const pos = camera.position.clone()
        .add(forward.multiplyScalar(BUBBLE_SPAWN_DISTANCE))
        .add(right.multiplyScalar(offsetX))
        .add(up.multiplyScalar(offsetY));
    
    // Add small random spread
    pos.add(new Vector3(
        (Math.random() - 0.5) * BUBBLE_SPREAD,
        (Math.random() - 0.5) * BUBBLE_SPREAD,
        (Math.random() - 0.5) * BUBBLE_SPREAD
    ));
    
    return pos;
}

export function Update(cameraY: number): void {
    if (!initialized) return;
    
    isUnderwater = cameraY < UNDERWATER_Y_THRESHOLD;
    
    // Update existing bubbles
    for (const bubble of bubbles) {
        if (bubble.life <= 0) continue;
        
        // Wobble
        bubble.velocity.x += (Math.random() - 0.5) * BUBBLE_WOBBLE * deltaTime * 2;
        bubble.velocity.z += (Math.random() - 0.5) * BUBBLE_WOBBLE * deltaTime * 2;
        bubble.velocity.x *= 0.98;
        bubble.velocity.z *= 0.98;
        
        // Move
        bubble.mesh.position.x += bubble.velocity.x * deltaTime;
        bubble.mesh.position.y += bubble.velocity.y * deltaTime;
        bubble.mesh.position.z += bubble.velocity.z * deltaTime;
        
        // Age
        bubble.life -= deltaTime;
        
        // Fade out and pop at surface
        const lifeRatio = bubble.life / bubble.maxLife;
        const mat = bubble.mesh.material as MeshBasicMaterial;
        mat.opacity = Math.min(0.6, lifeRatio * 1.5);
        
        // Pop at surface
        if (bubble.mesh.position.y > UNDERWATER_Y_THRESHOLD - 0.05) {
            bubble.life = 0;
        }
        
        if (bubble.life <= 0) {
            bubble.mesh.visible = false;
        }
    }
    
    // Detect entering underwater - spawn burst of bubbles
    if (isUnderwater && !wasUnderwater) {
        spawnEntryBubbles();
        lastAmbientBubbleTime = time;
        lastAmbientSoundTime = time;
    }
    wasUnderwater = isUnderwater;
    
    // Spawn new bubbles when moving underwater
    if (isUnderwater && mouseInitialized) {
        const dx = mousePosition.x - lastMousePosition.x;
        const dy = mousePosition.y - lastMousePosition.y;
        const mouseDelta = Math.sqrt(dx * dx + dy * dy);
        
        if (mouseDelta > 3 && time - lastSpawnTime > BUBBLE_SPAWN_RATE) {
            const pos = getSpawnPosition();
            if (pos && pos.y < UNDERWATER_Y_THRESHOLD) {
                spawnBubble(pos);
                lastSpawnTime = time;
            }
        }
        
        lastMousePosition.x = mousePosition.x;
        lastMousePosition.y = mousePosition.y;
        
        // Ambient bubble groups every few seconds
        if (time - lastAmbientBubbleTime > AMBIENT_BUBBLE_INTERVAL) {
            spawnAmbientBubbleGroup();
            lastAmbientBubbleTime = time;
        }
        
        // Play bubble sound periodically
        if (time - lastAmbientSoundTime > AMBIENT_SOUND_INTERVAL) {
            playDiveSound();
            lastAmbientSoundTime = time;
        }
    }
}

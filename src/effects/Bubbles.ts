import {
    Mesh,
    SphereGeometry,
    ShaderMaterial,
    Vector3,
    Group,
    AdditiveBlending,
    FrontSide
} from "three";
import { camera, scene } from "../scripts/Scene";
import { deltaTime, time } from "../scripts/Time";
import { UNDERWATER_Y_THRESHOLD } from "./Underwater";
import { playDiveSound } from "../scripts/Audio";

// ============================================
// BUBBLE SETTINGS (tweak these!)
// ============================================
export const BUBBLE_COUNT = 200;           // Max bubbles at once
export const BUBBLE_SIZE_MIN = 0.005;     // Minimum bubble radius
export const BUBBLE_SIZE_MAX = 0.015;     // Maximum bubble radius
export const BUBBLE_RISE_SPEED = 0.3;     // How fast bubbles rise
export const BUBBLE_WOBBLE = 0.08;        // Horizontal wobble amount
export const BUBBLE_LIFETIME = 2.5;       // Seconds before fade
export const BUBBLE_SPAWN_RATE = 0.02;    // Seconds between spawns
export const BUBBLE_SPAWN_DISTANCE = 0.8; // Distance from camera to spawn
export const BUBBLE_SPREAD = 0.25;        // Random spread at spawn

// Ambient underwater bubble settings
export const AMBIENT_BUBBLE_INTERVAL = 1.4;   // Seconds between ambient bubble groups
export const AMBIENT_BUBBLE_GROUP_SIZE = 6;    // Bubbles per ambient group
export const AMBIENT_SOUND_INTERVAL = 10.0;   // Seconds between bubble sounds
export const ENTRY_BUBBLE_COUNT = 60;          // Total bubbles to spawn when entering water
const ENTRY_BUBBLE_PER_FRAME = 12;                // Bubbles to spawn per frame (stagger the burst)
// ============================================

interface Bubble {
    mesh: Mesh;
    velocity: Vector3;
    life: number;
    maxLife: number;
}

const bubbles: Bubble[] = [];
const bubbleGroup = new Group();
const sphereGeo = new SphereGeometry(1, 16, 12);  // Smoother for Fresnel rim

// ============================================
// BUBBLE SHADER — Fresnel rim + transparent center
// ============================================
const bubbleVertexShader = /* glsl */`
    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
    }
`;

const bubbleFragmentShader = /* glsl */`
    uniform float uOpacity;
    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main() {
        float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
        float rim = pow(fresnel, 1.8);

        // Slight rainbow iridescence based on view angle
        vec3 rimColor = vec3(0.9, 0.95, 1.0);  // bright white-blue rim
        vec3 iriColor = vec3(
            0.7 + 0.3 * sin(fresnel * 6.0),
            0.8 + 0.2 * sin(fresnel * 6.0 + 2.1),
            0.9 + 0.1 * sin(fresnel * 6.0 + 4.2)
        );
        vec3 color = mix(iriColor, rimColor, rim);

        // More visible: higher base alpha, stronger rim
        float alpha = mix(0.12, 0.7, rim) * uOpacity;

        gl_FragColor = vec4(color, alpha);
    }
`;
// ============================================

let initialized = false;
let lastSpawnTime = 0;
let isUnderwater = false;
let wasUnderwater = false;
let _bubblesEnabled = true;

// Ambient bubble timing
let lastAmbientBubbleTime = 0;
let lastAmbientSoundTime = 0;

// Staggered entry bubble spawning (avoids 60-bubble single-frame spike)
let entryBubblesRemaining = 0;

// Track mouse position
const mousePosition = { x: 0, y: 0 };
const lastMousePosition = { x: 0, y: 0 };
let mouseInitialized = false;

export function Start(): void {
    // Pre-create bubble meshes (pooling)
    for (let i = 0; i < BUBBLE_COUNT; i++) {
        const size = BUBBLE_SIZE_MIN + Math.random() * (BUBBLE_SIZE_MAX - BUBBLE_SIZE_MIN);
        const material = new ShaderMaterial({
            vertexShader: bubbleVertexShader,
            fragmentShader: bubbleFragmentShader,
            uniforms: {
                uOpacity: { value: 0 }
            },
            transparent: true,
            blending: AdditiveBlending,
            depthWrite: false,
            side: FrontSide
        });
        const mesh = new Mesh(sphereGeo, material);
        mesh.scale.setScalar(size);
        mesh.visible = false;
        mesh.raycast = () => {};  // purely visual — must not intercept raycasts (ocean ripple, etc.)
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

export function setBubblesEnabled(enabled: boolean): void {
    _bubblesEnabled = enabled;
    if (!enabled) {
        for (const bubble of bubbles) {
            if (bubble.life > 0) { bubble.life = 0; bubble.mesh.visible = false; }
        }
    }
}

function spawnBubble(position: Vector3): void {
    if (!_bubblesEnabled) return;
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
            
            const mat = bubble.mesh.material as ShaderMaterial;
            mat.uniforms.uOpacity.value = 0.6;
            
            return;
        }
    }
}

// Reusable scratch vectors (eliminates per-call allocations in spawn functions)
const _forward = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _spawnPos = new Vector3();

// Get a spawn position at given screen coordinates (NDC: -1 to 1)
function getSpawnPositionAtNDC(ndcX: number, ndcY: number): Vector3 {
    _forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    
    const fovRad = (camera.fov * Math.PI) / 180;
    const halfHeight = Math.tan(fovRad / 2) * BUBBLE_SPAWN_DISTANCE;
    const halfWidth = halfHeight * camera.aspect;
    
    const offsetX = ndcX * halfWidth;
    const offsetY = ndcY * halfHeight;
    
    _spawnPos.copy(camera.position)
        .addScaledVector(_forward, BUBBLE_SPAWN_DISTANCE)
        .addScaledVector(_right, offsetX)
        .addScaledVector(_up, offsetY);
    
    _spawnPos.x += (Math.random() - 0.5) * BUBBLE_SPREAD;
    _spawnPos.y += (Math.random() - 0.5) * BUBBLE_SPREAD;
    _spawnPos.z += (Math.random() - 0.5) * BUBBLE_SPREAD;
    
    return _spawnPos;
}

// Spawn a small group of ambient bubbles at a random screen position
function spawnAmbientBubbleGroup(): void {
    // Random position on screen (avoid edges)
    const ndcX = (Math.random() - 0.5) * 1.4;
    const ndcY = (Math.random() - 0.5) * 1.4;
    
    // Spawn bubbles close together using the constant
    for (let i = 0; i < AMBIENT_BUBBLE_GROUP_SIZE; i++) {
        const offsetX = ndcX + (Math.random() - 0.5) * 0.2;
        const offsetY = ndcY + (Math.random() - 0.5) * 0.2;
        const pos = getSpawnPositionAtNDC(offsetX, offsetY);
        
        if (pos.y < UNDERWATER_Y_THRESHOLD) {
            spawnBubble(pos);
        }
    }
}

function getSpawnPosition(): Vector3 | null {
    if (!mouseInitialized) return null;
    
    // Reuse scratch vectors
    _forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    
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
    _spawnPos.copy(camera.position)
        .addScaledVector(_forward, BUBBLE_SPAWN_DISTANCE)
        .addScaledVector(_right, offsetX)
        .addScaledVector(_up, offsetY);
    
    // Add small random spread
    _spawnPos.x += (Math.random() - 0.5) * BUBBLE_SPREAD;
    _spawnPos.y += (Math.random() - 0.5) * BUBBLE_SPREAD;
    _spawnPos.z += (Math.random() - 0.5) * BUBBLE_SPREAD;
    
    return _spawnPos;
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
        const mat = bubble.mesh.material as ShaderMaterial;
        mat.uniforms.uOpacity.value = Math.min(0.6, lifeRatio * 1.5);
        
        // Pop at surface
        if (bubble.mesh.position.y > UNDERWATER_Y_THRESHOLD - 0.05) {
            bubble.life = 0;
        }
        
        if (bubble.life <= 0) {
            bubble.mesh.visible = false;
        }
    }
    
    // Detect entering underwater - stagger bubble burst across frames
    if (isUnderwater && !wasUnderwater && _bubblesEnabled) {
        entryBubblesRemaining = ENTRY_BUBBLE_COUNT;
        lastAmbientBubbleTime = time;
        lastAmbientSoundTime = time;
    }
    wasUnderwater = isUnderwater;
    
    // Stagger entry bubble spawning across multiple frames
    if (entryBubblesRemaining > 0) {
        const toSpawn = Math.min(entryBubblesRemaining, ENTRY_BUBBLE_PER_FRAME);
        for (let i = 0; i < toSpawn; i++) {
            const ndcX = (Math.random() - 0.5) * 1.6;
            const ndcY = (Math.random() - 0.5) * 1.6;
            const pos = getSpawnPositionAtNDC(ndcX, ndcY);
            if (pos.y < UNDERWATER_Y_THRESHOLD) {
                spawnBubble(pos);
            }
        }
        entryBubblesRemaining -= toSpawn;
    }
    
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

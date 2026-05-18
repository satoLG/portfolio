import {
    SphereGeometry,
    ShaderMaterial,
    Vector3,
    AdditiveBlending,
    FrontSide,
    InstancedMesh,
    InstancedBufferAttribute,
    Object3D
} from "three";
import { camera, scene } from "../core/Scene";
import { deltaTime, time } from "../core/Time";
import { UNDERWATER_Y_THRESHOLD } from "./PostProcess";
import { playDiveSound } from "../core/Audio";

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

// Per-bubble CPU-side state (no Three.js objects — just numbers)
interface Bubble {
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
    scale: number;
    life: number;
    maxLife: number;
}

const bubbles: Bubble[] = [];

// ── InstancedMesh (replaces 200 individual Mesh draw calls with 1) ───────────
let _instMesh: InstancedMesh | null = null;
const _opacities = new Float32Array(BUBBLE_COUNT);
let _opacityAttr: InstancedBufferAttribute;
const _dummy = new Object3D();

export function getRenderable(): InstancedMesh | null {
    return _instMesh;
}

// ============================================
// BUBBLE SHADER — Fresnel rim + transparent center (instanced)
// instanceMatrix is injected by Three.js for InstancedMesh + ShaderMaterial
// ============================================
const bubbleVertexShader = /* glsl */`
    attribute float aOpacity;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying float vOpacity;

    void main() {
        vOpacity = aOpacity;
        // normalMatrix is from the base mesh — correct for uniform-scale instances
        // (uniform scale cancels out after normalization)
        vNormal = normalize(normalMatrix * normal);
        // instanceMatrix applies per-instance position + scale
        vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
    }
`;

const bubbleFragmentShader = /* glsl */`
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying float vOpacity;

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
        float alpha = mix(0.12, 0.7, rim) * vOpacity;

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
    const geo = new SphereGeometry(1, 16, 12);  // Smoother for Fresnel rim

    // Per-instance opacity passed as a vertex attribute
    _opacityAttr = new InstancedBufferAttribute(_opacities, 1);
    geo.setAttribute('aOpacity', _opacityAttr);

    const material = new ShaderMaterial({
        vertexShader: bubbleVertexShader,
        fragmentShader: bubbleFragmentShader,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: FrontSide
    });

    _instMesh = new InstancedMesh(geo, material, BUBBLE_COUNT);
    _instMesh.frustumCulled = false;
    _instMesh.raycast = () => {};  // purely visual — must not intercept raycasts (ocean ripple, etc.)

    // Initialise all instances as hidden (scale 0, far below scene)
    for (let i = 0; i < BUBBLE_COUNT; i++) {
        _dummy.position.set(0, -1000, 0);
        _dummy.scale.setScalar(0);
        _dummy.updateMatrix();
        _instMesh.setMatrixAt(i, _dummy.matrix);
        _opacities[i] = 0;

        bubbles.push({
            x: 0, y: -1000, z: 0,
            vx: 0, vy: 0, vz: 0,
            scale: BUBBLE_SIZE_MIN + Math.random() * (BUBBLE_SIZE_MAX - BUBBLE_SIZE_MIN),
            life: 0,
            maxLife: BUBBLE_LIFETIME
        });
    }

    _instMesh.instanceMatrix.needsUpdate = true;
    _opacityAttr.needsUpdate = true;
    scene.add(_instMesh);

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
        for (let i = 0; i < bubbles.length; i++) {
            if (bubbles[i].life > 0) {
                bubbles[i].life = 0;
                _opacities[i] = 0;
            }
        }
        if (_instMesh) {
            _opacityAttr.needsUpdate = true;
        }
    }
}

export function spawnBubble(position: Vector3): void {
    if (!_bubblesEnabled) return;
    // Find inactive bubble
    for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i];
        if (b.life <= 0) {
            b.x = position.x;
            b.y = position.y;
            b.z = position.z;
            b.life = BUBBLE_LIFETIME * (0.7 + Math.random() * 0.6);
            b.maxLife = b.life;
            b.vx = (Math.random() - 0.5) * BUBBLE_WOBBLE;
            b.vy = BUBBLE_RISE_SPEED * (0.8 + Math.random() * 0.4);
            b.vz = (Math.random() - 0.5) * BUBBLE_WOBBLE;

            // Randomize size
            b.scale = BUBBLE_SIZE_MIN + Math.random() * (BUBBLE_SIZE_MAX - BUBBLE_SIZE_MIN);
            _opacities[i] = 0.6;
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
    if (!initialized || !_instMesh) return;

    isUnderwater = cameraY < UNDERWATER_Y_THRESHOLD;

    // Update existing bubbles (physics + opacity)
    for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i];
        if (b.life <= 0) {
            // Ensure dead bubbles are invisible
            if (_opacities[i] !== 0) _opacities[i] = 0;
            continue;
        }

        // Wobble
        b.vx += (Math.random() - 0.5) * BUBBLE_WOBBLE * deltaTime * 2;
        b.vz += (Math.random() - 0.5) * BUBBLE_WOBBLE * deltaTime * 2;
        b.vx *= 0.98;
        b.vz *= 0.98;

        // Move
        b.x += b.vx * deltaTime;
        b.y += b.vy * deltaTime;
        b.z += b.vz * deltaTime;

        // Age
        b.life -= deltaTime;

        // Fade out
        const lifeRatio = b.life / b.maxLife;
        _opacities[i] = Math.min(0.6, lifeRatio * 1.5);

        // Pop at surface
        if (b.y > UNDERWATER_Y_THRESHOLD - 0.05) {
            b.life = 0;
        }

        if (b.life <= 0) {
            _opacities[i] = 0;
        }
    }

    // Batch-update instance matrices (position + uniform scale)
    for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i];
        if (b.life > 0) {
            _dummy.position.set(b.x, b.y, b.z);
            _dummy.scale.setScalar(b.scale);
        } else {
            // Dead: degenerate scale → rasterizer culls immediately
            _dummy.position.set(0, -1000, 0);
            _dummy.scale.setScalar(0);
        }
        _dummy.updateMatrix();
        _instMesh.setMatrixAt(i, _dummy.matrix);
    }

    _instMesh.instanceMatrix.needsUpdate = true;
    _opacityAttr.needsUpdate = true;

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

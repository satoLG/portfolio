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
import { camera, scene, isMobile } from "../core/Scene";
import { deltaTime, time } from "../core/Time";
import { UNDERWATER_Y_THRESHOLD, getLineNdcY } from "./PostProcess";
import { underwaterLineEdge, underwaterLineWobbleGain } from "../scene/config/OceanConfig";
import { playDiveSound } from "../core/Audio";
import { isRadioZoomActive, isPugZoomActive, isRadioPugZoomSettling } from "../core/Control";

// ============================================
// BUBBLE SETTINGS (tweak these!)
// ============================================
export const BUBBLE_COUNT = 360;          // Instance pool size (InstancedMesh — 1 draw call regardless of count)
export const BUBBLE_SIZE_MIN = 0.0025;    // Minimum bubble radius
export const BUBBLE_SIZE_MAX = 0.008;     // Maximum bubble radius
export const BUBBLE_RISE_SPEED = 0.14;    // How fast bubbles rise (world units/sec)
export const BUBBLE_WOBBLE = 0.0225;      // Horizontal sway velocity amplitude (world units/sec)
export const BUBBLE_LIFETIME = 3.4;       // Seconds before fade (longer so they can reach a high line)
export const BUBBLE_SPAWN_RATE = 0.02;    // Seconds between cursor-trail spawns
export const BUBBLE_SPAWN_DISTANCE = 0.8; // Distance from camera to spawn
export const BUBBLE_HORIZONTAL_SPREAD = 1.9; // NDC width the ambient bubbles seed across (screen-wide)
export const BUBBLE_DEPTH_SPREAD = 0.5;   // World-unit forward/back jitter so bubbles aren't coplanar
export const BUBBLE_LINE_FADE_BAND = 0.08; // NDC band below the ocean line over which a rising bubble fades out before popping at it
export const BUBBLE_LINE_CLIP_MARGIN = 0.03; // Extra NDC below the line's ripple crest where bubbles pop — guarantees they vanish *before* touching the line
export const BUBBLE_SPAWN_LINE_MARGIN = 0.15; // Bubbles may be seeded up to this far below the line (short-path bubbles keep the band under the line populated)
export const BUBBLE_FADE_IN_TIME = 0.12;  // Seconds a fresh bubble takes to ramp from 0 → full opacity (so it materialises instead of popping in)

// Ambient underwater bubbles are kept at a target *live count* rather than
// spawned on a fixed timer. Because every bubble pops when it reaches the ocean
// line, a fixed spawn rate looks sparse when the line sits low on screen (short
// travel → fast turnover) and dense when it sits high. Targeting a live count
// instead keeps the density constant at any camera depth.
export const BUBBLE_TARGET_DENSITY = 25;  // Live ambient bubbles when the screen is fully underwater
export const BUBBLE_TARGET_MIN = 7;       // Floor as soon as any water shows (keeps shallow views populated)
const BUBBLE_SPAWN_PER_FRAME = 5;         // Cap on new ambient bubbles per frame (staggers the fill)
export const AMBIENT_SOUND_INTERVAL = 10.0;   // Seconds between bubble sounds
// ============================================

// Per-bubble CPU-side state (no Three.js objects — just numbers)
interface Bubble {
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
    scale: number;
    life: number;
    maxLife: number;
    swaySpeed: number;   // rad/sec — smooth sinusoidal horizontal drift (no jitter)
    swayPhase: number;   // per-bubble phase offset so they don't sway in unison
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

// Ambient bubble sound timing
let lastAmbientSoundTime = 0;

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
            maxLife: BUBBLE_LIFETIME,
            swaySpeed: 0,
            swayPhase: 0
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
            b.vy = BUBBLE_RISE_SPEED * (0.8 + Math.random() * 0.4);
            // Smooth sinusoidal sway (see Update) instead of a per-frame random
            // walk — reads as a gentle drift rather than a jitter.
            b.swaySpeed = 0.8 + Math.random() * 1.2;
            b.swayPhase = Math.random() * Math.PI * 2;
            b.vx = 0;
            b.vz = 0;

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
const _screenProj = new Vector3();

// Get a spawn position at given screen coordinates (NDC: -1 to 1).
// The only randomness added here is a small forward/back (depth) jitter so the
// bubbles occupy a volume rather than a flat plane — it barely moves their
// screen position, so a bubble seeded below the bottom edge stays below it and
// rises *into* frame. (The old world-space X/Y spread pushed bubbles up to
// ±0.5 NDC vertically, which is why they used to pop into existence mid-screen.)
function getSpawnPositionAtNDC(ndcX: number, ndcY: number): Vector3 {
    _forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    const fovRad = (camera.fov * Math.PI) / 180;
    const halfHeight = Math.tan(fovRad / 2) * BUBBLE_SPAWN_DISTANCE;
    const halfWidth = halfHeight * camera.aspect;

    const offsetX = ndcX * halfWidth;
    const offsetY = ndcY * halfHeight;
    const depthJitter = (Math.random() - 0.5) * BUBBLE_DEPTH_SPREAD;

    _spawnPos.copy(camera.position)
        .addScaledVector(_forward, BUBBLE_SPAWN_DISTANCE + depthJitter)
        .addScaledVector(_right, offsetX)
        .addScaledVector(_up, offsetY);

    return _spawnPos;
}

// Spawn a single ambient bubble at a random height across the *whole* visible
// underwater column — from just below the bottom edge up to a hair under the
// ocean line — at a random horizontal position. Seeding the upper part of the
// column (not just the bottom) is what keeps the band right below the line
// populated: those bubbles just have a short path before they fade out at the
// line, which is fine. A brief fade-in (see Update) stops them from popping in.
function spawnAmbientBubble(): void {
    const ndcX = (Math.random() - 0.5) * BUBBLE_HORIZONTAL_SPREAD;

    const lineNdc = getLineNdcY(camera.position.y);
    const bottom = -1.1;                               // just below the screen's bottom edge
    const top = Math.max(bottom, lineNdc - BUBBLE_SPAWN_LINE_MARGIN); // a hair below the line (never above `bottom`)
    const ndcY = bottom + Math.random() * (top - bottom);
    const pos = getSpawnPositionAtNDC(ndcX, ndcY);

    if (pos.y < UNDERWATER_Y_THRESHOLD) {
        spawnBubble(pos);
    }
}

function getSpawnPosition(): Vector3 | null {
    if (!mouseInitialized) return null;

    // Cursor-trail bubbles are meant to appear *at* the cursor, so (unlike the
    // ambient bubbles) a little jitter around that point is fine.
    const ndcX = (mousePosition.x / window.innerWidth) * 2 - 1;
    const ndcY = -((mousePosition.y / window.innerHeight) * 2 - 1);
    return getSpawnPositionAtNDC(
        ndcX + (Math.random() - 0.5) * 0.06,
        ndcY + (Math.random() - 0.5) * 0.06
    );
}

export function Update(): void {
    if (!initialized || !_instMesh) return;

    // Same source of truth as the screen-space over/under effect (PostProcess.ts):
    // the ocean line's projected screen row. The tint itself is a soft smoothstep
    // band `underwaterLineEdge` wide, so the bottom of the screen already reads as
    // underwater once the line is within that band of the bottom edge (NDC -1) —
    // not only once it fully crosses it. Match that so bubbles start as soon as the
    // tint is visible, instead of lagging behind it.
    isUnderwater = getLineNdcY(camera.position.y) > -1.0 - underwaterLineEdge;

    // A radio/pug zoom reframes the camera, so the projected ocean line misfires
    // (it assumes a level scroll camera) — the same reason the tint/distortion is
    // disabled in PostProcess. Suppress bubbles too: stop new spawns and clear any
    // that are already alive so they don't linger against the misplaced line. Stay
    // suppressed through the zoom-out transition (isRadioPugZoomSettling) until the
    // camera has fully eased back — the flags below flip false the instant zoom-out
    // starts, well before the camera actually gets there.
    if (isRadioZoomActive() || isPugZoomActive() || isRadioPugZoomSettling()) {
        isUnderwater = false;
        for (let i = 0; i < bubbles.length; i++) {
            if (bubbles[i].life > 0) {
                bubbles[i].life = 0;
                _opacities[i] = 0;
            }
        }
    }

    // The clip line: the rendered ocean line ripples up to `underwaterLineWobbleGain`
    // above the base line (getLineNdcY returns the un-rippled base). Clip at the
    // *crest* of that ripple, plus an extra margin, so a rising bubble pops a bit
    // BEFORE it can ever reach the visible line at any column or camera height.
    const clipLineNdcY = getLineNdcY(camera.position.y) - underwaterLineWobbleGain - BUBBLE_LINE_CLIP_MARGIN;

    // Update existing bubbles (physics + opacity), tallying the live count so the
    // spawner below can top the population back up to its target.
    let aliveCount = 0;
    for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i];
        if (b.life <= 0) {
            // Ensure dead bubbles are invisible
            if (_opacities[i] !== 0) _opacities[i] = 0;
            continue;
        }

        // Smooth sinusoidal sway — a gentle drift rather than a per-frame random
        // walk, so bubbles glide sideways as they rise instead of jittering.
        b.vx = Math.sin(time * b.swaySpeed + b.swayPhase) * BUBBLE_WOBBLE;
        b.vz = Math.cos(time * b.swaySpeed * 0.8 + b.swayPhase * 1.3) * BUBBLE_WOBBLE * 0.6;

        // Move
        b.x += b.vx * deltaTime;
        b.y += b.vy * deltaTime;
        b.z += b.vz * deltaTime;

        // Age
        b.life -= deltaTime;

        // Age-based fade, plus a quick fade-IN at the start of life so a bubble
        // seeded high in the column materialises gently instead of popping into
        // existence.
        const lifeRatio = b.life / b.maxLife;
        const fadeIn = Math.min(1.0, (b.maxLife - b.life) / BUBBLE_FADE_IN_TIME);
        let opacity = Math.max(0.0, Math.min(0.6, lifeRatio * 1.5)) * fadeIn;

        // Screen-space clip to the ocean line (the top of the effect): fade the
        // bubble out as it approaches the line and pop it the instant it reaches
        // the line, so it rises up to the line and gradually vanishes there but
        // NEVER passes it. Purely screen-space, so it behaves identically whether
        // the line sits low (camera above water) or high (submerged) — it's the
        // same projected line PostProcess draws. The world-Y check is only a far
        // safety net (a bubble should never be well above the surface).
        const bubbleNdcY = _screenProj.set(b.x, b.y, b.z).project(camera).y;
        const gap = clipLineNdcY - bubbleNdcY; // >0 below the line, <0 past it
        if (gap <= 0.0 || b.y > UNDERWATER_Y_THRESHOLD + 2.0) {
            b.life = 0;
            opacity = 0;
        } else {
            opacity *= Math.min(1.0, gap / BUBBLE_LINE_FADE_BAND);
            aliveCount++;
        }
        _opacities[i] = opacity;
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

    // Detect entering underwater — reset the sound timer so the dive SFX plays
    // promptly. The bubble population itself is maintained continuously below, so
    // there's no separate entry burst to schedule.
    if (isUnderwater && !wasUnderwater && _bubblesEnabled) {
        lastAmbientSoundTime = time;
    }
    wasUnderwater = isUnderwater;

    if (isUnderwater && _bubblesEnabled) {
        // Maintain the ambient bubble population by topping it back up to a target
        // live count, all spawned from just below the bottom edge so they rise into
        // frame. The target scales with how much of the screen is underwater, so
        // the density stays constant whether the ocean line sits low (shallow view,
        // short travel, fast turnover) or high (deep view). Per-frame spawn cap
        // staggers the fill so it flows in from below rather than popping as a wall.
        const underwaterFrac = Math.max(0, Math.min(1, (getLineNdcY(camera.position.y) + 1) / 2));
        const target = Math.min(
            BUBBLE_COUNT,
            Math.round(BUBBLE_TARGET_MIN + underwaterFrac * (BUBBLE_TARGET_DENSITY - BUBBLE_TARGET_MIN))
        );
        let deficit = Math.min(target - aliveCount, BUBBLE_SPAWN_PER_FRAME);
        while (deficit-- > 0) spawnAmbientBubble();

        // Cursor-hover bubble trail — desktop-only. On mobile the touch usually
        // means a scroll/drag gesture, not deliberate cursor tracking, so it's
        // disabled there; the ambient population + sound run on both platforms.
        if (!isMobile && mouseInitialized) {
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
        }

        // Play bubble sound periodically
        if (time - lastAmbientSoundTime > AMBIENT_SOUND_INTERVAL) {
            playDiveSound();
            lastAmbientSoundTime = time;
        }
    }
}

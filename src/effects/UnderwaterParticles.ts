import {
    Points,
    BufferGeometry,
    Float32BufferAttribute,
    ShaderMaterial,
    NormalBlending
} from "three";
import { camera, scene } from "../scripts/Scene";
import { deltaTime } from "../scripts/Time";
import { UNDERWATER_Y_THRESHOLD } from "./Underwater";

// ============================================
// UNDERWATER PARTICLE SETTINGS (tweak these!)
// ============================================
export const PARTICLE_COUNT        = 300;     // Total number of specks
export const PARTICLE_BOX_SIZE     = 12.0;    // Half-size of the cube volume around camera
export const PARTICLE_MIN_DIST     = 1.0;     // Minimum distance from camera (no specks in your face)
export const PARTICLE_SIZE         = 1.0;     // Point size (pixels) — tiny specks
export const PARTICLE_OPACITY      = 1;     // Max opacity (0-1)
export const PARTICLE_DRIFT_SPEED  = 0.01;   // Very slow drift (units/sec)
export const PARTICLE_FADE_NEAR    = 2.0;     // Fade in between minDist and this distance
export const PARTICLE_FADE_FAR     = 10.0;    // Start fading out at this distance
// ============================================

let points: Points | null = null;
let geometry: BufferGeometry | null = null;
let material: ShaderMaterial | null = null;
let initialized = false;

// Per-particle local offsets (relative to camera) and velocities
let positions: Float32Array;
let velocities: Float32Array;

let currentOpacity = 0;

// Track last camera position to wrap particles as camera moves
let lastCamX = 0, lastCamY = 0, lastCamZ = 0;
let firstFrame = true;

const vertexShader = /* glsl */`
    uniform float uOpacity;
    uniform float uSize;
    uniform float uDpr;
    uniform float uFadeNear;
    uniform float uFadeFar;
    uniform float uMinDist;
    uniform float uBoxSize;

    varying float vAlpha;

    void main() {
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        float dist3d = length(mvPos.xyz);
        
        // Fade: invisible when too close, ramp in, full in middle, fade out far
        float fadeIn = smoothstep(uMinDist, uFadeNear, dist3d);
        float fadeOut = 1.0 - smoothstep(uFadeFar, uBoxSize, dist3d);
        
        vAlpha = fadeIn * fadeOut * uOpacity;
        
        gl_Position = projectionMatrix * mvPos;
        // uSize is in CSS pixels; multiply by DPR so it stays consistent across displays/zoom
        gl_PointSize = uSize * uDpr;
    }
`;

const fragmentShader = /* glsl */`
    varying float vAlpha;

    void main() {
        gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha);
    }
`;

function randomInBox(halfSize: number, minDist: number): { x: number; y: number; z: number } {
    // Random position in box, reject if too close to center
    for (let attempt = 0; attempt < 10; attempt++) {
        const x = (Math.random() - 0.5) * 2.0 * halfSize;
        const y = (Math.random() - 0.5) * 2.0 * halfSize;
        const z = (Math.random() - 0.5) * 2.0 * halfSize;
        if (x * x + y * y + z * z >= minDist * minDist) {
            return { x, y, z };
        }
    }
    // Fallback: place at edge
    return { x: halfSize * 0.8, y: halfSize * 0.3, z: halfSize * 0.5 };
}

export function Start(): void {
    positions = new Float32Array(PARTICLE_COUNT * 3);
    velocities = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = randomInBox(PARTICLE_BOX_SIZE, PARTICLE_MIN_DIST);
        positions[i * 3]     = p.x;
        positions[i * 3 + 1] = p.y;
        positions[i * 3 + 2] = p.z;

        // Very slow random drift
        velocities[i * 3]     = (Math.random() - 0.5) * PARTICLE_DRIFT_SPEED * 2;
        velocities[i * 3 + 1] = (Math.random() - 0.5) * PARTICLE_DRIFT_SPEED * 2;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * PARTICLE_DRIFT_SPEED * 2;
    }

    geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));

    const dpr = Math.min(window.devicePixelRatio, 2);

    material = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            uOpacity:  { value: 0 },
            uSize:     { value: PARTICLE_SIZE },
            uDpr:      { value: dpr },
            uMinDist:  { value: PARTICLE_MIN_DIST },
            uFadeNear: { value: PARTICLE_FADE_NEAR },
            uFadeFar:  { value: PARTICLE_FADE_FAR },
            uBoxSize:  { value: PARTICLE_BOX_SIZE }
        },
        transparent: true,
        blending: NormalBlending,
        depthWrite: false,
        depthTest: false
    });

    points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 1000;  // Render AFTER ocean surface and all other transparent objects
    points.raycast = () => {};   // purely visual — must not intercept raycasts
    scene.add(points);

    initialized = true;
}

export function Update(cameraY: number): void {
    if (!initialized || !points || !geometry || !material) return;

    const isUnderwater = cameraY < UNDERWATER_Y_THRESHOLD;

    // Smoothly fade in/out
    const targetOpacity = isUnderwater ? PARTICLE_OPACITY : 0;
    const prevOpacity = currentOpacity;
    currentOpacity += (targetOpacity - currentOpacity) * Math.min(1, deltaTime * 4);

    if (currentOpacity < 0.001) {
        // Not visible — skip all CPU/GPU work, but still track camera so
        // particles re-enter from sensible positions when we dive again.
        if (points.visible) {
            points.visible = false;
            material.uniforms.uOpacity.value = 0;
        }
        // Keep lastCam* in sync so dCam is zero on first visible frame
        lastCamX = camera.position.x;
        lastCamY = camera.position.y;
        lastCamZ = camera.position.z;
        firstFrame = false;
        return;
    }
    points.visible = true;

    const camX = camera.position.x;
    const camY = camera.position.y;
    const camZ = camera.position.z;

    if (firstFrame) {
        lastCamX = camX;
        lastCamY = camY;
        lastCamZ = camZ;
        firstFrame = false;
    }

    // How much the camera moved this frame
    const dCamX = camX - lastCamX;
    const dCamY = camY - lastCamY;
    const dCamZ = camZ - lastCamZ;
    lastCamX = camX;
    lastCamY = camY;
    lastCamZ = camZ;

    const dt = deltaTime;
    const posAttr = geometry.getAttribute('position') as Float32BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const box = PARTICLE_BOX_SIZE;

    // Max local Y so that world Y stays below the ocean surface
    const maxLocalY = UNDERWATER_Y_THRESHOLD - camY - 0.1;  // small margin below surface

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;

        // Drift very slowly in world space (subtract camera movement to keep them in local space)
        arr[i3]     += velocities[i3]     * dt - dCamX;
        arr[i3 + 1] += velocities[i3 + 1] * dt - dCamY;
        arr[i3 + 2] += velocities[i3 + 2] * dt - dCamZ;

        // Wrap within box (toroidal wrapping)
        if (arr[i3]     >  box) arr[i3]     -= box * 2;
        if (arr[i3]     < -box) arr[i3]     += box * 2;
        if (arr[i3 + 1] >  box) arr[i3 + 1] -= box * 2;
        if (arr[i3 + 1] < -box) arr[i3 + 1] += box * 2;
        if (arr[i3 + 2] >  box) arr[i3 + 2] -= box * 2;
        if (arr[i3 + 2] < -box) arr[i3 + 2] += box * 2;

        // Clamp: keep particle below ocean surface
        if (arr[i3 + 1] > maxLocalY) {
            arr[i3 + 1] = -box + Math.random() * box;  // wrap to lower half
        }
    }

    // Only push data to GPU when the buffer actually changed
    posAttr.needsUpdate = true;

    // The positions are local-space offsets — center on camera
    points.position.set(camX, camY, camZ);

    // Only write uniform when the value changed (avoids a driver round-trip on unchanged frames)
    if (currentOpacity !== prevOpacity) {
        material.uniforms.uOpacity.value = currentOpacity;
    }
}

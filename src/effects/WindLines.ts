import {
    BufferGeometry,
    BufferAttribute,
    Mesh,
    ShaderMaterial,
    Group,
    Color,
    DoubleSide,
} from 'three';
import { isBreezeActive } from '../scripts/Audio';
import { UNDERWATER_Y_THRESHOLD } from './Underwater';
import { islandPosition } from '../scene/IslandConfig';
import * as WLC from '../scene/WindLinesConfig';

// Scale factor: converts pixel-based config values to Three.js world units.
// At FOV=70 degrees, camera distance ~4.2u from island: 1px approx 0.006 world units.
const WORLD_SCALE = 0.006;

// World-Y spawn range — driven directly by config.minWorldY / config.maxWorldY.

// Shaders
const VERT = /* glsl */`
    attribute float aT;
    varying  float vT;
    void main() {
        vT = aT;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const FRAG = /* glsl */`
    uniform float uAlpha;
    uniform vec3  uColor;
    varying float vT;
    void main() {
        float fade = smoothstep(0.0, 0.15, vT) * smoothstep(1.0, 0.85, vT);
        gl_FragColor = vec4(uColor, uAlpha * fade);
    }
`;

// Runtime config - initialised from WindLinesConfig.ts, mutated live by debug GUI
export const config = {
    maxLines:      WLC.maxLines,
    minLength:     WLC.minLength,
    maxLength:     WLC.maxLength,
    minSpeed:      WLC.minSpeed,
    maxSpeed:      WLC.maxSpeed,
    minWorldY:     WLC.minWorldY,
    maxWorldY:     WLC.maxWorldY,
    tiltY:         WLC.tiltY,
    minWidth:      WLC.minWidth,
    maxWidth:      WLC.maxWidth,
    lineOpacity:   WLC.lineOpacity,
    colorR:        WLC.colorR,
    colorG:        WLC.colorG,
    colorB:        WLC.colorB,
    spawnRate:     WLC.spawnRate,
    rampUp:        WLC.rampUp,
    rampDown:      WLC.rampDown,
    waveAmplitude: WLC.waveAmplitude,
    waveFrequency: WLC.waveFrequency,
    waveSpeed:     WLC.waveSpeed,
    waveSegments:  WLC.waveSegments,
    minZOffset:          WLC.minZOffset,
    maxZOffset:          WLC.maxZOffset,
    islandDisappearDist: WLC.islandDisappearDist,
    islandAppearDist:    WLC.islandAppearDist,
};

// The Group is exported so Scene.ts can add it to the Three.js scene once.
export const windLinesGroup = new Group();

// Internal per-line state
interface WindLine3D {
    mesh:      Mesh;
    geometry:  BufferGeometry;
    worldX:    number;
    worldY:    number;
    worldZ:    number;
    driftY:    number;
    length:    number;
    halfWidth: number;
    speed:     number;
    opacity:   number;
    waveScale: number;
    phase:     number;
    segments:  number;
}

const lines:     WindLine3D[] = [];
let intensity  = 0;
let spawnAccum = 0;
let elapsed    = 0;
let _camX   = 0;
let _camZ   = 0;
let _camFov = 70;

// Lifecycle

export function Start(): void {
    // All resources are created lazily in _spawn().
    // Scene.ts should call scene.add(WindLines.windLinesGroup) after this.
}

export function onResize(): void {}

// Per-frame update - called from Scene.Update() every frame
export function Update(
    deltaTime: number,
    camX:       number,
    camY:       number,
    camZ:       number,
    cameraFov:  number,
): void {
    _camX   = camX;
    _camZ   = camZ;
    _camFov = cameraFov;
    elapsed += deltaTime;

    // Hard-cut when underwater
    if (camY < UNDERWATER_Y_THRESHOLD) {
        if (lines.length > 0) _clearAll();
        intensity  = 0;
        spawnAccum = 0;
        return;
    }

    // Breeze intensity envelope
    if (isBreezeActive()) {
        intensity = Math.min(1, intensity + deltaTime / config.rampUp);
    } else {
        intensity = Math.max(0, intensity - deltaTime / config.rampDown);
    }

    if (intensity > 0) {
        spawnAccum += config.spawnRate * intensity * deltaTime;
        while (spawnAccum >= 1 && lines.length < config.maxLines) {
            spawnAccum -= 1;
            _spawn();
        }
        if (spawnAccum >= 1) spawnAccum = 0;
    }

    for (let i = lines.length - 1; i >= 0; i--) {
        const wl = lines[i];
        const dx = wl.speed * deltaTime;
        wl.worldX -= dx;
        wl.driftY -= dx * config.tiltY;

        // Per-line positional fade based on this line's X relative to the island.
        // Every line uses the same X thresholds so opacity changes at the same
        // 3D position in the scene regardless of camera position or per-line randomness.
        const relX = wl.worldX - islandPosition.x;
        let posAlpha: number;
        if (relX > 0) {
            // right of island, approaching → fade in from 0 to 1
            posAlpha = 1.0 - Math.min(1.0, relX / config.islandAppearDist);
        } else {
            // left of island, moving away → fade out from 1 to 0
            posAlpha = 1.0 - Math.min(1.0, -relX / config.islandDisappearDist);
        }

        // Kill line once fully faded past the island on the left side.
        if (posAlpha <= 0.0 && relX < 0) {
            _removeLine(i);
            continue;
        }

        const mat = wl.mesh.material as ShaderMaterial;
        mat.uniforms.uColor.value.setRGB(
            config.colorR / 255,
            config.colorG / 255,
            config.colorB / 255,
        );
        mat.uniforms.uAlpha.value = config.lineOpacity * intensity * posAlpha;

        _updatePositions(wl);
    }
}

// Private helpers

function _rand(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function _clearAll(): void {
    for (let i = lines.length - 1; i >= 0; i--) _removeLine(i);
}

function _removeLine(idx: number): void {
    const wl = lines[idx];
    windLinesGroup.remove(wl.mesh);
    wl.geometry.dispose();
    (wl.mesh.material as ShaderMaterial).dispose();
    lines.splice(idx, 1);
}

function _spawn(): void {
    const segs = Math.max(4, config.waveSegments);

    const length    = _rand(config.minLength, config.maxLength) * WORLD_SCALE;
    const halfWidth = _rand(config.minWidth,  config.maxWidth ) * WORLD_SCALE * 0.5;

    // World Y - direct world-space range from config.
    const worldY = _rand(config.minWorldY, config.maxWorldY);

    // World Z - scatter lines at different depths around the island.
    const worldZ = islandPosition.z + _rand(config.minZOffset, config.maxZOffset);

    // Spawn just past the right screen edge at this line's Z depth.
    // Three.js FOV is vertical — multiply by aspect ratio to get horizontal extent.
    const halfVFovRad = (_camFov * Math.PI / 180) * 0.5;
    const aspect      = window.innerWidth / window.innerHeight;
    const depthToLine = Math.abs(_camZ - worldZ);
    const screenRight = _camX + depthToLine * Math.tan(halfVFovRad) * aspect;
    const spawnX      = screenRight + length + 0.05;

    const geo = _createRibbonGeo(segs);
    const mat = new ShaderMaterial({
        uniforms: {
            uAlpha: { value: 1.0 },
            uColor: { value: new Color(
                config.colorR / 255,
                config.colorG / 255,
                config.colorB / 255,
            )},
        },
        vertexShader:   VERT,
        fragmentShader: FRAG,
        transparent:    true,
        depthTest:      true,
        depthWrite:     false,
        side:           DoubleSide,
    });

    const mesh         = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder   = 1;

    const wl: WindLine3D = {
        mesh,
        geometry:  geo,
        worldX:    spawnX,
        worldY,
        worldZ,
        driftY:    0,
        length,
        halfWidth,
        speed:     _rand(config.minSpeed, config.maxSpeed) * WORLD_SCALE,
        opacity:   1.0,
        waveScale: _rand(0.3, 1.0),
        phase:     _rand(0, Math.PI * 2),
        segments:  segs,
    };

    lines.push(wl);
    windLinesGroup.add(mesh);
}

// Build a BufferGeometry ribbon (quad strip) with `segments` divisions.
// Vertex layout: [top0, bot0, top1, bot1, ..., topN, botN]
// aT attribute: 0 (right end) to 1 (left end) for the gradient shader.
function _createRibbonGeo(segments: number): BufferGeometry {
    const vertCount = 2 * (segments + 1);
    const positions = new Float32Array(vertCount * 3);
    const tAttr     = new Float32Array(vertCount);

    for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        tAttr[s * 2]     = t;
        tAttr[s * 2 + 1] = t;
    }

    const indices = new Uint16Array(segments * 6);
    for (let i = 0; i < segments; i++) {
        const b = i * 2;
        const d = i * 6;
        indices[d]     = b;
        indices[d + 1] = b + 1;
        indices[d + 2] = b + 2;
        indices[d + 3] = b + 1;
        indices[d + 4] = b + 3;
        indices[d + 5] = b + 2;
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('aT',       new BufferAttribute(tAttr,     1));
    geo.setIndex(new BufferAttribute(indices, 1));
    return geo;
}

// Recompute all ribbon vertex positions for the current frame.
function _updatePositions(wl: WindLine3D): void {
    const positions = wl.geometry.attributes.position.array as Float32Array;
    const segs      = wl.segments;
    const ampW      = config.waveAmplitude * WORLD_SCALE;

    for (let s = 0; s <= segs; s++) {
        const t = s / segs;

        const px = wl.worldX - t * wl.length;

        // Along-line downward tilt (left end sits lower than right)
        const tiltDrop = t * wl.length * config.tiltY;

        // Sinusoidal wobble
        const waveY = ampW * wl.waveScale
            * Math.sin(
                t * Math.PI * 2 * config.waveFrequency
                + elapsed * config.waveSpeed
                + wl.phase,
            );

        const centerY = wl.worldY + wl.driftY - tiltDrop + waveY;

        const topIdx = s * 2;
        const botIdx = s * 2 + 1;

        positions[topIdx * 3]     = px;
        positions[topIdx * 3 + 1] = centerY + wl.halfWidth;
        positions[topIdx * 3 + 2] = wl.worldZ;

        positions[botIdx * 3]     = px;
        positions[botIdx * 3 + 1] = centerY - wl.halfWidth;
        positions[botIdx * 3 + 2] = wl.worldZ;
    }

    wl.geometry.attributes.position.needsUpdate = true;
}

import { isBreezeActive } from '../scripts/Audio';
import { UNDERWATER_Y_THRESHOLD } from './Underwater';
import * as WLC from '../scene/WindLinesConfig';

// ──────────────────────────────────────────────────────────────────────────────
// Runtime config — initialised from WindLinesConfig.ts, mutated live by debug GUI
// ──────────────────────────────────────────────────────────────────────────────
export const config = {
    maxLines:      WLC.maxLines,
    minLength:     WLC.minLength,
    maxLength:     WLC.maxLength,
    minSpeed:      WLC.minSpeed,
    maxSpeed:      WLC.maxSpeed,
    minYFrac:      WLC.minYFrac,
    maxYFrac:      WLC.maxYFrac,
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
    // ── wave ────────────────────────────────────────────────────────────────
    // waveFrequency = full sine cycles across one line (1 = one wave, 2 = two, etc.)
    waveAmplitude: WLC.waveAmplitude,
    waveFrequency: WLC.waveFrequency,
    waveSpeed:     WLC.waveSpeed,     // radians per second phase shift
    waveSegments:  WLC.waveSegments,
};
// ──────────────────────────────────────────────────────────────────────────────

interface WindLine {
    x:         number;   // current right-edge X (canvas px)
    worldY:    number;   // Y in world/scene units — stays fixed as camera moves
    driftPx:   number;   // screen-space downward drift accumulated from tiltY
    length:    number;   // px
    speed:     number;   // px/s
    width:     number;   // stroke width
    opacity:   number;   // 0–1 multiplied by config.lineOpacity
    waveScale: number;   // per-line 0–1 amplitude multiplier (random at spawn)
    phase:     number;   // per-line phase offset for the wave
}

let canvas:   HTMLCanvasElement | null = null;
let ctx:      CanvasRenderingContext2D | null = null;
let w = window.innerWidth;
let h = window.innerHeight;

const lines: WindLine[] = [];
let intensity  = 0;     // 0–1 smoothed breeze envelope
let spawnAccum = 0;     // fractional spawn accumulator
let elapsed    = 0;     // total seconds elapsed (for wave animation)
let _cameraFov = 70;   // kept in sync each frame from the param
let _cameraY   = 0;    // kept in sync each frame from the param

// ──────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ──────────────────────────────────────────────────────────────────────────────

export function Start(): void {
    canvas = document.createElement('canvas');
    canvas.style.cssText = [
        'position:fixed',
        'inset:0',
        'width:100%',
        'height:100%',
        'pointer-events:none',
        'z-index:10',
    ].join(';');
    document.body.appendChild(canvas);
    _resize();
    window.addEventListener('resize', _resize);
}

export function onResize(): void {
    _resize();
}

function _resize(): void {
    if (!canvas) return;
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width  = w;
    canvas.height = h;
    ctx = canvas.getContext('2d');
}

// ──────────────────────────────────────────────────────────────────────────────
// Per-frame update
// ──────────────────────────────────────────────────────────────────────────────

export function Update(deltaTime: number, cameraY: number, cameraFov: number): void {
    if (!ctx || !canvas) return;

    _cameraFov = cameraFov;
    _cameraY   = cameraY;

    elapsed += deltaTime;

    // Hard-cut when underwater — clear any in-flight lines immediately
    if (cameraY < UNDERWATER_Y_THRESHOLD) {
        if (lines.length > 0) {
            lines.length = 0;
            ctx.clearRect(0, 0, w, h);
        }
        intensity  = 0;
        spawnAccum = 0;
        return;
    }

    // Smooth intensity envelope
    if (isBreezeActive()) {
        intensity = Math.min(1, intensity + deltaTime / config.rampUp);
    } else {
        intensity = Math.max(0, intensity - deltaTime / config.rampDown);
    }

    if (intensity <= 0) {
        if (lines.length > 0) {
            lines.length = 0;
            ctx.clearRect(0, 0, w, h);
        }
        return;
    }

    // ── Spawn ─────────────────────────────────────────────────────────────────
    spawnAccum += config.spawnRate * intensity * deltaTime;
    while (spawnAccum >= 1 && lines.length < config.maxLines) {
        spawnAccum -= 1;
        _spawn();
    }
    if (spawnAccum >= 1) spawnAccum = 0;

    // ── Clear ─────────────────────────────────────────────────────────────────
    ctx.clearRect(0, 0, w, h);

    // ── Move & draw ───────────────────────────────────────────────────────────
    const rgb  = `${config.colorR},${config.colorG},${config.colorB}`;
    const segs = Math.max(4, config.waveSegments);

    // Camera FOV drives the world→screen Y scale so lines stay fixed in the scene
    const fovRad        = _cameraFov * (Math.PI / 180);
    const pixelsPerUnit = (h / 2) / Math.tan(fovRad / 2);

    for (let i = lines.length - 1; i >= 0; i--) {
        const ln = lines[i];
        const dx = ln.speed * deltaTime;
        ln.x      -= dx;
        ln.driftPx += dx * config.tiltY;   // slow downward screen-drift as line travels

        if (ln.x - ln.length < -(ln.length + 500)) { lines.splice(i, 1); continue; }

        // Project world Y to screen Y — lines now follow the scene, not the viewport
        const screenY = h / 2 - (ln.worldY - cameraY) * pixelsPerUnit + ln.driftPx;

        // Cull if off-screen vertically
        const margin = config.waveAmplitude + 20;
        if (screenY < -margin || screenY > h + margin) continue;

        const rightEdge = ln.x;
        const leftEdge  = ln.x - ln.length;

        const enterFade = rightEdge > w
            ? Math.max(0, 1 - (rightEdge - w) / (ln.length * 0.3)) : 1;
        const alpha = ln.opacity * config.lineOpacity * intensity * enterFade;

        // Gradient along the line direction
        const grad = ctx.createLinearGradient(leftEdge, 0, rightEdge, 0);
        grad.addColorStop(0,   `rgba(${rgb},0)`);
        grad.addColorStop(0.2, `rgba(${rgb},${alpha})`);
        grad.addColorStop(0.8, `rgba(${rgb},${alpha})`);
        grad.addColorStop(1,   `rgba(${rgb},0)`);

        // Build wavy path as N segments
        ctx.beginPath();
        for (let s = 0; s <= segs; s++) {
            const t  = s / segs;               // 0 → 1 from right to left
            const px = rightEdge - t * ln.length;
            const py = screenY + t * ln.length * config.tiltY;  // screen-space tilt along length

            // Sine wave: waveFrequency = full cycles per line length
            const waveY = config.waveAmplitude * ln.waveScale
                * Math.sin(t * Math.PI * 2 * config.waveFrequency
                           + elapsed * config.waveSpeed
                           + ln.phase);

            if (s === 0) ctx.moveTo(px, py + waveY);
            else         ctx.lineTo(px, py + waveY);
        }

        ctx.strokeStyle = grad;
        ctx.lineWidth   = ln.width;
        ctx.stroke();
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function _rand(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function _spawn(): void {
    // Convert random screen-fraction to world Y so the line stays fixed in the scene
    const fovRad        = _cameraFov * (Math.PI / 180);
    const pixelsPerUnit = (h / 2) / Math.tan(fovRad / 2);
    const screenFrac    = _rand(config.minYFrac, config.maxYFrac);
    const worldY        = _cameraY + (0.5 - screenFrac) * h / pixelsPerUnit;
    const length        = _rand(config.minLength, config.maxLength);

    lines.push({
        // Start entirely off the right edge: right tip + full line length + large random stagger
        x:         w + length + _rand(200, 500),
        worldY,
        driftPx:   0,
        length,
        speed:     _rand(config.minSpeed,  config.maxSpeed),
        width:     _rand(config.minWidth,  config.maxWidth),
        opacity:   _rand(0.5, 1.0),
        waveScale: _rand(0.3, 1.0),
        phase:     _rand(0, Math.PI * 2),
    });
}


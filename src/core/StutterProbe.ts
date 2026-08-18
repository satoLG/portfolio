/**
 * StutterProbe.ts — find out WHAT stutters, instead of guessing.
 *
 * The scene has a long-running, never-quite-solved hitch: crossing the
 * waterline, arriving at the fish/turtle band. Every plausible cause has a very
 * different fix, and they are indistinguishable by eye:
 *
 *   · a shader PROGRAM compiled mid-frame  → the prewarm missed a variant
 *   · a TEXTURE or GEOMETRY uploaded       → the prewarm missed an asset
 *   · neither, but the frame got expensive → a sustained cost step (an extra
 *                                            render pass switching on), not a
 *                                            first-touch cost at all
 *   · neither, and the JS heap dropped     → a garbage collection
 *
 * Adding more prewarm for the wrong one costs loading time and memory and fixes
 * nothing, which is roughly the history of this problem. So this measures.
 *
 * OFF by default and free when off — two boolean checks per frame, no
 * allocation, nothing rendered, nothing logged.
 *
 * ── Using it ────────────────────────────────────────────────────────────────
 *   Load the page with ?probe=1, or run __probe.enable() in the console at any
 *   time (it persists, so a reload keeps collecting). Then do the thing that
 *   stutters. Spikes print as they happen; afterwards:
 *
 *     __probe.report()    the worst frames, with what jumped on each
 *     __probe.summary()   p50/p95/p99, and what the spikes are blamed on
 *     __probe.reset()     start a fresh measurement
 *     __probe.disable()
 *
 * The verdict to read for: if spikes carry programs>0 the prewarm has a hole
 * and more preloading is the answer. If they carry uploads the same. If they
 * carry neither, preloading is NOT the lever and the fix is in the frame's own
 * work — which is a different job entirely.
 */

import type { PerspectiveCamera, WebGLRenderer } from 'three';

const STORAGE_KEY = 'portfolio-probe';
/** A frame slower than this is a spike worth recording. ~2 dropped frames at
 *  60Hz — below that it is jitter, not something a person calls a stutter. */
const DEFAULT_SPIKE_MS = 34;
/** Worst frames kept for the report. */
const RING = 64;
/** Spike lines printed before going quiet, so a bad stretch cannot flood the
 *  console (and cost more than what it is measuring). */
const MAX_LOGGED = 40;

interface FrameRecord {
    at: number;          // ms since probe start
    frameMs: number;     // wall clock between consecutive frame starts
    cpuMs: number;       // time inside Update() — the part we control
    programs: number;    // NEW shader programs compiled during this frame
    geometries: number;  // net geometry allocations
    textures: number;    // net texture allocations
    calls: number;       // draw calls issued this frame (all passes)
    triangles: number;
    heapMB: number;      // JS heap after the frame (Chrome only, else 0)
    heapDeltaMB: number; // negative = a GC ran
    camY: number;
    underwater: boolean;
    verdict: string;
}

let _enabled = false;
let _renderer: WebGLRenderer | null = null;
let _startedAt = 0;
let _spikeMs = DEFAULT_SPIKE_MS;
let _logged = 0;

// Previous-frame counters, to turn absolutes into per-frame deltas.
let _prevBegin = 0;
let _beginAt = 0;
let _prevPrograms = 0;
let _prevGeometries = 0;
let _prevTextures = 0;
let _prevHeap = 0;

/** Every frame time seen, for percentiles. Plain number[] — a session's worth
 *  of frames is a few hundred KB and this only exists while probing. */
let _all: number[] = [];
/** The worst frames, kept sorted worst-first, capped at RING. */
let _worst: FrameRecord[] = [];

function _heapMB(): number {
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return mem ? mem.usedJSHeapSize / (1024 * 1024) : 0;
}

/** What to blame this frame on, in priority order. The first three are things
 *  a prewarm can fix; the last two are not. */
function _verdict(r: Omit<FrameRecord, 'verdict'>): string {
    if (r.programs > 0)   return `SHADER COMPILE (${r.programs} program${r.programs > 1 ? 's' : ''}) — prewarm missed a variant`;
    if (r.textures > 0)   return `TEXTURE UPLOAD (+${r.textures}) — asset not warmed`;
    if (r.geometries > 0) return `GEOMETRY UPLOAD (+${r.geometries}) — asset not warmed`;
    if (r.heapDeltaMB < -2) return `GC (heap dropped ${(-r.heapDeltaMB).toFixed(1)} MB)`;
    if (r.cpuMs > r.frameMs * 0.6) return `CPU in Update() (${r.cpuMs.toFixed(1)} of ${r.frameMs.toFixed(1)} ms)`;
    return `GPU / frame cost (${r.calls} draw calls, ${(r.triangles / 1000).toFixed(0)}k tris) — not a first-touch cost`;
}

function _readCounters() {
    const info = _renderer!.info;
    return {
        programs: info.programs?.length ?? 0,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        calls: info.render.calls,
        triangles: info.render.triangles,
    };
}

function _activate(): void {
    if (_enabled || !_renderer) return;
    _enabled = true;
    // Draw calls reset at the top of every renderer.render(), and a frame here
    // issues several (depth pre-pass, main, ocean, the underwater transparent
    // pass, the post quad). Take the reset over ourselves so the numbers are
    // per FRAME rather than per last-pass. Nothing else in the project reads
    // renderer.info, and this only ever happens while probing.
    _renderer.info.autoReset = false;
    reset();
    console.log(
        `%c[probe] on%c — spikes over ${_spikeMs}ms will print. __probe.report() / __probe.summary() when done.`,
        'background:#2d7;color:#000;padding:1px 5px;border-radius:3px', '',
    );
}

/** Call once, from Scene.Start, as soon as the renderer exists. */
export function Start(renderer: WebGLRenderer): void {
    _renderer = renderer;

    const params = new URLSearchParams(location.search);
    const on = params.get('probe') === '1' || localStorage.getItem(STORAGE_KEY) === '1';

    (window as unknown as { __probe: unknown }).__probe = {
        enable() { localStorage.setItem(STORAGE_KEY, '1'); _activate(); },
        disable() {
            localStorage.removeItem(STORAGE_KEY);
            _enabled = false;
            if (_renderer) _renderer.info.autoReset = true;
            console.log('[probe] off');
        },
        /** Change what counts as a spike (ms). */
        threshold(ms: number) { _spikeMs = ms; console.log(`[probe] spike threshold = ${ms}ms`); },
        reset,
        report,
        summary,
    };

    if (on) _activate();
}

export function reset(): void {
    _startedAt = performance.now();
    _prevBegin = 0;
    _logged = 0;
    _all = [];
    _worst = [];
    if (_renderer) {
        const c = _readCounters();
        _prevPrograms = c.programs;
        _prevGeometries = c.geometries;
        _prevTextures = c.textures;
    }
    _prevHeap = _heapMB();
}

/** Top of Update(), after the scene-ready gate. */
export function beginFrame(): void {
    if (!_enabled || !_renderer) return;
    _beginAt = performance.now();
    _renderer.info.reset();
}

/** Very end of Update(), after every render call for the frame. */
export function endFrame(camera: PerspectiveCamera, underwater: boolean): void {
    if (!_enabled || !_renderer) return;

    const now = performance.now();
    const cpuMs = now - _beginAt;
    // First frame has no predecessor to measure a period against.
    const frameMs = _prevBegin > 0 ? _beginAt - _prevBegin : cpuMs;
    _prevBegin = _beginAt;

    const c = _readCounters();
    const heapMB = _heapMB();

    const base = {
        at: now - _startedAt,
        frameMs,
        cpuMs,
        programs:   c.programs   - _prevPrograms,
        geometries: c.geometries - _prevGeometries,
        textures:   c.textures   - _prevTextures,
        calls: c.calls,
        triangles: c.triangles,
        heapMB,
        heapDeltaMB: _prevHeap > 0 ? heapMB - _prevHeap : 0,
        camY: camera.position.y,
        underwater,
    };
    _prevPrograms = c.programs;
    _prevGeometries = c.geometries;
    _prevTextures = c.textures;
    _prevHeap = heapMB;

    _all.push(frameMs);
    if (frameMs < _spikeMs) return;

    const rec: FrameRecord = { ...base, verdict: _verdict(base) };

    // Keep only the worst RING frames, worst first.
    let i = _worst.length;
    while (i > 0 && _worst[i - 1].frameMs < rec.frameMs) i--;
    _worst.splice(i, 0, rec);
    if (_worst.length > RING) _worst.length = RING;

    if (_logged < MAX_LOGGED) {
        _logged++;
        console.warn(
            `[probe] ${frameMs.toFixed(1)}ms  (cpu ${cpuMs.toFixed(1)})  ` +
            `y=${rec.camY.toFixed(2)}${underwater ? ' underwater' : ''}  →  ${rec.verdict}`,
        );
        if (_logged === MAX_LOGGED) console.warn('[probe] further spikes are recorded but no longer printed — __probe.report()');
    }
}

/** The worst frames, with what jumped on each. */
export function report(): void {
    if (_worst.length === 0) { console.log('[probe] no spikes recorded'); return; }
    console.table(_worst.map(r => ({
        't (s)': (r.at / 1000).toFixed(1),
        'frame ms': r.frameMs.toFixed(1),
        'cpu ms': r.cpuMs.toFixed(1),
        'new programs': r.programs,
        'new textures': r.textures,
        'new geoms': r.geometries,
        'draw calls': r.calls,
        'heap Δ MB': r.heapDeltaMB.toFixed(1),
        'cam y': r.camY.toFixed(2),
        verdict: r.verdict,
    })));
}

/** Distribution, plus what the spikes are blamed on overall. */
export function summary(): void {
    if (_all.length === 0) { console.log('[probe] nothing recorded'); return; }
    const sorted = [..._all].sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

    const causes = new Map<string, number>();
    for (const r of _worst) {
        const key = r.verdict.split(' (')[0].split(' —')[0];
        causes.set(key, (causes.get(key) ?? 0) + 1);
    }

    console.log(
        `[probe] ${_all.length} frames over ${((performance.now() - _startedAt) / 1000).toFixed(0)}s\n` +
        `  p50 ${at(0.5).toFixed(1)}ms   p95 ${at(0.95).toFixed(1)}ms   ` +
        `p99 ${at(0.99).toFixed(1)}ms   max ${sorted[sorted.length - 1].toFixed(1)}ms\n` +
        `  spikes over ${_spikeMs}ms: ${_worst.length}${_worst.length === RING ? '+ (ring full)' : ''}`,
    );
    if (causes.size > 0) {
        console.log('  worst frames blamed on:');
        for (const [cause, n] of [...causes].sort((a, b) => b[1] - a[1])) console.log(`    ${n}x  ${cause}`);
    }
}

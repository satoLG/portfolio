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
 * OFF by default and nearly free when off — two boolean checks per frame, no
 * allocation, nothing rendered, nothing drawn.
 *
 * ── Opening it ──────────────────────────────────────────────────────────────
 *
 *   PHONE:    tap anywhere with THREE FINGERS. One finger drags the camera and
 *             two scroll it, so three is the first gesture the scene does not
 *             already own — and it works with no keyboard, no URL bar and no
 *             console, which is the whole point.
 *   DESKTOP:  the same three-finger tap, or ?probe=1, or __probe.enable().
 *
 * It stays on across reloads until switched off again, so a reload-and-repeat
 * test does not need re-arming.
 *
 * ── Reading it ──────────────────────────────────────────────────────────────
 *
 * The verdict line is the answer. If the spikes are blamed on SHADER or UPLOAD
 * the prewarm has a hole and preloading more is the fix. If they are blamed on
 * frame cost or GC, preloading is NOT the lever and the work is elsewhere.
 *
 * Hit ZERAR at the top of the thing you want to measure (right before a dive),
 * so page-load spikes don't drown out what you are actually looking at.
 */

import type { PerspectiveCamera, WebGLRenderer } from 'three';

const STORAGE_KEY = 'portfolio-probe';
/** A frame slower than this is a spike worth recording. ~2 dropped frames at
 *  60Hz — below that it is jitter, not something a person calls a stutter. */
const DEFAULT_SPIKE_MS = 34;
/** Worst frames kept. Only the top few are shown; the rest feed the verdict. */
const RING = 64;
/** Spikes listed in the overlay. */
const SHOWN = 6;
/** The overlay repaints at this interval, not per frame — an instrument that
 *  costs what it measures is worthless. */
const REPAINT_MS = 250;

interface FrameRecord {
    at: number;          // ms since probe start
    frameMs: number;     // wall clock between consecutive frame starts
    cpuMs: number;       // time inside Update() — the part we control
    programs: number;    // NEW shader programs compiled during this frame
    progNames: string;   // and which materials they belong to
    topSection: string;  // the dominant slice of the frame, when there is one
    geometries: number;  // net geometry allocations
    textures: number;    // net texture allocations
    calls: number;       // draw calls issued this frame (all passes)
    triangles: number;
    heapMB: number;      // JS heap after the frame (Chrome/Android only, else 0)
    heapDeltaMB: number; // negative = a GC ran
    camY: number;
    underwater: boolean;
    cause: Cause;
    detail: string;
}

/** Deliberately coarse: these are the four things worth telling apart, because
 *  each one points at a different fix. */
type Cause = 'shader' | 'upload' | 'gc' | 'cpu' | 'gpu';

const CAUSE_LABEL: Record<Cause, string> = {
    shader: 'SHADER',
    upload: 'UPLOAD',
    gc:     'GC',
    cpu:    'CPU',
    gpu:    'FRAME',
};

/** What each verdict means for what to do next — the actionable half. */
const CAUSE_VERDICT: Record<Cause, string> = {
    shader: 'shader compilando em cena → falta prewarm',
    upload: 'textura/geometria subindo → falta prewarm',
    gc:     'coleta de lixo → algo aloca por frame',
    cpu:    'CPU no Update() → trabalho por frame',
    gpu:    'custo do frame → NÃO é preload',
};

/** Tie-break order for the verdict. A run with as many shader spikes as
 *  expensive frames should report the SHADER — it is the one with a known fix,
 *  and calling the tie the other way would send the reader off to rewrite a
 *  render path when a prewarm line was missing. */
const CAUSE_PRIORITY: Cause[] = ['shader', 'upload', 'gc', 'cpu', 'gpu'];

const CAUSE_COLOR: Record<Cause, string> = {
    shader: '#ff6b6b',
    upload: '#ffa94d',
    gc:     '#ffd43b',
    cpu:    '#74c0fc',
    gpu:    '#8ce99a',
};

let _enabled = false;
let _renderer: WebGLRenderer | null = null;
let _startedAt = 0;
let _spikeMs = DEFAULT_SPIKE_MS;

// Previous-frame counters, to turn absolutes into per-frame deltas.
let _beginAt = 0;

/**
 * The frame whose counters are known but whose duration is not yet.
 *
 * A frame's COST and a frame's COUNTERS land at different moments and pairing
 * them naively blames the wrong frame — which is fatal for an instrument whose
 * entire job is attribution. The counters for frame N are final when Update()
 * returns (endFrame). But the frame's real duration only becomes measurable at
 * the START of frame N+1: we issue draw calls and return, and the GPU is still
 * working — a stall shows up as a long gap before the next rAF, not as time
 * spent inside our own Update.
 *
 * So endFrame stashes the counters here and beginFrame closes the record one
 * frame later, with the period that actually contains that frame's GPU work.
 * One reused object; nothing allocates per frame.
 */
const _pending = {
    live: false,
    beganAt: 0,
    cpuMs: 0,
    programs: 0, geometries: 0, textures: 0,
    progNames: '',
    topSection: '',
    calls: 0, triangles: 0,
    heapMB: 0, heapDeltaMB: 0,
    camY: 0, underwater: false,
};
let _prevPrograms = 0;
let _prevGeometries = 0;
let _prevTextures = 0;
let _prevHeap = 0;
let _lastPaint = 0;

// Which programs we have already accounted for. A count alone says "something
// compiled"; the NAME says what, which is the difference between knowing there
// is a prewarm hole and knowing where it is.
let _seenPrograms = new WeakSet<object>();
const _newNames: string[] = [];

/** three names a program after its material's type. Trim the boilerplate so a
 *  couple of them still fit on one phone-width line. */
function _shortName(n: string): string {
    return (n || '?').replace(/^Mesh/, '').replace(/Material$/, '') || '?';
}

/** Record programs not seen before. `collect` is false while seeding, so the
 *  several hundred that exist at startup are not reported as a spike cause. */
function _scanPrograms(list: readonly unknown[], collect: boolean): void {
    if (collect) _newNames.length = 0;
    for (let i = 0; i < list.length; i++) {
        const prog = list[i] as object & { name?: string };
        if (!prog || _seenPrograms.has(prog)) continue;
        _seenPrograms.add(prog);
        if (collect && _newNames.length < 3) _newNames.push(_shortName(prog.name ?? ''));
    }
}
let _liveCalls = 0;
let _liveHeap = 0;

// ── Section timing ───────────────────────────────────────────────────────────
//
// A frame blamed on "FRAME" is one where nothing compiled and nothing uploaded
// — it just took long. That is a true statement and a useless one on its own:
// it could be the island's per-frame work, the render passes, or the browser
// laying out and rasterising the CSS3D subtree after our callback returns.
// Update() calls section() at a handful of boundaries so the overlay can name
// the biggest slice instead of shrugging.
//
// The tail — everything between the end of Update and the start of the next
// frame — is tracked as 'paint': that is the browser's own style/layout/paint
// and the GPU draining the commands we just queued, and it is invisible to any
// timer inside our own code.

const SECTIONS = ['world', 'render', 'css3d', 'paint'] as const;
type Section = typeof SECTIONS[number];

const _secMs: Record<string, number> = {};
let _curSection: Section | null = null;
let _curSectionAt = 0;

/** Close the running section and open `name` (null just closes). Free when the
 *  probe is off, which is the common case. */
export function section(name: Section | null): void {
    if (!_enabled) return;
    const now = performance.now();
    if (_curSection) _secMs[_curSection] = (_secMs[_curSection] ?? 0) + (now - _curSectionAt);
    _curSection = name;
    _curSectionAt = now;
}

/** The slowest section of the frame, as a short label, or '' if nothing stands
 *  out. Only reported when one slice actually dominates — naming a winner in a
 *  frame where the cost is spread evenly would be noise dressed as a finding. */
function _topSection(totalMs: number): string {
    let best = '';
    let bestMs = 0;
    for (const k of SECTIONS) {
        const v = _secMs[k] ?? 0;
        if (v > bestMs) { bestMs = v; best = k; }
    }
    if (!best || bestMs < totalMs * 0.4) return '';
    return `${best} ${bestMs.toFixed(0)}ms`;
}

function _resetSections(): void {
    for (const k of SECTIONS) _secMs[k] = 0;
}

/** Every frame time seen, for percentiles. */
let _all: number[] = [];
/** The worst frames, sorted worst-first, capped at RING. */
let _worst: FrameRecord[] = [];

// ── Overlay ──────────────────────────────────────────────────────────────────

let _root: HTMLDivElement | null = null;
let _body: HTMLDivElement | null = null;

function _buildOverlay(): void {
    if (_root) return;

    const root = document.createElement('div');
    root.id = 'stutter-probe';
    // pointer-events:none on the shell so the panel never eats a drag meant for
    // the scene — only the two buttons opt back in.
    root.style.cssText = [
        'position:fixed',
        // Below the page header, so it never covers the wordmark or the
        // day/night control — those have to stay reachable while measuring.
        'top:calc(72px + env(safe-area-inset-top,0px))',
        'left:calc(8px + env(safe-area-inset-left,0px))',
        'width:min(320px,86vw)',
        'z-index:2147483000',
        'pointer-events:none',
        'font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
        'color:#dfe9f5',
        'background:rgba(8,12,18,0.86)',
        '-webkit-backdrop-filter:blur(3px)',
        'backdrop-filter:blur(3px)',
        'border:1px solid rgba(255,255,255,0.16)',
        'border-radius:9px',
        'padding:8px 9px',
        'box-shadow:0 4px 18px rgba(0,0,0,0.45)',
        'user-select:none',
        '-webkit-user-select:none',
    ].join(';');

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';

    // Tapping the title collapses to the header line alone — a one-line HUD to
    // play with, expanded when there is something to read.
    const title = document.createElement('div');
    title.textContent = 'PROBE ▾';
    title.style.cssText = 'flex:1;letter-spacing:1px;opacity:0.65;font-weight:700;pointer-events:auto;cursor:pointer';
    title.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const hidden = _body!.style.display === 'none';
        _body!.style.display = hidden ? '' : 'none';
        title.textContent = hidden ? 'PROBE ▾' : 'PROBE ▸';
    });

    const mkBtn = (label: string, onTap: () => void) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = [
            'pointer-events:auto',
            'font:inherit',
            'color:#dfe9f5',
            'background:rgba(255,255,255,0.10)',
            'border:1px solid rgba(255,255,255,0.20)',
            'border-radius:6px',
            'padding:4px 9px',
            'touch-action:manipulation',
            'cursor:pointer',
        ].join(';');
        // pointerdown, not click: the scene's own listeners are aggressive about
        // swallowing taps, and the panel must respond even mid-interaction.
        b.addEventListener('pointerdown', (e) => { e.stopPropagation(); onTap(); });
        return b;
    };

    bar.append(title, mkBtn('zerar', reset), mkBtn('✕', disable));

    const body = document.createElement('div');
    _body = body;

    root.append(bar, body);
    document.body.appendChild(root);
    _root = root;
}

function _pct(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function _esc(s: string): string {
    return s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function _paint(): void {
    if (!_body) return;

    const sorted = [..._all].sort((a, b) => a - b);
    const p50 = _pct(sorted, 0.5);
    const p95 = _pct(sorted, 0.95);
    const p99 = _pct(sorted, 0.99);
    const max = sorted.length > 0 ? sorted[sorted.length - 1] : 0;
    const fps = p50 > 0 ? 1000 / p50 : 0;

    // Tally across every spike, not just the shown ones — a run is usually a
    // mixture, and which mixture it is IS the finding.
    const tally = new Map<Cause, number>();
    for (const r of _worst) tally.set(r.cause, (tally.get(r.cause) ?? 0) + 1);
    let top: Cause | null = null;
    let topN = 0;
    for (const c of CAUSE_PRIORITY) {
        const n = tally.get(c) ?? 0;
        if (n > topN) { top = c; topN = n; }   // strict >, so priority order breaks ties
    }
    const mix = CAUSE_PRIORITY
        .filter(c => tally.has(c))
        .map(c => `<span style="color:${CAUSE_COLOR[c]}">${CAUSE_LABEL[c]} ${tally.get(c)}</span>`)
        .join(' <span style="opacity:0.3">·</span> ');

    const rows = _worst.slice(0, SHOWN).map(r => `
        <div style="display:flex;gap:6px;white-space:nowrap">
            <span style="width:52px;text-align:right;color:${CAUSE_COLOR[r.cause]}">${r.frameMs.toFixed(0)}ms</span>
            <span style="width:56px;opacity:0.6">y ${r.camY.toFixed(1)}</span>
            <span style="color:${CAUSE_COLOR[r.cause]};font-weight:700">${CAUSE_LABEL[r.cause]}</span>
            <span style="opacity:0.6;overflow:hidden;text-overflow:ellipsis">${_esc(r.detail)}</span>
        </div>`).join('');

    const verdict = top
        ? `<div style="margin-top:7px;padding:5px 6px;border-radius:5px;white-space:normal;
                       background:${CAUSE_COLOR[top]}22;border-left:3px solid ${CAUSE_COLOR[top]}">
             <b style="color:${CAUSE_COLOR[top]}">${topN}/${_worst.length}</b> ${CAUSE_VERDICT[top]}
           </div>`
        : `<div style="margin-top:7px;opacity:0.55">sem picos acima de ${_spikeMs}ms — mexa na cena</div>`;


    _body.innerHTML = `
        <div style="display:flex;gap:10px;margin-bottom:5px">
            <span><b style="font-size:14px">${fps.toFixed(0)}</b> fps</span>
            <span style="opacity:0.75">p50 ${p50.toFixed(0)}</span>
            <span style="opacity:0.75">p95 ${p95.toFixed(0)}</span>
            <span style="opacity:0.75">p99 ${p99.toFixed(0)}</span>
            <span style="opacity:0.75">max ${max.toFixed(0)}</span>
        </div>
        <div style="opacity:0.55;margin-bottom:6px">
            ${_all.length} frames · ${_liveCalls} draws${_liveHeap > 0 ? ` · ${_liveHeap.toFixed(0)}MB` : ''}
        </div>
        <div style="display:flex;gap:6px;opacity:0.65;letter-spacing:0.5px;margin-bottom:3px">
            <span>PICOS &gt;${_spikeMs}ms (${_worst.length})</span>
        </div>
        ${rows || '<div style="opacity:0.4">—</div>'}
        ${mix ? `<div style="margin-top:5px;white-space:normal">${mix}</div>` : ''}
        ${verdict}`;
}

// ── Measurement ──────────────────────────────────────────────────────────────

function _heapMB(): number {
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return mem ? mem.usedJSHeapSize / (1024 * 1024) : 0;
}

/** What to blame this frame on, in priority order. The first two are things a
 *  prewarm can fix; the rest are not. */
function _blame(r: Omit<FrameRecord, 'cause' | 'detail'>): { cause: Cause; detail: string } {  // eslint-disable-line
    if (r.programs > 0) {
        return { cause: 'shader', detail: r.progNames ? `+${r.programs} ${r.progNames}` : `+${r.programs} prog` };
    }
    if (r.textures > 0 || r.geometries > 0) {
        const parts: string[] = [];
        if (r.textures > 0) parts.push(`+${r.textures} tex`);
        if (r.geometries > 0) parts.push(`+${r.geometries} geo`);
        return { cause: 'upload', detail: parts.join(' ') };
    }
    if (r.heapDeltaMB < -2) return { cause: 'gc', detail: `-${(-r.heapDeltaMB).toFixed(0)}MB` };
    if (r.cpuMs > r.frameMs * 0.6) return { cause: 'cpu', detail: r.topSection || `${r.cpuMs.toFixed(0)}ms js` };
    return { cause: 'gpu', detail: r.topSection || `${r.calls} draws` };
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

// ── Public ───────────────────────────────────────────────────────────────────

export function enable(): void {
    if (!_renderer) return;
    localStorage.setItem(STORAGE_KEY, '1');
    if (_enabled) return;
    _enabled = true;
    // Draw calls reset at the top of every renderer.render(), and a frame here
    // issues several (depth pre-pass, main, ocean, the underwater transparent
    // pass, the post quad). Take the reset over ourselves so the numbers are
    // per FRAME rather than per last-pass. Nothing else in the project reads
    // renderer.info, and this only ever happens while probing.
    _renderer.info.autoReset = false;
    _buildOverlay();
    reset();
    _paint();
}

export function disable(): void {
    localStorage.removeItem(STORAGE_KEY);
    _enabled = false;
    if (_renderer) _renderer.info.autoReset = true;
    _root?.remove();
    _root = null;
    _body = null;
}

export function toggle(): void {
    _enabled ? disable() : enable();
}

export function reset(): void {
    _startedAt = performance.now();
    _pending.live = false;
    _all = [];
    _worst = [];
    if (_renderer) {
        _seenPrograms = new WeakSet<object>();
        _scanPrograms(_renderer.info.programs ?? [], false);
        const c = _readCounters();
        _prevPrograms = c.programs;
        _prevGeometries = c.geometries;
        _prevTextures = c.textures;
    }
    _prevHeap = _heapMB();
    _resetSections();
    _curSection = null;
    _paint();
}

/** Change what counts as a spike (ms). */
export function threshold(ms: number): void { _spikeMs = ms; _paint(); }

/** Call once, from Scene.ts, as soon as the renderer exists. */
export function Start(renderer: WebGLRenderer): void {
    _renderer = renderer;

    (window as unknown as { __probe: unknown }).__probe = { enable, disable, toggle, reset, threshold };

    // THREE-FINGER TAP opens it. One finger drags the camera, two scroll it —
    // three is the first gesture nothing else in the scene claims, and unlike a
    // corner hot-zone it cannot collide with UI that moves around. Passive and
    // never preventDefault: this must not be able to break normal input even if
    // the detection is wrong.
    let armed = false;
    window.addEventListener('touchstart', (e: TouchEvent) => {
        if (e.touches.length === 3) armed = true;
        else if (e.touches.length > 3) armed = false;
    }, { passive: true, capture: true });
    window.addEventListener('touchend', (e: TouchEvent) => {
        // Fires as the fingers lift; only the transition out of a 3-touch state
        // counts, so a 3-finger drag that ends anywhere still toggles once.
        if (armed && e.touches.length === 0) { armed = false; toggle(); }
    }, { passive: true, capture: true });

    const params = new URLSearchParams(location.search);
    if (params.get('probe') === '1' || localStorage.getItem(STORAGE_KEY) === '1') enable();
}

/** Close the previous frame's record now that its full period is known. */
function _closePending(now: number): void {
    if (!_pending.live) return;
    _pending.live = false;

    const frameMs = now - _pending.beganAt;
    _all.push(frameMs);
    if (frameMs < _spikeMs) return;

    const base = {
        at: now - _startedAt,
        frameMs,
        cpuMs: _pending.cpuMs,
        programs: _pending.programs,
        progNames: _pending.progNames,
        topSection: _pending.topSection,
        geometries: _pending.geometries,
        textures: _pending.textures,
        calls: _pending.calls,
        triangles: _pending.triangles,
        heapMB: _pending.heapMB,
        heapDeltaMB: _pending.heapDeltaMB,
        camY: _pending.camY,
        underwater: _pending.underwater,
    };
    const rec: FrameRecord = { ...base, ..._blame(base) };

    // Keep only the worst RING frames, worst first.
    let i = _worst.length;
    while (i > 0 && _worst[i - 1].frameMs < rec.frameMs) i--;
    _worst.splice(i, 0, rec);
    if (_worst.length > RING) _worst.length = RING;
}

/** Top of Update(), after the scene-ready gate. */
export function beginFrame(): void {
    if (!_enabled || !_renderer) return;
    const now = performance.now();
    // Close the 'paint' tail opened at the end of the previous frame BEFORE the
    // record is finalised — it is the slice that record is about to be judged on.
    if (_curSection) {
        _secMs[_curSection] = (_secMs[_curSection] ?? 0) + (now - _curSectionAt);
        _curSection = null;
    }
    _pending.topSection = _topSection(now - _pending.beganAt);
    _closePending(now);
    _resetSections();
    _beginAt = now;
    _renderer.info.reset();
}

/** Very end of Update(), after every render call for the frame. */
export function endFrame(camera: PerspectiveCamera, underwater: boolean): void {
    if (!_enabled || !_renderer) return;

    const now = performance.now();
    const c = _readCounters();
    const heapMB = _heapMB();
    _liveCalls = c.calls;
    _liveHeap = heapMB;

    // Stash — the duration this belongs to is only known next frame.
    _pending.live = true;
    _pending.beganAt = _beginAt;
    _pending.cpuMs = now - _beginAt;
    _pending.programs   = c.programs   - _prevPrograms;
    if (c.programs > _prevPrograms) {
        _scanPrograms(_renderer.info.programs ?? [], true);
        _pending.progNames = _newNames.join(' ');
    } else {
        _pending.progNames = '';
    }
    _pending.geometries = c.geometries - _prevGeometries;
    _pending.textures   = c.textures   - _prevTextures;
    _pending.calls = c.calls;
    _pending.triangles = c.triangles;
    _pending.heapMB = heapMB;
    _pending.heapDeltaMB = _prevHeap > 0 ? heapMB - _prevHeap : 0;
    _pending.camY = camera.position.y;
    _pending.underwater = underwater;

    _prevPrograms = c.programs;
    _prevGeometries = c.geometries;
    _prevTextures = c.textures;
    _prevHeap = heapMB;

    // Everything from here to the next frame is the browser's: style, layout,
    // paint, compositing the CSS3D layer, and the GPU working through what we
    // just queued.
    section('paint');

    if (now - _lastPaint >= REPAINT_MS) {
        _lastPaint = now;
        _paint();
    }
}

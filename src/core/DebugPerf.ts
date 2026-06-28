// DEBUG-PERF — TEMPORARY performance-diagnosis overlay.
// On-screen, tappable toggles + live FPS so we can isolate the GPU bottleneck
// directly on a low-end phone (no debug GUI available there). Each flag is read
// by the render loop to skip a whole subsystem. Remove this entire file and all
// `// DEBUG-PERF` marked code before merging.

/** Global flags consulted by the render loop. All default OFF (= no change). */
export const DebugPerf = {
    disableWater: false,     // ocean surface fragment shader (blur + foam + edge-foam)
    disableClouds: false,    // 6600 cloud billboards (transparent overdraw)
    disableGrass: false,     // procedural grass (~1M verts + sway + ocean lighting)
    disableFloor: false,     // 169 sea-floor triplanar tiles (fill rate)
    disableDecor: false,     // corals / kelp / anemone / crab / fish decor
    disableParticles: false, // bubbles + underwater particles
    disablePost: false,      // post-processing (framebuffer copy + fullscreen quad)
    // Island model buckets — each also gates the subsystem's per-frame CPU work.
    disableApples: false,    // apple meshes + spring/wind/physics + impact streaks
    disableTreeBush: false,  // tree + main bush (pure GPU, no CPU work)
    disableRadio: false,     // radio + phone + radio bushes + music-note particles
    disablePug: false,       // pug + pug bush + dog bed + mixer/night/Z-particles
    disableFirecamp: false,  // campfire model + fire (sprite anim + embers + lights)
    disableRocks: false,     // moss rocks + little rocks
    disableSword: false,     // sword
    disableTent: false,      // tent exterior + interior props (table/bed/rug/lantern/bowl/biscuit/phone)
    disableBareIsland: false, // MASTER: hide every prop + gate all prop CPU; keep only terrain
};

type FlagKey = keyof typeof DebugPerf;

const BUTTONS: { key: FlagKey; label: string }[] = [
    { key: 'disableWater',     label: 'Water' },
    { key: 'disableClouds',    label: 'Clouds' },
    { key: 'disableGrass',     label: 'Grass' },
    { key: 'disableFloor',     label: 'Floor' },
    { key: 'disableDecor',     label: 'Decor' },
    { key: 'disableParticles', label: 'Particles' },
    { key: 'disablePost',      label: 'Post' },
    { key: 'disableApples',    label: 'Apples' },
    { key: 'disableTreeBush',  label: 'Tree+Bush' },
    { key: 'disableRadio',     label: 'Radio' },
    { key: 'disablePug',       label: 'Pug' },
    { key: 'disableFirecamp',  label: 'Firecamp' },
    { key: 'disableRocks',     label: 'Rocks' },
    { key: 'disableSword',     label: 'Sword' },
    { key: 'disableTent',      label: 'Tent' },
    { key: 'disableBareIsland', label: 'BARE ISLAND' },
];

let _initialized = false;

/** Build the on-screen overlay (idempotent). */
export function initDebugPerfOverlay(): void {
    if (_initialized) return;
    if (typeof document === 'undefined') return;
    _initialized = true;

    const panel = document.createElement('div');
    panel.id = 'debug-perf-overlay';
    Object.assign(panel.style, {
        position: 'fixed',
        left: '0',
        bottom: '0',
        zIndex: '99999',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '6px',
        background: 'rgba(0,0,0,0.55)',
        font: '600 13px/1.2 monospace',
        color: '#fff',
        pointerEvents: 'auto',
        userSelect: 'none',
        touchAction: 'manipulation',
        maxWidth: '46vw',
    });

    // ── FPS readout ──────────────────────────────────────────────────────────
    const fps = document.createElement('div');
    Object.assign(fps.style, {
        padding: '4px 6px',
        background: 'rgba(0,0,0,0.4)',
        fontSize: '16px',
        letterSpacing: '0.5px',
    });
    fps.textContent = 'FPS --';
    panel.appendChild(fps);

    // ── Toggle buttons ───────────────────────────────────────────────────────
    const buttonGrid = document.createElement('div');
    Object.assign(buttonGrid.style, {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
    });

    for (const { key, label } of BUTTONS) {
        const btn = document.createElement('button');
        const paint = () => {
            const off = DebugPerf[key];
            btn.textContent = off ? `${label}: OFF` : `${label}: on`;
            btn.style.background = off ? '#a11' : '#161';
        };
        Object.assign(btn.style, {
            minHeight: '44px',
            minWidth: '92px',
            padding: '0 8px',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: '4px',
            color: '#fff',
            font: '600 13px/1 monospace',
            touchAction: 'manipulation',
            cursor: 'pointer',
        });
        // `click` fires reliably on touch; touch-action:manipulation removes the
        // 300ms delay, so one listener avoids any double-toggle from touch+click.
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            DebugPerf[key] = !DebugPerf[key];
            paint();
        });
        paint();
        buttonGrid.appendChild(btn);
    }
    panel.appendChild(buttonGrid);

    const mount = () => document.body.appendChild(panel);
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);

    // ── Independent FPS meter (rolling average over ~30 frames) ──────────────
    let last = performance.now();
    const samples: number[] = [];
    const tick = () => {
        const now = performance.now();
        const dt = now - last;
        last = now;
        if (dt > 0) {
            samples.push(1000 / dt);
            if (samples.length > 30) samples.shift();
            let sum = 0;
            for (const s of samples) sum += s;
            fps.textContent = `FPS ${(sum / samples.length).toFixed(0)}`;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

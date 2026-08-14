/**
 * InkTuner.ts — TEMPORARY on-screen tuner for the underwater ink's edge wobble.
 *
 * ⚠️ SCAFFOLDING. Delete this file and its single call site in main.ts once the
 * wobble is dialled in; nothing else imports it.
 *
 * Everything this panel used to carry — punch strength, the water and card
 * colours, the media player's glass and translucency — is settled and baked into
 * the source. What is left is the one thing that still needs a real screen and
 * real water to judge:
 *
 *   • FREQ — wave frequency, radians per design px. Low is a long swell, high is
 *            a tight chop. ~0.030 is a 210px wavelength, roughly two waves
 *            across a card.
 *   • AMP  — how far the edge travels, in design px. AMP 0 also doubles as the
 *            wobble's off switch when you need to know whether it is the thing
 *            costing frames.
 *
 * (The BLEND diagnostic that briefly lived here is gone: it confirmed the stall
 * was the card fills repainting, and those no longer carry a fill at all.)
 *
 * Both are live: the punch shader reads them every frame, no mask re-bake. They
 * map back to wobbleAmp / wobbleFreq in CardCarousel.ts. Speed is fixed at
 * WOBBLE_SPEED there — the brief was "bem suave", and a slider for making it
 * less so is not what this is for.
 *
 * Underwater only, so scroll down and open a tab to see anything.
 *
 * The panel swallows its own pointer/touch/wheel events — the scene's input
 * lives on window and would otherwise scroll the camera while you drag a slider.
 */

import { getWobble, setWobble } from '../effects/CardCarousel';

// Versioned: bumped whenever the stored shape or a default changes, so a value
// left over from an earlier round cannot silently win over the new default on
// the very phone it is being tuned on.
const STORE_KEY = 'ink-tuner-v13';

interface TunerState {
    freq: number;
    amp: number;
}

function readStored(): Partial<TunerState> {
    try {
        return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    } catch {
        return {};
    }
}

function store(state: TunerState): void {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch { /* private mode — tuning just won't survive a reload */ }
}

export function mountInkTuner(): void {
    if (document.getElementById('ink-tuner')) return;

    const stored = readStored();
    const wobble = getWobble();
    const state: TunerState = {
        freq: stored.freq ?? wobble.freq,
        amp: stored.amp ?? wobble.amp,
    };

    const root = document.createElement('div');
    root.id = 'ink-tuner';
    root.innerHTML = `
        <style>
            #ink-tuner {
                position: fixed; right: 10px; bottom: 10px; z-index: 99999;
                font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
                color: #eaf4ff; touch-action: auto; user-select: none;
                -webkit-user-select: none;
            }
            #ink-tuner .it-chip {
                margin-left: auto; width: 44px; height: 44px; border-radius: 22px;
                display: flex; align-items: center; justify-content: center;
                background: rgba(8, 26, 40, 0.86); border: 1px solid rgba(150, 210, 255, 0.5);
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45); font-size: 18px;
            }
            #ink-tuner .it-body {
                display: none; margin-bottom: 8px; padding: 12px 14px 14px;
                width: 230px; border-radius: 12px;
                background: rgba(8, 26, 40, 0.92); border: 1px solid rgba(150, 210, 255, 0.35);
                box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
            }
            #ink-tuner.is-open .it-body { display: block; }
            #ink-tuner h4 {
                margin: 0 0 10px; font-size: 11px; letter-spacing: 1.2px;
                text-transform: uppercase; opacity: 0.65; font-weight: 600;
            }
            #ink-tuner label { display: block; margin-bottom: 11px; }
            #ink-tuner .it-row {
                display: flex; justify-content: space-between; margin-bottom: 3px;
                font-size: 11px; letter-spacing: 0.5px;
            }
            #ink-tuner .it-val { opacity: 0.75; font-variant-numeric: tabular-nums; }
            #ink-tuner input[type=range] { width: 100%; margin: 0; height: 26px; }
            #ink-tuner .it-hint { margin: 2px 0 10px; opacity: 0.5; font-size: 10px; line-height: 1.4; }
            #ink-tuner button.it-reset {
                width: 100%; padding: 7px; border-radius: 7px; font: inherit; font-size: 11px;
                color: inherit; background: rgba(150, 210, 255, 0.14);
                border: 1px solid rgba(150, 210, 255, 0.3);
            }
        </style>
        <div class="it-body">
            <h4>wobble</h4>
            <p class="it-hint">Desça até o oceano e abra uma aba. FREQ = quantas ondas na borda, AMP = quanto ela viaja (px).</p>
            <label>
                <span class="it-row"><span>FREQ</span><span class="it-val" data-val="freq"></span></span>
                <input type="range" data-k="freq" min="0.005" max="0.15" step="0.005">
            </label>
            <label>
                <span class="it-row"><span>AMP</span><span class="it-val" data-val="amp"></span></span>
                <input type="range" data-k="amp" min="0" max="10" step="0.1">
            </label>
            <button class="it-reset" type="button">reset</button>
        </div>
        <div class="it-chip">◐</div>
    `;
    document.body.appendChild(root);

    // The scene listens on window; without this a slider drag scrolls the camera
    // and a tap on the chip raycasts into the carousel.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'click']) {
        root.addEventListener(type, e => e.stopPropagation(), { passive: false });
    }

    const chip = root.querySelector('.it-chip') as HTMLDivElement;
    chip.addEventListener('click', () => root.classList.toggle('is-open'));

    const inputs = [...root.querySelectorAll<HTMLInputElement>('input[data-k]')];
    const vals = [...root.querySelectorAll<HTMLSpanElement>('[data-val]')];

    function apply(persist: boolean): void {
        setWobble(state.amp, state.freq);
        for (const el of vals) {
            const k = el.dataset.val as keyof TunerState;
            el.textContent = state[k].toFixed(3);
        }
        for (const el of inputs) {
            const k = el.dataset.k as 'freq' | 'amp';
            el.value = String(state[k]);
        }
        if (persist) store(state);
    }

    for (const el of inputs) {
        el.addEventListener('input', () => {
            state[el.dataset.k as 'freq' | 'amp'] = parseFloat(el.value);
            apply(true);
        });
    }

    (root.querySelector('button.it-reset') as HTMLButtonElement).addEventListener('click', () => {
        try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
        state.freq = 0.030;
        state.amp = 10;
        apply(false);
    });

    apply(false);
}

/**
 * InkTuner.ts — TEMPORARY on-screen tuner for the underwater ink.
 *
 * ⚠️ SCAFFOLDING. Delete this file and its single call site in main.ts once the
 * ink is dialled in; nothing else imports it.
 *
 * The three numbers that decide how the carousel's ink reads can only really be
 * judged against the real water, on the device it ships to — a desktop preview
 * lies about both the water's brightness and how much contrast a phone screen
 * gives you outdoors. So they get sliders instead of a commit round-trip:
 *
 *   • CARD   — punch strength of the carousel's cards and title pills. 1 =
 *              opaque ink, lower = more of the live scene left sitting on top.
 *   • ALL    — instant master multiplier over it (no mask re-bake), for
 *              sweeping the whole effect to feel the range.
 *   • WATER N — --ink-water-night, the colour a fully-punched pixel lands on
 *              at night.
 *   • CARD DAY — --oc-panel-day: the carousel cards' and title pills' fill at
 *              midday.
 *
 * Both pickers write ENDPOINTS, never the live value. The live --ink-water and
 * --oc-panel are mixed between their day and night endpoints off
 * --day-night-blend (style.css), so pinning the mixed value would freeze the
 * transition the blend exists to produce.
 *   • GLASS  — strength of the lit pane in front of the media player, and how
 *              rough it is.
 *   • PLAYER — how see-through the media player panel is (1 = opaque). Zoom the
 *              radio for these three; the rest of the panel needs the ocean.
 *
 * Whatever you settle on maps back to, in order: inkPunch in CardCarousel.ts;
 * --ink-water and the day --oc-panel in style.css (--ink-water also has an
 * inline fallback on <body> in index.html); and PLAYER_PUNCH / glassOpacity /
 * glassRoughness on the CSS3DPanel the media player builds in MediaPlayer.ts.
 *
 * The panel swallows its own pointer/touch/wheel events — the scene's input
 * lives on window and would otherwise scroll the camera while you drag a slider.
 */

import { getInkPunch, setInkPunch, setInkPunchStrength } from '../effects/CardCarousel';
import { setGlassParams } from '../effects/CSS3DPanel';
import { setPlayerPanelPunch } from './MediaPlayer';

// Versioned: the shipping defaults changed after the first round of tuning, and
// a stored value from that round would silently win over the new default on the
// very phone the change was made for. Bump this whenever a default moves.
const STORE_KEY = 'ink-tuner-v9';

interface TunerState {
    card: number;
    cardDay: string;
    all: number;
    water: string;
    glass: number;
    glassRough: number;
    player: number;
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

/** Override endpoint custom properties on <body> as a real stylesheet rule.
 *
 *  Endpoints, never the live value. --ink-water and --oc-panel are mixed
 *  between their day/night endpoints off --day-night-blend, so writing the
 *  mixed property would pin it and kill the very transition it feeds. Writing
 *  the endpoint flows through the mix and keeps moving with the sky.
 *
 *  A rule rather than an inline style for the same reason as before: inline on
 *  <body> beats every mode-keyed rule at once, which is how --ink-water once
 *  froze whichever mode was active at load. Same specificity as the stylesheet
 *  and later in the document, so it wins without out-ranking anything. */
const _endpoints: Record<string, string> = {};
let _endpointStyle: HTMLStyleElement | null = null;
function applyEndpoint(name: string, hex: string): void {
    _endpoints[name] = hex;
    if (!_endpointStyle) {
        _endpointStyle = document.createElement('style');
        _endpointStyle.id = 'ink-tuner-endpoints';
        document.head.appendChild(_endpointStyle);
    }
    const decls = Object.entries(_endpoints).map(([k, v]) => `${k}: ${v};`).join(' ');
    _endpointStyle.textContent = `body { ${decls} }`;
}

/** An endpoint's authored value, as #rrggbb. Read from the live cascade rather
 *  than duplicated here — endpoints are mode-independent, so this is correct
 *  whichever mode happens to be active when the tuner opens. */
function readEndpoint(name: string, fallback: string): string {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    const m = v.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (m) {
        const hex = (n: string) => (+n).toString(16).padStart(2, '0');
        return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
    }
    return fallback;
}

export function mountInkTuner(): void {
    if (document.getElementById('ink-tuner')) return;

    const stored = readStored();
    const punch = getInkPunch();
    // An untouched tuner must not echo the stylesheet's own values back at it:
    // editing style.css and forgetting a copy here would then silently do
    // nothing. Endpoints are only overridden once their picker is used.
    let waterTouched = stored.water !== undefined;
    let dayPanelTouched = stored.cardDay !== undefined;
    const state: TunerState = {
        card: stored.card ?? punch,
        cardDay: stored.cardDay ?? readEndpoint('--oc-panel-day', '#1e617a'),
        all: stored.all ?? 1,
        water: stored.water ?? readEndpoint('--ink-water-night', '#0a2338'),
        glass: stored.glass ?? 0.20,
        glassRough: stored.glassRough ?? 0.30,
        player: stored.player ?? 0.80,
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
            #ink-tuner input[type=color] {
                width: 100%; height: 30px; padding: 0; border: 0; background: none;
            }
            #ink-tuner .it-hint { margin: 2px 0 10px; opacity: 0.5; font-size: 10px; line-height: 1.4; }
            #ink-tuner button.it-reset {
                width: 100%; padding: 7px; border-radius: 7px; font: inherit; font-size: 11px;
                color: inherit; background: rgba(150, 210, 255, 0.14);
                border: 1px solid rgba(150, 210, 255, 0.3);
            }
        </style>
        <div class="it-body">
            <h4>ink tuner</h4>
            <p class="it-hint">Carrossel (CARD, WATER, CARD DAY): desça até o oceano e abra uma aba. GLASS/PLAYER: zoom no rádio.</p>
            <label>
                <span class="it-row"><span>CARD</span><span class="it-val" data-val="card"></span></span>
                <input type="range" data-k="card" min="0.2" max="1" step="0.01">
            </label>
            <label>
                <span class="it-row"><span>ALL</span><span class="it-val" data-val="all"></span></span>
                <input type="range" data-k="all" min="0" max="1" step="0.01">
            </label>
            <label>
                <span class="it-row"><span>WATER N</span><span class="it-val" data-val="water"></span></span>
                <input type="color" data-k="water">
            </label>
            <label>
                <span class="it-row"><span>CARD DAY</span><span class="it-val" data-val="cardDay"></span></span>
                <input type="color" data-k="cardDay">
            </label>
            <label>
                <span class="it-row"><span>GLASS</span><span class="it-val" data-val="glass"></span></span>
                <input type="range" data-k="glass" min="0" max="0.5" step="0.01">
            </label>
            <label>
                <span class="it-row"><span>GLASS ROUGH</span><span class="it-val" data-val="glassRough"></span></span>
                <input type="range" data-k="glassRough" min="0" max="1" step="0.01">
            </label>
            <label>
                <span class="it-row"><span>PLAYER</span><span class="it-val" data-val="player"></span></span>
                <input type="range" data-k="player" min="0.2" max="1" step="0.01">
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
        setInkPunch(state.card);
        setInkPunchStrength(state.all);
        setGlassParams(state.glass, state.glassRough);
        setPlayerPanelPunch(state.player);
        if (dayPanelTouched) applyEndpoint('--oc-panel-day', state.cardDay);
        else state.cardDay = readEndpoint('--oc-panel-day', state.cardDay);
        if (waterTouched) applyEndpoint('--ink-water-night', state.water);
        else state.water = readEndpoint('--ink-water-night', state.water);
        for (const el of vals) {
            const k = el.dataset.val as keyof TunerState;
            el.textContent = typeof state[k] === 'number' ? (state[k] as number).toFixed(2) : String(state[k]);
        }
        for (const el of inputs) {
            const k = el.dataset.k as keyof TunerState;
            el.value = String(state[k]);
        }
        if (persist) store(state);
    }

    for (const el of inputs) {
        el.addEventListener('input', () => {
            const k = el.dataset.k as keyof TunerState;
            if (k === 'water') { state.water = el.value; waterTouched = true; }
            else if (k === 'cardDay') { state.cardDay = el.value; dayPanelTouched = true; }
            else (state[k] as number) = parseFloat(el.value);
            apply(true);
        });
    }

    (root.querySelector('.it-reset') as HTMLButtonElement).addEventListener('click', () => {
        try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
        waterTouched = false;
        dayPanelTouched = false;
        for (const k of Object.keys(_endpoints)) delete _endpoints[k];
        _endpointStyle?.remove();
        _endpointStyle = null;
        state.card = 0.85;
        state.all = 1;
        state.glass = 0.20;
        state.glassRough = 0.30;
        state.player = 0.80;
        apply(false);
    });

    apply(false);
}

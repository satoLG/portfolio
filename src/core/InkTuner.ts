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
 *   • WATER  — --ink-water, the colour every fully-punched pixel lands on.
 *   • CARD DAY — --oc-panel in DAY mode: the fill of the carousel's cards and
 *              title pills. Scoped to day only (see applyDayPanel), so night is
 *              never touched no matter what is stored.
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
const STORE_KEY = 'ink-tuner-v7';

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

// Day-mode --oc-panel as authored in style.css. Duplicated here because
// getComputedStyle can only report the mode that is currently active, and the
// tuner has to open with the right swatch while it is night. Keep in sync with
// the .ocean-carousel rule.
const DAY_PANEL_DEFAULT = '#b8d4e8';

/** Scope a day-mode panel colour into the document as a real CSS rule rather
 *  than an inline style on <body>. Inline would beat BOTH mode rules at once —
 *  the bug --ink-water hit, where a value pinned at load froze whichever mode
 *  was active and the day/night swap stopped reaching the ink. A rule keyed on
 *  body.day-mode simply does not match at night. */
let _dayPanelStyle: HTMLStyleElement | null = null;
function applyDayPanel(hex: string): void {
    if (!_dayPanelStyle) {
        _dayPanelStyle = document.createElement('style');
        _dayPanelStyle.id = 'ink-tuner-day-panel';
        document.head.appendChild(_dayPanelStyle);
    }
    _dayPanelStyle.textContent = `body.day-mode .ocean-carousel { --oc-panel: ${hex}; }`;
}

/** Current --ink-water for the active day/night mode, as #rrggbb. The stylesheet
 *  authors it per mode, so read it back rather than hard-coding a default. */
function currentWater(): string {
    const v = getComputedStyle(document.body).getPropertyValue('--ink-water').trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    const m = v.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (m) {
        const hex = (n: string) => (+n).toString(16).padStart(2, '0');
        return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
    }
    return '#0a2338';
}

export function mountInkTuner(): void {
    if (document.getElementById('ink-tuner')) return;

    const stored = readStored();
    const punch = getInkPunch();
    // --ink-water is authored PER MODE in style.css. Writing it inline on <body>
    // beats both rules at once, so a value pinned at mount freezes whichever
    // mode happened to be active then and the day/night swap silently stops
    // working for the ink. Only pin it once the picker is actually used.
    let waterTouched = stored.water !== undefined;
    // Same rule for the day panel: an untouched tuner must not inject
    // DAY_PANEL_DEFAULT over the stylesheet, or editing style.css and
    // forgetting the copy here would silently do nothing.
    let dayPanelTouched = stored.cardDay !== undefined;
    const state: TunerState = {
        card: stored.card ?? punch,
        cardDay: stored.cardDay ?? DAY_PANEL_DEFAULT,
        all: stored.all ?? 1,
        water: stored.water ?? currentWater(),
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
                <span class="it-row"><span>WATER</span><span class="it-val" data-val="water"></span></span>
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
        if (dayPanelTouched) applyDayPanel(state.cardDay);
        else state.cardDay = DAY_PANEL_DEFAULT;
        if (waterTouched) {
            document.body.style.setProperty('--ink-water', state.water);
        } else {
            // Untouched: leave the stylesheet in charge and just mirror what it
            // is currently serving, so the readout matches the live mode.
            state.water = currentWater();
        }
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
        _dayPanelStyle?.remove();
        _dayPanelStyle = null;
        state.card = 0.80;
        state.cardDay = DAY_PANEL_DEFAULT;
        state.all = 1;
        state.glass = 0.20;
        state.glassRough = 0.30;
        state.player = 0.80;
        document.body.style.removeProperty('--ink-water');
        apply(false);
    });

    apply(false);
}

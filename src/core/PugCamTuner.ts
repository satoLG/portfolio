/**
 * PugCamTuner.ts — TEMPORARY on-screen tuner for the pug-zoom framing and the
 * placement of the two in-scene dialog panels.
 *
 * ⚠️ SCAFFOLDING, same deal as InkTuner.ts. Delete this file and its single call
 * site in main.ts once the numbers are settled; nothing else imports it. When
 * they are, paste the CAMERA block back into `pugZoomConfig` (core/Control.ts)
 * and the DIALOG block into `dialogAnchorConfig` (core/Dialog.ts) — the "copy"
 * button hands you both, already formatted.
 *
 * Everything here is live: Control's Update reads pugZoomConfig every frame, and
 * the panels re-anchor from dialogAnchorConfig on the next one. Click the pug to
 * zoom in, then drag — the framing moves under you.
 *
 * CAMERA
 *   DIST    world units out along the pug's facing normal. Smaller = closer.
 *   HEIGHT  camera Y above the pug's origin.
 *   LATERAL camera-right shift before the yaw. Negative = left.
 *   YAW     radians off "look straight at the pug". NEGATIVE looks left, which
 *           slides the pug RIGHT across the frame and gives the space it leaves
 *           behind to the island.
 *   PITCH   radians. POSITIVE looks up, sliding the pug DOWN the frame.
 *
 * DIALOG
 *   SPEECH X/Y/Z   the white panel's offset from the pug, in world units.
 *   REPLY  X/Y/Z   the reply pills' offset from the pug.
 *   SPEECH/REPLY SIZE  px per world unit — HIGHER IS SMALLER (the DOM is authored
 *           large and scaled down; that is what keeps it crisp).
 *   THREAD Y  how far up the pug the connector line attaches.
 *
 * The panel swallows its own pointer/touch/wheel events — the scene's input lives
 * on window and would otherwise scroll the camera while you drag a slider.
 */

import { pugZoomConfig } from './Control';
import { dialogAnchorConfig, refreshDialogPlacement } from './Dialog';

// Versioned: bumped whenever the stored shape or a default changes, so a value
// left over from an earlier round cannot silently win over the new default.
const STORE_KEY = 'pug-cam-tuner-v1';

interface Field {
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    /** Where the value lives: the camera config or the dialog anchor config. */
    target: 'cam' | 'dlg';
    /** Decimal places in the readout / the copied source. */
    dp: number;
}

const FIELDS: Field[] = [
    { target: 'cam', key: 'dist',    label: 'DIST',    min: 0.35, max: 2.2,  step: 0.01, dp: 4 },
    { target: 'cam', key: 'height',  label: 'HEIGHT',  min: -0.3, max: 1.0,  step: 0.01, dp: 4 },
    { target: 'cam', key: 'lateral', label: 'LATERAL', min: -0.8, max: 0.8,  step: 0.01, dp: 4 },
    { target: 'cam', key: 'yaw',     label: 'YAW',     min: -1.2, max: 1.2,  step: 0.01, dp: 4 },
    { target: 'cam', key: 'pitch',   label: 'PITCH',   min: -0.6, max: 0.6,  step: 0.01, dp: 4 },

    { target: 'dlg', key: 'speechX', label: 'SPEECH X', min: -1.6, max: 1.6, step: 0.01, dp: 4 },
    { target: 'dlg', key: 'speechY', label: 'SPEECH Y', min: -1.0, max: 1.8, step: 0.01, dp: 4 },
    { target: 'dlg', key: 'speechZ', label: 'SPEECH Z', min: -1.6, max: 1.6, step: 0.01, dp: 4 },
    { target: 'dlg', key: 'speechPxPerUnit', label: 'SPEECH SIZE', min: 300, max: 2600, step: 10, dp: 0 },
    { target: 'dlg', key: 'replyX',  label: 'REPLY X',  min: -1.6, max: 1.6, step: 0.01, dp: 4 },
    { target: 'dlg', key: 'replyY',  label: 'REPLY Y',  min: -1.0, max: 1.8, step: 0.01, dp: 4 },
    { target: 'dlg', key: 'replyZ',  label: 'REPLY Z',  min: -1.6, max: 1.6, step: 0.01, dp: 4 },
    { target: 'dlg', key: 'replyPxPerUnit', label: 'REPLY SIZE', min: 300, max: 2600, step: 10, dp: 0 },
    { target: 'dlg', key: 'connectorY', label: 'THREAD Y', min: -0.3, max: 0.9, step: 0.01, dp: 4 },
];

type AnyConfig = Record<string, number>;

function cfgOf(target: 'cam' | 'dlg'): AnyConfig {
    return (target === 'cam' ? pugZoomConfig : dialogAnchorConfig) as unknown as AnyConfig;
}

/** The defaults baked into the source — captured before any stored value lands,
 *  so "reset" really does go back to what is committed. */
const DEFAULTS: Record<string, number> = {};
for (const f of FIELDS) DEFAULTS[`${f.target}.${f.key}`] = cfgOf(f.target)[f.key];

function readStored(): Record<string, number> {
    try {
        return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    } catch {
        return {};
    }
}

function store(): void {
    const out: Record<string, number> = {};
    for (const f of FIELDS) out[`${f.target}.${f.key}`] = cfgOf(f.target)[f.key];
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch { /* private mode — tuning just won't survive a reload */ }
}

/** Paste-ready source for both config blocks. */
function sourceText(): string {
    const line = (f: Field): string => {
        const v = cfgOf(f.target)[f.key];
        return `    ${f.key}: ${f.dp > 0 ? v.toFixed(f.dp) : String(Math.round(v))},`;
    };
    const cam = FIELDS.filter(f => f.target === 'cam').map(line).join('\n');
    const dlg = FIELDS.filter(f => f.target === 'dlg').map(line).join('\n');
    return (
        '// core/Control.ts — pugZoomConfig\n' +
        `export const pugZoomConfig = {\n${cam}\n};\n\n` +
        '// core/Dialog.ts — dialogAnchorConfig\n' +
        `export const dialogAnchorConfig = {\n${dlg}\n};\n`
    );
}

export function mountPugCamTuner(): void {
    if (document.getElementById('pug-cam-tuner')) return;

    // Apply anything saved from an earlier session before the UI is built.
    const stored = readStored();
    for (const f of FIELDS) {
        const v = stored[`${f.target}.${f.key}`];
        if (typeof v === 'number' && Number.isFinite(v)) cfgOf(f.target)[f.key] = v;
    }
    refreshDialogPlacement();

    const group = (title: string, target: 'cam' | 'dlg'): string => `
        <h4>${title}</h4>
        ${FIELDS.filter(f => f.target === target).map(f => `
            <label>
                <span class="pt-row"><span>${f.label}</span><span class="pt-val" data-val="${f.target}.${f.key}"></span></span>
                <input type="range" data-t="${f.target}" data-k="${f.key}"
                       min="${f.min}" max="${f.max}" step="${f.step}">
            </label>
        `).join('')}
    `;

    const root = document.createElement('div');
    root.id = 'pug-cam-tuner';
    root.innerHTML = `
        <style>
            #pug-cam-tuner {
                position: fixed; right: 10px; bottom: 64px; z-index: 99999;
                font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
                color: #eaf4ff; touch-action: auto; user-select: none;
                -webkit-user-select: none;
            }
            #pug-cam-tuner .pt-chip {
                margin-left: auto; width: 44px; height: 44px; border-radius: 22px;
                display: flex; align-items: center; justify-content: center;
                background: rgba(8, 26, 40, 0.86); border: 1px solid rgba(150, 210, 255, 0.5);
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45); font-size: 18px;
            }
            #pug-cam-tuner .pt-body {
                display: none; margin-bottom: 8px; padding: 12px 14px 14px;
                width: 250px; max-height: 68vh; overflow-y: auto; border-radius: 12px;
                background: rgba(8, 26, 40, 0.92); border: 1px solid rgba(150, 210, 255, 0.35);
                box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
            }
            #pug-cam-tuner.is-open .pt-body { display: block; }
            #pug-cam-tuner h4 {
                margin: 0 0 10px; font-size: 11px; letter-spacing: 1.2px;
                text-transform: uppercase; opacity: 0.65; font-weight: 600;
            }
            #pug-cam-tuner h4 + label { margin-top: 0; }
            #pug-cam-tuner label { display: block; margin-bottom: 9px; }
            #pug-cam-tuner .pt-row {
                display: flex; justify-content: space-between; margin-bottom: 3px;
                font-size: 11px; letter-spacing: 0.5px;
            }
            #pug-cam-tuner .pt-val { opacity: 0.75; font-variant-numeric: tabular-nums; }
            #pug-cam-tuner input[type=range] { width: 100%; margin: 0; height: 24px; }
            #pug-cam-tuner .pt-hint { margin: 2px 0 10px; opacity: 0.5; font-size: 10px; line-height: 1.4; }
            #pug-cam-tuner hr {
                border: none; border-top: 1px solid rgba(150, 210, 255, 0.2); margin: 12px 0;
            }
            #pug-cam-tuner button {
                width: 100%; padding: 7px; border-radius: 7px; font: inherit; font-size: 11px;
                color: inherit; background: rgba(150, 210, 255, 0.14);
                border: 1px solid rgba(150, 210, 255, 0.3); margin-top: 6px;
            }
        </style>
        <div class="pt-body">
            <p class="pt-hint">Clique no pug pra dar zoom, depois arraste. YAW negativo olha pra esquerda (pug vai pra direita), PITCH positivo olha pra cima (pug desce). SIZE maior = painel menor.</p>
            ${group('camera', 'cam')}
            <hr>
            ${group('dialog', 'dlg')}
            <button class="pt-copy" type="button">copiar valores</button>
            <button class="pt-reset" type="button">reset</button>
        </div>
        <div class="pt-chip">🐶</div>
    `;
    document.body.appendChild(root);

    // The scene listens on window; without this a slider drag scrolls the camera
    // and a tap on the chip raycasts into the island.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'click']) {
        root.addEventListener(type, e => e.stopPropagation(), { passive: false });
    }

    const chip = root.querySelector('.pt-chip') as HTMLDivElement;
    chip.addEventListener('click', () => root.classList.toggle('is-open'));

    const inputs = [...root.querySelectorAll<HTMLInputElement>('input[data-k]')];
    const vals = [...root.querySelectorAll<HTMLSpanElement>('[data-val]')];

    function apply(persist: boolean): void {
        // Panel sizes/offsets are read per frame, but pxPerUnit has to be pushed
        // into the live panels.
        refreshDialogPlacement();
        for (const el of vals) {
            const [target, key] = (el.dataset.val ?? '').split('.') as ['cam' | 'dlg', string];
            const f = FIELDS.find(x => x.target === target && x.key === key);
            if (!f) continue;
            const v = cfgOf(target)[key];
            el.textContent = f.dp > 0 ? v.toFixed(3) : String(Math.round(v));
        }
        for (const el of inputs) {
            const target = el.dataset.t as 'cam' | 'dlg';
            el.value = String(cfgOf(target)[el.dataset.k as string]);
        }
        if (persist) store();
    }

    for (const el of inputs) {
        el.addEventListener('input', () => {
            const target = el.dataset.t as 'cam' | 'dlg';
            cfgOf(target)[el.dataset.k as string] = parseFloat(el.value);
            apply(true);
        });
    }

    const copyBtn = root.querySelector('button.pt-copy') as HTMLButtonElement;
    copyBtn.addEventListener('click', () => {
        const text = sourceText();
        const done = (ok: boolean): void => {
            copyBtn.textContent = ok ? 'copiado ✓' : 'ver console';
            setTimeout(() => { copyBtn.textContent = 'copiar valores'; }, 1400);
        };
        // console.log unconditionally: on http (or a denied permission) the
        // clipboard is simply not available, and the values still have to
        // reach you somehow.
        console.log(text);
        navigator.clipboard?.writeText(text).then(() => done(true), () => done(false)) ?? done(false);
    });

    (root.querySelector('button.pt-reset') as HTMLButtonElement).addEventListener('click', () => {
        try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
        for (const f of FIELDS) cfgOf(f.target)[f.key] = DEFAULTS[`${f.target}.${f.key}`];
        apply(false);
    });

    apply(false);
}

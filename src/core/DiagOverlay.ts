/**
 * DiagOverlay — TEMPORARY on-device diagnostic panel for the iOS edge-foam
 * flicker investigation. Plain DOM, no lil-gui: on/off toggles + a Z-fade
 * stepper, reachable via a small corner tap target (no keyboard needed).
 *
 * Delete this file + its Start() call in main.ts once the final
 * edgeFoamFadeEndZMobile value is confirmed and hardcoded into OceanConfig.ts.
 */
import { edgeFoamIntensityUniform, foamIntensityUniform, edgeFoamFadeEndZUniform } from "../materials/OceanMaterial";
import * as OceanConfig from "../scene/config/OceanConfig";
import * as Scene from "./Scene";

const FADE_Z_STEP = 0.25;

let panel: HTMLDivElement | null = null;
let panelVisible = false;
let fadeZValueEl: HTMLSpanElement | null = null;

function formatZ(v: number): string {
    return v.toFixed(2);
}

function updateFadeZText(): void {
    if (fadeZValueEl) fadeZValueEl.textContent = formatZ(edgeFoamFadeEndZUniform.value);
}

function makeToggleRow(label: string, onValue: number, uniform: { value: number }): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = `display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0;`;

    const text = document.createElement('span');
    text.textContent = label;
    text.style.cssText = `font-size: 13px; color: #fff; font-family: sans-serif;`;

    const btn = document.createElement('button');
    btn.style.cssText = `
        min-width: 52px;
        padding: 6px 10px;
        border-radius: 6px;
        border: none;
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        font-family: sans-serif;
    `;
    const render = () => {
        const on = uniform.value !== 0;
        btn.textContent = on ? 'ON' : 'OFF';
        btn.style.background = on ? '#2b7cd4' : 'rgba(255,255,255,0.15)';
    };
    btn.addEventListener('click', () => {
        uniform.value = uniform.value !== 0 ? 0 : onValue;
        render();
    });
    render();

    row.appendChild(text);
    row.appendChild(btn);
    return row;
}

let fishFxForcedIn = false;
let terrainHidden = false;
let campFloraHidden = false;
let applesHidden = false;
let mossRocksHidden = false;
let chestHidden = false;
let fishJellyHidden = false;

function makeBoolToggleRow(label: string, getValue: () => boolean, setValue: (v: boolean) => void): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = `display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0;`;

    const text = document.createElement('span');
    text.textContent = label;
    text.style.cssText = `font-size: 13px; color: #fff; font-family: sans-serif;`;

    const btn = document.createElement('button');
    btn.style.cssText = `
        min-width: 52px;
        padding: 6px 10px;
        border-radius: 6px;
        border: none;
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        font-family: sans-serif;
    `;
    const render = () => {
        const on = getValue();
        btn.textContent = on ? 'ON' : 'OFF';
        btn.style.background = on ? '#2b7cd4' : 'rgba(255,255,255,0.15)';
    };
    btn.addEventListener('click', () => {
        setValue(!getValue());
        render();
    });
    render();

    row.appendChild(text);
    row.appendChild(btn);
    return row;
}

function makeStepButton(delta: number, label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: none;
        background: rgba(255,255,255,0.15);
        color: #fff;
        font-size: 16px;
        font-weight: 700;
        font-family: sans-serif;
    `;
    b.addEventListener('click', () => {
        edgeFoamFadeEndZUniform.value = Math.round((edgeFoamFadeEndZUniform.value + delta) * 100) / 100;
        updateFadeZText();
    });
    return b;
}

function buildPanel(): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = `
        position: fixed;
        bottom: 32px;
        right: 8px;
        z-index: 10000;
        min-width: 200px;
        padding: 12px;
        border-radius: 12px;
        background: rgb(20 40 60 / 85%);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        display: none;
    `;

    el.appendChild(makeToggleRow('Edge Foam', OceanConfig.edgeFoamIntensity, edgeFoamIntensityUniform));
    el.appendChild(makeToggleRow('Ring Foam', OceanConfig.foamIntensity, foamIntensityUniform));
    // OFF (default) = fish/jellyfish/bubbles/particles excluded from the
    // depth pre-pass (the fix). ON = force them back in, to A/B-confirm
    // they're the flicker source live.
    el.appendChild(makeBoolToggleRow(
        'Fish/FX Depth',
        () => fishFxForcedIn,
        (forcedIn) => {
            fishFxForcedIn = forcedIn;
            Scene.setDiagForceIncludeUnderwaterTransparents(fishFxForcedIn);
        },
    ));

    // Coarse "kill switch" buckets — fully hide (not just depth-pre-pass-
    // exclude) groups of models to bisect the flicker by testing whether a
    // real, visible model is the culprit. ON = normal/visible, OFF = hidden.
    el.appendChild(makeBoolToggleRow('Terrain', () => !terrainHidden, (v) => {
        terrainHidden = !v;
        Scene.setDiagHideTerrain(terrainHidden);
    }));
    el.appendChild(makeBoolToggleRow('Camp/Flora/Pug', () => !campFloraHidden, (v) => {
        campFloraHidden = !v;
        Scene.setDiagHideCampFlora(campFloraHidden);
    }));
    el.appendChild(makeBoolToggleRow('Apples', () => !applesHidden, (v) => {
        applesHidden = !v;
        Scene.setDiagHideApples(applesHidden);
    }));
    el.appendChild(makeBoolToggleRow('Moss Rocks', () => !mossRocksHidden, (v) => {
        mossRocksHidden = !v;
        Scene.setDiagHideMossRocks(mossRocksHidden);
    }));
    el.appendChild(makeBoolToggleRow('Chest', () => !chestHidden, (v) => {
        chestHidden = !v;
        Scene.setDiagHideChest(chestHidden);
    }));
    el.appendChild(makeBoolToggleRow('Fish/Jelly', () => !fishJellyHidden, (v) => {
        fishJellyHidden = !v;
        Scene.setDiagHideFishJelly(fishJellyHidden);
    }));

    const fadeRow = document.createElement('div');
    fadeRow.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 10px 0 0;
        border-top: 1px solid rgba(255, 255, 255, 0.15);
        margin-top: 6px;
    `;

    const fadeLabel = document.createElement('span');
    fadeLabel.textContent = 'Fade Z';
    fadeLabel.style.cssText = `font-size: 13px; color: #fff; font-family: sans-serif;`;

    fadeZValueEl = document.createElement('span');
    fadeZValueEl.style.cssText = `font-size: 13px; color: #fff; font-family: sans-serif; min-width: 44px; text-align: center;`;

    fadeRow.appendChild(fadeLabel);
    fadeRow.appendChild(makeStepButton(-FADE_Z_STEP, '−'));
    fadeRow.appendChild(fadeZValueEl);
    fadeRow.appendChild(makeStepButton(FADE_Z_STEP, '+'));

    el.appendChild(fadeRow);
    updateFadeZText();

    return el;
}

function toggle(): void {
    panelVisible = !panelVisible;
    if (panel) panel.style.display = panelVisible ? 'block' : 'none';
}

export function Start(): void {
    panel = buildPanel();
    document.body.appendChild(panel);

    const dot = document.createElement('button');
    dot.setAttribute('aria-label', 'Toggle foam diagnostics');
    dot.style.cssText = `
        position: fixed;
        bottom: 8px;
        right: 8px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: none;
        background: rgba(128, 128, 128, 0.25);
        z-index: 10000;
        padding: 0;
        -webkit-tap-highlight-color: transparent;
    `;
    dot.addEventListener('click', toggle);
    document.body.appendChild(dot);
}

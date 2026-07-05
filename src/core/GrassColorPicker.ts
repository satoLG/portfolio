/**
 * GrassColorPicker — a tiny on-page colour picker (independent of the debug GUI,
 * which is keyboard-only and unreachable on mobile).
 *
 * IMPORTANT: it uses inline H/S/L range sliders, NOT <input type="color">.
 * The native colour input opens a full-screen OS modal that covers the whole
 * scene, so you can't watch the grass change while dragging. Sliders adjust in
 * place, keeping the island fully visible for live preview.
 *
 * Sliders work in sRGB HSL (matching the hex you read). When applying to the
 * grass we convert the sRGB hex to linear via three's Color, exactly like the
 * committed GRASS_COLOR_* config values. Purely a tuning helper — remove once
 * the colours are locked in.
 */
import { Color } from "three";
import { setGrassColorBase, setGrassColorTip, rebuildGrassGeometry } from "../scene/Island";
import { grassColorBase, grassColorTip } from "../scene/ProceduralGrass";

// ── sRGB HSL <-> hex helpers ───────────────────────────────────────────────
// h in [0,360), s/l in [0,1]. Standard sRGB conversions (not linear-space).
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60)       { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else              { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (d !== 0) {
        s = d / (1 - Math.abs(2 * l - 1));
        if (max === r)      h = (((g - b) / d) % 6);
        else if (max === g) h = (b - r) / d + 2;
        else                h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return [h, s, l];
}
function toHex(r: number, g: number, b: number): string {
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

let _rafPending = false;

/** Coalesce rapid drag events into at most one geometry rebuild per frame. */
function scheduleApply(baseHex: string, tipHex: string): void {
    const base = new Color(baseHex);
    const tip  = new Color(tipHex);
    setGrassColorBase(base.r, base.g, base.b);
    setGrassColorTip(tip.r, tip.g, tip.b);
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => {
        _rafPending = false;
        rebuildGrassGeometry();
    });
}

export function Start(): void {
    const baseHex0 = "#" + grassColorBase.getHexString();
    const tipHex0  = "#" + grassColorTip.getHexString();

    // Slider look — inline, no native modal. Injected once.
    const style = document.createElement("style");
    style.textContent = `
        .gcp-sld { -webkit-appearance:none; appearance:none; height:12px; border-radius:6px;
                   outline:none; margin:0; padding:0; flex:1; background:rgba(255,255,255,0.15); }
        .gcp-sld::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:14px;
                   height:14px; border-radius:50%; background:#fff; border:1px solid rgba(0,0,0,0.4);
                   box-shadow:0 1px 2px rgba(0,0,0,0.4); cursor:pointer; }
        .gcp-sld::-moz-range-thumb { width:14px; height:14px; border-radius:50%; background:#fff;
                   border:1px solid rgba(0,0,0,0.4); cursor:pointer; }
    `;
    document.head.appendChild(style);

    // ── Panel shell ──────────────────────────────────────────────────────────
    // Top-center over the sky so it never covers the island, translucent so the
    // scene reads through it.
    const panel = document.createElement("div");
    panel.style.cssText = [
        "position:fixed",
        "top:calc(52px + env(safe-area-inset-top, 0px))",
        "left:50%",
        "transform:translateX(-50%)",
        "z-index:99999",
        "width:214px",
        "font:10px/1.3 system-ui, -apple-system, sans-serif",
        "color:#f0f0f0",
        "background:rgba(18,22,18,0.5)",
        "backdrop-filter:blur(5px)",
        "-webkit-backdrop-filter:blur(5px)",
        "border:1px solid rgba(255,255,255,0.12)",
        "border-radius:8px",
        "padding:5px 8px 7px",
        "box-shadow:0 2px 10px rgba(0,0,0,0.3)",
        "user-select:none",
        "touch-action:manipulation",
    ].join(";");

    // Header row with a collapse toggle
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:5px;cursor:pointer";
    const title = document.createElement("span");
    title.textContent = "🌿 grama";
    title.style.cssText = "font-weight:600;letter-spacing:0.2px;opacity:0.9";
    const chevron = document.createElement("span");
    chevron.textContent = "▾";
    chevron.style.cssText = "margin-left:auto;opacity:0.6";
    header.append(title, chevron);

    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:8px";

    // One colour block: label + swatch + hex readout, plus H/S/L sliders.
    function makeBlock(label: string, initialHex: string, onChange: (hex: string) => void) {
        const [ir, ig, ib] = hexToRgb(initialHex);
        let [h, s, l] = rgbToHsl(ir, ig, ib);

        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:4px";

        // Top row: name • swatch • hex
        const top = document.createElement("div");
        top.style.cssText = "display:flex;align-items:center;gap:6px";
        const name = document.createElement("span");
        name.textContent = label;
        name.style.cssText = "width:38px;opacity:0.85";
        const swatch = document.createElement("div");
        swatch.style.cssText =
            "width:20px;height:16px;border-radius:4px;border:1px solid rgba(255,255,255,0.25);flex:none";
        const hex = document.createElement("input");
        hex.type = "text";
        hex.value = initialHex;
        hex.spellcheck = false;
        hex.style.cssText = [
            "flex:1", "min-width:0",
            "font:10px ui-monospace, SFMono-Regular, Menlo, monospace",
            "text-transform:lowercase",
            "color:#f0f0f0",
            "background:rgba(255,255,255,0.08)",
            "border:1px solid rgba(255,255,255,0.15)",
            "border-radius:5px",
            "padding:3px 5px",
        ].join(";");
        top.append(name, swatch, hex);

        // Slider factory
        function makeSlider(letter: string, min: number, max: number, step: number, val: number) {
            const r = document.createElement("div");
            r.style.cssText = "display:flex;align-items:center;gap:6px";
            const lab = document.createElement("span");
            lab.textContent = letter;
            lab.style.cssText = "width:10px;opacity:0.6;text-align:center";
            const sld = document.createElement("input");
            sld.type = "range";
            sld.className = "gcp-sld";
            sld.min = String(min); sld.max = String(max); sld.step = String(step);
            sld.value = String(val);
            r.append(lab, sld);
            return { r, sld };
        }

        const hueS = makeSlider("H", 0, 360, 1, h);
        const satS = makeSlider("S", 0, 100, 1, s * 100);
        const litS = makeSlider("L", 0, 100, 1, l * 100);

        // Give the hue slider a full rainbow; S/L get live gradients from current h/s/l.
        hueS.sld.style.background =
            "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)";

        function refreshTracks(): void {
            satS.sld.style.background =
                `linear-gradient(to right, hsl(${h} 0% ${l * 100}%), hsl(${h} 100% ${l * 100}%))`;
            litS.sld.style.background =
                `linear-gradient(to right, #000, hsl(${h} ${s * 100}% 50%), #fff)`;
        }

        function sync(apply: boolean): void {
            const [r, g, b] = hslToRgb(h, s, l);
            const hx = toHex(r, g, b);
            swatch.style.background = hx;
            if (document.activeElement !== hex) hex.value = hx;
            refreshTracks();
            if (apply) onChange(hx);
        }

        hueS.sld.addEventListener("input", () => { h = +hueS.sld.value;        sync(true); });
        satS.sld.addEventListener("input", () => { s = +satS.sld.value / 100;  sync(true); });
        litS.sld.addEventListener("input", () => { l = +litS.sld.value / 100;  sync(true); });

        // Typed/pasted hex → move sliders + apply
        hex.addEventListener("input", () => {
            let v = hex.value.trim();
            if (v && v[0] !== "#") v = "#" + v;
            if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                const [r, g, b] = hexToRgb(v);
                [h, s, l] = rgbToHsl(r, g, b);
                hueS.sld.value = String(h);
                satS.sld.value = String(s * 100);
                litS.sld.value = String(l * 100);
                swatch.style.background = v;
                refreshTracks();
                onChange(v);
            }
        });

        wrap.append(top, hueS.r, satS.r, litS.r);
        sync(false);
        return wrap;
    }

    let baseHex = baseHex0;
    let tipHex  = tipHex0;

    const baseBlock = makeBlock("Base", baseHex0, (v) => { baseHex = v; scheduleApply(baseHex, tipHex); });
    const tipBlock  = makeBlock("Ponta", tipHex0, (v) => { tipHex  = v; scheduleApply(baseHex, tipHex); });

    body.append(baseBlock, tipBlock);

    // Collapse / expand
    let collapsed = false;
    header.addEventListener("click", () => {
        collapsed = !collapsed;
        body.style.display = collapsed ? "none" : "flex";
        chevron.textContent = collapsed ? "▸" : "▾";
    });

    panel.append(header, body);
    document.body.appendChild(panel);
}

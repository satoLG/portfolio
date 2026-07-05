/**
 * GrassColorPicker — a tiny on-page colour picker (independent of the debug GUI,
 * which is keyboard-only and unreachable on mobile).
 *
 * Lets you drag the base + tip grass colours live and read the exact sRGB hex,
 * so you can dial in a value on the phone and copy it back into IslandConfig.ts
 * (GRASS_COLOR_BASE / GRASS_COLOR_TIP). Purely a tuning helper — remove once the
 * colours are locked in.
 */
import { Color } from "three";
import { setGrassColorBase, setGrassColorTip, rebuildGrassGeometry } from "../scene/Island";
import { grassColorBase, grassColorTip } from "../scene/ProceduralGrass";

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

    // ── Panel shell ──────────────────────────────────────────────────────────
    // Anchored top-center over the sky so it never covers the island/grass, and
    // kept small + translucent so the scene reads through it.
    const panel = document.createElement("div");
    panel.style.cssText = [
        "position:fixed",
        "top:calc(52px + env(safe-area-inset-top, 0px))",
        "left:50%",
        "transform:translateX(-50%)",
        "z-index:99999",
        "font:10px/1.3 system-ui, -apple-system, sans-serif",
        "color:#f0f0f0",
        "background:rgba(18,22,18,0.5)",
        "backdrop-filter:blur(5px)",
        "-webkit-backdrop-filter:blur(5px)",
        "border:1px solid rgba(255,255,255,0.12)",
        "border-radius:8px",
        "padding:5px 7px",
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
    body.style.cssText = "display:flex;flex-direction:column;gap:5px";

    // Build one labelled row: colour swatch + editable hex readout, kept in sync.
    function makeRow(label: string, initialHex: string, onChange: (hex: string) => void) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:6px";

        const name = document.createElement("span");
        name.textContent = label;
        name.style.cssText = "width:34px;opacity:0.85";

        const swatch = document.createElement("input");
        swatch.type = "color";
        swatch.value = initialHex;
        swatch.style.cssText =
            "width:24px;height:20px;padding:0;border:none;border-radius:5px;background:none;cursor:pointer";

        const hex = document.createElement("input");
        hex.type = "text";
        hex.value = initialHex;
        hex.spellcheck = false;
        hex.style.cssText = [
            "width:66px",
            "font:10px ui-monospace, SFMono-Regular, Menlo, monospace",
            "text-transform:lowercase",
            "color:#f0f0f0",
            "background:rgba(255,255,255,0.08)",
            "border:1px solid rgba(255,255,255,0.15)",
            "border-radius:5px",
            "padding:3px 5px",
        ].join(";");

        // Swatch drag → update hex text + apply
        swatch.addEventListener("input", () => {
            hex.value = swatch.value;
            onChange(swatch.value);
        });
        // Typed/pasted hex → validate, sync swatch, apply
        hex.addEventListener("input", () => {
            let v = hex.value.trim();
            if (v && v[0] !== "#") v = "#" + v;
            if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                swatch.value = v;
                onChange(v);
            }
        });

        row.append(name, swatch, hex);
        return { row, swatch, hex };
    }

    let baseHex = baseHex0;
    let tipHex  = tipHex0;

    const baseRow = makeRow("Base", baseHex0, (v) => { baseHex = v; scheduleApply(baseHex, tipHex); });
    const tipRow  = makeRow("Ponta", tipHex0, (v) => { tipHex  = v; scheduleApply(baseHex, tipHex); });

    body.append(baseRow.row, tipRow.row);

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

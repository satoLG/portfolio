// TEMP — throwaway overlay to A/B the campfire sprite FPS live in the browser.
// Delete this file + its mount() call in Scene.ts once a value is picked, and
// inline the winning number back into Fire.ts's SPRITE_FPS const.

import { SPRITE_FPS, setSpriteFps } from "./Fire";

const OPTIONS = [16, 24, 32] as const;

export function mount(): void {
    const panel = document.createElement("div");
    panel.style.position = "fixed";
    panel.style.bottom = "16px";
    panel.style.left = "16px";
    panel.style.zIndex = "9999";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.gap = "6px";
    panel.style.padding = "10px";
    panel.style.borderRadius = "8px";
    panel.style.background = "rgba(20, 20, 20, 0.75)";
    panel.style.backdropFilter = "blur(6px)";
    panel.style.fontFamily = "system-ui, sans-serif";
    panel.style.fontSize = "11px";
    panel.style.color = "#fff";

    const title = document.createElement("div");
    title.textContent = "Fire FPS test (temp)";
    title.style.fontWeight = "600";
    title.style.marginBottom = "2px";
    panel.appendChild(title);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "6px";
    panel.appendChild(row);

    const buttons: HTMLButtonElement[] = [];

    function paintActive(active: number): void {
        buttons.forEach((btn, i) => {
            const isActive = OPTIONS[i] === active;
            btn.style.background = isActive ? "#007bff" : "#373c4b";
        });
    }

    for (const fps of OPTIONS) {
        const btn = document.createElement("button");
        btn.textContent = `${fps} fps`;
        btn.style.cursor = "pointer";
        btn.style.border = "none";
        btn.style.borderRadius = "4px";
        btn.style.padding = "6px 10px";
        btn.style.color = "#fff";
        btn.style.fontSize = "11px";
        btn.style.fontWeight = "600";
        btn.addEventListener("click", () => {
            setSpriteFps(fps);
            paintActive(fps);
        });
        buttons.push(btn);
        row.appendChild(btn);
    }

    paintActive(SPRITE_FPS);
    document.body.appendChild(panel);
}

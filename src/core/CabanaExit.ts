/**
 * CabanaExit.ts — on-screen exit button for the cabana (tent) interior.
 *
 * While inside the cabana the interior view fills the screen with a very narrow
 * FOV, so there's no "outside" to click to leave. This bottom-centre door/exit
 * button steps the camera out one level each press:
 *   - inside the nested phone zoom → back to the cabana room
 *   - in the cabana room          → back outside
 *
 * DOM-only (like CoinTooltip). Wired from main.ts: Start() once, Update() each frame.
 */

import { isCabanaZoomActive, isPhoneZoomActive, zoomOutFromPhone, zoomOutFromCabana } from './Control';

let _btn: HTMLButtonElement | null = null;
let _visible = false;

// Lucide "log-out" glyph — a doorway with an arrow stepping out.
const EXIT_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
     fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
  <polyline points="16 17 21 12 16 7"/>
  <line x1="21" x2="9" y1="12" y2="12"/>
</svg>`;

export function Start(): void {
    if (_btn) return;
    _btn = document.createElement('button');
    _btn.className = 'cabana-exit-btn';
    _btn.type = 'button';
    _btn.setAttribute('aria-label', 'Exit');
    _btn.innerHTML = EXIT_ICON;

    _btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();   // don't let the click reach the canvas zoom handlers
    });
    _btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Step out one level: phone (inner) first, then the cabana itself.
        if (isPhoneZoomActive()) {
            zoomOutFromPhone();
        } else if (isCabanaZoomActive()) {
            zoomOutFromCabana();
        }
    });

    document.body.appendChild(_btn);
}

export function Update(): void {
    if (!_btn) return;
    const shouldShow = isCabanaZoomActive();
    if (shouldShow === _visible) return;   // no DOM churn when unchanged
    _visible = shouldShow;
    _btn.classList.toggle('cabana-exit-btn--visible', shouldShow);
}

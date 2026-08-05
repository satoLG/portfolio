/**
 * CoinTooltip — hover / tap tooltip for the three chest coins, rendered as a
 * CSS3D panel floating in the scene ABOVE the coin (see effects/CSS3DPanel).
 *
 * It exists at the coin's world position, billboards to face the camera and is
 * composited into the scene (fish/geometry pass in front of and behind it).
 *
 * Desktop : hovering a coin shows the tooltip; clicking the coin opens the link
 *           (the panel is a non-interactive label — the canvas stays live so
 *           coin hovers keep tracking).
 * Mobile  : tapping the coin shows the tooltip; the panel is modal (grabs the
 *           pointer) so tapping IT opens the link; tapping elsewhere closes it.
 */

import { CSS3DPanel } from '../effects/CSS3DPanel';

/** True on primary-touch devices (checked once at module load). */
export const IS_TOUCH_DEVICE: boolean =
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);

// ─── linked coin data ────────────────────────────────────────────────────────

const EXTERNAL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"
  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
  stroke-linecap="round" stroke-linejoin="round" class="ct-external">
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
</svg>`;

const COINS = [
    {
        name: 'LinkedIn',
        href: 'https://www.linkedin.com/in/leonardo-gutierrez-sato/',
        color: '#0A66C2',
        // simple-icons path
        path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
    },
    {
        name: 'GitHub',
        href: 'https://github.com/satoLG',
        color: '#181717',
        path: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
    },
    {
        name: 'Gmail',
        href: 'mailto:leonardogsato@gmail.com',
        color: '#EA4335',
        path: 'M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.147C21.69 2.28 24 3.434 24 5.457z',
    },
] as const;

// World-space vertical offset so the pill floats above the coin. The chest zoom
// is telephoto (~fov 27), so a small world offset reads as a big screen gap —
// nudge this if the pill sits too close to / too far from the coin.
const TOOLTIP_Y_OFFSET = 0.18;
// Bigger = smaller pill in-scene. High value on purpose: the DOM is authored
// large (see the .css3d-panel-content #coin-tooltip rules — a "supersample" so
// the raster stays crisp) and scaled DOWN into the scene, which is what makes it
// sharp instead of upscaled/blurry. Tweak this to resize the pill.
const TOOLTIP_PX_PER_UNIT = 2200;

// ─── DOM / panel ───────────────────────────────────────────────────────────────

let _panel:      CSS3DPanel | null = null;
let _iconEl:     HTMLDivElement | null = null;
let _nameEl:     HTMLSpanElement | null = null;
let _visibleIdx: number = -1;

function _ensurePanel(): CSS3DPanel {
    if (_panel) return _panel;

    _panel = new CSS3DPanel({
        pxPerUnit: TOOLTIP_PX_PER_UNIT,
        radiusPx: 34,   // matches the supersized .ct-body border-radius (CSS)
        // Touch: modal so tapping the pill opens the link. Desktop: the coin
        // click already opens the link, so keep the scene interactive.
        modal: IS_TOUCH_DEVICE,
        maskPad: 16,
        // Matches the fixed #coin-tooltip width in CSS (explicit width is what
        // makes the pill measurable inside the CSS3D preserve-3d subtree — an
        // intrinsically-sized element collapses there).
        initialSize: { w: 380, h: 116 },
        transparent: true,
        // Punch ONE region = the whole pill (.ct-body). Its solid fill + rounded
        // corners + content show; the scene shows around it.
        inkBounds: true,
        inkSelectors: ['.ct-body'],
        inkPad: 4,
        inkRadius: 34,
        inkBorderBand: 0,
        connector: true,   // thin 3D line down to the coin
    });

    const body = document.createElement('div');
    body.id = 'coin-tooltip';
    body.innerHTML = `
        <div class="ct-body">
            <div class="ct-icon"></div>
            <span class="ct-name"></span>
            ${EXTERNAL_ICON}
        </div>
    `;
    _panel.content.appendChild(body);

    _iconEl = body.querySelector('.ct-icon');
    _nameEl = body.querySelector('.ct-name');

    // Clicking / tapping the tooltip opens the link (touch path; harmless on desktop).
    body.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (_visibleIdx < 0) return;
        window.open(COINS[_visibleIdx].href, '_blank', 'noopener,noreferrer');
    });

    return _panel;
}

function _setContent(idx: number): void {
    const c = COINS[idx];
    if (_iconEl) {
        _iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path fill="${c.color}" d="${c.path}"/>
        </svg>`;
    }
    if (_nameEl) _nameEl.textContent = c.name;
}

// ─── public API ──────────────────────────────────────────────────────────────

/** Show the tooltip anchored at the coin's WORLD position (wx,wy,wz). */
export function showCoinTooltip(idx: number, wx: number, wy: number, wz: number): void {
    const panel = _ensurePanel();
    _visibleIdx = idx;
    _setContent(idx);
    _anchor(panel, wx, wy, wz);
    panel.open();
    // Moving straight from one coin to another swaps the icon + name on an
    // already-open pill: no pop animation runs, so nothing else would nudge the
    // CSS3D layer into re-rasterising the new content.
    panel.requestRepaint();
}

/** Call every frame to keep the panel anchored as the coin bobs. */
export function repositionCoinTooltip(wx: number, wy: number, wz: number): void {
    if (_visibleIdx < 0 || !_panel) return;
    _anchor(_panel, wx, wy, wz);
}

/** Position above the coin + drive the connector line (down to the coin) and
 *  its colour (matches the ink fill: black in day mode, white at night). */
function _anchor(panel: CSS3DPanel, wx: number, wy: number, wz: number): void {
    panel.setWorldPosition(wx, wy + TOOLTIP_Y_OFFSET, wz);
    panel.setConnectorTarget(wx, wy, wz);
    panel.setConnectorColor(document.body.classList.contains('day-mode') ? 0x000000 : 0xffffff);
}

export function hideCoinTooltip(): void {
    if (_visibleIdx < 0 || !_panel) return;
    _visibleIdx = -1;
    _panel.close();
}

export function isCoinTooltipVisible(): boolean { return _visibleIdx >= 0; }
export function getCoinTooltipIdx():    number  { return _visibleIdx; }
export function openCoinLink(idx: number): void {
    window.open(COINS[idx].href, '_blank', 'noopener,noreferrer');
}

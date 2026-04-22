/**
 * CoinTooltip — hover / tap tooltip for the three chest coins.
 *
 * Desktop : hovers show the tooltip; clicking the coin opens the link directly.
 * Mobile  : tapping the coin shows the tooltip; tapping the tooltip opens the
 *           link; tapping anywhere else closes it.
 */

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

// ─── DOM ─────────────────────────────────────────────────────────────────────

let _el:         HTMLDivElement | null = null;
let _iconEl:     HTMLDivElement | null = null;
let _nameEl:     HTMLSpanElement | null = null;
let _visibleIdx: number = -1;
let _hideTimer:  ReturnType<typeof setTimeout> | null = null;

function _ensureDOM(): HTMLDivElement {
    if (_el) return _el;

    _el = document.createElement('div');
    _el.id = 'coin-tooltip';
    _el.innerHTML = `
        <div class="ct-body">
            <div class="ct-icon"></div>
            <span class="ct-name"></span>
            ${EXTERNAL_ICON}
        </div>
    `;
    document.body.appendChild(_el);

    _iconEl = _el.querySelector('.ct-icon');
    _nameEl = _el.querySelector('.ct-name');

    // Clicking / tapping the tooltip opens the link
    _el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (_visibleIdx < 0) return;
        window.open(COINS[_visibleIdx].href, '_blank', 'noopener,noreferrer');
    });

    return _el;
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

function _place(coinX: number, coinY: number): void {
    if (!_el) return;
    // Vertical gap between tail tip and coin centre
    const GAP      = 40;
    const TAIL_H   = 12;   // visual tail height in px  (keep in sync with CSS)
    const PAD      = 8;    // minimum viewport edge margin

    const w = _el.offsetWidth;
    const h = _el.offsetHeight;   // body height only (tail is outside flow)

    // Default: centre tooltip horizontally on the coin
    let left = coinX - w / 2;
    const top  = coinY - h - TAIL_H - GAP;

    // Clamp to viewport
    const clampedLeft = Math.max(PAD, Math.min(window.innerWidth - w - PAD, left));

    // Keep the tail pin aligned with the actual coin X
    const tailX = Math.max(12, Math.min(w - 12, coinX - clampedLeft));

    _el.style.left = `${clampedLeft}px`;
    _el.style.top  = `${top}px`;
    _el.style.setProperty('--tail-x', `${tailX}px`);
}

// ─── public API ──────────────────────────────────────────────────────────────

export function showCoinTooltip(idx: number, coinX: number, coinY: number): void {
    const el = _ensureDOM();

    if (_hideTimer !== null) { clearTimeout(_hideTimer); _hideTimer = null; }

    _visibleIdx = idx;
    _setContent(idx);

    // Show + measure before placing
    el.classList.remove('ct-out', 'ct-visible');
    el.style.display = 'block';

    requestAnimationFrame(() => {
        _place(coinX, coinY);
        el.classList.add('ct-visible');
    });
}

/** Call every frame to keep the tail anchored as the scene animates. */
export function repositionCoinTooltip(coinX: number, coinY: number): void {
    if (_visibleIdx < 0) return;
    _place(coinX, coinY);
}

export function hideCoinTooltip(): void {
    if (!_el || _visibleIdx < 0) return;
    _visibleIdx = -1;
    _el.classList.remove('ct-visible');
    _el.classList.add('ct-out');
    _hideTimer = setTimeout(() => {
        if (_el && _visibleIdx < 0) {
            _el.style.display = 'none';
            _el.classList.remove('ct-out');
        }
        _hideTimer = null;
    }, 200);
}

export function isCoinTooltipVisible(): boolean { return _visibleIdx >= 0; }
export function getCoinTooltipIdx():    number  { return _visibleIdx; }
export function openCoinLink(idx: number): void {
    window.open(COINS[idx].href, '_blank', 'noopener,noreferrer');
}

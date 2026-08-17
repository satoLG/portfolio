// ============================================
// NOTICE BOARD SLIDES — what the notice's carousel pages through
// ============================================
//
// Data + artwork only, deliberately free of the CSS3D plumbing that displays it
// (NoticeBoardPanel.ts). Keeping the split means the slides can be rendered and
// eyeballed in a plain page at their design size, without dragging the whole
// scene in behind them.

import { t } from '../core/i18n';

// ── Slides ───────────────────────────────────────────────────────────────────
// Body copy lives in i18n; only the structure and the artwork are here.

const WARNING_MARK = `
<svg class="nb-mark" viewBox="0 0 64 58" aria-hidden="true">
  <path d="M32 4 L61 54 H3 Z" fill="#c8562f" stroke="#7d2f1c" stroke-width="5"
        stroke-linejoin="round"/>
  <rect x="28.5" y="20" width="7" height="19" rx="3.5" fill="#f8efd8"/>
  <circle cx="32" cy="45" r="4" fill="#f8efd8"/>
</svg>`;

// The inspiration slide shows the real thing: a screenshot of Rayman Legends'
// "The Mysterious Inflatable Island", credited on the slide itself and in the
// credits modal. Drop the file at the path below (see ISLAND_SHOT_SRC).
//
// Until that file exists the slide falls back to a drawn stand-in — a round
// island on a float, its waterline, the chain down to an anchor, a shoal
// underneath. That keeps the notice from ever showing a broken image, and it
// means adding the screenshot later is purely a matter of dropping the file in:
// no code change, the <img> simply stops erroring.
const ISLAND_SHOT_SRC = 'images/inspiration/rayman-inflatable-island.webp';

const ISLAND_FALLBACK = `
<svg class="nb-mark-drawn" viewBox="0 0 132 72" aria-hidden="true">
  <defs>
    <clipPath id="nb-island-frame"><rect x="1" y="1" width="130" height="70" rx="8"/></clipPath>
  </defs>
  <g clip-path="url(#nb-island-frame)">
    <rect x="0" y="0" width="132" height="72" fill="#c3e6f0"/>
    <circle cx="108" cy="15" r="9" fill="#f7e6a8" opacity="0.85"/>
    <rect x="0" y="38" width="132" height="34" fill="#4fa3bd"/>

    <path d="M66 50 V66" stroke="#26697c" stroke-width="2"/>
    <path d="M59 66 h14" stroke="#26697c" stroke-width="2" stroke-linecap="round"/>
    <path d="M66 70 a6 6 0 0 1 -7 -5" fill="none" stroke="#26697c" stroke-width="2"/>
    <path d="M66 70 a6 6 0 0 0 7 -5" fill="none" stroke="#26697c" stroke-width="2"/>

    <g fill="#26697c" opacity="0.5">
      <path d="M27 53 l6 -3 v6 z"/><path d="M39 62 l5 -2.5 v5 z"/>
      <path d="M99 51 l-6 -3 v6 z"/><path d="M88 61 l-5 -2.5 v5 z"/>
    </g>

    <ellipse cx="66" cy="41" rx="29" ry="11" fill="#2f7f96"/>
    <ellipse cx="66" cy="36" rx="32" ry="10" fill="#7fd0d6"/>
    <ellipse cx="66" cy="34" rx="26" ry="8" fill="#a8e4e0"/>
    <path d="M44 33 a22 13 0 0 1 44 0 z" fill="#e8c86a"/>
    <path d="M52 28 a14 9 0 0 1 28 0 z" fill="#f2dc93"/>
    <path d="M66 27 v-11" stroke="#7a4c2b" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M66 16 l10 3.5 -10 3.5 z" fill="#c8562f"/>
  </g>
  <rect x="1" y="1" width="130" height="70" rx="8" fill="none"
        stroke="#8d3a2c" stroke-width="2" opacity="0.5"/>
</svg>`;

// Flipped the first time the screenshot 404s. Without it every re-render (a
// language switch, paging back to this slide) issues the same doomed request
// and prints another console error.
let _shotMissing = false;

function islandMark(): string {
    const img = _shotMissing ? '' : `<img class="nb-shot" src="${ISLAND_SHOT_SRC}" alt="">`;
    return `<div class="nb-figure${_shotMissing ? ' nb-figure-missing' : ''}">${img}${ISLAND_FALLBACK}</div>`;
}

const LOST_MARK = `
<svg class="nb-mark" viewBox="0 0 64 58" aria-hidden="true">
  <path d="M32 3 L38 15 V33 H26 V15 Z" fill="#ccd2da" stroke="#828b98"
        stroke-width="2.2" stroke-linejoin="round"/>
  <rect x="16" y="33" width="32" height="5.5" rx="2.75" fill="#8d6a3a"/>
  <rect x="28.5" y="38" width="7" height="12" rx="3.5" fill="#5c4433"/>
  <circle cx="32" cy="52" r="4.2" fill="#8d6a3a"/>
</svg>`;

interface Slide {
    /** Inline artwork above the copy. A function when it depends on state that
     *  can change after module load (the screenshot's presence). */
    mark: string | (() => string);
    /** i18n keys. `lines` renders one <p> each. */
    titleKey: string;
    lineKeys: string[];
    signKey: string;
    /** Extra class on the slide root, for per-slide styling. */
    cls?: string;
}

const SLIDES: Slide[] = [
    {
        mark: WARNING_MARK,
        titleKey: 'board.warn.title',
        lineKeys: ['board.warn.line1', 'board.warn.line2'],
        signKey: 'board.warn.sign',
    },
    {
        mark: islandMark,
        titleKey: 'board.island.title',
        lineKeys: ['board.island.line1', 'board.island.line2'],
        signKey: 'board.island.sign',
        cls: 'nb-slide-island',
    },
    {
        mark: LOST_MARK,
        titleKey: 'board.lost.title',
        lineKeys: ['board.lost.line1', 'board.lost.line2'],
        signKey: 'board.lost.sign',
        cls: 'nb-slide-lost',
    },
];

export const SLIDE_COUNT = SLIDES.length;

/** Extra class for the stage element, so a slide can adjust its own type scale. */
export function slideClass(i: number): string {
    return SLIDES[i]?.cls ?? '';
}

/**
 * Wire up anything the markup cannot express on its own. Today that is the
 * inspiration screenshot: if the file is not in public/, swap in the drawn
 * fallback. Done with a listener rather than an inline onerror attribute so it
 * survives a Content-Security-Policy that forbids inline handlers.
 *
 * Call once after each render — `complete && naturalWidth === 0` covers the case
 * where the image already failed before the listener was attached (a cached
 * 404), which a bare 'error' listener would miss.
 */
export function wireSlide(stage: HTMLElement): void {
    const fig = stage.querySelector<HTMLElement>('.nb-figure');
    const img = fig?.querySelector<HTMLImageElement>('.nb-shot');
    if (!fig || !img) return;
    const fail = () => { _shotMissing = true; fig.classList.add('nb-figure-missing'); };
    img.addEventListener('error', fail, { once: true });
    if (img.complete && img.naturalWidth === 0) fail();
}

/** The slide's inner markup, translated into the current language. */
export function buildSlideHTML(i: number): string {
    const s = SLIDES[i];
    if (!s) return '';
    return `
        ${typeof s.mark === 'function' ? s.mark() : s.mark}
        <h3 class="nb-title">${t(s.titleKey)}</h3>
        ${s.lineKeys.map(k => `<p class="nb-line">${t(k)}</p>`).join('')}
        <p class="nb-sign">${t(s.signKey)}</p>
    `;
}

// ============================================
// NOTICE BOARD PANEL — the notice itself, as live DOM pinned to the board
// ============================================
//
// The paper on the board is a CSS3DPanel rather than a texture: it punches a
// hole in the WebGL canvas exactly over the planks and shows real DOM through
// it, with a lit glass pane hung in front so the flat HTML still answers to the
// scene's light (midday vs. campfire at night). See effects/CSS3DPanel.ts.
//
// It is a carousel, but deliberately not the card kind — there is one stage in
// the middle and an arrow at each end of the strip. Each press swaps what the
// stage is showing.
//
// INTERACTIVITY IS GATED ON THE ZOOM, and that is the whole reason setModal
// exists on CSS3DPanel. A panel that wants the pointer forces the canvas to
// pointer-events:none, which would kill every other interaction in the scene
// (radio, pug, apples, the board's own click-to-zoom) for as long as the notice
// is on screen — which is always. So the notice is READABLE the whole time and
// only becomes CLICKABLE once the camera has flown in:
//
//   not zoomed → non-modal. The canvas owns the pointer; clicking the notice
//                raycasts the planks behind it and starts the zoom.
//   zoomed     → modal. The arrows take clicks, and a click anywhere else lands
//                on the CSS layer and backs the camera out through the
//                outside-click hook.

import { CSS3DPanel } from '../effects/CSS3DPanel';
import { setNoticeBoardFocus, isNoticeBoardFocused, getNoticeBoardFocusKey } from '../core/Control';
import { onLanguageChange } from '../core/i18n';
import { SLIDE_COUNT, buildSlideHTML, slideClass, wireSlide } from './NoticeBoardSlides';

// Design size of the hosted DOM, in CSS px. The panel's world size comes from
// px-per-world-unit, so these two numbers set the notice's aspect ratio and its
// text-to-paper proportions; the on-screen size is set by the board.
const DESIGN_W = 360;
const DESIGN_H = 282;

const CHEVRON = (dir: 'l' | 'r') => `
<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="${dir === 'l' ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19'}"
        fill="none" stroke="currentColor" stroke-width="3.2"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/** Paper shading, mutable so the debug GUI can dial it against the real sky.
 *  "Readable at night but clearly night" is a judgement that can only be made
 *  on screen, against the campfire. */
export const noticePaperConfig = {
    shade: 0.66,   // how dark the sheet may go with no light at all
    gain:  1.15,   // multiplier on measured light before it is inverted
};

// ── State ────────────────────────────────────────────────────────────────────

let _panel: CSS3DPanel | null = null;
let _stage: HTMLDivElement | null = null;
let _index = 0;
let _modal = false;
let _onExit: ((e?: PointerEvent) => void) | null = null;
/** The panel's own world rectangle, refreshed every frame. Clicking the sheet
 *  frames THIS — a second, closer step inside the board zoom, because the board
 *  zoom fits the whole board and leaves one sheet on it too small to read. */
const _rect = { x: 0, y: 0, z: 0, rotY: 0, w: 0, h: 0 };

/** Register what a click outside the notice should do while it is zoomed
 *  (Island wires this to the board's zoom-out). */
export function setNoticeBoardExit(cb: (e?: PointerEvent) => void): void {
    _onExit = cb;
}

function _renderSlide(): void {
    if (!_stage || !_panel) return;
    _stage.className = `nb-stage ${slideClass(_index)}`;
    _stage.innerHTML = buildSlideHTML(_index);
    wireSlide(_stage);
    // The CSS3D subtree is composited behind the canvas, so a content swap on a
    // static camera is exactly the case Chrome serves from stale raster tiles —
    // the new slide would simply not appear. Force the invalidation.
    _panel.requestRepaint();
}

function _step(delta: number): void {
    _index = (_index + delta + SLIDE_COUNT) % SLIDE_COUNT;
    _renderSlide();
}

function _ensurePanel(): CSS3DPanel {
    if (_panel) return _panel;

    _panel = new CSS3DPanel({
        // Overwritten every frame from the region's live world width (see sync).
        pxPerUnit: DESIGN_W,
        initialSize: { w: DESIGN_W, h: DESIGN_H },
        modal: false,          // flipped on only while the board zoom is active
        maskPad: 10,
        // Punch one rounded rect around the whole notice: the paper's own fill
        // and border show, and the planks show around it.
        transparent: true,
        inkBounds: true,
        inkSelectors: ['.nb-note'],
        // NEGATIVE pad: the hole is punched three pixels INSIDE the paper.
        //
        // A hole the same size as its DOM is the bug that leaves a hairline of
        // page background all round the sheet — the mask edge is antialiased and
        // the punch reaches a fraction past where the paper actually paints. The
        // media player never had it because its ink selectors are inner elements
        // and inkPad grows outward INTO the panel's own fill, so the hole always
        // lands strictly inside something opaque. Same idea from the other
        // direction: shrink the hole instead of growing it. The sheet's outer
        // 3px is then behind the canvas, so its visible edge is the inset rule
        // below it in the CSS.
        inkPad: -3,
        inkRadius: 8,
        inkBorderBand: 0,
        // A sheet of paper nailed to a board, not a screen: 'paper' makes the
        // pane in front MULTIPLY the DOM by the light it measures, so the notice
        // actually goes dim at dusk and warms up when the campfire throws light
        // on the trunk. 'gloss' could only ever add a highlight on top.
        glass: true,
        glassMode: 'paper',
        glassRoughness: 0.96,     // matte — no specular sliding across a page
        paperShadeStrength: noticePaperConfig.shade,
        paperLightGain: noticePaperConfig.gain,
    });

    // .nb-host exists purely so .nb-note is a DESCENDANT of the hosted element.
    // CSS3DPanel resolves inkSelectors with panelEl.querySelectorAll(), which
    // only ever looks at descendants — pointing an ink selector at the hosted
    // element itself matches nothing, no boxes get punched, and the canvas stays
    // opaque over DOM that is technically there but permanently invisible.
    const host = document.createElement('div');
    host.className = 'nb-host';
    host.innerHTML = `
        <div class="nb-note">
            <button class="nb-arrow nb-arrow-prev" type="button">${CHEVRON('l')}</button>
            <div class="nb-stage"></div>
            <button class="nb-arrow nb-arrow-next" type="button">${CHEVRON('r')}</button>
        </div>
    `;
    _panel.content.appendChild(host);
    const note = host.querySelector<HTMLElement>('.nb-note')!;
    _stage = note.querySelector('.nb-stage');

    const arrow = (sel: string, delta: number) => {
        const el = note.querySelector<HTMLButtonElement>(sel)!;
        el.addEventListener('click', (e) => {
            e.stopPropagation();   // never reads as "clicked outside" → no zoom-out
            _step(delta);
        });
    };
    arrow('.nb-arrow-prev', -1);
    arrow('.nb-arrow-next', +1);

    // Clicking the paper itself (not an arrow) does nothing — but it must not
    // bubble out and back the camera out either, or the notice would be
    // impossible to read without dismissing it.
    // Clicking the paper (not an arrow) studies it. The arrows stop propagation
    // of their own, so paging never changes the framing.
    // Same rule as the badge sheet next door: click me to study me, click me
    // while something else is framed and that counts as clicking outside it.
    // The arrows stop propagation of their own, so paging never reframes.
    _stage!.addEventListener('click', (e) => {
        e.stopPropagation();
        const focused = getNoticeBoardFocusKey();
        if (focused === null) setNoticeBoardFocus({ key: 'slides', ..._rect });
        else if (focused !== 'slides') setNoticeBoardFocus(null);
    });

    _panel.setOnOutsideClick((e) => { _onExit?.(e); });
    onLanguageChange(() => _renderSlide());
    _renderSlide();

    return _panel;
}

/**
 * Per-frame sync, driven from Island.Update.
 *
 * @param shown      board is on screen (above water, outside the cabana) — the
 *                   notice is readable whenever this is true
 * @param zoomed     the board zoom is active → the arrows become clickable
 * @param wx/wy/wz   world position of the notice's centre
 * @param worldW     the region's live width in world units, so the notice keeps
 *                   its size relative to the planks when the board is resized
 * @param boardRotY  the board's yaw. The notice is pinned to it rather than
 *                   billboarded — it is nailed to the wood, so it turns with the
 *                   wood and with nothing else.
 */
export function syncNoticeBoardPanel(
    shown: boolean,
    zoomed: boolean,
    wx: number, wy: number, wz: number,
    worldW: number,
    worldH: number,
    boardRotY: number,
): void {
    // Nothing to do — and nothing to build — until the board is first on screen.
    if (!shown && !_panel) return;

    const panel = _ensurePanel();

    if (!shown) {
        if (panel.isOpen()) panel.close();
        if (_modal) { _modal = false; panel.setModal(false); }
        return;
    }

    _rect.x = wx; _rect.y = wy; _rect.z = wz;
    _rect.rotY = boardRotY; _rect.w = worldW; _rect.h = worldH;

    panel.setPaper(noticePaperConfig.shade, noticePaperConfig.gain);
    panel.setFixedYaw(boardRotY);
    panel.setWorldPosition(wx, wy, wz);
    if (worldW > 0) panel.setPxPerUnit(DESIGN_W / worldW);
    if (!panel.isOpen()) panel.open();

    if (zoomed !== _modal) {
        _modal = zoomed;
        panel.setModal(zoomed);
        // The arrows only get their hover/press affordance while they are live.
        panel.content.classList.toggle('nb-interactive', zoomed);
        panel.requestRepaint();
    }
}

/** Which slide is showing — for the debug GUI. */
export function getNoticeSlide(): number { return _index; }
export function setNoticeSlide(i: number): void {
    _index = ((i % SLIDE_COUNT) + SLIDE_COUNT) % SLIDE_COUNT;
    _renderSlide();
}
export function getNoticeSlideCount(): number { return SLIDE_COUNT; }

// ============================================
// ACHIEVEMENTS PANEL — the badge sheet, top-left of the board
// ============================================
//
// Same construction as the notice next to it: a CSS3DPanel in 'paper' mode, so
// it is live DOM punched through the canvas with a lit pane in front that
// multiplies it by the scene's light. No carousel — one sheet, six badges
// scattered across it.
//
// THE REVEAL IS THE POINT. Achievements are earned out in the world, hours
// before the visitor walks back to the board. If the sheet simply rendered
// current state, arriving would mean finding the work already done — a status
// screen. Instead the sheet only ever shows what has been REVEALED, and the
// first zoom after earning something plays it in: each pending badge pops from
// grey to lit, one after another, with its own note in a rising run.
//
// The sequence is committed (markRevealed) only as each badge actually
// animates, so a zoom that gets interrupted halfway leaves the rest pending for
// next time rather than quietly spending them.

import { CSS3DPanel } from '../effects/CSS3DPanel';
import { setNoticeBoardFocus, getNoticeBoardFocusKey, isNoticeBoardZoomActive } from '../core/Control';
import { t, onLanguageChange } from '../core/i18n';
import { ACHIEVEMENTS, getPendingReveals, isUnlocked, markRevealed, type AchievementId } from '../core/Achievements';
import { ACHIEVEMENT_ART } from '../core/AchievementArt';
import { playAchievementReveal } from '../core/Audio';
import { noticePaperConfig } from './NoticeBoardPanel';

const DESIGN_W = 360;
const DESIGN_H = 282;

/** Gap between one badge lighting up and the next. Long enough to read as
 *  separate events, short enough that six of them is still a moment and not a
 *  cutscene. */
const REVEAL_STAGGER_MS = 260;
/** Matches the .ach-badge-reveal animation in style.css. */
const REVEAL_ANIM_MS = 620;

let _panel: CSS3DPanel | null = null;
let _sheet: HTMLDivElement | null = null;
let _modal = false;
let _onExit: ((e?: PointerEvent) => void) | null = null;
/** The panel's own world rectangle, refreshed every frame. Clicking the sheet
 *  frames THIS — a second, closer step inside the board zoom, because the board
 *  zoom fits the whole board and leaves one sheet on it too small to read. */
const _rect = { x: 0, y: 0, z: 0, rotY: 0, w: 0, h: 0 };
/** Ids currently painted as lit. Starts as "everything already revealed" and
 *  grows as the reveal sequence runs — never read straight from isUnlocked, or
 *  the pop would be over before it started. */
let _shown = new Set<AchievementId>();
let _revealTimers: number[] = [];
let _wasZoomed = false;

export function setAchievementsExit(cb: (e?: PointerEvent) => void): void {
    _onExit = cb;
}

function _badgeHTML(): string {
    return ACHIEVEMENTS.map(a => `
        <div class="ach-badge ${_shown.has(a.id) ? 'ach-badge-lit' : ''}"
             data-ach="${a.id}"
             style="left:${a.x}%; top:${a.y}%; --ach-rot:${a.rot}deg;"
             title="${t(a.titleKey)} — ${t(a.descKey)}">
            <div class="ach-badge-art">${ACHIEVEMENT_ART[a.id] ?? ''}</div>
        </div>`).join('');
}

function _render(): void {
    if (!_sheet || !_panel) return;
    _sheet.innerHTML = `
        <h3 class="ach-title">${t('ach.panel.title')}</h3>
        <div class="ach-field">${_badgeHTML()}</div>
        <p class="ach-count">${_shown.size} / ${ACHIEVEMENTS.length}</p>`;
    _panel.requestRepaint();
}

function _cancelReveals(): void {
    for (const id of _revealTimers) clearTimeout(id);
    _revealTimers = [];
}

/**
 * Play the pending badges in, one after another.
 *
 * Each step marks its own badge revealed as it fires rather than marking the
 * whole batch up front: leaving the zoom mid-sequence should cost the visitor
 * only what they actually saw.
 */
function _playReveals(): void {
    _cancelReveals();
    const pending = getPendingReveals();
    if (pending.length === 0) return;

    pending.forEach((id, i) => {
        const timer = window.setTimeout(() => {
            _shown.add(id);
            markRevealed([id]);
            const el = _sheet?.querySelector<HTMLElement>(`[data-ach="${id}"]`);
            if (el) {
                el.classList.add('ach-badge-lit', 'ach-badge-reveal');
                // Drop the animation class once it has played so a later render
                // (a language switch) does not replay it.
                window.setTimeout(() => el.classList.remove('ach-badge-reveal'), REVEAL_ANIM_MS);
            }
            const count = _sheet?.querySelector('.ach-count');
            if (count) count.textContent = `${_shown.size} / ${ACHIEVEMENTS.length}`;
            playAchievementReveal(i);
            _panel?.requestRepaint();
        }, i * REVEAL_STAGGER_MS);
        _revealTimers.push(timer);
    });
}

function _ensurePanel(): CSS3DPanel {
    if (_panel) return _panel;

    // Anything already revealed in a previous visit is simply lit on arrival —
    // only what is pending gets the animation.
    _shown = new Set(ACHIEVEMENTS.map(a => a.id).filter(id => isUnlocked(id) && !getPendingReveals().includes(id)));

    _panel = new CSS3DPanel({
        pxPerUnit: DESIGN_W,
        initialSize: { w: DESIGN_W, h: DESIGN_H },
        modal: false,
        maskPad: 10,
        transparent: true,
        inkBounds: true,
        inkSelectors: ['.ach-sheet'],
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
        glass: true,
        glassMode: 'paper',
        glassRoughness: 0.96,
        paperShadeStrength: noticePaperConfig.shade,
        paperLightGain: noticePaperConfig.gain,
    });

    // .ach-host exists so .ach-sheet is a DESCENDANT of the hosted element —
    // CSS3DPanel resolves ink selectors with querySelectorAll, which never
    // matches the host itself. See the same note in NoticeBoardPanel.
    const host = document.createElement('div');
    host.className = 'ach-host';
    host.innerHTML = `<div class="ach-sheet"></div>`;
    _panel.content.appendChild(host);
    _sheet = host.querySelector('.ach-sheet');

    // Clicking the sheet studies it. stopPropagation either way, so the click
    // never reaches the board's click-away and drops the camera out entirely.
    // Clicking THIS sheet studies it. Clicking it while a DIFFERENT one is
    // framed counts as clicking outside that one, so it steps back to the board
    // — the rule is the same wherever the click lands: outside the framed thing
    // means back to the board, and only outside the board leaves the zoom.
    // stopPropagation either way, so the board's own click-away never also runs.
    _sheet!.addEventListener('click', (e) => {
        e.stopPropagation();
        // Nothing on the board does anything from outside its zoom.
        if (!isNoticeBoardZoomActive()) return;
        const focused = getNoticeBoardFocusKey();
        if (focused === null) setNoticeBoardFocus({ key: 'achievements', ..._rect });
        else if (focused !== 'achievements') setNoticeBoardFocus(null);
    });
    _panel.setOnOutsideClick((e) => { _onExit?.(e); });
    onLanguageChange(() => _render());
    _render();

    return _panel;
}

/**
 * Per-frame sync, driven from Island.Update.
 *
 * @param shown   the board is on screen
 * @param zoomed  the board zoom is active. The RISING EDGE of this is what
 *                starts the reveal sequence.
 * @param interactive whether this panel may hold the pointer. Separate from
 *                `zoomed` because a post-it being placed needs the canvas back:
 *                a modal panel sets canvas pointer-events:none, and placement is
 *                built entirely on raycasting the canvas.
 * @param worldW  the region's width in world units
 * @param rotY    the board's yaw — pinned, never billboarded
 */
export function syncAchievementsPanel(
    shown: boolean,
    zoomed: boolean,
    interactive: boolean,
    wx: number, wy: number, wz: number,
    worldW: number,
    worldH: number,
    rotY: number,
): void {
    if (!shown && !_panel) return;
    const panel = _ensurePanel();

    if (!shown) {
        if (panel.isOpen()) panel.close();
        if (_modal) { _modal = false; panel.setModal(false); }
        _wasZoomed = false;
        _cancelReveals();
        return;
    }

    _rect.x = wx; _rect.y = wy; _rect.z = wz;
    _rect.rotY = rotY; _rect.w = worldW; _rect.h = worldH;

    panel.setPaper(noticePaperConfig.shade, noticePaperConfig.gain);
    panel.setFixedYaw(rotY);
    panel.setWorldPosition(wx, wy, wz);
    if (worldW > 0) panel.setPxPerUnit(DESIGN_W / worldW);
    if (!panel.isOpen()) panel.open();

    if (interactive !== _modal) {
        _modal = interactive;
        panel.setModal(interactive);
        panel.content.classList.toggle('ach-interactive', interactive);
        panel.requestRepaint();
    }

    // Rising edge: the visitor has just arrived at the board.
    if (zoomed && !_wasZoomed) _playReveals();
    if (!zoomed && _wasZoomed) _cancelReveals();
    _wasZoomed = zoomed;
}

/** Repaint from scratch — used by the debug GUI after resetting progress. */
export function refreshAchievementsPanel(): void {
    _shown = new Set(ACHIEVEMENTS.map(a => a.id).filter(id => isUnlocked(id) && !getPendingReveals().includes(id)));
    _cancelReveals();
    _wasZoomed = false;
    _render();
}

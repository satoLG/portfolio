/**
 * Dialog — the pug's speech, as CSS3D panels that live INSIDE the scene.
 *
 * Two panels, both built on effects/CSS3DPanel (the same technique the media
 * player and the coin tooltip use), so they are part of the world rather than
 * an overlay pasted on the frame:
 *
 *   • SPEECH  — a white sheet with the typewriter text on it, left a little
 *     see-through so the island reads through the paper (the punch stops short
 *     of erasing the canvas — see speechPunch below). It carries
 *     `glass`, the lit pane hung in front of the punch, so the sheet answers to
 *     the scene's light: warm under the midday sun, quiet at night, with the
 *     sheen sliding across as the camera moves. And `connector`, the thin 3D
 *     line that grows out of the pug up to the panel — the "fiozinho" — which is
 *     also what drives the panel's two-phase entrance (line first, then the
 *     panel bounces in). It only plays on the FIRST line of a conversation:
 *     branching into a follow-up re-uses the panel that is already open, so the
 *     thread is drawn once, when the pug starts talking.
 *
 *   • REPLIES — the player's answers, as small "inked" pills: a TRANSPARENT
 *     panel that punches one rounded pill per option, so each one reads like the
 *     underwater carousel's tab pills (the punched hole shows --ink-water, the
 *     label sits on top) — minus the wobble, which belongs to the water.
 *
 * Both anchor to the pug's WORLD position through `dialogAnchorConfig`.
 *
 * Usage:
 *   showDialog(lines, getSpeakerWorld, onComplete)
 *   advanceDialog()          — call from surrounding click handler
 *   dismissDialog()          — force-close (e.g. on zoom-out)
 *   isDialogActive() → bool
 */

import { CSS3DPanel } from '../effects/CSS3DPanel';
import { playDialogSound, playDialogAppearSound, playDialogTypeSound } from './Audio';
import { t, onLanguageChange } from './i18n';

// ─── Public types ─────────────────────────────────────────────────────────────

/** A clickable reply option shown inside the reply speech bubble. */
export interface ReplyOption {
    /** i18n translation key for the reply label */
    textKey: string;
    /** Called when the user clicks this option. The reply bubble is hidden before calling. */
    onSelect: () => void;
}

export interface DialogLine {
    /** i18n translation key — falls back to the literal string if not found */
    textKey: string;
    /** Optional audio URL to play when this line starts (relative to origin) */
    sound?: string;
    /** Called immediately when this line becomes active */
    onLineStart?: () => void;
    /** Called when the sound clip finishes playing (or immediately if no sound) */
    onLineSoundEnd?: () => void;
    /**
     * When provided, after this line finishes typing the reply bubble appears
     * with these options instead of the normal ▼ advance-prompt.
     */
    replies?: ReplyOption[];
}

/** World-space position of whoever is talking (the pug). */
export interface WorldPoint { x: number; y: number; z: number }

// ─── Placement ────────────────────────────────────────────────────────────────

/**
 * Where the two panels hang relative to the SPEAKER, in world units, plus how
 * big they are in the scene. Every value here was set by eye against the real
 * framing on a real screen — "does the box sit nicely in the empty upper-left
 * of the shot" is not a thing that can be derived — so treat them as a set:
 * moving one usually means re-judging its neighbours.
 *
 * The two px-per-unit values are sizes, and they run BACKWARDS: higher is a
 * SMALLER panel in the scene, because the DOM is authored large and scaled down
 * — which is exactly what keeps it crisp rather than upscaled (see the coin
 * tooltip's note).
 */
export const dialogAnchorConfig = {
    /** Speech panel offset from the speaker (world units) — its CENTRE. */
    speechX: -0.4100,
    speechY:  0.8300,
    speechZ: -0.2200,
    /**
     * How translucent the white sheet is, 0..1. This is the PUNCH, not a DOM
     * alpha: 1 erases the canvas outright and the panel is flat white, while
     * lower values leave that fraction of the LIVE SCENE sitting on top of the
     * DOM — the island actually showing through the paper. A DOM alpha would
     * only reveal the page background behind the canvas (--ink-water), which is
     * not what is behind the panel at all. Same knob the media player uses.
     */
    speechPunch: 0.8800,
    /**
     * Reply pills. X/Z are the list's centre; Y is its BOTTOM EDGE, measured up
     * from the pug's feet — i.e. from the island surface it is standing on.
     * Bottom-anchored on purpose: the list grows UPWARD as options are added, so
     * two replies and four replies both clear the ground by exactly this much
     * instead of the taller one sinking into it.
     */
    replyX:      -1.0500,
    replyBottomY: 0.0300,
    replyZ:      -0.0500,
    /** Panel px-per-unit — bigger = smaller panel. */
    speechPxPerUnit: 570,
    replyPxPerUnit:  450,
    /** Where on the pug the connector thread attaches (world Y above its origin). */
    connectorY: 0.1200,
};

/** Corner radius of the speech panel's punched hole — matches the CSS. */
const SPEECH_RADIUS_PX = 30;
/** Ink punch strength for the reply pills — the carousel's own value, so the
 *  pills keep the same slice of live scene sitting on the ink that its tabs do. */
const REPLY_INK_PUNCH = 0.85;
/** Design px the punched pill is dilated past its DOM box on every side. The
 *  bottom anchor has to give this back (see _syncAnchors), or replyBottomY would
 *  clear the ground by the pill's INK bottom minus this much. */
const REPLY_INK_PAD = 10;

// ─── Internal state ───────────────────────────────────────────────────────────

interface ActiveState {
    lines: DialogLine[];
    lineIdx: number;
    getSpeakerWorld: () => WorldPoint | null;
    onComplete: () => void;
    typeTimer: ReturnType<typeof setInterval> | null;
    typeIndex: number;
    isTyping: boolean;
    rafId: number;
}

let _state: ActiveState | null = null;

// ─── Panels + DOM (created once, reused) ──────────────────────────────────────

let _speechPanel: CSS3DPanel | null = null;
let _boxEl: HTMLDivElement | null = null;
let _textEl: HTMLParagraphElement | null = null;
let _promptEl: HTMLSpanElement | null = null;

let _replyPanel: CSS3DPanel | null = null;
let _replyListEl: HTMLDivElement | null = null;
let _replyActive = false;

function ensurePanels(): void {
    // ─ Speech panel ────────────────────────────────────────────────────────────
    if (!_speechPanel) {
        _speechPanel = new CSS3DPanel({
            pxPerUnit: dialogAnchorConfig.speechPxPerUnit,
            radiusPx: SPEECH_RADIUS_PX,
            // NOT modal: the canvas keeps the pointer, so a click anywhere on the
            // scene still advances the dialog through Island's click handler.
            modal: false,
            maskPad: 14,
            // Seeded so the punch + wrapper are correct from frame 1 (the DOM
            // only measures once the CSS renderer has drawn it at least once).
            initialSize: { w: 720, h: 214 },
            // Slightly see-through: the punch stops short of erasing the canvas,
            // so a little of the live island stays on top of the white sheet.
            punchAlpha: dialogAnchorConfig.speechPunch,
            // The thread out of the pug, and the two-phase entrance it drives.
            connector: true,
            // The lit pane that makes a flat white sheet belong to the scene's
            // light instead of sitting on top of it. Same numbers as the media
            // player, so the two surfaces read as the same material.
            glass: true,
            glassOpacity: 0.20,
            glassRoughness: 0.30,
        });

        _boxEl = document.createElement('div');
        _boxEl.className = 'dialog-panel';

        _textEl = document.createElement('p');
        _textEl.className = 'dialog-text';

        _promptEl = document.createElement('span');
        _promptEl.className = 'dialog-prompt';  // triangle is drawn via CSS mask

        _boxEl.appendChild(_textEl);
        _boxEl.appendChild(_promptEl);
        _speechPanel.content.appendChild(_boxEl);
        // The panel is white; so is the thread, so it reads as the sheet reaching
        // down to the pug rather than as a separate mark over the island.
        _speechPanel.setConnectorColor(0xffffff);
    }

    // ─ Reply panel ─────────────────────────────────────────────────────────────
    if (!_replyPanel) {
        _replyPanel = new CSS3DPanel({
            pxPerUnit: dialogAnchorConfig.replyPxPerUnit,
            modal: true,          // the options must be clickable DOM
            maskPad: 18,
            initialSize: { w: 560, h: 146 },
            // The list is pinned by its BOTTOM edge, so adding a third or fourth
            // option grows it upward instead of pushing the lowest pill down
            // through the island (see dialogAnchorConfig.replyBottomY).
            anchor: 'bottom',
            // Ink mode: punch ONE pill per option, nothing else. The gaps between
            // them stay canvas, so the scene shows straight through the list.
            transparent: true,
            inkBounds: false,
            inkSelectors: ['.dialog-reply-option'],
            inkPad: REPLY_INK_PAD,
            inkRadius: 999,       // clamped to half the box height → a true pill
            inkBorderBand: 0,
            punchAlpha: REPLY_INK_PUNCH,
        });

        _replyListEl = document.createElement('div');
        _replyListEl.className = 'dialog-reply-panel';
        _replyPanel.content.appendChild(_replyListEl);
    }
}

// ─── Anchoring ────────────────────────────────────────────────────────────────

function _syncAnchors(): void {
    if (!_state) return;
    const p = _state.getSpeakerWorld();
    if (!p) return;
    const c = dialogAnchorConfig;

    if (_speechPanel) {
        _speechPanel.setWorldPosition(p.x + c.speechX, p.y + c.speechY, p.z + c.speechZ);
        // The thread runs down into the pug (its head, not its feet).
        _speechPanel.setConnectorTarget(p.x, p.y + c.connectorY, p.z);
    }
    if (_replyPanel) {
        // Bottom-anchored: the Y handed over is the panel's BOTTOM EDGE, lifted by
        // the ink dilation so what actually clears the ground by replyBottomY is
        // the lowest PILL, not the invisible DOM box it was punched from. Whatever
        // the option count, that bottom stays where it is and the list grows up.
        const inkLift = REPLY_INK_PAD / c.replyPxPerUnit;
        _replyPanel.setWorldPosition(
            p.x + c.replyX,
            p.y + c.replyBottomY + inkLift,
            p.z + c.replyZ,
        );
    }
}

function _trackLoop(): void {
    if (!_state) return;
    _syncAnchors();
    _state.rafId = requestAnimationFrame(_trackLoop);
}

/** Push dialogAnchorConfig into the two panels. Size and translucency are
 *  construction-time options on a CSS3DPanel, so they need handing over
 *  explicitly; the world anchors are read per frame by _syncAnchors. */
function _applyPlacement(): void {
    if (_speechPanel) {
        _speechPanel.setPxPerUnit(dialogAnchorConfig.speechPxPerUnit);
        _speechPanel.setPunchAlpha(dialogAnchorConfig.speechPunch);
    }
    if (_replyPanel) _replyPanel.setPxPerUnit(dialogAnchorConfig.replyPxPerUnit);
    _syncAnchors();
}

// ─── Typewriter ───────────────────────────────────────────────────────────────

const CHARS_PER_SEC = 20;
/** Max characters added in a single frame — prevents a throttled mobile rAF
 *  from dumping an entire sentence at once after a long gap between frames. */
const MAX_CHARS_PER_FRAME = 3;

function _startTyping(text: string): void {
    if (!_state || !_textEl || !_promptEl || !_boxEl) return;
    _state.typeIndex = 0;
    _state.isTyping  = true;
    _promptEl.classList.remove('dialog-prompt--visible');

    // Lock the box's HEIGHT to the finished line before typing it. The panel's
    // width is fixed in CSS, so the only thing a growing string can move is the
    // line count — and every change there re-bakes the punch mask and slides the
    // panel a few pixels while the words are still arriving. Measuring the whole
    // line once and holding that height keeps the sheet dead still.
    _boxEl.style.height = '';
    _textEl.textContent = text;
    void _boxEl.offsetHeight;                       // force reflow
    const h = _boxEl.offsetHeight;
    if (h > 0) _boxEl.style.height = `${h}px`;
    _textEl.textContent = '';

    const msPerChar = 1000 / CHARS_PER_SEC;
    let lastTime = -1;          // −1 signals "first frame"
    let accumulated = 0;

    const tick = (now: number): void => {
        if (!_state || !_state.isTyping) return;

        // First frame: just record the timestamp, don't add chars yet.
        // Prevents dumping a huge batch if rAF fires late after setup.
        if (lastTime < 0) {
            lastTime = now;
            _state.typeTimer = requestAnimationFrame(tick) as unknown as ReturnType<typeof setInterval>;
            return;
        }

        // Clamp delta to avoid large jumps when mobile browser throttles rAF
        const delta = Math.min(now - lastTime, 120);   // max ~120 ms gap
        lastTime = now;
        accumulated += delta;

        let add = Math.floor(accumulated / msPerChar);
        if (add > 0) {
            add = Math.min(add, MAX_CHARS_PER_FRAME);
            accumulated = Math.min(accumulated - add * msPerChar, msPerChar);
            _state.typeIndex = Math.min(_state.typeIndex + add, text.length);
            if (_textEl) _textEl.textContent = text.slice(0, _state.typeIndex);
            // One tick per frame that revealed at least one letter (avoids stacking
            // several at the same instant when a throttled frame adds 2–3 chars).
            playDialogTypeSound();
        }
        if (_state.typeIndex >= text.length) {
            _state.typeTimer = null;
            _state.isTyping  = false;
            _onLineDoneTyping();
        } else {
            _state.typeTimer = requestAnimationFrame(tick) as unknown as ReturnType<typeof setInterval>;
        }
    };

    _state.typeTimer = requestAnimationFrame(tick) as unknown as ReturnType<typeof setInterval>;
}

/** Called whenever a line finishes typing (naturally or via skip). */
function _onLineDoneTyping(): void {
    if (!_state || !_promptEl) return;
    const currentLine = _state.lines[_state.lineIdx];
    // The ▼ indicator stays visible even on the line that waits for a reply —
    // it signals "the pug is done talking" regardless of whether the next step is
    // an advance-click or picking a reply. The reply pills appear alongside it.
    _promptEl.classList.add('dialog-prompt--visible');
    if (currentLine.replies?.length) {
        _showReplies(currentLine.replies);
    }
}

function _completeTyping(): void {
    if (!_state || !_state.isTyping || !_textEl || !_promptEl) return;
    if (_state.typeTimer) {
        cancelAnimationFrame(_state.typeTimer as unknown as number);
        _state.typeTimer = null;
    }
    _state.isTyping = false;
    _textEl.textContent = t(_state.lines[_state.lineIdx].textKey);
    _onLineDoneTyping();
}

// ─── Reply pills ──────────────────────────────────────────────────────────────

function _showReplies(replies: ReplyOption[]): void {
    if (!_replyPanel || !_replyListEl) return;
    _replyActive = true;

    _replyListEl.innerHTML = '';
    for (const reply of replies) {
        const optEl = document.createElement('span');
        optEl.className = 'dialog-reply-option';
        optEl.textContent = t(reply.textKey);
        optEl.dataset.textKey = reply.textKey;
        // Bound on POINTERUP, not click: this DOM lives behind the WebGL canvas
        // in the CSS3D subtree, where iOS WebKit does not reliably synthesize a
        // click — the media player's buttons hit the same wall. stopPropagation
        // keeps the tap off the panel manager's outside-click path.
        optEl.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            e.preventDefault();
            _hideReplies();
            reply.onSelect();
        });
        _replyListEl.appendChild(optEl);
    }

    _syncAnchors();
    _replyPanel.open();
    // The list content changed on a panel that may still be composited from the
    // previous open — force the raster (see CSS3DPanel.requestRepaint).
    _replyPanel.requestRepaint();
}

function _hideReplies(): void {
    _replyActive = false;
    _replyPanel?.close();
}

// ─── Audio ────────────────────────────────────────────────────────────────────

// Dialog sound buffers are preloaded centrally in Audio.ts.

function _playSound(url: string, onEnd?: () => void): void {
    playDialogSound(url, onEnd);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Open the speech panel anchored to the world position returned by
 * `getSpeakerWorld()`. `onComplete` is called after the last line is dismissed.
 *
 * Calling this again while a panel is already open (a reply branching into a
 * follow-up) swaps the lines WITHOUT replaying the entrance — the thread out of
 * the pug is drawn once, when the conversation starts.
 */
export function showDialog(
    lines: DialogLine[],
    getSpeakerWorld: () => WorldPoint | null,
    onComplete: () => void,
): void {
    if (!lines.length) return;
    ensurePanels();

    const wasOpen = _speechPanel!.isOpen();

    // Tear down any previous dialog cleanly
    _clearState();

    _state = {
        lines,
        lineIdx: 0,
        getSpeakerWorld,
        onComplete,
        typeTimer: null,
        typeIndex: 0,
        isTyping:  false,
        rafId: 0,
    };

    // Anchor before opening so the entrance plays at the right place.
    _applyPlacement();

    if (!wasOpen) {
        _speechPanel!.open();
        playDialogAppearSound();  // soft "pop" the first time the panel appears
    }

    const line = lines[0];
    line.onLineStart?.();
    _startTyping(t(line.textKey));
    if (line.sound) _playSound(line.sound, line.onLineSoundEnd);
    else line.onLineSoundEnd?.();

    _state.rafId = requestAnimationFrame(_trackLoop);
}

/**
 * Advance the dialog:
 * - If still typing → instantly complete the current line.
 * - If done typing  → move to next line, or complete if it was the last.
 * - If reply pills are up → ignore (waiting for reply selection).
 * Returns `true` while dialog is still active, `false` when it finishes.
 */
export function advanceDialog(): boolean {
    if (!_state) return false;
    if (_replyActive) return true;  // waiting for user to pick a reply

    if (_state.isTyping) {
        _completeTyping();
        return true;
    }

    _state.lineIdx++;
    if (_state.lineIdx >= _state.lines.length) {
        const cb = _state.onComplete;
        dismissDialog();
        cb();
        return false;
    }

    const line = _state.lines[_state.lineIdx];
    line.onLineStart?.();
    _startTyping(t(line.textKey));
    if (line.sound) _playSound(line.sound, line.onLineSoundEnd);
    else line.onLineSoundEnd?.();
    return true;
}

/** Force-close both panels immediately (e.g. triggered by external zoom-out). */
export function dismissDialog(): void {
    _replyActive = false;
    _replyPanel?.close();
    _clearState();
    if (_promptEl) _promptEl.classList.remove('dialog-prompt--visible');
    _speechPanel?.close();
}

export function isDialogActive(): boolean {
    return _state !== null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _clearState(): void {
    if (!_state) return;
    if (_state.typeTimer) {
        cancelAnimationFrame(_state.typeTimer as unknown as number);
    }
    cancelAnimationFrame(_state.rafId);
    _state = null;
}

// ─── Live language update ───────────────────────────────────────────────────────

onLanguageChange(() => {
    if (!_state) return;
    // Re-translate the currently displayed line (whether done typing or mid-type)
    const key = _state.lines[_state.lineIdx].textKey;
    if (!_state.isTyping && _textEl) {
        _textEl.textContent = t(key);
    }
    // Re-translate visible reply options
    if (_replyActive && _replyListEl) {
        _replyListEl.querySelectorAll<HTMLElement>('.dialog-reply-option').forEach(el => {
            const rk = el.dataset.textKey;
            if (rk) el.textContent = t(rk);
        });
    }
    // Both panels are composited behind the canvas — a text swap with no
    // animation running would otherwise keep serving the old raster.
    _speechPanel?.requestRepaint();
    _replyPanel?.requestRepaint();
});

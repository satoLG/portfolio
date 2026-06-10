/**
 * Dialog — pixel-art speech bubble with typewriter effect.
 *
 * Usage:
 *   showDialog(lines, getAnchorScreen, onComplete)
 *   advanceDialog()          — call from surrounding click handler
 *   dismissDialog()          — force-close (e.g. on zoom-out)
 *   isDialogActive() → bool
 */

import { playDialogSound, playDialogAppearSound, playDialogTypeSound } from './Audio';
import { t, onLanguageChange } from './i18n';

// ─── iOS detection (run once at module load) ──────────────────────────────────
// iOS Safari has a compositing bug where filter:url(#svg)+border-radius creates
// visible gaps at the rounded corners. Marking the body suppresses the filter.
{
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) document.body.classList.add('no-svg-filter');
}

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

// ─── Internal state ───────────────────────────────────────────────────────────

interface ActiveState {
    lines: DialogLine[];
    lineIdx: number;
    getAnchorScreen: () => { x: number; y: number } | null;
    onComplete: () => void;
    typeTimer: ReturnType<typeof setInterval> | null;
    typeIndex: number;
    isTyping: boolean;
    rafId: number;
}

let _state: ActiveState | null = null;

// ─── DOM elements (created once, reused) ──────────────────────────────────────

let _bubbleEl: HTMLDivElement | null = null;
let _textEl: HTMLParagraphElement | null = null;
let _promptEl: HTMLSpanElement | null = null;

// Reply bubble (user-side, right edge)
let _replyBubbleEl: HTMLDivElement | null = null;
let _replyOptionsEl: HTMLDivElement | null = null;
let _replyActive = false;

function ensureBubble(): void {
    // ─ Character text ──────────────────────────────────────────────────────────
    // No speech-bubble box anymore — the text is written straight onto the page.
    // The continue prompt (▼) is wrapped together with the text so it can sit
    // right after where the typed text ends (see _onLineDoneTyping).
    if (!_bubbleEl) {
        _bubbleEl = document.createElement('div');
        _bubbleEl.className = 'dialog-bubble';

        _textEl = document.createElement('p');
        _textEl.className = 'dialog-text';

        _promptEl = document.createElement('span');
        _promptEl.className = 'dialog-prompt';  // triangle is drawn via CSS mask

        _bubbleEl.appendChild(_textEl);
        _bubbleEl.appendChild(_promptEl);
        document.body.appendChild(_bubbleEl);

        // Clicking the text itself advances the dialog (the canvas click handler
        // also advances, so this is just a convenience for clicking the words).
        _bubbleEl.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            advanceDialog();
        });
    }

    // ─ Reply text ──────────────────────────────────────────────────────────────
    if (!_replyBubbleEl) {
        _replyBubbleEl = document.createElement('div');
        _replyBubbleEl.className = 'dialog-reply-bubble';

        _replyOptionsEl = document.createElement('div');
        _replyOptionsEl.className = 'dialog-reply-options';

        _replyBubbleEl.appendChild(_replyOptionsEl);
        document.body.appendChild(_replyBubbleEl);
    }
}

// ─── Positioning ──────────────────────────────────────────────────────────────

const BUBBLE_ABOVE   = 24;  // px — clearance between the text bottom and the anchor point
// px — how far right of the character the text floats. Pushed well clear of the
// pug so the (now larger) boxless text reads as sitting to its right.
const DIALOG_OFFSET_X = 96;
// px — keep the text this far from the viewport edges (don't go near the edge).
const EDGE_MARGIN     = 28;

function _updatePosition(): void {
    if (!_state || !_bubbleEl) return;
    const anchor = _state.getAnchorScreen();
    if (!anchor) return;

    const bw = _bubbleEl.offsetWidth || 240;
    const bh = _bubbleEl.offsetHeight || 60;
    const ww = window.innerWidth;
    const wh = window.innerHeight;

    // Text floats up and to the RIGHT of the character.
    const rawLeft = anchor.x + DIALOG_OFFSET_X;
    const left = Math.max(EDGE_MARGIN, Math.min(ww - bw - EDGE_MARGIN, rawLeft));

    // Place the text above the anchor.
    const top = Math.max(EDGE_MARGIN, Math.min(wh - bh - EDGE_MARGIN, anchor.y - bh - BUBBLE_ABOVE));

    _bubbleEl.style.left = `${left}px`;
    _bubbleEl.style.top  = `${top}px`;
}

function _trackLoop(): void {
    if (!_state) return;
    _updatePosition();
    if (_replyActive) _positionReplyBubble();
    _state.rafId = requestAnimationFrame(_trackLoop);
}

// ─── Typewriter ───────────────────────────────────────────────────────────────

const CHARS_PER_SEC = 20;
/** Max characters added in a single frame — prevents a throttled mobile rAF
 *  from dumping an entire sentence at once after a long gap between frames. */
const MAX_CHARS_PER_FRAME = 3;

function _startTyping(text: string): void {
    if (!_state || !_textEl || !_promptEl || !_bubbleEl) return;
    _state.typeIndex = 0;
    _state.isTyping  = true;
    _promptEl.classList.remove('dialog-prompt--visible');

    // Pre-fix the bubble's dimensions to prevent width/height oscillation
    // while characters are added one by one (line-wraps would cause jarring reflow).
    // We lock the box to the WIDEST actually-rendered line, not the max-content
    // width. When the text is long enough to wrap (capped by the CSS max-width),
    // measuring the block would return the full max-width — which on mobile leaves
    // the right-aligned ▼ floating at the screen edge, far from the real text. A
    // Range over the text node returns the union of its per-line rects, i.e. the
    // widest line, so the box shrink-wraps to the words and the ▼ stays beside them.
    // Fractional width is rounded UP plus a 1px guard: offsetWidth truncates the
    // sub-pixel width, which can leave the box a hair too narrow and wrap the last
    // word (e.g. "au au" → "au"/"au").
    _bubbleEl.style.width     = '';
    _bubbleEl.style.minHeight = '';
    _textEl.textContent = text;
    void _bubbleEl.offsetWidth;                         // force reflow
    const _range = document.createRange();
    _range.selectNodeContents(_textEl);
    const _lineW = _range.getBoundingClientRect().width;
    _bubbleEl.style.width     = `${Math.ceil(_lineW) + 1}px`;
    _bubbleEl.style.minHeight = `${_bubbleEl.offsetHeight}px`;
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
    // an advance-click or picking a reply. The reply bubble appears alongside it.
    _promptEl.classList.add('dialog-prompt--visible');
    if (currentLine.replies?.length) {
        _showReplyBubble(currentLine.replies);
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

// ─── Reply bubble ─────────────────────────────────────────────────────────────

/** px — gap between the reply text bottom and the viewport bottom */
const REPLY_BOTTOM_MARGIN = 40;
/**
 * px — keep the reply text this far from the right edge (mobile baseline). Matches
 * the pug dialog's EDGE_MARGIN so the reply list and the pug's text respect the
 * exact same distance from the screen border.
 */
const REPLY_RIGHT_MARGIN  = EDGE_MARGIN;
/**
 * Desktop centering: below this width the reply hugs the right edge (mobile —
 * looks good there). Above it, the reply's right edge is pulled left a fraction
 * of the extra width so on wide screens it lands nearer the middle, relatively
 * close to the pug dialog instead of glued to the right edge.
 */
const REPLY_CENTER_FROM_WIDTH = 600;
const REPLY_CENTER_PULL_RATE  = 0.3;

function _positionReplyBubble(): void {
    if (!_replyBubbleEl) return;

    const replyW = _replyBubbleEl.offsetWidth  || 200;
    const replyH = _replyBubbleEl.offsetHeight || 60;
    const ww     = window.innerWidth;
    const wh     = window.innerHeight;

    // User replies sit toward the RIGHT, near the bottom of the viewport. On wide
    // screens the right edge is pulled inward so it reads closer to the pug dialog
    // instead of touching the screen edge; on mobile it stays near the edge.
    const extraPull  = Math.max(0, ww - REPLY_CENTER_FROM_WIDTH) * REPLY_CENTER_PULL_RATE;
    const rightEdge  = ww - (REPLY_RIGHT_MARGIN + extraPull);
    const left = Math.max(28, rightEdge - replyW);
    const top  = wh - replyH - REPLY_BOTTOM_MARGIN;

    _replyBubbleEl.style.left = `${left}px`;
    _replyBubbleEl.style.top  = `${Math.max(28, top)}px`;
}

function _showReplyBubble(replies: ReplyOption[]): void {
    if (!_replyBubbleEl || !_replyOptionsEl) return;
    _replyActive = true;

    _replyOptionsEl.innerHTML = '';
    for (const reply of replies) {
        const optEl = document.createElement('span');
        optEl.className = 'dialog-reply-option';
        optEl.textContent = t(reply.textKey);
        optEl.dataset.textKey = reply.textKey;
        // Select on `click`, not `pointerdown`: handling it on pointerdown hides the
        // reply bubble before the browser dispatches the follow-up synthetic click,
        // which then hit-tests through to the canvas underneath and fires
        // advanceDialog() — instantly dumping the next line instead of letting it
        // type. With `click` the option stays the event target, so it never falls
        // through, and a deliberate second tap on the scene can still skip-ahead.
        optEl.addEventListener('click', (e) => {
            e.stopPropagation();
            _hideReplyBubble();
            reply.onSelect();
        });
        _replyOptionsEl.appendChild(optEl);
    }

    _positionReplyBubble();

    _replyBubbleEl.classList.remove('dialog-out');
    void _replyBubbleEl.offsetWidth;  // force reflow for animation restart
    _replyBubbleEl.classList.add('dialog-visible');
}

function _hideReplyBubble(): void {
    _replyActive = false;
    if (_replyBubbleEl) {
        _replyBubbleEl.classList.remove('dialog-visible');
        _replyBubbleEl.classList.add('dialog-out');
    }
}

// ─── Audio ────────────────────────────────────────────────────────────────────

// Dialog sound buffers are preloaded centrally in Audio.ts.

function _playSound(url: string, onEnd?: () => void): void {
    playDialogSound(url, onEnd);
    return;
/*

    const ctx  = getAudioContext();
    const dest = getCharacterDestination();  // routes through characterGain — respects Character volume/mute
    if (!ctx || !dest) { onEnd?.(); return; }
    try {
        let buf = _audioCache.get(url);
        if (!buf) {
            const resp = await fetch(url);
            const arr  = await resp.arrayBuffer();
            buf = await ctx.decodeAudioData(arr);
            _audioCache.set(url, buf);
        }
        const src  = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = 0.85;
        src.connect(gain);
        gain.connect(dest);
        if (onEnd) src.addEventListener('ended', onEnd, { once: true });
        src.start();
    } catch (e) {
        console.warn('[Dialog] Audio play error:', e);
        onEnd?.();
    }
*/
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Open a dialog bubble anchored above the screen position returned by
 * `getAnchorScreen()`.  `onComplete` is called after the last line is
 * dismissed.
 */
export function showDialog(
    lines: DialogLine[],
    getAnchorScreen: () => { x: number; y: number } | null,
    onComplete: () => void,
): void {
    if (!lines.length) return;
    ensureBubble();

    // Tear down any previous dialog cleanly
    _clearState();

    _state = {
        lines,
        lineIdx: 0,
        getAnchorScreen,
        onComplete,
        typeTimer: null,
        typeIndex: 0,
        isTyping:  false,
        rafId: 0,
    };

    // Position before making visible so transform-origin is correct
    _updatePosition();

    // Show with bounce animation
    _bubbleEl!.classList.remove('dialog-out');
    void _bubbleEl!.offsetWidth;  // force reflow so animation restarts
    _bubbleEl!.classList.add('dialog-visible');
    playDialogAppearSound();  // soft "pop" the first time the bubble appears

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
 * - If reply bubble is active → ignore (waiting for reply selection).
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

/** Force-close the bubble immediately (e.g. triggered by external zoom-out). */
export function dismissDialog(): void {
    _replyActive = false;
    if (_replyBubbleEl) {
        _replyBubbleEl.classList.remove('dialog-visible');
        _replyBubbleEl.classList.add('dialog-out');
    }
    _clearState();
    if (_bubbleEl) {
        _bubbleEl.style.width     = '';
        _bubbleEl.style.minHeight = '';
        _bubbleEl.classList.remove('dialog-visible');
        _bubbleEl.classList.add('dialog-out');
    }
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
    if (_replyActive && _replyOptionsEl) {
        _replyOptionsEl.querySelectorAll<HTMLElement>('.dialog-reply-option').forEach(el => {
            const rk = el.dataset.textKey;
            if (rk) el.textContent = t(rk);
        });
    }
});

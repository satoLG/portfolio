/**
 * Dialog — pixel-art speech bubble with typewriter effect.
 *
 * Usage:
 *   showDialog(lines, getAnchorScreen, onComplete)
 *   advanceDialog()          — call from surrounding click handler
 *   dismissDialog()          — force-close (e.g. on zoom-out)
 *   isDialogActive() → bool
 */

import { getAudioContext, getCharacterDestination } from './Audio';
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

function _buildTailSvg(ns: string, mirrored: boolean): SVGSVGElement {
    const svg = document.createElementNS(ns, 'svg') as SVGSVGElement;
    svg.setAttribute('width', '30');
    svg.setAttribute('height', '22');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.classList.add('dialog-tail-path');
    if (!mirrored) {
        // Left tail — tip at (−8, 22), points toward character on the left
        svg.setAttribute('viewBox', '-8 0 30 22');
        svg.classList.add('dialog-tail');
        path.setAttribute('d', 'M 2,0 C -1,7 -5,14 -8,22 C 0,15 11,8 22,0 Z');
    } else {
        // Right tail — tip at (30, 22) mirrored, points toward user on the right
        svg.setAttribute('viewBox', '0 0 30 22');
        svg.classList.add('dialog-reply-tail');
        path.setAttribute('d', 'M 20,0 C 23,7 27,14 30,22 C 22,15 11,8 0,0 Z');
    }
    svg.appendChild(path);
    return svg;
}

function ensureBubble(): void {
    const ns = 'http://www.w3.org/2000/svg';

    // ─ Character bubble ────────────────────────────────────────────────────────
    if (!_bubbleEl) {
        _bubbleEl = document.createElement('div');
        _bubbleEl.className = 'dialog-bubble';

        _textEl = document.createElement('p');
        _textEl.className = 'dialog-text';

        _promptEl = document.createElement('span');
        _promptEl.className = 'dialog-prompt';
        _promptEl.textContent = '▼';

        _bubbleEl.appendChild(_textEl);
        _bubbleEl.appendChild(_promptEl);
        _bubbleEl.appendChild(_buildTailSvg(ns, false));
        document.body.appendChild(_bubbleEl);

        // Clicking the bubble itself advances the dialog
        _bubbleEl.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            advanceDialog();
        });
    }

    // ─ Reply bubble ───────────────────────────────────────────────────────────
    if (!_replyBubbleEl) {
        _replyBubbleEl = document.createElement('div');
        _replyBubbleEl.className = 'dialog-reply-bubble';

        _replyOptionsEl = document.createElement('div');
        _replyOptionsEl.className = 'dialog-reply-options';

        _replyBubbleEl.appendChild(_replyOptionsEl);
        _replyBubbleEl.appendChild(_buildTailSvg(ns, true));
        document.body.appendChild(_replyBubbleEl);
    }
}

// ─── Positioning ──────────────────────────────────────────────────────────────

const TAIL_HEIGHT     = 22;  // px — height of the SVG tail below the bubble
const BUBBLE_ABOVE    = 10;  // px — extra clearance between tail tip and anchor point
const TAIL_TIP_OVERHANG = 8;  // px — SVG tail tip overhangs this far left of bubble.left

/** The SVG <svg> tail element inside the character bubble */
function _getTailSvg(): SVGSVGElement | null {
    return _bubbleEl?.querySelector('.dialog-tail') as SVGSVGElement | null;
}

function _updatePosition(): void {
    if (!_state || !_bubbleEl) return;
    const anchor = _state.getAnchorScreen();
    if (!anchor) return;

    const bw = _bubbleEl.offsetWidth || 240;
    const bh = _bubbleEl.offsetHeight || 60;
    const ww = window.innerWidth;
    const wh = window.innerHeight;

    // Bubble sits to the RIGHT of the character — tail at bottom-left points back at them.
    const rawLeft = anchor.x + TAIL_TIP_OVERHANG;
    const left = Math.max(8, Math.min(ww - bw - 8, rawLeft));

    // Place bubble above anchor
    const top = Math.max(8, Math.min(wh - bh - 8, anchor.y - bh - TAIL_HEIGHT - BUBBLE_ABOVE));

    _bubbleEl.style.left = `${left}px`;
    _bubbleEl.style.top  = `${top}px`;

    // ── Dynamic tail: keep the SVG tip aligned with the 3D character ──────
    const tailSvg = _getTailSvg();
    if (tailSvg) {
        // The SVG tip sits at (tail.left − TAIL_TIP_OVERHANG) in px from the
        // bubble's left edge.  We want: left + tailLeft − TAIL_TIP_OVERHANG = anchor.x
        // → tailLeft = anchor.x − left + TAIL_TIP_OVERHANG
        const idealTailLeft = anchor.x - left + TAIL_TIP_OVERHANG;
        // Clamp so the tail stays inside the bubble with some margin
        const minTail = 12;
        const maxTail = bw - 28;
        const clampedTail = Math.max(minTail, Math.min(maxTail, idealTailLeft));
        tailSvg.style.left = `${clampedTail}px`;
    }
}

function _trackLoop(): void {
    if (!_state) return;
    _updatePosition();
    if (_replyActive) _positionReplyBubble();
    _state.rafId = requestAnimationFrame(_trackLoop);
}

// ─── Typewriter ───────────────────────────────────────────────────────────────

const CHARS_PER_SEC = 22;
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
    _bubbleEl.style.width     = '';
    _bubbleEl.style.minHeight = '';
    _textEl.textContent = text;
    void _bubbleEl.offsetWidth;                         // force reflow
    _bubbleEl.style.width     = `${_bubbleEl.offsetWidth}px`;
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
    if (currentLine.replies?.length) {
        _showReplyBubble(currentLine.replies);
    } else {
        _promptEl.classList.add('dialog-prompt--visible');
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

/** px — reply bubble left edge sits this far right of the main bubble's right edge */
const REPLY_OFFSET_X = 24;
/** px — gap between reply bubble bottom and viewport bottom */
const REPLY_BOTTOM_MARGIN = 24;

function _positionReplyBubble(): void {
    if (!_replyBubbleEl) return;

    const replyW = _replyBubbleEl.offsetWidth  || 200;
    const replyH = _replyBubbleEl.offsetHeight || 60;
    const ww     = window.innerWidth;
    const wh     = window.innerHeight;

    // Center horizontally, pinned to the bottom of the viewport
    const left = Math.max(8, Math.min(ww - replyW - 8, (ww - replyW) / 2));
    const top  = wh - replyH - REPLY_BOTTOM_MARGIN;

    _replyBubbleEl.style.left = `${left}px`;
    _replyBubbleEl.style.top  = `${Math.max(8, top)}px`;
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
        optEl.addEventListener('pointerdown', (e) => {
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

const _audioCache = new Map<string, AudioBuffer>();

async function _playSound(url: string, onEnd?: () => void): Promise<void> {
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

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
import { t } from './i18n';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DialogLine {
    /** i18n translation key — falls back to the literal string if not found */
    textKey: string;
    /** Optional audio URL to play when this line starts (relative to origin) */
    sound?: string;
    /** Called immediately when this line becomes active */
    onLineStart?: () => void;
    /** Called when the sound clip finishes playing (or immediately if no sound) */
    onLineSoundEnd?: () => void;
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

function ensureBubble(): void {
    if (_bubbleEl) return;

    _bubbleEl = document.createElement('div');
    _bubbleEl.className = 'dialog-bubble';

    _textEl = document.createElement('p');
    _textEl.className = 'dialog-text';

    _promptEl = document.createElement('span');
    _promptEl.className = 'dialog-prompt';
    _promptEl.textContent = '▼';

    // SVG curved tail — pinned to bottom-left of bubble, tip hangs 8 px left and 22 px below,
    // pointing toward the character standing to the left.
    const ns = 'http://www.w3.org/2000/svg';
    const tailSvg = document.createElementNS(ns, 'svg');
    tailSvg.classList.add('dialog-tail');
    tailSvg.setAttribute('width', '30');
    tailSvg.setAttribute('height', '22');
    tailSvg.setAttribute('viewBox', '-8 0 30 22');
    tailSvg.setAttribute('aria-hidden', 'true');
    const tailPath = document.createElementNS(ns, 'path');
    tailPath.classList.add('dialog-tail-path');
    // Bezier teardrop: base spans bottom-left of bubble; tip at (−8, 22) = below-left
    tailPath.setAttribute('d', 'M 2,0 C -1,7 -5,14 -8,22 C 0,15 11,8 22,0 Z');
    tailSvg.appendChild(tailPath);

    _bubbleEl.appendChild(_textEl);
    _bubbleEl.appendChild(_promptEl);
    _bubbleEl.appendChild(tailSvg);
    document.body.appendChild(_bubbleEl);

    // Clicking the bubble itself advances the dialog
    _bubbleEl.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        advanceDialog();
    });
}

// ─── Positioning ──────────────────────────────────────────────────────────────

const TAIL_HEIGHT     = 22;  // px — height of the SVG tail below the bubble
const BUBBLE_ABOVE    = 10;  // px — extra clearance between tail tip and anchor point
// The SVG tail tip overhangs TAIL_TIP_OVERHANG px to the LEFT of bubble.left.
// Setting rawLeft = anchor.x + TAIL_TIP_OVERHANG aligns the tip with the character.
const TAIL_TIP_OVERHANG = 8;  // px

function _updatePosition(): void {
    if (!_state || !_bubbleEl) return;
    const anchor = _state.getAnchorScreen();
    if (!anchor) return;

    const bw = _bubbleEl.offsetWidth || 240;
    const bh = _bubbleEl.offsetHeight || 60;
    const ww = window.innerWidth;
    const wh = window.innerHeight;

    // Bubble sits to the RIGHT of the character — tail at bottom-left points back at them.
    // tail tip x  =  left − TAIL_TIP_OVERHANG  ⇒  left = anchor.x + TAIL_TIP_OVERHANG
    const rawLeft = anchor.x + TAIL_TIP_OVERHANG;
    const left = Math.max(8, Math.min(ww - bw - 8, rawLeft));

    // Place bubble above anchor
    const top = Math.max(8, Math.min(wh - bh - 8, anchor.y - bh - TAIL_HEIGHT - BUBBLE_ABOVE));

    _bubbleEl.style.left = `${left}px`;
    _bubbleEl.style.top  = `${top}px`;
}

function _trackLoop(): void {
    if (!_state) return;
    _updatePosition();
    _state.rafId = requestAnimationFrame(_trackLoop);
}

// ─── Typewriter ───────────────────────────────────────────────────────────────

const CHARS_PER_SEC = 22;

function _startTyping(text: string): void {
    if (!_state || !_textEl || !_promptEl) return;
    _state.typeIndex = 0;
    _state.isTyping  = true;
    _textEl.textContent = '';
    _promptEl.classList.remove('dialog-prompt--visible');

    const interval = Math.round(1000 / CHARS_PER_SEC);
    _state.typeTimer = setInterval(() => {
        if (!_state || !_textEl) return;
        _state.typeIndex++;
        _textEl.textContent = text.slice(0, _state.typeIndex);
        if (_state.typeIndex >= text.length) {
            clearInterval(_state.typeTimer!);
            _state.typeTimer = null;
            _state.isTyping  = false;
            _promptEl?.classList.add('dialog-prompt--visible');
        }
    }, interval);
}

function _completeTyping(): void {
    if (!_state || !_state.isTyping || !_textEl || !_promptEl) return;
    if (_state.typeTimer) { clearInterval(_state.typeTimer); _state.typeTimer = null; }
    _state.isTyping = false;
    _textEl.textContent = t(_state.lines[_state.lineIdx].textKey);
    _promptEl.classList.add('dialog-prompt--visible');
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
 * Returns `true` while dialog is still active, `false` when it finishes.
 */
export function advanceDialog(): boolean {
    if (!_state) return false;

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
    _clearState();
    if (_bubbleEl) {
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
    if (_state.typeTimer) clearInterval(_state.typeTimer);
    cancelAnimationFrame(_state.rafId);
    _state = null;
}

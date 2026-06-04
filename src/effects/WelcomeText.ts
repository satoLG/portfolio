import { getCurrentLanguage } from '../core/i18n';
import { playDialogAppearSound, playDialogTypeSound } from '../core/Audio';

// ── Speed knob ────────────────────────────────────────────────────────────────
// Typewriter speed in characters per second — matches the pug dialog feel
// (Dialog.ts CHARS_PER_SEC), so the intro and the dialogs reveal identically.
const CHARS_PER_SEC = 20;
// ─────────────────────────────────────────────────────────────────────────────

const FADE_OUT_DURATION = 650;
// Same translucent white the dialog text + continue arrows use (see style.css
// --intro-white). Kept here as the single source for the inline color.
const WELCOME_COLOR = '#e8eced6c';

export function showWelcomeText(
    onComplete: () => void,
): void {
    const word = getCurrentLanguage() === 'pt-br' ? 'boas-vindas' : 'welcome';

    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 9999;
        opacity: 0;
        transition: opacity 280ms ease-in;
    `;

    // Mirror the pug dialog layout exactly: a block that shrink-wraps to the
    // word, the text revealed left→right, and the continue arrow tucked into the
    // bottom-right corner (instead of the old centred word + centred arrow).
    const block = document.createElement('div');
    block.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: stretch;
    `;

    const textStyle = `
        color: ${WELCOME_COLOR};
        font-family: 'Patrick Hand', cursive;
        font-size: clamp(40px, 7vw, 64px);
        white-space: nowrap;
        text-align: left;
    `;

    // Relative wrapper holding a hidden "ghost" copy of the full word (reserves
    // the final width/height so nothing shifts as letters appear) and the visible
    // typed copy layered on top, anchored left so it grows rightward.
    const textWrap = document.createElement('div');
    textWrap.style.cssText = 'position: relative;';

    const ghost = document.createElement('div');
    ghost.className = 'welcome-text';
    ghost.style.cssText = textStyle + 'visibility: hidden;';
    ghost.textContent = word;

    const container = document.createElement('div');
    container.className = 'welcome-text';
    container.style.cssText = textStyle + 'position: absolute; left: 0; top: 0;';

    textWrap.appendChild(ghost);
    textWrap.appendChild(container);

    // Reuse the pug dialog's continue prompt verbatim — the same ▼ glyph and the
    // same `.dialog-prompt` styling/animation — so the intro is 100% identical to
    // the in-scene dialogs (the old CSS border-triangle looked different). It's a
    // block with text-align:right, so inside the stretched flex column it lands in
    // the bottom-right corner, under the end of the word, just like the dialog.
    const arrow = document.createElement('span');
    arrow.className = 'dialog-prompt';
    arrow.textContent = '▼';

    block.appendChild(textWrap);
    block.appendChild(arrow);
    overlay.appendChild(block);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        playDialogAppearSound();  // same "pop" as a dialog bubble appearing
    }));

    // ── Typewriter ────────────────────────────────────────────────────────────
    // Same rAF-driven, delta-clamped approach as Dialog._startTyping so a
    // throttled mobile frame can't dump the whole word at once.
    const msPerChar = 1000 / CHARS_PER_SEC;
    let typeIndex = 0;
    let lastTime = -1;
    let accumulated = 0;
    let rafId = 0;

    const onTypingComplete = (): void => {
        overlay.style.pointerEvents = 'auto';
        overlay.style.cursor = 'pointer';
        arrow.classList.add('dialog-prompt--visible');

        const continueIntro = (): void => {
            overlay.removeEventListener('pointerdown', continueIntro);
            overlay.style.pointerEvents = 'none';
            overlay.style.cursor = '';
            overlay.style.transition = `opacity ${FADE_OUT_DURATION}ms ease-out`;
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.remove();
                onComplete();
            }, FADE_OUT_DURATION);
        };

        overlay.addEventListener('pointerdown', continueIntro, { once: true });
    };

    const tick = (now: number): void => {
        if (lastTime < 0) {
            lastTime = now;
            rafId = requestAnimationFrame(tick);
            return;
        }
        const delta = Math.min(now - lastTime, 120);
        lastTime = now;
        accumulated += delta;

        const add = Math.floor(accumulated / msPerChar);
        if (add > 0) {
            accumulated -= add * msPerChar;
            typeIndex = Math.min(typeIndex + add, word.length);
            container.textContent = word.slice(0, typeIndex);
            playDialogTypeSound();  // one tick per frame that revealed a letter
        }

        if (typeIndex >= word.length) {
            onTypingComplete();
        } else {
            rafId = requestAnimationFrame(tick);
        }
    };

    rafId = requestAnimationFrame(tick);
}

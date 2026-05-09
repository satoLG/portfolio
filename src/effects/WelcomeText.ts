import { TegakiEngine, type TegakiBundle } from 'tegaki/core';
import _patrickHand from '../fonts/patrick-hand/bundle';
import { getCurrentLanguage } from '../core/i18n';

// tegaki bundles use readonly tuples that don't match the mutable TegakiBundle type.
const patrickHand = _patrickHand as unknown as TegakiBundle;

// ── Speed knob ────────────────────────────────────────────────────────────────
// Playback speed multiplier. 1 = default, 0.6 = slower, 1.5 = faster.
const PLAYBACK_SPEED = 1.5;
// ─────────────────────────────────────────────────────────────────────────────

const HOLD_DURATION     = 450;
const FADE_OUT_DURATION = 650;

export function showWelcomeText(
    onComplete: () => void,
): void {
    const word = getCurrentLanguage() === 'pt-br' ? 'boas-vindas' : 'welcome';

    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 9999;
        opacity: 0;
        transition: opacity 280ms ease-in;
    `;

    const container = document.createElement('div');
    container.className = 'welcome-tegaki';
    container.style.cssText = `
        color: #e8eced36;
        font-size: clamp(40px, 7vw, 64px);
        white-space: nowrap;
    `;

    overlay.appendChild(container);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.style.opacity = '1';
    }));

    const engine = new TegakiEngine(container, {
        text: word,
        font: patrickHand,
        time: { mode: 'uncontrolled', speed: PLAYBACK_SPEED } as any,
        onComplete: () => {
            setTimeout(() => {
                overlay.style.transition = `opacity ${FADE_OUT_DURATION}ms ease-out`;
                overlay.style.opacity    = '0';
                setTimeout(() => {
                    engine.destroy();
                    overlay.remove();
                    onComplete();
                }, FADE_OUT_DURATION);
            }, HOLD_DURATION);
        },
    });
}

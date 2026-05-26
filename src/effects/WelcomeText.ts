import { TegakiEngine, type TegakiBundle } from 'tegaki/core';
import _patrickHand from '../fonts/patrick-hand/bundle';
import { getCurrentLanguage } from '../core/i18n';
import { INTRO_WRITING_VOLUME } from "../core/Audio";

// tegaki bundles use readonly tuples that don't match the mutable TegakiBundle type.
const patrickHand = _patrickHand as unknown as TegakiBundle;

// ── Speed knob ────────────────────────────────────────────────────────────────
// Playback speed multiplier. 1 = default, 0.6 = slower, 1.5 = faster.
const PLAYBACK_SPEED = 1.5;
// ─────────────────────────────────────────────────────────────────────────────

const FADE_OUT_DURATION = 650;
const WELCOME_COLOR = '#e8eced36';
const WRITING_AUDIO_SRC = '/audio/ui/335518__newagesoup__writing-short-8.mp3';
const WRITING_AUDIO_FADE_MS = 180;

function startWritingAudio(): HTMLAudioElement {
    const audio = new Audio(WRITING_AUDIO_SRC);
    audio.loop = true;
    audio.volume = INTRO_WRITING_VOLUME;
    audio.play().catch(() => {
        // Some browsers may block playback if the delayed welcome starts after
        // transient user activation. The visual intro should continue normally.
    });
    return audio;
}

function fadeOutWritingAudio(audio: HTMLAudioElement): void {
    const startVolume = audio.volume;
    const startedAt = performance.now();

    const tick = (now: number): void => {
        const progress = Math.min(1, (now - startedAt) / WRITING_AUDIO_FADE_MS);
        const eased = 1 - Math.pow(1 - progress, 2);
        audio.volume = startVolume * (1 - eased);

        if (progress < 1) {
            requestAnimationFrame(tick);
            return;
        }

        audio.pause();
        audio.currentTime = 0;
        audio.src = '';
    };

    requestAnimationFrame(tick);
}

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

    const container = document.createElement('div');
    container.className = 'welcome-tegaki';
    container.style.cssText = `
        color: ${WELCOME_COLOR};
        font-size: clamp(40px, 7vw, 64px);
        white-space: nowrap;
    `;

    const arrow = document.createElement('div');
    arrow.className = 'welcome-continue-arrow';

    overlay.appendChild(container);
    overlay.appendChild(arrow);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.style.opacity = '1';
    }));

    const writingAudio = startWritingAudio();

    const engine = new TegakiEngine(container, {
        text: word,
        font: patrickHand,
        time: { mode: 'uncontrolled', speed: PLAYBACK_SPEED } as any,
        onComplete: () => {
            fadeOutWritingAudio(writingAudio);
            overlay.style.pointerEvents = 'auto';
            overlay.style.cursor = 'pointer';
            arrow.classList.add('welcome-continue-arrow--visible');

            const continueIntro = (): void => {
                overlay.removeEventListener('pointerdown', continueIntro);
                overlay.style.pointerEvents = 'none';
                overlay.style.cursor = '';
                overlay.style.transition = `opacity ${FADE_OUT_DURATION}ms ease-out`;
                overlay.style.opacity = '0';
                setTimeout(() => {
                    engine.destroy();
                    overlay.remove();
                    onComplete();
                }, FADE_OUT_DURATION);
            };

            overlay.addEventListener('pointerdown', continueIntro, { once: true });
        },
    });
}

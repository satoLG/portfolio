import { isDayTime } from "../scene/Skybox";

// ============================================
// UNIFIED AUDIO ENGINE
// Uses HTMLAudioElement + MediaElementAudioSourceNode
// for simultaneous Web Audio effects.
// ============================================
let _audioContext: AudioContext | null = null;
export function getAudioContext(): AudioContext | null { return _audioContext; }

// ============================================
// AUDIO SETTINGS (easily tweakable)
// ============================================
const WATER_VOLUME = 0.7;
const BREEZE_VOLUME = 0.3;
const BREEZE_MIN_DELAY = 3;
const BREEZE_MAX_DELAY = 6;
const FIREPLACE_VOLUME_MAX = 0.35;
const FIREPLACE_FADE_DURATION = 1.5;
const UNDERWATER_AMB_VOLUME = 0.25;
const TRANSITION_SFX_VOLUME = 0.1;
const BUBBLE_SFX_DURATION = 2000;
const UI_SOUND_THROTTLE = 100;
const WATER_SPLASH_VOLUME = 0.3;
const UI_SOUND_VOLUME = 0.4;
const CROSSFADE_DURATION = 1.0;
const AUDIO_CHECK_INTERVAL = 2000;

const AUDIO_PATHS = {
    water: 'audio/ocean.wav',
    breeze: 'audio/breeze.wav',
    fireplace: 'audio/fireplace.wav',
    underwaterAmb: 'audio/366159__dcsfx__underwater-loop-amb.wav',
    underwaterBubbles: 'audio/96742__robinhood76__01650-underwater-bubbles.wav',
    waterSplash: 'audio/274060__junggle__water-splash-11.wav',
    uiSwitchDay: '/audio/ui/dragon-studio-light-switch-on-382714.mp3',
    uiSwitchNight: '/audio/ui/dragon-studio-light-switch-382712.mp3',
    uiButton: '/audio/ui/soundreality-button-202966.mp3',
    uiBubbleExpand: '/audio/ui/universfield-bubble-pop-293342.mp3',
    uiBubbleCollapse: '/audio/ui/universfield-bubble-pop-06-351337.mp3',
};

// ============================================
// UNIFIED SOUND TYPE
// Each sound = HTMLAudioElement + MediaElementAudioSourceNode + GainNode
// ============================================
interface UnifiedSound {
    element: HTMLAudioElement;
    source: MediaElementAudioSourceNode;
    gain: GainNode;
}

/**
 * Create a unified sound: <audio> element wired through Web Audio graph.
 * @param url      Path to audio file
 * @param dest     Destination GainNode (natureGain or interfaceGain)
 * @param options  loop / volume / preload
 */
function createSound(
    url: string,
    dest: GainNode,
    options: { loop?: boolean; volume?: number; preload?: boolean } = {}
): UnifiedSound {
    const { loop = false, volume = 1, preload = true } = options;
    const ctx = _audioContext!;
    const element = new Audio(url);
    element.loop = loop;
    element.preload = preload ? 'auto' : 'none';
    // Keep element volume at 1 — control volume via GainNode for precision
    element.volume = 1;

    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(dest);

    if (preload) element.load();
    return { element, source, gain };
}

// ============================================
// GROUP GAIN NODES (nature / interface)
// ============================================
let natureGain: GainNode | null = null;
let interfaceGain: GainNode | null = null;

// ============================================
// NATURE SOUNDS
// ============================================
let waterSound1: UnifiedSound | null = null;
let waterSound2: UnifiedSound | null = null;
let activeWaterSound: UnifiedSound | null = null;
let waterCrossfading = false;

let breezeSound: UnifiedSound | null = null;
let breezeTimeout: ReturnType<typeof setTimeout> | null = null;
let breezeActive = false;

let fireplaceSound: UnifiedSound | null = null;
let fireplaceActive = false;

let underwaterAmbSound: UnifiedSound | null = null;
let underwaterBubblesSound: UnifiedSound | null = null;
let bubblesStopTimer: ReturnType<typeof setTimeout> | null = null;

let waterSplashSound: UnifiedSound | null = null;

// ============================================
// UI SOUNDS
// ============================================
let uiSwitchDaySound: UnifiedSound | null = null;
let uiSwitchNightSound: UnifiedSound | null = null;
let uiButtonSound: UnifiedSound | null = null;
let uiBubbleExpandSound: UnifiedSound | null = null;
let uiBubbleCollapseSound: UnifiedSound | null = null;

// ============================================
// STATE
// ============================================
let isCurrentlyUnderwater = false;
let wasDay = true;
let audioInitialized = false;
let listenersRemoved = false;
let lastUISoundTime = 0;
let lastAudioCheck = 0;

// Mute state
let natureMuted = false;
let musicMuted = false;
let interfaceMuted = false;

// Volume state (persisted to localStorage)
let natureVolume = parseFloat(localStorage.getItem('portfolio-nature-volume') ?? '1');
let musicVolume = parseFloat(localStorage.getItem('portfolio-music-volume') ?? '1');
let interfaceVolume = parseFloat(localStorage.getItem('portfolio-interface-volume') ?? '1');

// ============================================
// WATER CROSSFADE
// Uses Web Audio gain ramps for smooth, reliable crossfade.
// Two <audio> elements alternate; timeupdate triggers the blend.
// ============================================
function setupWaterCrossfade(current: UnifiedSound, next: UnifiedSound): void {
    current.element.addEventListener('timeupdate', () => {
        if (!current.element.duration || waterCrossfading) return;
        const timeRemaining = current.element.duration - current.element.currentTime;

        if (timeRemaining <= CROSSFADE_DURATION && timeRemaining > 0) {
            waterCrossfading = true;
            const ctx = _audioContext!;
            const now = ctx.currentTime;

            // Prepare next
            next.element.currentTime = 0;
            next.gain.gain.setValueAtTime(0, now);
            next.element.play().catch(() => {});

            // Ramp current down, next up
            current.gain.gain.setValueAtTime(current.gain.gain.value, now);
            current.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE_DURATION);
            next.gain.gain.linearRampToValueAtTime(WATER_VOLUME, now + CROSSFADE_DURATION);

            // After ramp completes, swap active
            setTimeout(() => {
                current.element.pause();
                current.element.currentTime = 0;
                current.gain.gain.value = WATER_VOLUME;
                activeWaterSound = next;
                waterCrossfading = false;
            }, CROSSFADE_DURATION * 1000 + 50);
        }
    });

    // Fallback: if crossfade fails and element ends abruptly, restart from next
    current.element.addEventListener('ended', () => {
        if (isCurrentlyUnderwater) return;
        if (activeWaterSound === current) {
            waterCrossfading = false;
            next.element.currentTime = 0;
            next.gain.gain.value = WATER_VOLUME;
            next.element.play().catch(() => {});
            activeWaterSound = next;
        }
    });
}

// ============================================
// BREEZE SCHEDULING
// ============================================
function scheduleBreeze(): void {
    if (breezeTimeout) { clearTimeout(breezeTimeout); breezeTimeout = null; }
    if (isCurrentlyUnderwater) return;
    const delay = BREEZE_MIN_DELAY + Math.random() * (BREEZE_MAX_DELAY - BREEZE_MIN_DELAY);
    breezeTimeout = setTimeout(() => playBreeze(), delay * 1000);
}

function playBreeze(): void {
    if (!breezeSound || isCurrentlyUnderwater || natureMuted) {
        if (!isCurrentlyUnderwater) scheduleBreeze();
        return;
    }
    breezeSound.element.currentTime = 0;
    breezeActive = true;
    breezeSound.element.play().then(() => {
        // Re-check scene state after async play
        if (isCurrentlyUnderwater && breezeSound) {
            breezeSound.element.pause();
            breezeActive = false;
        }
    }).catch(() => {
        breezeActive = false;
    });
}

// ============================================
// FIREPLACE (fade in/out via gain ramp)
// ============================================
function startFireplace(): void {
    if (fireplaceActive || !fireplaceSound || !_audioContext) return;
    fireplaceActive = true;
    const ctx = _audioContext;
    const now = ctx.currentTime;
    fireplaceSound.element.currentTime = 0;
    fireplaceSound.gain.gain.setValueAtTime(0, now);
    fireplaceSound.gain.gain.linearRampToValueAtTime(FIREPLACE_VOLUME_MAX, now + FIREPLACE_FADE_DURATION);
    fireplaceSound.element.play().catch(() => {});
}

function stopFireplace(): void {
    if (!fireplaceActive || !fireplaceSound || !_audioContext) return;
    const ctx = _audioContext;
    const now = ctx.currentTime;
    fireplaceSound.gain.gain.setValueAtTime(fireplaceSound.gain.gain.value, now);
    fireplaceSound.gain.gain.linearRampToValueAtTime(0, now + 0.5);
    setTimeout(() => {
        if (fireplaceSound) {
            fireplaceSound.element.pause();
            fireplaceSound.element.currentTime = 0;
        }
    }, 600);
    fireplaceActive = false;
}

// ============================================
// UNDERWATER TRANSITIONS
// ============================================
export function transitionToUnderwater(): void {
    if (!audioInitialized || isCurrentlyUnderwater) return;
    isCurrentlyUnderwater = true;

    // Stop above-water sounds
    if (activeWaterSound) activeWaterSound.element.pause();
    // Also pause the other water element in case crossfade was mid-flight
    if (waterSound1 && waterSound1 !== activeWaterSound) waterSound1.element.pause();
    if (waterSound2 && waterSound2 !== activeWaterSound) waterSound2.element.pause();
    waterCrossfading = false;

    if (breezeTimeout) { clearTimeout(breezeTimeout); breezeTimeout = null; }
    if (breezeSound && !breezeSound.element.paused) {
        breezeSound.element.pause();
        breezeActive = false;
    }
    if (fireplaceActive) stopFireplace();

    // Start underwater sounds
    if (!natureMuted) {
        if (underwaterAmbSound) {
            underwaterAmbSound.element.currentTime = 0;
            underwaterAmbSound.gain.gain.value = UNDERWATER_AMB_VOLUME;
            underwaterAmbSound.element.play().catch(() => {});
        }
        playBubbleClip();
    }
}

export function transitionToAboveWater(): void {
    if (!audioInitialized || !isCurrentlyUnderwater) return;
    isCurrentlyUnderwater = false;

    // Stop underwater sounds
    if (bubblesStopTimer) { clearTimeout(bubblesStopTimer); bubblesStopTimer = null; }
    if (underwaterAmbSound && !underwaterAmbSound.element.paused) {
        underwaterAmbSound.element.pause();
        underwaterAmbSound.element.currentTime = 0;
    }
    if (underwaterBubblesSound && !underwaterBubblesSound.element.paused) {
        underwaterBubblesSound.element.pause();
        underwaterBubblesSound.element.currentTime = 0;
    }

    // Resume above-water sounds
    if (!natureMuted) {
        if (activeWaterSound) {
            activeWaterSound.element.currentTime = 0;
            activeWaterSound.gain.gain.value = WATER_VOLUME;
            activeWaterSound.element.play().catch(() => {});
        }
        scheduleBreeze();
        if (!isDayTime()) startFireplace();
    }
}

/** Play bubble SFX for BUBBLE_SFX_DURATION ms (clip is longer, we cut it short) */
function playBubbleClip(): void {
    if (!underwaterBubblesSound) return;
    if (bubblesStopTimer) { clearTimeout(bubblesStopTimer); bubblesStopTimer = null; }
    underwaterBubblesSound.element.currentTime = 0;
    underwaterBubblesSound.element.play().catch(() => {});
    bubblesStopTimer = setTimeout(() => {
        if (underwaterBubblesSound && !underwaterBubblesSound.element.paused) {
            underwaterBubblesSound.element.pause();
            underwaterBubblesSound.element.currentTime = 0;
        }
        bubblesStopTimer = null;
    }, BUBBLE_SFX_DURATION);
}

export async function playDiveSound(): Promise<void> {
    if (!audioInitialized || !isCurrentlyUnderwater) return;
    if (!underwaterBubblesSound || !underwaterBubblesSound.element.paused) return;
    playBubbleClip();
}

export function playWaterSplash(): void {
    if (!audioInitialized || isNatureMuted() || isCurrentlyUnderwater) return;
    if (!waterSplashSound) return;
    waterSplashSound.element.currentTime = 0;
    waterSplashSound.element.play().catch(() => {});
}

// ============================================
// HEALTH CHECK
// ============================================
function checkHealth(): void {
    if (!audioInitialized || natureMuted) return;
    if (_audioContext && _audioContext.state === 'suspended') {
        _audioContext.resume();
    }

    if (isCurrentlyUnderwater) {
        // Kill leaked above-water sounds
        if (waterSound1 && !waterSound1.element.paused) waterSound1.element.pause();
        if (waterSound2 && !waterSound2.element.paused) waterSound2.element.pause();
        if (breezeSound && !breezeSound.element.paused) { breezeSound.element.pause(); breezeActive = false; }
        if (fireplaceSound && !fireplaceSound.element.paused) { fireplaceSound.element.pause(); fireplaceActive = false; }
        // Ensure underwater ambient is playing
        if (underwaterAmbSound && underwaterAmbSound.element.paused) {
            underwaterAmbSound.gain.gain.value = UNDERWATER_AMB_VOLUME;
            underwaterAmbSound.element.play().catch(() => {});
        }
    } else {
        // Kill leaked underwater sounds
        if (underwaterAmbSound && !underwaterAmbSound.element.paused) { underwaterAmbSound.element.pause(); underwaterAmbSound.element.currentTime = 0; }
        if (underwaterBubblesSound && !underwaterBubblesSound.element.paused) { underwaterBubblesSound.element.pause(); underwaterBubblesSound.element.currentTime = 0; }
        // Ensure water loop is playing
        if (activeWaterSound && activeWaterSound.element.paused && !waterCrossfading) {
            activeWaterSound.gain.gain.value = WATER_VOLUME;
            activeWaterSound.element.currentTime = 0;
            activeWaterSound.element.play().catch(() => {});
        }
        // Ensure fireplace is playing at night
        if (fireplaceSound && fireplaceActive && fireplaceSound.element.paused) {
            fireplaceSound.gain.gain.value = FIREPLACE_VOLUME_MAX;
            fireplaceSound.element.play().catch(() => {});
        }
    }
}

// ============================================
// MUTE CONTROLS
// ============================================
export function isBreezeActive(): boolean {
    return breezeActive;
}

export function isNatureMuted(): boolean {
    return natureMuted;
}

export function isMusicMuted(): boolean {
    return musicMuted;
}

export function isInterfaceMuted(): boolean {
    return interfaceMuted;
}

export function setNatureMuted(muted: boolean): void {
    natureMuted = muted;
    if (natureGain) natureGain.gain.value = muted ? 0 : natureVolume;
}

export function setMusicMuted(muted: boolean): void {
    musicMuted = muted;
    window.dispatchEvent(new CustomEvent('musicMuteChanged', { detail: { muted } }));
}

export function setInterfaceMuted(muted: boolean): void {
    interfaceMuted = muted;
    if (interfaceGain) interfaceGain.gain.value = muted ? 0 : interfaceVolume;
}

// Volume getters
export function getNatureVolume(): number { return natureVolume; }
export function getMusicVolume(): number { return musicVolume; }
export function getInterfaceVolume(): number { return interfaceVolume; }

// Volume setters
export function setNatureVolume(v: number): void {
    natureVolume = v;
    localStorage.setItem('portfolio-nature-volume', v.toString());
    if (!natureMuted && natureGain) natureGain.gain.value = v;
}

export function setMusicVolume(v: number): void {
    musicVolume = v;
    localStorage.setItem('portfolio-music-volume', v.toString());
    window.dispatchEvent(new CustomEvent('musicVolumeChanged', { detail: { volume: v } }));
}

export function setInterfaceVolume(v: number): void {
    interfaceVolume = v;
    localStorage.setItem('portfolio-interface-volume', v.toString());
    if (!interfaceMuted && interfaceGain) interfaceGain.gain.value = v;
}

// ============================================
// UI SOUND EFFECTS
// ============================================
export function preloadUISounds(): void {
    if (!_audioContext || !interfaceGain) return;
    uiSwitchDaySound = createSound(AUDIO_PATHS.uiSwitchDay, interfaceGain, { volume: UI_SOUND_VOLUME });
    uiSwitchNightSound = createSound(AUDIO_PATHS.uiSwitchNight, interfaceGain, { volume: UI_SOUND_VOLUME });
    uiButtonSound = createSound(AUDIO_PATHS.uiButton, interfaceGain, { volume: UI_SOUND_VOLUME });
    uiBubbleExpandSound = createSound(AUDIO_PATHS.uiBubbleExpand, interfaceGain, { volume: UI_SOUND_VOLUME });
    uiBubbleCollapseSound = createSound(AUDIO_PATHS.uiBubbleCollapse, interfaceGain, { volume: UI_SOUND_VOLUME });
}

function playUISound(sound: UnifiedSound | null): void {
    const now = performance.now();
    if (now - lastUISoundTime < UI_SOUND_THROTTLE) return;
    if (interfaceMuted) return;
    lastUISoundTime = now;
    if (!sound) return;
    sound.element.currentTime = 0;
    sound.element.play().catch(() => {});
}

export function playUISwitchDay(): void { playUISound(uiSwitchDaySound); }
export function playUISwitchNight(): void { playUISound(uiSwitchNightSound); }
export function playUIButton(): void { playUISound(uiButtonSound); }
export function playUIBubbleExpand(): void { playUISound(uiBubbleExpandSound); }
export function playUIBubbleCollapse(): void { playUISound(uiBubbleCollapseSound); }

// ============================================
// INITIALIZATION
// ============================================
function initAudio(): void {
    if (audioInitialized) return;
    audioInitialized = true;

    // Clean up legacy localStorage key
    localStorage.removeItem('portfolio-audio-mode');

    // Create AudioContext (must be in user gesture for iOS)
    _audioContext = new AudioContext();

    // Group gain nodes (apply saved volume)
    natureGain = _audioContext.createGain();
    natureGain.gain.value = natureMuted ? 0 : natureVolume;
    natureGain.connect(_audioContext.destination);
    interfaceGain = _audioContext.createGain();
    interfaceGain.gain.value = interfaceMuted ? 0 : interfaceVolume;
    interfaceGain.connect(_audioContext.destination);

    // Create all nature sounds
    waterSound1 = createSound(AUDIO_PATHS.water, natureGain, { volume: WATER_VOLUME });
    waterSound2 = createSound(AUDIO_PATHS.water, natureGain, { volume: 0 });
    setupWaterCrossfade(waterSound1, waterSound2);
    setupWaterCrossfade(waterSound2, waterSound1);

    breezeSound = createSound(AUDIO_PATHS.breeze, natureGain, { volume: BREEZE_VOLUME });
    breezeSound.element.addEventListener('ended', () => {
        breezeActive = false;
        if (!isCurrentlyUnderwater) scheduleBreeze();
    });

    fireplaceSound = createSound(AUDIO_PATHS.fireplace, natureGain, { loop: true, volume: 0 });
    underwaterAmbSound = createSound(AUDIO_PATHS.underwaterAmb, natureGain, { loop: true, volume: UNDERWATER_AMB_VOLUME });
    underwaterBubblesSound = createSound(AUDIO_PATHS.underwaterBubbles, natureGain, { volume: TRANSITION_SFX_VOLUME });
    waterSplashSound = createSound(AUDIO_PATHS.waterSplash, natureGain, { volume: WATER_SPLASH_VOLUME });

    // Sync day state
    wasDay = isDayTime();

    // Start ambient sounds
    activeWaterSound = waterSound1;
    waterSound1.gain.gain.value = WATER_VOLUME;
    waterSound1.element.play().catch(() => {});
    scheduleBreeze();
    if (!isDayTime()) startFireplace();

    setupVisibilityHandler();
    console.log('Unified audio engine initialized');
}

function setupVisibilityHandler(): void {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && audioInitialized) {
            setTimeout(() => checkHealth(), 100);
        }
    });
    window.addEventListener('focus', () => {
        if (audioInitialized) {
            setTimeout(() => checkHealth(), 100);
        }
    });
}

export function startAudio(): void {
    if (listenersRemoved) return;
    listenersRemoved = true;
    initAudio();
}

// ============================================
// LIFECYCLE
// ============================================
export function Start(): void {
    wasDay = isDayTime();
}

export function Update(): void {
    if (!audioInitialized) return;

    const isDay = isDayTime();
    const now = performance.now();

    // Periodic health check
    if (now - lastAudioCheck > AUDIO_CHECK_INTERVAL) {
        lastAudioCheck = now;
        checkHealth();
    }

    // Day/night fireplace transitions (only above water)
    if (!isCurrentlyUnderwater) {
        if (wasDay && !isDay) startFireplace();
        if (!wasDay && isDay) stopFireplace();
    }

    wasDay = isDay;
}

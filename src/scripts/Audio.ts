import { isDayTime } from "../scene/Skybox";

// ============================================
// WEB AUDIO ENGINE
// 100% Web Audio API — AudioBuffer + AudioBufferSourceNode
// No HTML audio tags or MediaElementAudioSourceNode
// ============================================
let _audioContext: AudioContext | null = null;
export function getAudioContext(): AudioContext | null { return _audioContext; }

// ============================================
// AUDIO SETTINGS (easily tweakable)
// ============================================
const WATER_VOLUME = 1.0;
const BREEZE_VOLUME = 0.5;
const BREEZE_MIN_DELAY = 6;
const BREEZE_MAX_DELAY = 9;
const FIREPLACE_VOLUME_MAX = 0.4;
const FIREPLACE_FADE_DURATION = 1.5;
const UNDERWATER_AMB_VOLUME = 0.25;
const TRANSITION_SFX_VOLUME = 0.1;
const BUBBLE_SFX_DURATION = 2000;
const UI_SOUND_THROTTLE = 100;
const WATER_SPLASH_VOLUME = 0.3;
const UI_SOUND_VOLUME = 0.4;
const CHARACTER_SNORE_VOLUME = 0.5;
const CROSSFADE_DURATION = 1.0;
const AUDIO_CHECK_INTERVAL = 2000;
const FADE_IN_DURATION = 2.0;  // seconds — all audio fades in over this after start

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
    uiSpin: '/audio/ui/712916__greyfeather__spinning-a-crank-fast.wav',
    pugSnore: '/audio/character/freesound_community-pug-roncando-95042.mp3',
};

// ============================================
// PRE-FETCH CACHE (raw ArrayBuffers fetched during loading screen, before AudioContext)
// ============================================
const _prefetchCache = new Map<string, ArrayBuffer>();
let _prefetchPromise: Promise<void> | null = null;

/** Pre-fetch all audio files as raw ArrayBuffers (no AudioContext needed).
 *  Called early during loading screen so data is ready when user clicks Start. */
function prefetchAudioData(): void {
    if (_prefetchPromise) return;
    const paths = Object.values(AUDIO_PATHS);
    _prefetchPromise = Promise.all(
        paths.map(async (url) => {
            try {
                const resp = await fetch(url);
                const buf = await resp.arrayBuffer();
                _prefetchCache.set(url, buf);
            } catch (e) {
                console.warn('Audio prefetch failed:', url, e);
            }
        })
    ).then(() => {});
}

// ============================================
// WEB AUDIO BUFFER SOUND TYPE
// Each sound = AudioBuffer + GainNode + active AudioBufferSourceNode
// ============================================
interface BufferSound {
    buffer: AudioBuffer;
    gain: GainNode;
    source: AudioBufferSourceNode | null;
    loop: boolean;
    defaultVolume: number;
}

/** Fetch and decode an audio file into an AudioBuffer.
 *  Uses pre-fetched ArrayBuffer from cache when available (eliminates network delay). */
async function loadAudioBuffer(url: string): Promise<AudioBuffer> {
    const cached = _prefetchCache.get(url);
    if (cached) {
        _prefetchCache.delete(url); // free memory
        return _audioContext!.decodeAudioData(cached);
    }
    // Fallback: fetch from network (cache miss or prefetch not done)
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return _audioContext!.decodeAudioData(arrayBuffer);
}

/**
 * Create a buffer-based sound wired through the Web Audio graph.
 * @param buffer  Decoded AudioBuffer
 * @param dest    Destination GainNode (natureGain or interfaceGain)
 * @param options loop / volume
 */
function createBufferSound(
    buffer: AudioBuffer,
    dest: GainNode,
    options: { loop?: boolean; volume?: number } = {}
): BufferSound {
    const { loop = false, volume = 1 } = options;
    const gain = _audioContext!.createGain();
    gain.gain.value = volume;
    gain.connect(dest);
    return { buffer, gain, source: null, loop, defaultVolume: volume };
}

/**
 * Play a buffer sound (creates a new AudioBufferSourceNode each time).
 * Stops any currently active source for this sound first.
 */
function playBufferSound(sound: BufferSound, options?: { onEnded?: () => void }): AudioBufferSourceNode {
    stopBufferSound(sound);

    const ctx = _audioContext!;
    const source = ctx.createBufferSource();
    source.buffer = sound.buffer;
    source.loop = sound.loop;
    source.connect(sound.gain);

    source.onended = () => {
        if (sound.source === source) sound.source = null;
        options?.onEnded?.();
    };

    sound.source = source;
    source.start(0);
    return source;
}

/** Stop a buffer sound's active source */
function stopBufferSound(sound: BufferSound): void {
    if (sound.source) {
        try { sound.source.stop(); } catch { /* already stopped */ }
        try { sound.source.disconnect(); } catch { /* already disconnected */ }
        sound.source = null;
    }
}

/** Check if a buffer sound is currently playing */
function isBufferPlaying(sound: BufferSound | null): boolean {
    return sound !== null && sound.source !== null;
}

// ============================================
// GROUP GAIN NODES (nature / interface)
// ============================================
let masterGain: GainNode | null = null;
let natureGain: GainNode | null = null;
let interfaceGain: GainNode | null = null;
let characterGain: GainNode | null = null;

/** Master output node — all audio routes through this for global fade-in.
 *  External consumers (e.g. MediaPlayer) should connect here instead of ctx.destination. */
export function getMasterDestination(): AudioNode | null {
    return masterGain ?? _audioContext?.destination ?? null;
}

/** Character audio output node — dialog barks and pug snore route through this. */
export function getCharacterDestination(): AudioNode | null {
    return characterGain ?? getMasterDestination();
}

// ============================================
// NATURE SOUNDS
// ============================================
let waterSound1: BufferSound | null = null;
let waterSound2: BufferSound | null = null;
let activeWaterSound: BufferSound | null = null;
let waterCrossfading = false;
let waterCrossfadeTimer: ReturnType<typeof setTimeout> | null = null;
let waterSourceStartTime = 0;

let breezeSound: BufferSound | null = null;
let breezeTimeout: ReturnType<typeof setTimeout> | null = null;
let breezeActive = false;

let fireplaceSound: BufferSound | null = null;
let fireplaceActive = false;

let underwaterAmbSound: BufferSound | null = null;
let underwaterBubblesSound: BufferSound | null = null;
let bubblesStopTimer: ReturnType<typeof setTimeout> | null = null;

let waterSplashSound: BufferSound | null = null;

// ============================================
// CHARACTER SOUNDS
// ============================================
let pugSnoreSound: BufferSound | null = null;
let _snoreActive = false;
let _snoreTimeout: ReturnType<typeof setTimeout> | null = null;
const SNORE_MIN_PAUSE = 1.5;  // seconds of silence between snore clip plays
const SNORE_MAX_PAUSE = 3.0;

function _scheduleNextSnore(): void {
    if (!_snoreActive) return;
    const delay = SNORE_MIN_PAUSE + Math.random() * (SNORE_MAX_PAUSE - SNORE_MIN_PAUSE);
    _snoreTimeout = setTimeout(() => {
        if (!_snoreActive || !pugSnoreSound) return;
        if (isCurrentlyUnderwater) { stopPugSnore(); return; }  // Don't snore underwater
        playBufferSound(pugSnoreSound, {
            onEnded: () => { if (_snoreActive) _scheduleNextSnore(); }
        });
    }, delay * 1000);
}

// ============================================
// UI SOUNDS
// ============================================
let uiSwitchDaySound: BufferSound | null = null;
let uiSwitchNightSound: BufferSound | null = null;
let uiButtonSound: BufferSound | null = null;
let uiBubbleExpandSound: BufferSound | null = null;
let uiBubbleCollapseSound: BufferSound | null = null;
let uiSpinOpenSound: BufferSound | null = null;
let uiSpinCloseSound: BufferSound | null = null;

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
let characterMuted = false;

// Volume state (persisted to localStorage)
let natureVolume = parseFloat(localStorage.getItem('portfolio-nature-volume') ?? '1');
let musicVolume = parseFloat(localStorage.getItem('portfolio-music-volume') ?? '1');
let interfaceVolume = parseFloat(localStorage.getItem('portfolio-interface-volume') ?? '1');
let characterVolume = parseFloat(localStorage.getItem('portfolio-character-volume') ?? '1');

// ============================================
// WATER CROSSFADE
// Uses Web Audio gain ramps for smooth, reliable crossfade.
// Two AudioBufferSourceNodes alternate; a scheduled timer triggers the blend.
// ============================================
function startWaterLoop(): void {
    if (!waterSound1 || !_audioContext) return;
    waterSound1.gain.gain.value = WATER_VOLUME;
    playWaterAndSchedule(waterSound1);
}

/** Play a water sound source and schedule the next crossfade */
function playWaterAndSchedule(sound: BufferSound): void {
    const other = sound === waterSound1 ? waterSound2 : waterSound1;
    activeWaterSound = sound;

    playBufferSound(sound, {
        onEnded: () => {
            // Fallback: if crossfade didn't trigger (e.g. tab was backgrounded)
            if (!waterCrossfading && activeWaterSound === sound && !isCurrentlyUnderwater && other) {
                other.gain.gain.value = WATER_VOLUME;
                playWaterAndSchedule(other);
            }
        }
    });
    waterSourceStartTime = Date.now();
    if (other) scheduleWaterCrossfade(sound, other);
}

function scheduleWaterCrossfade(current: BufferSound, next: BufferSound): void {
    if (waterCrossfadeTimer) { clearTimeout(waterCrossfadeTimer); waterCrossfadeTimer = null; }
    if (!current.buffer) return;

    const endTime = waterSourceStartTime + current.buffer.duration * 1000;
    const delay = endTime - CROSSFADE_DURATION * 1000 - Date.now();
    if (delay <= 0) return;

    waterCrossfadeTimer = setTimeout(() => {
        if (isCurrentlyUnderwater || waterCrossfading) return;
        startCrossfadeTo(next);
    }, delay);
}

function startCrossfadeTo(next: BufferSound): void {
    if (!_audioContext || waterCrossfading) return;
    waterCrossfading = true;

    const ctx = _audioContext;
    const now = ctx.currentTime;
    const current = activeWaterSound;
    const other = next === waterSound1 ? waterSound2 : waterSound1;

    // Ramp current down
    if (current) {
        current.gain.gain.cancelScheduledValues(now);
        current.gain.gain.setValueAtTime(current.gain.gain.value, now);
        current.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE_DURATION);
    }

    // Start next and ramp up
    next.gain.gain.cancelScheduledValues(now);
    next.gain.gain.setValueAtTime(0, now);
    next.gain.gain.linearRampToValueAtTime(WATER_VOLUME, now + CROSSFADE_DURATION);

    playBufferSound(next, {
        onEnded: () => {
            if (!waterCrossfading && activeWaterSound === next && !isCurrentlyUnderwater && other) {
                other.gain.gain.value = WATER_VOLUME;
                playWaterAndSchedule(other);
            }
        }
    });
    waterSourceStartTime = Date.now();

    // After ramp completes, stop old source & schedule next crossfade
    setTimeout(() => {
        if (current) stopBufferSound(current);
        activeWaterSound = next;
        waterCrossfading = false;

        if (other && !isCurrentlyUnderwater) {
            scheduleWaterCrossfade(next, other);
        }
    }, CROSSFADE_DURATION * 1000 + 50);
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
    breezeActive = true;
    playBufferSound(breezeSound, {
        onEnded: () => {
            breezeActive = false;
            if (!isCurrentlyUnderwater) scheduleBreeze();
        }
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
    fireplaceSound.gain.gain.cancelScheduledValues(now);
    fireplaceSound.gain.gain.setValueAtTime(0, now);
    fireplaceSound.gain.gain.linearRampToValueAtTime(FIREPLACE_VOLUME_MAX, now + FIREPLACE_FADE_DURATION);
    playBufferSound(fireplaceSound);
}

function stopFireplace(): void {
    if (!fireplaceActive || !fireplaceSound || !_audioContext) return;
    const ctx = _audioContext;
    const now = ctx.currentTime;
    fireplaceSound.gain.gain.cancelScheduledValues(now);
    fireplaceSound.gain.gain.setValueAtTime(fireplaceSound.gain.gain.value, now);
    fireplaceSound.gain.gain.linearRampToValueAtTime(0, now + 0.5);
    setTimeout(() => {
        if (fireplaceSound) stopBufferSound(fireplaceSound);
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
    if (waterCrossfadeTimer) { clearTimeout(waterCrossfadeTimer); waterCrossfadeTimer = null; }
    if (waterSound1) stopBufferSound(waterSound1);
    if (waterSound2) stopBufferSound(waterSound2);
    waterCrossfading = false;

    if (breezeTimeout) { clearTimeout(breezeTimeout); breezeTimeout = null; }
    if (breezeSound && isBufferPlaying(breezeSound)) {
        stopBufferSound(breezeSound);
        breezeActive = false;
    }
    if (fireplaceActive) stopFireplace();
    stopPugSnore();

    // Start underwater sounds
    if (!natureMuted) {
        if (underwaterAmbSound) {
            underwaterAmbSound.gain.gain.value = UNDERWATER_AMB_VOLUME;
            playBufferSound(underwaterAmbSound);
        }
        playBubbleClip();
    }
}

export function transitionToAboveWater(): void {
    if (!audioInitialized || !isCurrentlyUnderwater) return;
    isCurrentlyUnderwater = false;

    // Stop underwater sounds
    if (bubblesStopTimer) { clearTimeout(bubblesStopTimer); bubblesStopTimer = null; }
    if (underwaterAmbSound) stopBufferSound(underwaterAmbSound);
    if (underwaterBubblesSound) stopBufferSound(underwaterBubblesSound);

    // Resume above-water sounds
    if (!natureMuted) {
        if (activeWaterSound) {
            activeWaterSound.gain.gain.value = WATER_VOLUME;
            playWaterAndSchedule(activeWaterSound);
        }
        scheduleBreeze();
        if (!isDayTime()) startFireplace();
    }
}

/** Play bubble SFX for BUBBLE_SFX_DURATION ms (clip is longer, we cut it short) */
function playBubbleClip(): void {
    if (!underwaterBubblesSound) return;
    if (bubblesStopTimer) { clearTimeout(bubblesStopTimer); bubblesStopTimer = null; }
    playBufferSound(underwaterBubblesSound);
    bubblesStopTimer = setTimeout(() => {
        if (underwaterBubblesSound) stopBufferSound(underwaterBubblesSound);
        bubblesStopTimer = null;
    }, BUBBLE_SFX_DURATION);
}

export async function playDiveSound(): Promise<void> {
    if (!audioInitialized || !isCurrentlyUnderwater) return;
    if (!underwaterBubblesSound || isBufferPlaying(underwaterBubblesSound)) return;
    playBubbleClip();
}

export function playWaterSplash(): void {
    if (!audioInitialized || isNatureMuted() || isCurrentlyUnderwater) return;
    if (!waterSplashSound) return;
    playBufferSound(waterSplashSound);
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
        if (waterCrossfadeTimer) { clearTimeout(waterCrossfadeTimer); waterCrossfadeTimer = null; }
        if (waterSound1 && isBufferPlaying(waterSound1)) stopBufferSound(waterSound1);
        if (waterSound2 && isBufferPlaying(waterSound2)) stopBufferSound(waterSound2);
        if (breezeSound && isBufferPlaying(breezeSound)) { stopBufferSound(breezeSound); breezeActive = false; }
        if (fireplaceSound && isBufferPlaying(fireplaceSound)) { stopBufferSound(fireplaceSound); fireplaceActive = false; }
        if (_snoreActive) stopPugSnore();
        // Ensure underwater ambient is playing
        if (underwaterAmbSound && !isBufferPlaying(underwaterAmbSound)) {
            underwaterAmbSound.gain.gain.value = UNDERWATER_AMB_VOLUME;
            playBufferSound(underwaterAmbSound);
        }
    } else {
        // Kill leaked underwater sounds
        if (underwaterAmbSound && isBufferPlaying(underwaterAmbSound)) stopBufferSound(underwaterAmbSound);
        if (underwaterBubblesSound && isBufferPlaying(underwaterBubblesSound)) stopBufferSound(underwaterBubblesSound);
        // Ensure water loop is playing
        if (activeWaterSound && !isBufferPlaying(activeWaterSound) && !waterCrossfading) {
            activeWaterSound.gain.gain.value = WATER_VOLUME;
            playWaterAndSchedule(activeWaterSound);
        }
        // Ensure fireplace is playing at night
        if (fireplaceSound && fireplaceActive && !isBufferPlaying(fireplaceSound)) {
            fireplaceSound.gain.gain.value = FIREPLACE_VOLUME_MAX;
            playBufferSound(fireplaceSound);
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

export function getCharacterVolume(): number { return characterVolume; }
export function isCharacterMuted(): boolean { return characterMuted; }

export function setCharacterVolume(v: number): void {
    characterVolume = v;
    localStorage.setItem('portfolio-character-volume', v.toString());
    if (!characterMuted && characterGain) characterGain.gain.value = v;
}

export function setCharacterMuted(muted: boolean): void {
    characterMuted = muted;
    if (characterGain) characterGain.gain.value = muted ? 0 : characterVolume;
}

/** Start pug snoring loop (safe to call repeatedly — no-op if already active). */
export function playPugSnore(): void {
    if (!audioInitialized || !pugSnoreSound) return;
    if (_snoreActive) return;  // already playing/scheduled
    if (isCurrentlyUnderwater) return;  // Don't snore underwater
    _snoreActive = true;
    // Play first clip immediately, then schedule repeats via onEnded
    playBufferSound(pugSnoreSound, {
        onEnded: () => { if (_snoreActive) _scheduleNextSnore(); }
    });
}

/** Play pug snore sound exactly once — no loop scheduling. Used for dialog line cues. */
export function playPugSnoreOnce(): void {
    if (!audioInitialized || !pugSnoreSound) return;
    if (isCurrentlyUnderwater) return;
    playBufferSound(pugSnoreSound, {});
}

/** Stop pug snore and cancel any pending replay. */
export function stopPugSnore(): void {
    _snoreActive = false;
    if (_snoreTimeout) { clearTimeout(_snoreTimeout); _snoreTimeout = null; }
    if (pugSnoreSound) stopBufferSound(pugSnoreSound);
}

// ============================================
// UI SOUND EFFECTS
// ============================================
/** Create a reversed copy of an AudioBuffer (for playing sounds backwards) */
function reverseAudioBuffer(buffer: AudioBuffer): AudioBuffer {
    const ctx = _audioContext!;
    const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const src = buffer.getChannelData(ch);
        const dst = reversed.getChannelData(ch);
        for (let i = 0; i < src.length; i++) {
            dst[i] = src[src.length - 1 - i];
        }
    }
    return reversed;
}

export async function preloadUISounds(): Promise<void> {
    if (!_audioContext || !interfaceGain) return;
    try {
        const [switchDayBuf, switchNightBuf, buttonBuf, bubbleExpandBuf, bubbleCollapseBuf, spinBuf] = await Promise.all([
            loadAudioBuffer(AUDIO_PATHS.uiSwitchDay),
            loadAudioBuffer(AUDIO_PATHS.uiSwitchNight),
            loadAudioBuffer(AUDIO_PATHS.uiButton),
            loadAudioBuffer(AUDIO_PATHS.uiBubbleExpand),
            loadAudioBuffer(AUDIO_PATHS.uiBubbleCollapse),
            loadAudioBuffer(AUDIO_PATHS.uiSpin),
        ]);
        uiSwitchDaySound = createBufferSound(switchDayBuf, interfaceGain, { volume: UI_SOUND_VOLUME });
        uiSwitchNightSound = createBufferSound(switchNightBuf, interfaceGain, { volume: UI_SOUND_VOLUME });
        uiButtonSound = createBufferSound(buttonBuf, interfaceGain, { volume: UI_SOUND_VOLUME });
        uiBubbleExpandSound = createBufferSound(bubbleExpandBuf, interfaceGain, { volume: UI_SOUND_VOLUME });
        uiBubbleCollapseSound = createBufferSound(bubbleCollapseBuf, interfaceGain, { volume: UI_SOUND_VOLUME });
        uiSpinOpenSound = createBufferSound(spinBuf, interfaceGain, { volume: UI_SOUND_VOLUME });
        uiSpinCloseSound = createBufferSound(reverseAudioBuffer(spinBuf), interfaceGain, { volume: UI_SOUND_VOLUME });
    } catch (e) {
        console.warn('Failed to preload UI sounds:', e);
    }
}

function playUISound(sound: BufferSound | null): void {
    const now = performance.now();
    if (now - lastUISoundTime < UI_SOUND_THROTTLE) return;
    if (interfaceMuted) return;
    lastUISoundTime = now;
    if (!sound) return;
    playBufferSound(sound);
}

export function playUISwitchDay(): void { playUISound(uiSwitchDaySound); }
export function playUISwitchNight(): void { playUISound(uiSwitchNightSound); }
export function playUIButton(): void { playUISound(uiButtonSound); }
export function playUIBubbleExpand(): void { playUISound(uiBubbleExpandSound); }
export function playUIBubbleCollapse(): void { playUISound(uiBubbleCollapseSound); }
export function playUISpinOpen(): void { playUISound(uiSpinOpenSound); }
export function playUISpinClose(): void { playUISound(uiSpinCloseSound); }

// ============================================
// INITIALIZATION
// ============================================
async function initAudio(): Promise<void> {
    if (audioInitialized) return;
    audioInitialized = true;

    // Clean up legacy localStorage key
    localStorage.removeItem('portfolio-audio-mode');

    // Create AudioContext (must be in user gesture for iOS)
    _audioContext = new AudioContext();

    // Master gain — starts at 0 for global fade-in after start
    masterGain = _audioContext.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(_audioContext.destination);

    // Group gain nodes routed through master (apply saved volume)
    natureGain = _audioContext.createGain();
    natureGain.gain.value = natureMuted ? 0 : natureVolume;
    natureGain.connect(masterGain);
    interfaceGain = _audioContext.createGain();
    interfaceGain.gain.value = interfaceMuted ? 0 : interfaceVolume;
    interfaceGain.connect(masterGain);
    characterGain = _audioContext.createGain();
    characterGain.gain.value = characterMuted ? 0 : characterVolume;
    characterGain.connect(masterGain);

    // Wait for pre-fetched audio data (eliminates network delay)
    if (_prefetchPromise) await _prefetchPromise;

    // Load and decode all nature sound buffers
    try {
        const [waterBuf, breezeBuf, fireplaceBuf, underwaterAmbBuf, underwaterBubblesBuf, waterSplashBuf] = await Promise.all([
            loadAudioBuffer(AUDIO_PATHS.water),
            loadAudioBuffer(AUDIO_PATHS.breeze),
            loadAudioBuffer(AUDIO_PATHS.fireplace),
            loadAudioBuffer(AUDIO_PATHS.underwaterAmb),
            loadAudioBuffer(AUDIO_PATHS.underwaterBubbles),
            loadAudioBuffer(AUDIO_PATHS.waterSplash),
        ]);

        waterSound1 = createBufferSound(waterBuf, natureGain, { volume: WATER_VOLUME });
        waterSound2 = createBufferSound(waterBuf, natureGain, { volume: 0 });
        breezeSound = createBufferSound(breezeBuf, natureGain, { volume: BREEZE_VOLUME });
        fireplaceSound = createBufferSound(fireplaceBuf, natureGain, { loop: true, volume: 0 });
        underwaterAmbSound = createBufferSound(underwaterAmbBuf, natureGain, { loop: true, volume: UNDERWATER_AMB_VOLUME });
        underwaterBubblesSound = createBufferSound(underwaterBubblesBuf, natureGain, { volume: TRANSITION_SFX_VOLUME });
        waterSplashSound = createBufferSound(waterSplashBuf, natureGain, { volume: WATER_SPLASH_VOLUME });

        // Load character sounds
        try {
            const pugSnoreBuf = await loadAudioBuffer(AUDIO_PATHS.pugSnore);
            pugSnoreSound = createBufferSound(pugSnoreBuf, characterGain!, { loop: false, volume: CHARACTER_SNORE_VOLUME });
        } catch (e) {
            console.warn('Failed to load character sounds:', e);
        }

        // Sync day state
        wasDay = isDayTime();

        // Start appropriate ambient sounds based on current state
        if (!isCurrentlyUnderwater) {
            startWaterLoop();
            scheduleBreeze();
            if (!isDayTime()) startFireplace();
        } else {
            // Already underwater when buffers finished loading
            if (!natureMuted && underwaterAmbSound) {
                underwaterAmbSound.gain.gain.value = UNDERWATER_AMB_VOLUME;
                playBufferSound(underwaterAmbSound);
            }
        }
    } catch (e) {
        console.error('Failed to load audio buffers:', e);
    }

    // Gradually fade in all audio from silence
    const now = _audioContext.currentTime;
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(1, now + FADE_IN_DURATION);

    setupVisibilityHandler();
    console.log('Web Audio engine initialized (pure AudioBuffer)');
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
    initAudio(); // AudioContext created synchronously (required for iOS), buffers load async
}

// ============================================
// LIFECYCLE
// ============================================
export function Start(): void {
    wasDay = isDayTime();
    // Begin fetching audio files early (during loading screen) so they're cached by the time user clicks Start
    prefetchAudioData();
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

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
const WATER_VOLUME = 0.15;
const BREEZE_VOLUME = 0.3;
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

// ── Intro (sky / pre-descent) audio ──────────────────────────────────────────
// Plays from start-click until the camera begins descending. Both fade in
// gradually from silence and fade out gradually when the descent triggers.
const INTRO_PIANO_VOLUME       = 0.25;   // Loop volume while in sky
const INTRO_BREEZE_VOLUME      = 0.08;   // Quieter than scene breeze on purpose
const INTRO_BREEZE_INTERVAL    = 5;      // Seconds between breeze plays
const INTRO_FADE_IN_DURATION   = 3.0;    // Fade-in when start clicked
const INTRO_FADE_OUT_DURATION  = 2.5;    // Fade-out when descent begins
export const INTRO_WRITING_VOLUME = 0.03; // Tegaki pen scratching during welcome text — read by WelcomeText.ts

// ── Day-time bird tweets (played on click — see Island.ts robin interaction) ─
const DAY_BIRD_VOLUME = 0.6;             // EASY TO TWEAK — on-click bird tweet volume

// ── Night crickets loop ──────────────────────────────────────────────────────
const CRICKETS_VOLUME       = 0.08;      // EASY TO TWEAK — very soft
const CRICKETS_FADE_DURATION = 0;      // Day↔night crossfade

// ── Scene audio reveal (camera proximity to island) ──────────────────────────
// Scene audio is silent while camera is high above the island and ramps up
// linearly as the camera descends past these thresholds.
const SCENE_REVEAL_START_Y = 5.5;        // Above this Y: scene audio silent
const SCENE_REVEAL_END_Y   = 2.5;        // Below this Y: scene audio full volume

const AUDIO_PATHS = {
    water: 'audio/nature/surface/waves.mp3',
    breeze: 'audio/nature/surface/breeze.mp3',
    fireplace: 'audio/nature/surface/fireplace.opus',
    underwaterAmb: 'audio/nature/underwater/366159__dcsfx__underwater-loop-amb.opus',
    underwaterBubbles: 'audio/nature/underwater/96742__robinhood76__01650-underwater-bubbles.mp3',
    waterSplash: 'audio/nature/surface/274060__junggle__water-splash-11.mp3',
    introPiano: 'audio/music/320526__benpm__ambient-piano-music-3.mp3',
    dayBird1: 'audio/nature/surface/31062 Ortolan bird tweet-full.mp3',
    dayBird2: 'audio/nature/surface/31451 Ortolan bunting bird isolated tweet-full.mp3',
    crickets: 'audio/nature/surface/Crickets.mp3',
    uiSwitchDay: '/audio/ui/dragon-studio-light-switch-on-382714.mp3',
    uiSwitchNight: '/audio/ui/dragon-studio-light-switch-382712.mp3',
    uiButton: '/audio/ui/soundreality-button-202966.mp3',
    uiBubbleExpand: '/audio/ui/universfield-bubble-pop-293342.mp3',
    uiBubbleCollapse: '/audio/ui/universfield-bubble-pop-06-351337.mp3',
    uiSpin: '/audio/ui/712916__greyfeather__spinning-a-crank-fast.mp3',
    pugSnore: '/audio/character/pug/freesound_community-pug-roncando-95042.mp3',
};

const INTERACTION_AUDIO_PATHS = {
    appleImpact: 'audio/overall/209012__owlstorm__fruit-impact-1.mp3',
    chestOpen: 'audio/overall/771164__steprock__treasure-chest-open.mp3',
    writing: '/audio/ui/335518__newagesoup__writing-short-8.mp3',
    coral: [
        'audio/nature/underwater/321802__lloydevans09__pvc_pipe_hit_4.mp3',
        'audio/nature/underwater/321805__lloydevans09__pvc_pipe_hit_1.mp3',
        'audio/nature/underwater/321808__lloydevans09__pvc_pipe_hit_3.mp3',
    ],
    dialog: [
        '/audio/character/pug/freesound_community-pug-woof-2-103762_PRIMEIRA.mp3',
        '/audio/character/pug/freesound_community-pug-woof-2-103762_SEGUNDA.mp3',
    ],
};

// ============================================
// PRE-FETCH CACHE (raw ArrayBuffers fetched during loading screen, before AudioContext)
// ============================================
const _prefetchCache = new Map<string, ArrayBuffer>();
const _decodedBufferCache = new Map<string, AudioBuffer>();
let _prefetchPromise: Promise<void> | null = null;

/** Pre-fetch ambient/music audio files as raw ArrayBuffers (no AudioContext needed).
 *  Called early during loading screen so ambient audio is ready when user clicks Start.
 *  UI sounds (/audio/ui/) are excluded — they are loaded by preloadUISounds() after
 *  the start click so they don't compete with GLTF model downloads during loading. */
export function preloadAudioBytes(): Promise<void> {
    if (_prefetchPromise) return _prefetchPromise;
    const paths = Array.from(new Set([
        ...Object.values(AUDIO_PATHS),
        INTERACTION_AUDIO_PATHS.appleImpact,
        INTERACTION_AUDIO_PATHS.chestOpen,
        INTERACTION_AUDIO_PATHS.writing,
        ...INTERACTION_AUDIO_PATHS.coral,
        ...INTERACTION_AUDIO_PATHS.dialog,
    ]));
    _prefetchPromise = Promise.all(
        paths.map(async (url) => {
            try {
                if (_prefetchCache.has(url)) return;
                const resp = await fetch(url);
                const buf = await resp.arrayBuffer();
                _prefetchCache.set(url, buf);
            } catch (e) {
                console.warn('Audio prefetch failed:', url, e);
            }
        })
    ).then(() => {});
    return _prefetchPromise;
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
    const decoded = _decodedBufferCache.get(url);
    if (decoded) return decoded;

    const cached = _prefetchCache.get(url);
    if (cached) {
        _prefetchCache.delete(url); // free memory
        const decodedBuffer = await _audioContext!.decodeAudioData(cached);
        _decodedBufferCache.set(url, decodedBuffer);
        return decodedBuffer;
    }
    // Fallback: fetch from network (cache miss or prefetch not done)
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const decodedBuffer = await _audioContext!.decodeAudioData(arrayBuffer);
    _decodedBufferCache.set(url, decodedBuffer);
    return decodedBuffer;
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

// Sub-gain nodes between natureGain and individual sound gains. Let us fade
// the intro audio independently from the scene audio, and ramp scene audio
// based on camera Y proximity to the island.
let introGain: GainNode | null = null;
let sceneRevealGain: GainNode | null = null;

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

// ── Intro / sky audio ────────────────────────────────────────────────────────
let introPianoSound: BufferSound | null = null;
let introBreezeSound: BufferSound | null = null;
let introBreezeTimeout: ReturnType<typeof setTimeout> | null = null;
let introPianoActive = false;

// ── Day birds + night crickets ───────────────────────────────────────────────
// Bird tweets are click-triggered from Island.ts (robin interaction). The
// buffers stay loaded so playBirdTweet() can fire them on demand.
let dayBirdSounds: BufferSound[] = [];
let cricketsSound: BufferSound | null = null;
let cricketsActive = false;

// ── Scene reveal state ───────────────────────────────────────────────────────
// Armed when descent begins. While armed, sceneRevealGain.gain is set each
// frame from camera Y. Once it reaches ~1, the scene is considered "revealed"
// and we stop touching the gain (so user volume changes flow through normally).
let sceneRevealArmed = false;
let sceneRevealComplete = false;   // true once gain has reached full
let sceneAudioStarted = false;     // true once water/breeze/etc loops have been kicked off

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
// INTRO (SKY) AUDIO — piano loop + soft scheduled breeze
// Plays from start-click until camera descent triggers transition.
// ============================================
function startIntroPiano(): void {
    if (!introPianoSound || !_audioContext || !introGain) return;
    const ctx = _audioContext;
    const now = ctx.currentTime;
    introPianoActive = true;
    // Ramp introGain from 0 to 1 (volume of individual sounds set on their gains)
    introGain.gain.cancelScheduledValues(now);
    introGain.gain.setValueAtTime(0, now);
    introGain.gain.linearRampToValueAtTime(1, now + INTRO_FADE_IN_DURATION);
    introPianoSound.gain.gain.value = INTRO_PIANO_VOLUME;
    playBufferSound(introPianoSound);
    scheduleIntroBreeze();
}

function scheduleIntroBreeze(): void {
    if (introBreezeTimeout) { clearTimeout(introBreezeTimeout); introBreezeTimeout = null; }
    if (!introPianoActive) return;
    introBreezeTimeout = setTimeout(() => {
        if (!introPianoActive || !introBreezeSound) return;
        introBreezeSound.gain.gain.value = INTRO_BREEZE_VOLUME;
        playBufferSound(introBreezeSound, {
            onEnded: () => { if (introPianoActive) scheduleIntroBreeze(); }
        });
    }, INTRO_BREEZE_INTERVAL * 1000);
}

function stopIntroAudio(): void {
    if (!introPianoActive) return;
    introPianoActive = false;
    if (introBreezeTimeout) { clearTimeout(introBreezeTimeout); introBreezeTimeout = null; }
    if (!_audioContext || !introGain) return;
    const ctx = _audioContext;
    const now = ctx.currentTime;
    introGain.gain.cancelScheduledValues(now);
    introGain.gain.setValueAtTime(introGain.gain.value, now);
    introGain.gain.linearRampToValueAtTime(0, now + INTRO_FADE_OUT_DURATION);
    // Hard-stop the sources after the fade completes so they don't keep CPU,
    // then drop the intro-only AudioBuffer references so the decoded PCM can be
    // GC'd. The intro piano never plays again after the descent — keeping its
    // ~1 MB AudioBuffer alive for the rest of the session is wasted memory.
    setTimeout(() => {
        if (introPianoSound) {
            stopBufferSound(introPianoSound);
            introPianoSound = null;
        }
        if (introBreezeSound) {
            stopBufferSound(introBreezeSound);
            introBreezeSound = null;
        }
        _decodedBufferCache.delete(AUDIO_PATHS.introPiano);
    }, INTRO_FADE_OUT_DURATION * 1000 + 100);
}

/** Called from UI.ts when the camera descent begins. Fades intro audio out
 *  and arms scene audio to fade in based on camera proximity (Audio.Update). */
export function transitionFromIntroToScene(): void {
    if (!audioInitialized) return;
    stopIntroAudio();
    sceneRevealArmed = true;
    sceneRevealComplete = false;
    // Start the scene loops NOW (silenced by sceneRevealGain=0). They'll be
    // audible as the camera descends and sceneRevealGain ramps up.
    startSceneAudio();
}

// ============================================
// SCENE AUDIO (water, scene breeze, fireplace, birds, crickets)
// Started by transitionFromIntroToScene. Gated by sceneRevealGain.
// ============================================
function startSceneAudio(): void {
    if (sceneAudioStarted || isCurrentlyUnderwater) return;
    sceneAudioStarted = true;

    if (!natureMuted) {
        startWaterLoop();
        scheduleBreeze();
        if (!isDayTime()) startFireplace();
        if (!isDayTime()) startCrickets();
    }
}

// ============================================
// BIRD TWEET (on-demand — fired by clicking a robin in Island.ts)
// ============================================
/** Play the indexed bird tweet (0 = first robin, 1 = second). Safe to call
 *  before audio is initialized — no-op in that case. Also no-op underwater. */
export function playBirdTweet(index: number): void {
    if (!audioInitialized || isCurrentlyUnderwater) return;
    if (index < 0 || index >= dayBirdSounds.length) return;
    const sound = dayBirdSounds[index];
    if (!sound) return;
    sound.gain.gain.value = DAY_BIRD_VOLUME;
    playBufferSound(sound);
}

// ============================================
// NIGHT CRICKETS (loop, night-time only, with day↔night fade)
// ============================================
function startCrickets(): void {
    if (cricketsActive || !cricketsSound || !_audioContext) return;
    cricketsActive = true;
    const ctx = _audioContext;
    const now = ctx.currentTime;
    cricketsSound.gain.gain.cancelScheduledValues(now);
    cricketsSound.gain.gain.setValueAtTime(0, now);
    cricketsSound.gain.gain.linearRampToValueAtTime(CRICKETS_VOLUME, now + CRICKETS_FADE_DURATION);
    playBufferSound(cricketsSound);
}

function stopCrickets(): void {
    if (!cricketsActive || !cricketsSound || !_audioContext) return;
    cricketsActive = false;
    const ctx = _audioContext;
    const now = ctx.currentTime;
    cricketsSound.gain.gain.cancelScheduledValues(now);
    cricketsSound.gain.gain.setValueAtTime(cricketsSound.gain.gain.value, now);
    cricketsSound.gain.gain.linearRampToValueAtTime(0, now + CRICKETS_FADE_DURATION);
    setTimeout(() => {
        if (cricketsSound && !cricketsActive) stopBufferSound(cricketsSound);
    }, CRICKETS_FADE_DURATION * 1000 + 100);
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
    if (cricketsActive) stopCrickets();
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
        if (!isDayTime()) startCrickets();
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
        if (cricketsSound && isBufferPlaying(cricketsSound)) { stopBufferSound(cricketsSound); cricketsActive = false; }
        if (_snoreActive) stopPugSnore();
        // Ensure underwater ambient is playing
        if (underwaterAmbSound && !isBufferPlaying(underwaterAmbSound)) {
            underwaterAmbSound.gain.gain.value = UNDERWATER_AMB_VOLUME;
            playBufferSound(underwaterAmbSound);
        }
    } else if (sceneAudioStarted) {
        // Kill leaked underwater sounds (only relevant after scene revealed)
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
        // Ensure crickets are playing at night
        if (cricketsSound && cricketsActive && !isBufferPlaying(cricketsSound)) {
            cricketsSound.gain.gain.value = CRICKETS_VOLUME;
            playBufferSound(cricketsSound);
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

function playOneShot(
    buffer: AudioBuffer | undefined,
    dest: AudioNode | null,
    options: { volume: number; playbackRate?: number; lowpass?: number; duration?: number; onEnded?: () => void },
): void {
    const ctx = _audioContext;
    if (!ctx || !dest || !buffer) {
        options.onEnded?.();
        return;
    }

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = options.playbackRate ?? 1;
    gain.gain.value = options.volume;

    if (options.lowpass) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = options.lowpass;
        filter.Q.value = 0.7;
        source.connect(filter);
        filter.connect(gain);
    } else {
        source.connect(gain);
    }

    gain.connect(dest);
    if (options.onEnded) source.addEventListener('ended', options.onEnded, { once: true });
    if (options.duration !== undefined) source.start(0, 0, options.duration);
    else source.start();
}

let _chestReverseBuffer: AudioBuffer | null = null;

async function preloadInteractionSounds(): Promise<void> {
    await Promise.all([
        loadAudioBuffer(INTERACTION_AUDIO_PATHS.appleImpact),
        loadAudioBuffer(INTERACTION_AUDIO_PATHS.chestOpen),
        ...INTERACTION_AUDIO_PATHS.coral.map(url => loadAudioBuffer(url)),
        ...INTERACTION_AUDIO_PATHS.dialog.map(url => loadAudioBuffer(url)),
    ]);
    const chestBuffer = _decodedBufferCache.get(INTERACTION_AUDIO_PATHS.chestOpen);
    if (chestBuffer && !_chestReverseBuffer) {
        _chestReverseBuffer = reverseAudioBuffer(chestBuffer);
    }
}

export function playAppleImpactSound(): void {
    playOneShot(
        _decodedBufferCache.get(INTERACTION_AUDIO_PATHS.appleImpact),
        getMasterDestination(),
        { volume: 1.5 },
    );
}

export function playChestOpenSound(): void {
    playOneShot(
        _decodedBufferCache.get(INTERACTION_AUDIO_PATHS.chestOpen),
        getMasterDestination(),
        { volume: 4.0, lowpass: 500 },
    );
}

export function playChestCloseSound(cutoffRatio = 0.6): void {
    const buffer = _chestReverseBuffer ?? undefined;
    playOneShot(
        buffer,
        getMasterDestination(),
        { volume: 4.0, lowpass: 500, duration: buffer ? buffer.duration * cutoffRatio : undefined },
    );
}

const CORAL_PITCH = [0.8, 1.0, 1.3];

export function playCoralHitSound(idx: number): void {
    const url = INTERACTION_AUDIO_PATHS.coral[idx];
    if (!url) return;
    playOneShot(
        _decodedBufferCache.get(url),
        getMasterDestination(),
        { volume: 0.65, playbackRate: CORAL_PITCH[idx] ?? 1, lowpass: 600 },
    );
}

export function playDialogSound(url: string, onEnd?: () => void): void {
    playOneShot(
        _decodedBufferCache.get(url),
        getCharacterDestination(),
        { volume: 0.85, onEnded: onEnd },
    );
}

export async function preloadUISounds(): Promise<void> {
    if (!_audioContext || !interfaceGain) return;
    if (uiButtonSound && uiSpinCloseSound) return;
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

    // Sub-buses: intro audio (sky) and scene audio (after descent reveal).
    // Both route through natureGain so the user's nature volume/mute still applies.
    introGain = _audioContext.createGain();
    introGain.gain.value = 0;  // ramped up by startIntroPiano
    introGain.connect(natureGain);

    sceneRevealGain = _audioContext.createGain();
    sceneRevealGain.gain.value = 0;  // ramped up by Audio.Update based on cameraY
    sceneRevealGain.connect(natureGain);

    // Wait for pre-fetched audio data (eliminates network delay)
    await preloadAudioBytes();

    // Load and decode all nature sound buffers
    try {
        const [
            waterBuf, breezeBuf, fireplaceBuf, underwaterAmbBuf, underwaterBubblesBuf, waterSplashBuf,
            introPianoBuf, dayBird1Buf, dayBird2Buf, cricketsBuf,
        ] = await Promise.all([
            loadAudioBuffer(AUDIO_PATHS.water),
            loadAudioBuffer(AUDIO_PATHS.breeze),
            loadAudioBuffer(AUDIO_PATHS.fireplace),
            loadAudioBuffer(AUDIO_PATHS.underwaterAmb),
            loadAudioBuffer(AUDIO_PATHS.underwaterBubbles),
            loadAudioBuffer(AUDIO_PATHS.waterSplash),
            loadAudioBuffer(AUDIO_PATHS.introPiano),
            loadAudioBuffer(AUDIO_PATHS.dayBird1),
            loadAudioBuffer(AUDIO_PATHS.dayBird2),
            loadAudioBuffer(AUDIO_PATHS.crickets),
        ]);

        // Scene sounds route through sceneRevealGain (gated by camera proximity).
        waterSound1 = createBufferSound(waterBuf, sceneRevealGain, { volume: WATER_VOLUME });
        waterSound2 = createBufferSound(waterBuf, sceneRevealGain, { volume: 0 });
        breezeSound = createBufferSound(breezeBuf, sceneRevealGain, { volume: BREEZE_VOLUME });
        fireplaceSound = createBufferSound(fireplaceBuf, sceneRevealGain, { loop: true, volume: 0 });
        underwaterAmbSound = createBufferSound(underwaterAmbBuf, sceneRevealGain, { loop: true, volume: UNDERWATER_AMB_VOLUME });
        underwaterBubblesSound = createBufferSound(underwaterBubblesBuf, sceneRevealGain, { volume: TRANSITION_SFX_VOLUME });
        waterSplashSound = createBufferSound(waterSplashBuf, sceneRevealGain, { volume: WATER_SPLASH_VOLUME });
        dayBirdSounds = [
            createBufferSound(dayBird1Buf, sceneRevealGain, { volume: DAY_BIRD_VOLUME }),
            createBufferSound(dayBird2Buf, sceneRevealGain, { volume: DAY_BIRD_VOLUME }),
        ];
        cricketsSound = createBufferSound(cricketsBuf, sceneRevealGain, { loop: true, volume: 0 });

        // Intro sounds route through introGain (faded in at start, out at descent).
        introPianoSound = createBufferSound(introPianoBuf, introGain, { loop: true, volume: INTRO_PIANO_VOLUME });
        introBreezeSound = createBufferSound(breezeBuf, introGain, { volume: INTRO_BREEZE_VOLUME });

        // Load character sounds
        try {
            const pugSnoreBuf = await loadAudioBuffer(AUDIO_PATHS.pugSnore);
            pugSnoreSound = createBufferSound(pugSnoreBuf, characterGain!, { loop: false, volume: CHARACTER_SNORE_VOLUME });
        } catch (e) {
            console.warn('Failed to load character sounds:', e);
        }

        // Sync day state
        wasDay = isDayTime();

        // Start intro audio (piano loop + scheduled soft breeze) — plays in the
        // sky while the welcome text shows. Scene loops are NOT started here;
        // they begin in transitionFromIntroToScene() when the descent triggers.
        if (isCurrentlyUnderwater) {
            // Edge case: user dove before audio loaded (shouldn't normally happen
            // since dive requires scroll, which is blocked until after descent).
            sceneAudioStarted = true;
            sceneRevealComplete = true;
            if (sceneRevealGain) sceneRevealGain.gain.value = 1;
            if (!natureMuted && underwaterAmbSound) {
                underwaterAmbSound.gain.gain.value = UNDERWATER_AMB_VOLUME;
                playBufferSound(underwaterAmbSound);
            }
        } else if (!natureMuted) {
            startIntroPiano();
        }

        await Promise.all([
            preloadUISounds(),
            preloadInteractionSounds(),
        ]);
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

let _startAudioPromise: Promise<void> | null = null;

export function startAudio(): Promise<void> {
    if (listenersRemoved) return _startAudioPromise ?? Promise.resolve();
    if (_startAudioPromise) return _startAudioPromise;
    listenersRemoved = true;
    _startAudioPromise = initAudio(); // AudioContext created synchronously (required for iOS), buffers load async
    return _startAudioPromise;
}

// ============================================
// LIFECYCLE
// ============================================
export function Start(): void {
    wasDay = isDayTime();
    // Begin fetching audio files early (during loading screen) so they're cached by the time user clicks Start
    preloadAudioBytes();
}

export function Update(cameraY?: number): void {
    if (!audioInitialized) return;

    const isDay = isDayTime();
    const now = performance.now();

    // Scene reveal — ramp sceneRevealGain from 0 to 1 as camera descends.
    // Once the camera is below SCENE_REVEAL_END_Y the gain stays at 1 and
    // we stop touching it so user volume sliders flow through normally.
    if (sceneRevealArmed && !sceneRevealComplete && sceneRevealGain && cameraY !== undefined) {
        let t = (SCENE_REVEAL_START_Y - cameraY) / (SCENE_REVEAL_START_Y - SCENE_REVEAL_END_Y);
        if (t < 0) t = 0; else if (t > 1) t = 1;
        sceneRevealGain.gain.value = t;
        if (t >= 0.999) {
            sceneRevealComplete = true;
            sceneRevealArmed = false;
            sceneRevealGain.gain.value = 1;
        }
    }

    // Periodic health check
    if (now - lastAudioCheck > AUDIO_CHECK_INTERVAL) {
        lastAudioCheck = now;
        checkHealth();
    }

    // Day/night transitions for fireplace + night crickets (only above water,
    // and only after scene audio has been started — no fireplace/crickets in the sky).
    if (!isCurrentlyUnderwater && sceneAudioStarted) {
        if (wasDay && !isDay) { startFireplace(); startCrickets(); }
        if (!wasDay && isDay) { stopFireplace();  stopCrickets();  }
    }

    wasDay = isDay;
}

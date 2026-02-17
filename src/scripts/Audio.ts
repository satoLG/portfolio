import { isDayTime } from "../scene/Skybox";

// ============================================
// AUDIO MODE
// ============================================
export const audioMode: 'api' | 'tag' = (localStorage.getItem('portfolio-audio-mode') || 'api') as 'api' | 'tag';
let _audioContext: AudioContext | null = null;
export function getAudioContext(): AudioContext | null { return _audioContext; }
export function getAudioMode(): 'api' | 'tag' { return audioMode; }

// ============================================
// AUDIO SETTINGS (easily tweakable)
// ============================================
const WATER_VOLUME = 0.7;              // Constant water ambience volume (lowered for iOS)
const BREEZE_VOLUME = 0.3;             // Soft breeze volume
const BREEZE_MIN_DELAY = 3;           // Min seconds between breeze sounds
const BREEZE_MAX_DELAY = 6;           // Max seconds between breeze sounds
const FIREPLACE_VOLUME_MAX = 0.35;     // Fireplace target volume
const FIREPLACE_FADE_DURATION = 1.5;   // Seconds to fade in fireplace (desktop only)
const UNDERWATER_AMB_VOLUME = 0.25;    // Underwater ambient loop volume
const TRANSITION_SFX_VOLUME = 0.1;     // Volume for dive/surface SFX
const BUBBLE_SFX_DURATION = 2000;     // How long to play bubble SFX (ms) — clip is 10s, we only want 2s
const UI_SOUND_THROTTLE = 100;         // Minimum ms between UI sounds (mobile fix)

// Audio file paths (shared between modes)
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

// ============================================
// SAFE AUDIO PLAY/PAUSE SYSTEM
// Prevents "play() interrupted by pause()" errors
// ============================================
let lastUISoundTime = 0;
const pendingPlayPromises = new WeakMap<HTMLAudioElement, Promise<void>>();

// Map audio elements to their allowed scene state ('above' | 'underwater' | 'any')
const audioStateMap = new WeakMap<HTMLAudioElement, 'above' | 'underwater' | 'any'>();

// Safe play function that tracks pending promises and validates scene state
async function safePlay(audio: HTMLAudioElement | null, name: string = 'audio'): Promise<boolean> {
    if (!audio) return false;
    
    // If there's already a pending play, wait for it first
    const pendingPromise = pendingPlayPromises.get(audio);
    if (pendingPromise) {
        try {
            await pendingPromise;
        } catch {
            // Previous play was interrupted, that's fine
        }
    }
    
    // State gate: re-check if this audio is still valid for current scene state
    const requiredState = audioStateMap.get(audio);
    if (requiredState) {
        if (requiredState === 'above' && isCurrentlyUnderwater) return false;
        if (requiredState === 'underwater' && !isCurrentlyUnderwater) return false;
    }
    
    // Create and track the new play promise
    const playPromise = audio.play();
    pendingPlayPromises.set(audio, playPromise);
    
    try {
        await playPromise;
        return true;
    } catch (e) {
        // Only log if it's not an AbortError (which is expected during transitions)
        if (e instanceof Error && e.name !== 'AbortError') {
            console.error(`Failed to play ${name}:`, e);
        }
        return false;
    } finally {
        // Clean up the tracking if this was the most recent promise
        if (pendingPlayPromises.get(audio) === playPromise) {
            pendingPlayPromises.delete(audio);
        }
    }
}

// Safe pause function that waits for pending play to complete
async function safePause(audio: HTMLAudioElement | null, _name: string = 'audio'): Promise<void> {
    if (!audio) return;
    
    // Wait for any pending play promise to settle before pausing
    const pendingPromise = pendingPlayPromises.get(audio);
    if (pendingPromise) {
        try {
            await pendingPromise;
        } catch {
            // Play was interrupted, that's fine
        }
    }
    
    audio.pause();
}

// ============================================

// ============================================
// WEB AUDIO API ENGINE (audioMode === 'api')
// ============================================
const apiBuffers = new Map<string, AudioBuffer>();
let apiNatureGain: GainNode | null = null;
let apiInterfaceGain: GainNode | null = null;

// Active loop handles
let apiWaterLoop: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let apiFireplaceLoop: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let apiFireplaceActive = false;
let apiUnderwaterAmbLoop: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let apiBreezeTimeout: ReturnType<typeof setTimeout> | null = null;
let apiBreezeActive = false;

// Track active one-shot sources so they can be stopped on transition
let apiBreezeSource: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let apiBubblesSource: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let apiBubblesStopTimer: ReturnType<typeof setTimeout> | null = null;
let htmlBubblesStopTimer: ReturnType<typeof setTimeout> | null = null;

async function apiLoadBuffer(url: string): Promise<AudioBuffer | null> {
    if (!_audioContext) return null;
    if (apiBuffers.has(url)) return apiBuffers.get(url)!;
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await _audioContext.decodeAudioData(arrayBuffer);
        apiBuffers.set(url, audioBuffer);
        return audioBuffer;
    } catch (e) {
        console.error(`Failed to load buffer: ${url}`, e);
        return null;
    }
}

function apiPlayOneShot(url: string, destination: GainNode | null, volume: number = 1): { source: AudioBufferSourceNode; gain: GainNode } | null {
    if (!_audioContext || !destination) return null;
    const buffer = apiBuffers.get(url);
    if (!buffer) return null;
    const source = _audioContext.createBufferSource();
    source.buffer = buffer;
    const gain = _audioContext.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(destination);
    source.start();
    return { source, gain };
}

function apiStartLoop(url: string, destination: GainNode | null, volume: number = 1): { source: AudioBufferSourceNode; gain: GainNode } | null {
    if (!_audioContext || !destination) return null;
    const buffer = apiBuffers.get(url);
    if (!buffer) return null;
    const source = _audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = _audioContext.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(destination);
    source.start();
    return { source, gain };
}

function apiStopLoop(loop: { source: AudioBufferSourceNode; gain: GainNode } | null): null {
    if (loop) {
        try { loop.source.stop(); } catch { /* already stopped */ }
        loop.source.disconnect();
        loop.gain.disconnect();
    }
    return null;
}

function apiStartAmbientSounds(): void {
    if (!apiNatureGain) return;
    apiWaterLoop = apiStartLoop(AUDIO_PATHS.water, apiNatureGain, WATER_VOLUME);
    apiScheduleBreeze();
    if (!isDayTime()) apiStartFireplace();
    console.log('Web Audio ambient sounds started');
}

function apiScheduleBreeze(): void {
    if (apiBreezeTimeout) clearTimeout(apiBreezeTimeout);
    // Don't schedule if underwater
    if (isCurrentlyUnderwater) return;
    const delay = BREEZE_MIN_DELAY + Math.random() * (BREEZE_MAX_DELAY - BREEZE_MIN_DELAY);
    apiBreezeTimeout = setTimeout(() => {
        // Double-check state right before playing
        if (_audioContext && apiNatureGain && !isCurrentlyUnderwater && !natureMuted) {
            const handle = apiPlayOneShot(AUDIO_PATHS.breeze, apiNatureGain, BREEZE_VOLUME);
            if (handle && handle.source.buffer) {
                apiBreezeSource = handle;
                apiBreezeActive = true;
                const duration = handle.source.buffer.duration * 1000;
                handle.source.onended = () => {
                    apiBreezeActive = false;
                    apiBreezeSource = null;
                };
                setTimeout(() => { apiBreezeActive = false; }, duration);
            }
        }
        // Only re-schedule if still above water
        if (!isCurrentlyUnderwater) apiScheduleBreeze();
    }, delay * 1000);
}

function apiStartFireplace(): void {
    if (apiFireplaceActive || !apiNatureGain) return;
    const startVol = isIOS ? FIREPLACE_VOLUME_MAX : 0;
    apiFireplaceLoop = apiStartLoop(AUDIO_PATHS.fireplace, apiNatureGain, startVol);
    apiFireplaceActive = true;
    // Fade in on non-iOS
    if (!isIOS && apiFireplaceLoop && _audioContext) {
        apiFireplaceLoop.gain.gain.linearRampToValueAtTime(
            FIREPLACE_VOLUME_MAX, _audioContext.currentTime + FIREPLACE_FADE_DURATION
        );
    }
}

function apiStopFireplace(): void {
    if (!apiFireplaceActive) return;
    if (apiFireplaceLoop && !isIOS && _audioContext) {
        const { source, gain } = apiFireplaceLoop;
        gain.gain.linearRampToValueAtTime(0, _audioContext.currentTime + 0.5);
        setTimeout(() => {
            try { source.stop(); } catch { /* already stopped */ }
            source.disconnect();
            gain.disconnect();
        }, 600);
    } else {
        apiFireplaceLoop = apiStopLoop(apiFireplaceLoop);
    }
    apiFireplaceActive = false;
    apiFireplaceLoop = null;
}

/** Stop a one-shot source immediately */
function apiStopOneShot(handle: { source: AudioBufferSourceNode; gain: GainNode } | null): null {
    if (handle) {
        try { handle.source.stop(); } catch { /* already stopped */ }
        handle.source.disconnect();
        handle.gain.disconnect();
    }
    return null;
}

function apiTransitionToUnderwater(): void {
    // Stop above-water sounds
    apiWaterLoop = apiStopLoop(apiWaterLoop);
    if (apiBreezeTimeout) { clearTimeout(apiBreezeTimeout); apiBreezeTimeout = null; }
    // Stop actively playing breeze one-shot
    apiBreezeSource = apiStopOneShot(apiBreezeSource);
    apiBreezeActive = false;
    if (apiFireplaceActive) apiStopFireplace();
    // Start underwater sounds
    if (apiNatureGain) {
        apiUnderwaterAmbLoop = apiStartLoop(AUDIO_PATHS.underwaterAmb, apiNatureGain, UNDERWATER_AMB_VOLUME);
        apiPlayBubbleClip();
    }
}

/** Play bubble sound for exactly BUBBLE_SFX_DURATION ms, preventing overlap */
function apiPlayBubbleClip(): void {
    if (!apiNatureGain) return;
    // Stop any existing bubble playback first
    if (apiBubblesStopTimer) { clearTimeout(apiBubblesStopTimer); apiBubblesStopTimer = null; }
    apiBubblesSource = apiStopOneShot(apiBubblesSource);
    const handle = apiPlayOneShot(AUDIO_PATHS.underwaterBubbles, apiNatureGain, TRANSITION_SFX_VOLUME);
    if (handle) {
        apiBubblesSource = handle;
        apiBubblesStopTimer = setTimeout(() => {
            apiBubblesSource = apiStopOneShot(apiBubblesSource);
            apiBubblesStopTimer = null;
        }, BUBBLE_SFX_DURATION);
        handle.source.onended = () => { apiBubblesSource = null; };
    }
}

function apiTransitionToAboveWater(): void {
    // Stop underwater sounds
    apiUnderwaterAmbLoop = apiStopLoop(apiUnderwaterAmbLoop);
    // Stop actively playing bubble one-shot + clear timer
    if (apiBubblesStopTimer) { clearTimeout(apiBubblesStopTimer); apiBubblesStopTimer = null; }
    apiBubblesSource = apiStopOneShot(apiBubblesSource);
    // Resume above-water sounds
    if (apiNatureGain) {
        apiWaterLoop = apiStartLoop(AUDIO_PATHS.water, apiNatureGain, WATER_VOLUME);
        apiScheduleBreeze();
        if (!isDayTime()) apiStartFireplace();
    }
}

function apiCheckHealth(): void {
    if (_audioContext && _audioContext.state === 'suspended') {
        _audioContext.resume();
    }
    // Force-stop leaked sounds in the wrong scene state
    if (isCurrentlyUnderwater) {
        // Kill breeze if somehow still playing
        if (apiBreezeSource) { apiBreezeSource = apiStopOneShot(apiBreezeSource); apiBreezeActive = false; }
        // Kill water loop if somehow still playing
        if (apiWaterLoop) apiWaterLoop = apiStopLoop(apiWaterLoop);
    } else {
        // Kill underwater sounds if somehow still playing above water
        if (apiBubblesSource) apiBubblesSource = apiStopOneShot(apiBubblesSource);
        if (apiUnderwaterAmbLoop) apiUnderwaterAmbLoop = apiStopLoop(apiUnderwaterAmbLoop);
    }
}
// ============================================

// Pure HTML5 Audio elements - NO AudioContext connection
let waterAudio1: HTMLAudioElement | null = null;
let waterAudio2: HTMLAudioElement | null = null;
let activeWaterAudio: HTMLAudioElement | null = null;
let breezeAudio: HTMLAudioElement | null = null;
let fireplaceAudio: HTMLAudioElement | null = null;

// Underwater audio elements
let underwaterAmbAudio: HTMLAudioElement | null = null;
let underwaterBubblesAudio: HTMLAudioElement | null = null;

// Water splash interaction audio
let waterSplashAudio: HTMLAudioElement | null = null;
const WATER_SPLASH_VOLUME = 0.3;

// Track underwater state for audio
let isCurrentlyUnderwater = false;

// Crossfade settings for seamless water loop
const CROSSFADE_DURATION = 1.0;
let waterCrossfading = false;

// Audio health check interval (ms)
const AUDIO_CHECK_INTERVAL = 2000;
let lastAudioCheck = 0;

// Flag to prevent recursive pause handling
let isRecoveringAudio = false;

// Helper function to handle unexpected audio pause
function handleAudioPause(audio: HTMLAudioElement | null, name: string): void {
    if (!audio || isRecoveringAudio || !audioInitialized) return;
    
    // Strict state check — never restart sounds for the wrong scene
    const requiredState = audioStateMap.get(audio);
    if (requiredState === 'above' && isCurrentlyUnderwater) return;
    if (requiredState === 'underwater' && !isCurrentlyUnderwater) return;
    
    // Don't restart if we're intentionally fading or stopping
    if (name.includes('Fireplace') && (!fireplaceActive || fireplaceFading)) return;
    if (name.includes('Water') && waterCrossfading) return;
    
    // Check if audio was paused unexpectedly (not at end, not intentional)
    if (audio.currentTime > 0 && audio.currentTime < audio.duration - 0.1) {
        console.log(`${name} paused unexpectedly at ${audio.currentTime}s - attempting restart`);
        isRecoveringAudio = true;
        safePlay(audio, name).finally(() => isRecoveringAudio = false);
    }
}

// Helper function to restart water audio if crossfade failed
function restartWaterAudio(): void {
    if (!waterAudio1 || !waterAudio2 || !audioInitialized) return;
    
    // Don't restart if we're underwater
    if (isCurrentlyUnderwater) return;
    
    console.log('Restarting water audio loop');
    waterCrossfading = false;
    
    // Restart the active audio
    if (activeWaterAudio) {
        activeWaterAudio.currentTime = 0;
        activeWaterAudio.volume = WATER_VOLUME;
        safePlay(activeWaterAudio, 'water audio');
    }
}

// Check and recover audio if it stopped unexpectedly
function checkAudioHealth(): void {
    if (!audioInitialized || natureMuted) return;
    
    if (isCurrentlyUnderwater) {
        // Force-stop any above-water sounds that are still playing
        if (waterAudio1 && !waterAudio1.paused) { waterAudio1.pause(); console.log('Health: killed leaked water1'); }
        if (waterAudio2 && !waterAudio2.paused) { waterAudio2.pause(); console.log('Health: killed leaked water2'); }
        if (breezeAudio && !breezeAudio.paused) { breezeAudio.pause(); console.log('Health: killed leaked breeze'); }
        if (fireplaceAudio && !fireplaceAudio.paused) { fireplaceAudio.pause(); console.log('Health: killed leaked fireplace'); }
        // Check underwater ambient
        if (underwaterAmbAudio && underwaterAmbAudio.paused) {
            console.log('Health check: Underwater ambient stopped - restarting');
            underwaterAmbAudio.volume = UNDERWATER_AMB_VOLUME;
            underwaterAmbAudio.play().catch(() => {});
        }
        return;
    }
    
    // Above water — force-stop any underwater sounds that are still playing
    if (underwaterAmbAudio && !underwaterAmbAudio.paused) { underwaterAmbAudio.pause(); underwaterAmbAudio.currentTime = 0; console.log('Health: killed leaked underwater amb'); }
    if (underwaterBubblesAudio && !underwaterBubblesAudio.paused) { underwaterBubblesAudio.pause(); underwaterBubblesAudio.currentTime = 0; console.log('Health: killed leaked bubbles'); }
    
    // Check water audio
    if (activeWaterAudio && activeWaterAudio.paused && !waterCrossfading) {
        console.log('Health check: Water audio stopped - restarting');
        restartWaterAudio();
    }
    
    // Check fireplace audio (only when night time and supposed to be active)
    if (fireplaceAudio && fireplaceActive && !fireplaceFading && fireplaceAudio.paused) {
        console.log('Health check: Fireplace audio stopped - restarting');
        fireplaceAudio.volume = FIREPLACE_VOLUME_MAX;
        safePlay(fireplaceAudio, 'fireplace');
    }
}

// Fireplace state
let fireplaceActive = false;
let fireplaceFading = false;
let fireplaceFadeStart = 0;

// Breeze scheduling
let breezeTimeout: ReturnType<typeof setTimeout> | null = null;

// Track previous day state to detect transitions
let wasDay = true;

// Initialization flags
let audioInitialized = false;
let listenersRemoved = false;

// Detect iOS for fade workaround
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function createAudioElements(): void {
    waterAudio1 = new Audio('audio/ocean.wav');
    waterAudio1.loop = false;
    waterAudio1.volume = WATER_VOLUME;
    waterAudio1.preload = 'auto';
    
    waterAudio2 = new Audio('audio/ocean.wav');
    waterAudio2.loop = false;
    waterAudio2.volume = 0;
    waterAudio2.preload = 'auto';
    
    setupWaterCrossfade(waterAudio1, waterAudio2);
    setupWaterCrossfade(waterAudio2, waterAudio1);
    
    breezeAudio = new Audio('audio/breeze.wav');
    breezeAudio.loop = false;
    breezeAudio.volume = BREEZE_VOLUME;
    breezeAudio.preload = 'auto';
    
    fireplaceAudio = new Audio('audio/fireplace.wav');
    fireplaceAudio.loop = true;
    fireplaceAudio.volume = isIOS ? FIREPLACE_VOLUME_MAX : 0;
    fireplaceAudio.preload = 'auto';
    
    // Underwater audio elements
    underwaterAmbAudio = new Audio('audio/366159__dcsfx__underwater-loop-amb.wav');
    underwaterAmbAudio.loop = true;
    underwaterAmbAudio.volume = 0;
    underwaterAmbAudio.preload = 'auto';
    
    underwaterBubblesAudio = new Audio('audio/96742__robinhood76__01650-underwater-bubbles.wav');
    underwaterBubblesAudio.loop = false;
    underwaterBubblesAudio.volume = TRANSITION_SFX_VOLUME;
    underwaterBubblesAudio.preload = 'auto';
    
    // Register scene-state requirements for each audio element
    audioStateMap.set(waterAudio1, 'above');
    audioStateMap.set(waterAudio2, 'above');
    audioStateMap.set(breezeAudio!, 'above');
    audioStateMap.set(fireplaceAudio!, 'above');
    audioStateMap.set(underwaterAmbAudio, 'underwater');
    audioStateMap.set(underwaterBubblesAudio, 'underwater');
    
    // Water splash interaction audio
    waterSplashAudio = new Audio('audio/274060__junggle__water-splash-11.wav');
    waterSplashAudio.loop = false;
    waterSplashAudio.volume = WATER_SPLASH_VOLUME;
    waterSplashAudio.preload = 'auto';
    
    breezeAudio.addEventListener('ended', () => {
        scheduleBreezeSound();
    });
    
    // Add 'ended' event listeners as fallback if crossfade fails
    // These MUST restart audio even if crossfade was in progress (it may have failed)
    waterAudio1.addEventListener('ended', () => {
        console.log('Water audio 1 ended');
        // Don't restart if we're underwater
        if (isCurrentlyUnderwater) return;
        // If this was the active audio and it ended, crossfade failed - restart
        if (activeWaterAudio === waterAudio1 && waterAudio2) {
            console.log('Crossfade failed - restarting from audio 2');
            waterCrossfading = false;
            activeWaterAudio = waterAudio2;
            waterAudio2.currentTime = 0;
            waterAudio2.volume = WATER_VOLUME;
            safePlay(waterAudio2, 'water 2');
        }
    });
    
    waterAudio2.addEventListener('ended', () => {
        console.log('Water audio 2 ended');
        // Don't restart if we're underwater
        if (isCurrentlyUnderwater) return;
        // If this was the active audio and it ended, crossfade failed - restart
        if (activeWaterAudio === waterAudio2 && waterAudio1) {
            console.log('Crossfade failed - restarting from audio 1');
            waterCrossfading = false;
            activeWaterAudio = waterAudio1;
            waterAudio1.currentTime = 0;
            waterAudio1.volume = WATER_VOLUME;
            safePlay(waterAudio1, 'water 1');
        }
    });
    
    // Handle pause events (browser throttling, audio focus loss)
    waterAudio1.addEventListener('pause', () => handleAudioPause(waterAudio1, 'Water 1'));
    waterAudio2.addEventListener('pause', () => handleAudioPause(waterAudio2, 'Water 2'));
    fireplaceAudio.addEventListener('pause', () => handleAudioPause(fireplaceAudio, 'Fireplace'));
    
    waterAudio1.addEventListener('error', (e) => console.error('Water audio 1 error:', e));
    waterAudio2.addEventListener('error', (e) => console.error('Water audio 2 error:', e));
    breezeAudio.addEventListener('error', (e) => console.error('Breeze audio error:', e));
    fireplaceAudio.addEventListener('error', (e) => console.error('Fireplace audio error:', e));
    
    waterAudio1.load();
    waterAudio2.load();
    breezeAudio.load();
    fireplaceAudio.load();
    underwaterAmbAudio.load();
    underwaterBubblesAudio.load();
    
    console.log('HTML5 Audio elements created');
}

// Crossfade interval ID for cleanup
let crossfadeInterval: ReturnType<typeof setInterval> | null = null;

function setupWaterCrossfade(currentAudio: HTMLAudioElement, nextAudio: HTMLAudioElement): void {
    currentAudio.addEventListener('timeupdate', () => {
        if (!currentAudio.duration || waterCrossfading) return;
        
        const timeRemaining = currentAudio.duration - currentAudio.currentTime;
        
        if (timeRemaining <= CROSSFADE_DURATION && timeRemaining > 0) {
            waterCrossfading = true;
            
            nextAudio.currentTime = 0;
            nextAudio.volume = 0;
            safePlay(nextAudio, 'crossfade next');
            
            const fadeStartTime = performance.now();
            
            // Use setInterval instead of requestAnimationFrame
            // setInterval is less throttled when tab is backgrounded
            if (crossfadeInterval) clearInterval(crossfadeInterval);
            
            crossfadeInterval = setInterval(async () => {
                const elapsed = (performance.now() - fadeStartTime) / 1000;
                const progress = Math.min(elapsed / CROSSFADE_DURATION, 1);
                
                currentAudio.volume = WATER_VOLUME * (1 - progress);
                nextAudio.volume = WATER_VOLUME * progress;
                
                if (progress >= 1) {
                    if (crossfadeInterval) {
                        clearInterval(crossfadeInterval);
                        crossfadeInterval = null;
                    }
                    await safePause(currentAudio, 'crossfade current');
                    currentAudio.currentTime = 0;
                    currentAudio.volume = WATER_VOLUME;
                    activeWaterAudio = nextAudio;
                    waterCrossfading = false;
                }
            }, 50); // 50ms interval = 20fps, more reliable than rAF when backgrounded
        }
    });
}

// Media Session is now handled by MediaPlayer.ts for music playback

function initAudio(): void {
    if (audioInitialized) return;
    audioInitialized = true;
    
    if (audioMode === 'api') {
        console.log('Initializing Web Audio API engine...');
        // Create AudioContext synchronously (must be in user gesture for iOS)
        _audioContext = new AudioContext();
        apiNatureGain = _audioContext.createGain();
        apiNatureGain.connect(_audioContext.destination);
        apiInterfaceGain = _audioContext.createGain();
        apiInterfaceGain.connect(_audioContext.destination);
        
        // Load buffers async, then start ambient sounds
        Promise.all(Object.values(AUDIO_PATHS).map(url => apiLoadBuffer(url)))
            .then(() => apiStartAmbientSounds());
        
        setupVisibilityHandler();
        console.log('Web Audio API engine initialized');
        return;
    }
    
    console.log('Initializing audio system (Audio Tag)...');
    
    if (!waterAudio1) {
        createAudioElements();
    }
    
    startWaterSound();
    scheduleBreezeSound();
    
    if (!isDayTime()) {
        startFireplaceSound();
    }
    
    setupVisibilityHandler();
    
    console.log('Audio system fully initialized');
}

// Handle tab visibility changes - resume audio when tab becomes visible
function setupVisibilityHandler(): void {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && audioInitialized) {
            console.log('Tab became visible - checking audio health');
            // Small delay to let browser settle
            setTimeout(() => checkAudioHealth(), 100);
        }
    });
    
    // Also handle window focus
    window.addEventListener('focus', () => {
        if (audioInitialized) {
            console.log('Window focused - checking audio health');
            setTimeout(() => checkAudioHealth(), 100);
        }
    });
}

function startWaterSound(): void {
    if (!waterAudio1) return;
    
    activeWaterAudio = waterAudio1;
    waterAudio1.volume = WATER_VOLUME;
    waterAudio1.currentTime = 0;
    
    safePlay(waterAudio1, 'water sound').then((success) => {
        if (success) console.log('Water sound started playing');
    });
}

function scheduleBreezeSound(): void {
    if (breezeTimeout) {
        clearTimeout(breezeTimeout);
        breezeTimeout = null;
    }
    
    // Don't schedule breeze while underwater
    if (isCurrentlyUnderwater) return;
    
    const delay = BREEZE_MIN_DELAY + Math.random() * (BREEZE_MAX_DELAY - BREEZE_MIN_DELAY);
    
    breezeTimeout = setTimeout(() => {
        playBreezeSound();
    }, delay * 1000);
}

function playBreezeSound(): void {
    if (!breezeAudio || isCurrentlyUnderwater || natureMuted) return;
    
    breezeAudio.currentTime = 0;
    safePlay(breezeAudio, 'breeze sound').then((success) => {
        // Re-check state after async play resolved
        if (isCurrentlyUnderwater) {
            // State changed while we were waiting — force stop
            if (breezeAudio && !breezeAudio.paused) breezeAudio.pause();
            return;
        }
        if (success) console.log('Breeze sound playing');
        // Schedule next breeze only if still above water
        if (!isCurrentlyUnderwater) scheduleBreezeSound();
    });
}

function startFireplaceSound(): void {
    if (!fireplaceAudio || fireplaceActive) return;
    
    fireplaceAudio.currentTime = 0;
    
    if (isIOS) {
        fireplaceAudio.volume = FIREPLACE_VOLUME_MAX;
        fireplaceFading = false;
    } else {
        fireplaceAudio.volume = 0;
        fireplaceFadeStart = performance.now();
        fireplaceFading = true;
    }
    
    safePlay(fireplaceAudio, 'fireplace sound').then((success) => {
        if (success) console.log('Fireplace sound started' + (isIOS ? ' (iOS - no fade)' : ' (fading in)'));
    });
    
    fireplaceActive = true;
}

function stopFireplaceSound(): void {
    if (!fireplaceAudio || !fireplaceActive) return;
    
    if (isIOS) {
        fireplaceAudio.pause();
        fireplaceAudio.currentTime = 0;
    } else {
        const fadeOutDuration = 500;
        const startVolume = fireplaceAudio.volume;
        const startTime = performance.now();
        
        const fadeOut = (): void => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / fadeOutDuration, 1);
            fireplaceAudio!.volume = startVolume * (1 - progress);
            
            if (progress < 1) {
                requestAnimationFrame(fadeOut);
            } else {
                fireplaceAudio!.pause();
                fireplaceAudio!.currentTime = 0;
            }
        };
        
        requestAnimationFrame(fadeOut);
    }
    
    fireplaceActive = false;
    fireplaceFading = false;
}

export function startAudio(): void {
    if (listenersRemoved) return;
    listenersRemoved = true;
    
    console.log('Start button clicked, initializing audio...');
    initAudio();
}

// Pause above-water ambient sounds
// @ts-ignore: Used internally by transition functions
async function pauseAboveWaterSounds(): Promise<void> {
    // Use safePause to avoid interrupting pending play() calls
    await Promise.all([
        safePause(waterAudio1, 'water1'),
        safePause(waterAudio2, 'water2'),
        safePause(breezeAudio, 'breeze'),
        fireplaceActive ? safePause(fireplaceAudio, 'fireplace') : Promise.resolve()
    ]);
    if (breezeTimeout) {
        clearTimeout(breezeTimeout);
        breezeTimeout = null;
    }
    console.log('Above-water sounds paused');
}

// Resume above-water ambient sounds
// @ts-ignore: Used internally by transition functions
async function resumeAboveWaterSounds(): Promise<void> {
    if (activeWaterAudio) {
        await safePlay(activeWaterAudio, 'water');
    }
    scheduleBreezeSound();
    
    // Handle fireplace based on current day/night state
    if (!isDayTime()) {
        // It's night - resume or start fireplace
        if (fireplaceActive && fireplaceAudio) {
            await safePlay(fireplaceAudio, 'fireplace');
        } else {
            // Fireplace wasn't active but it's night, start it
            startFireplaceSound();
        }
    } else {
        // It's day - make sure fireplace is fully stopped
        // (it may have been left in "active but paused" state from diving at night)
        if (fireplaceActive) {
            fireplaceActive = false;
            fireplaceFading = false;
            if (fireplaceAudio) {
                await safePause(fireplaceAudio, 'fireplace');
                fireplaceAudio.currentTime = 0;
            }
        }
    }
    console.log('Above-water sounds resumed');
}

// Start underwater ambient loop
// @ts-ignore: Used internally by transition functions
async function startUnderwaterAmbient(): Promise<void> {
    if (!underwaterAmbAudio) return;
    underwaterAmbAudio.currentTime = 0;
    underwaterAmbAudio.volume = UNDERWATER_AMB_VOLUME;
    const success = await safePlay(underwaterAmbAudio, 'underwater ambient');
    if (success) console.log('Underwater ambient started');
}

// Stop underwater ambient loop
// @ts-ignore: Used internally by transition functions
async function stopUnderwaterAmbient(): Promise<void> {
    if (!underwaterAmbAudio) return;
    await safePause(underwaterAmbAudio, 'underwater ambient');
    underwaterAmbAudio.currentTime = 0;
    console.log('Underwater ambient stopped');
}

// Play dive/ambient bubble SFX (only first 2s of the 10s clip)
export async function playDiveSound(): Promise<void> {
    if (!audioInitialized || !isCurrentlyUnderwater) return;
    if (audioMode === 'api') {
        apiPlayBubbleClip();
        return;
    }
    if (!underwaterBubblesAudio) return;
    
    // Prevent overlap — if already playing, skip
    if (!underwaterBubblesAudio.paused) return;
    
    // Clear any lingering stop timer
    if (htmlBubblesStopTimer) { clearTimeout(htmlBubblesStopTimer); htmlBubblesStopTimer = null; }
    
    underwaterBubblesAudio.currentTime = 0;
    const success = await safePlay(underwaterBubblesAudio, 'dive sound');
    
    if (success) {
        // Stop after exactly 2 seconds (clip is 10s)
        htmlBubblesStopTimer = setTimeout(async () => {
            if (underwaterBubblesAudio && !underwaterBubblesAudio.paused) {
                await safePause(underwaterBubblesAudio, 'dive sound');
                underwaterBubblesAudio.currentTime = 0;
            }
            htmlBubblesStopTimer = null;
        }, BUBBLE_SFX_DURATION);
    }
}

// Play water splash interaction sound (clicking ocean surface)
export function playWaterSplash(): void {
    if (!audioInitialized || isNatureMuted() || isCurrentlyUnderwater) return;
    if (audioMode === 'api') {
        apiPlayOneShot(AUDIO_PATHS.waterSplash, apiNatureGain, WATER_SPLASH_VOLUME);
        return;
    }
    if (!waterSplashAudio) return;
    
    // Restart if already playing
    waterSplashAudio.currentTime = 0;
    safePlay(waterSplashAudio, 'water splash');
}

// Called when transitioning to underwater
export function transitionToUnderwater(): void {
    if (!audioInitialized || isCurrentlyUnderwater) return;
    isCurrentlyUnderwater = true;
    
    if (audioMode === 'api') { apiTransitionToUnderwater(); return; }
    
    // Clear breeze timeout so no scheduled breeze fires while underwater
    if (breezeTimeout) {
        clearTimeout(breezeTimeout);
        breezeTimeout = null;
    }
    
    // Kill any running water crossfade interval
    if (crossfadeInterval) {
        clearInterval(crossfadeInterval);
        crossfadeInterval = null;
        waterCrossfading = false;
    }
    
    // Stop above-water sounds synchronously (no setTimeout — avoids race conditions)
    if (waterAudio1 && !waterAudio1.paused) waterAudio1.pause();
    if (waterAudio2 && !waterAudio2.paused) waterAudio2.pause();
    if (breezeAudio && !breezeAudio.paused) breezeAudio.pause();
    if (fireplaceAudio && !fireplaceAudio.paused) {
        fireplaceAudio.pause();
        fireplaceActive = false;
        fireplaceFading = false;
    }
    
    // Start underwater sounds
    if (underwaterAmbAudio && !isNatureMuted()) {
        underwaterAmbAudio.currentTime = 0;
        underwaterAmbAudio.volume = UNDERWATER_AMB_VOLUME;
        underwaterAmbAudio.play().catch(() => {});
    }
    // Play bubble SFX once (stop after 2 seconds)
    if (underwaterBubblesAudio && !isNatureMuted()) {
        if (htmlBubblesStopTimer) { clearTimeout(htmlBubblesStopTimer); htmlBubblesStopTimer = null; }
        underwaterBubblesAudio.currentTime = 0;
        underwaterBubblesAudio.play().catch(() => {});
        htmlBubblesStopTimer = setTimeout(() => {
            if (underwaterBubblesAudio && !underwaterBubblesAudio.paused) {
                underwaterBubblesAudio.pause();
                underwaterBubblesAudio.currentTime = 0;
            }
            htmlBubblesStopTimer = null;
        }, BUBBLE_SFX_DURATION);
    }
}

// Called when transitioning to above water
export function transitionToAboveWater(): void {
    if (!audioInitialized || !isCurrentlyUnderwater) return;
    isCurrentlyUnderwater = false;
    
    if (audioMode === 'api') { apiTransitionToAboveWater(); return; }
    
    // Stop underwater sounds synchronously + clear bubble timer
    if (htmlBubblesStopTimer) { clearTimeout(htmlBubblesStopTimer); htmlBubblesStopTimer = null; }
    if (underwaterAmbAudio && !underwaterAmbAudio.paused) {
        underwaterAmbAudio.pause();
        underwaterAmbAudio.currentTime = 0;
    }
    if (underwaterBubblesAudio && !underwaterBubblesAudio.paused) {
        underwaterBubblesAudio.pause();
        underwaterBubblesAudio.currentTime = 0;
    }
    
    // Resume above-water sounds
    if (activeWaterAudio && !isNatureMuted()) {
        activeWaterAudio.currentTime = 0;
        activeWaterAudio.volume = WATER_VOLUME;
        activeWaterAudio.play().catch(() => {});
    }
    
    // Re-schedule breeze (don't resume mid-clip)
    if (!isNatureMuted()) {
        scheduleBreezeSound();
    }
    
    // Resume fireplace at night
    if (!isDayTime() && fireplaceAudio && !fireplaceActive) {
        startFireplaceSound();
    }
}

// ============================================
// MUTE CONTROLS
// ============================================
let natureMuted = false;
let musicMuted = false;
let interfaceMuted = false;

export function isBreezeActive(): boolean {
    if (audioMode === 'api') return apiBreezeActive;
    return breezeAudio !== null && !breezeAudio.paused;
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
    
    if (audioMode === 'api') {
        if (apiNatureGain) apiNatureGain.gain.value = muted ? 0 : 1;
        return;
    }
    
    // Apply to all nature audio elements
    if (waterAudio1) waterAudio1.muted = muted;
    if (waterAudio2) waterAudio2.muted = muted;
    if (breezeAudio) breezeAudio.muted = muted;
    if (fireplaceAudio) fireplaceAudio.muted = muted;
    if (underwaterAmbAudio) underwaterAmbAudio.muted = muted;
    if (underwaterBubblesAudio) underwaterBubblesAudio.muted = muted;

}

export function setMusicMuted(muted: boolean): void {
    musicMuted = muted;
    // Music is controlled by MediaPlayer - dispatch custom event
    window.dispatchEvent(new CustomEvent('musicMuteChanged', { detail: { muted } }));
}

export function setInterfaceMuted(muted: boolean): void {
    interfaceMuted = muted;
}

// ============================================
// UI SOUND EFFECTS
// ============================================
const UI_SOUND_VOLUME = 0.4;

// Pre-loaded UI sounds
let uiSoundSwitchDay: HTMLAudioElement | null = null;
let uiSoundSwitchNight: HTMLAudioElement | null = null;
let uiSoundButton: HTMLAudioElement | null = null;
let uiSoundBubbleExpand: HTMLAudioElement | null = null;
let uiSoundBubbleCollapse: HTMLAudioElement | null = null;

export function preloadUISounds(): void {
    // In API mode, UI sounds are already loaded as buffers
    if (audioMode === 'api') return;
    
    // Day/night toggle sounds
    uiSoundSwitchDay = new Audio('/audio/ui/dragon-studio-light-switch-on-382714.mp3');
    uiSoundSwitchDay.volume = UI_SOUND_VOLUME;
    uiSoundSwitchDay.preload = 'auto';
    
    uiSoundSwitchNight = new Audio('/audio/ui/dragon-studio-light-switch-382712.mp3');
    uiSoundSwitchNight.volume = UI_SOUND_VOLUME;
    uiSoundSwitchNight.preload = 'auto';
    
    // Play/pause button sound
    uiSoundButton = new Audio('/audio/ui/soundreality-button-202966.mp3');
    uiSoundButton.volume = UI_SOUND_VOLUME;
    uiSoundButton.preload = 'auto';
    
    // Bubble expand/collapse sounds
    uiSoundBubbleExpand = new Audio('/audio/ui/universfield-bubble-pop-293342.mp3');
    uiSoundBubbleExpand.volume = UI_SOUND_VOLUME;
    uiSoundBubbleExpand.preload = 'auto';
    
    uiSoundBubbleCollapse = new Audio('/audio/ui/universfield-bubble-pop-06-351337.mp3');
    uiSoundBubbleCollapse.volume = UI_SOUND_VOLUME;
    uiSoundBubbleCollapse.preload = 'auto';
}

export function playUISwitchDay(): void {
    const now = performance.now();
    if (now - lastUISoundTime < UI_SOUND_THROTTLE) return;
    if (interfaceMuted) return;
    lastUISoundTime = now;
    if (audioMode === 'api') { apiPlayOneShot(AUDIO_PATHS.uiSwitchDay, apiInterfaceGain, UI_SOUND_VOLUME); return; }
    if (!uiSoundSwitchDay) return;
    if (!uiSoundSwitchDay.paused) uiSoundSwitchDay.pause();
    uiSoundSwitchDay.currentTime = 0;
    uiSoundSwitchDay.play().catch(() => {});
}

export function playUISwitchNight(): void {
    const now = performance.now();
    if (now - lastUISoundTime < UI_SOUND_THROTTLE) return;
    if (interfaceMuted) return;
    lastUISoundTime = now;
    if (audioMode === 'api') { apiPlayOneShot(AUDIO_PATHS.uiSwitchNight, apiInterfaceGain, UI_SOUND_VOLUME); return; }
    if (!uiSoundSwitchNight) return;
    if (!uiSoundSwitchNight.paused) uiSoundSwitchNight.pause();
    uiSoundSwitchNight.currentTime = 0;
    uiSoundSwitchNight.play().catch(() => {});
}

export function playUIButton(): void {
    const now = performance.now();
    if (now - lastUISoundTime < UI_SOUND_THROTTLE) return;
    if (interfaceMuted) return;
    lastUISoundTime = now;
    if (audioMode === 'api') { apiPlayOneShot(AUDIO_PATHS.uiButton, apiInterfaceGain, UI_SOUND_VOLUME); return; }
    if (!uiSoundButton) return;
    if (!uiSoundButton.paused) uiSoundButton.pause();
    uiSoundButton.currentTime = 0;
    uiSoundButton.play().catch(() => {});
}

export function playUIBubbleExpand(): void {
    const now = performance.now();
    if (now - lastUISoundTime < UI_SOUND_THROTTLE) return;
    if (interfaceMuted) return;
    lastUISoundTime = now;
    if (audioMode === 'api') { apiPlayOneShot(AUDIO_PATHS.uiBubbleExpand, apiInterfaceGain, UI_SOUND_VOLUME); return; }
    if (!uiSoundBubbleExpand) return;
    if (!uiSoundBubbleExpand.paused) uiSoundBubbleExpand.pause();
    uiSoundBubbleExpand.currentTime = 0;
    uiSoundBubbleExpand.play().catch(() => {});
}

export function playUIBubbleCollapse(): void {
    const now = performance.now();
    if (now - lastUISoundTime < UI_SOUND_THROTTLE) return;
    if (interfaceMuted) return;
    lastUISoundTime = now;
    if (audioMode === 'api') { apiPlayOneShot(AUDIO_PATHS.uiBubbleCollapse, apiInterfaceGain, UI_SOUND_VOLUME); return; }
    if (!uiSoundBubbleCollapse) return;
    if (!uiSoundBubbleCollapse.paused) uiSoundBubbleCollapse.pause();
    uiSoundBubbleCollapse.currentTime = 0;
    uiSoundBubbleCollapse.play().catch(() => {});
}

export function Start(): void {
    wasDay = isDayTime();
}

export function Update(): void {
    if (!audioInitialized) return;
    
    const isDay = isDayTime();
    
    if (audioMode === 'api') {
        // Web Audio API mode: health check + day/night transitions
        const now = performance.now();
        if (now - lastAudioCheck > AUDIO_CHECK_INTERVAL) {
            lastAudioCheck = now;
            apiCheckHealth();
        }
        if (!isCurrentlyUnderwater) {
            if (wasDay && !isDay) apiStartFireplace();
            if (!wasDay && isDay) apiStopFireplace();
        }
        wasDay = isDay;
        return;
    }
    
    const now = performance.now();
    
    // Periodic audio health check
    if (now - lastAudioCheck > AUDIO_CHECK_INTERVAL) {
        lastAudioCheck = now;
        checkAudioHealth();
    }
    
    // Only handle day/night transitions if we're above water
    if (!isCurrentlyUnderwater) {
        if (wasDay && !isDay) {
            startFireplaceSound();
        }
        
        if (!wasDay && isDay) {
            stopFireplaceSound();
        }
    }
    
    wasDay = isDay;
    
    if (fireplaceFading && fireplaceAudio && !isIOS) {
        const elapsed = (performance.now() - fireplaceFadeStart) / 1000;
        const progress = Math.min(elapsed / FIREPLACE_FADE_DURATION, 1.0);
        const volume = FIREPLACE_VOLUME_MAX * progress;
        
        fireplaceAudio.volume = volume;
        
        if (progress >= 1.0) {
            fireplaceFading = false;
        }
    }
}

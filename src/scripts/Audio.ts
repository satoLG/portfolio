import { isDayTime } from "../scene/Skybox";

// ============================================
// AUDIO SETTINGS (easily tweakable)
// ============================================
const WATER_VOLUME = 0.09;              // Constant water ambience volume
const BREEZE_VOLUME = 0.3;             // Soft breeze volume
const BREEZE_MIN_DELAY = 10;           // Min seconds between breeze sounds
const BREEZE_MAX_DELAY = 20;           // Max seconds between breeze sounds
const FIREPLACE_VOLUME_MAX = 0.35;     // Fireplace target volume
const FIREPLACE_FADE_DURATION = 1.5;   // Seconds to fade in fireplace (desktop only)
const UNDERWATER_AMB_VOLUME = 0.25;    // Underwater ambient loop volume
const TRANSITION_SFX_VOLUME = 0.1;     // Volume for dive/surface SFX
const TRANSITION_SFX_DURATION = 400;  // How long to play transition SFX (ms)
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
let surfaceSplashAudio: HTMLAudioElement | null = null;

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
    
    // Don't restart above-water sounds if we're underwater
    if (isCurrentlyUnderwater && (name.includes('Water') || name.includes('Fireplace') || name.includes('Breeze'))) return;
    
    // Don't restart if we're intentionally fading or stopping
    if (name.includes('Fireplace') && (!fireplaceActive || fireplaceFading)) return;
    if (name.includes('Water') && waterCrossfading) return;
    
    // Check if audio was paused unexpectedly (not at end, not intentional)
    if (audio.currentTime > 0 && audio.currentTime < audio.duration - 0.1) {
        console.log(`${name} paused unexpectedly at ${audio.currentTime}s - attempting restart`);
        isRecoveringAudio = true;
        audio.play().catch(e => console.error(`Failed to restart ${name}:`, e))
            .finally(() => isRecoveringAudio = false);
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
        activeWaterAudio.play().catch(e => console.error('Failed to restart water audio:', e));
    }
}

// Check and recover audio if it stopped unexpectedly
function checkAudioHealth(): void {
    if (!audioInitialized) return;
    
    // Don't restart above-water sounds if we're underwater
    if (isCurrentlyUnderwater) {
        // Check underwater ambient instead
        if (underwaterAmbAudio && underwaterAmbAudio.paused) {
            console.log('Health check: Underwater ambient stopped - restarting');
            underwaterAmbAudio.play().catch(e => console.error('Failed to restart underwater ambient:', e));
        }
        return;
    }
    
    // Check water audio (only when above water)
    if (activeWaterAudio && activeWaterAudio.paused && !waterCrossfading) {
        console.log('Health check: Water audio stopped - restarting');
        restartWaterAudio();
    }
    
    // Check fireplace audio (only when night time and supposed to be active)
    if (fireplaceAudio && fireplaceActive && !fireplaceFading && fireplaceAudio.paused) {
        console.log('Health check: Fireplace audio stopped - restarting');
        fireplaceAudio.volume = FIREPLACE_VOLUME_MAX;
        fireplaceAudio.play().catch(e => console.error('Failed to restart fireplace:', e));
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
    
    surfaceSplashAudio = new Audio('audio/327667__juan_merie_venter__getting-out-of-the-pool.wav');
    surfaceSplashAudio.loop = false;
    surfaceSplashAudio.volume = TRANSITION_SFX_VOLUME;
    surfaceSplashAudio.preload = 'auto';
    
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
            waterAudio2.play().catch(e => console.error('Failed to start water 2:', e));
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
            waterAudio1.play().catch(e => console.error('Failed to start water 1:', e));
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
    surfaceSplashAudio.load();
    
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
            nextAudio.play().catch(() => {});
            
            const fadeStartTime = performance.now();
            
            // Use setInterval instead of requestAnimationFrame
            // setInterval is less throttled when tab is backgrounded
            if (crossfadeInterval) clearInterval(crossfadeInterval);
            
            crossfadeInterval = setInterval(() => {
                const elapsed = (performance.now() - fadeStartTime) / 1000;
                const progress = Math.min(elapsed / CROSSFADE_DURATION, 1);
                
                currentAudio.volume = WATER_VOLUME * (1 - progress);
                nextAudio.volume = WATER_VOLUME * progress;
                
                if (progress >= 1) {
                    if (crossfadeInterval) {
                        clearInterval(crossfadeInterval);
                        crossfadeInterval = null;
                    }
                    currentAudio.pause();
                    currentAudio.currentTime = 0;
                    currentAudio.volume = WATER_VOLUME;
                    activeWaterAudio = nextAudio;
                    waterCrossfading = false;
                }
            }, 50); // 50ms interval = 20fps, more reliable than rAF when backgrounded
        }
    });
}

function setupMediaSession(): void {
    if (!('mediaSession' in navigator)) {
        console.log('Media Session API not supported');
        return;
    }
    
    navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Ocean Ambience',
        artist: 'Leo Sato',
        album: 'Three.js Ocean Scene',
        artwork: [
            { src: 'images/sand.png', sizes: '512x512', type: 'image/png' }
        ]
    });
    
    navigator.mediaSession.playbackState = 'playing';
    
    navigator.mediaSession.setActionHandler('play', () => {
        if (activeWaterAudio) activeWaterAudio.play().catch(() => {});
        if (fireplaceActive && fireplaceAudio) fireplaceAudio.play().catch(() => {});
        navigator.mediaSession.playbackState = 'playing';
    });
    
    navigator.mediaSession.setActionHandler('pause', () => {
        if (waterAudio1) waterAudio1.pause();
        if (waterAudio2) waterAudio2.pause();
        if (fireplaceAudio) fireplaceAudio.pause();
        navigator.mediaSession.playbackState = 'paused';
    });
    
    navigator.mediaSession.setActionHandler('stop', () => {
        if (waterAudio1) { waterAudio1.pause(); waterAudio1.currentTime = 0; }
        if (waterAudio2) { waterAudio2.pause(); waterAudio2.currentTime = 0; }
        if (fireplaceAudio) { fireplaceAudio.pause(); fireplaceAudio.currentTime = 0; }
        navigator.mediaSession.playbackState = 'none';
    });
    
    console.log('Media Session API configured');
}

function initAudio(): void {
    if (audioInitialized) return;
    
    console.log('Initializing audio system...');
    
    if (!waterAudio1) {
        createAudioElements();
    }
    
    startWaterSound();
    scheduleBreezeSound();
    
    if (!isDayTime()) {
        startFireplaceSound();
    }
    
    setupMediaSession();
    setupVisibilityHandler();
    
    audioInitialized = true;
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
    
    waterAudio1.play().then(() => {
        console.log('Water sound started playing');
    }).catch((error) => {
        console.error('Failed to play water sound:', error);
    });
}

function scheduleBreezeSound(): void {
    if (breezeTimeout) {
        clearTimeout(breezeTimeout);
    }
    
    const delay = BREEZE_MIN_DELAY + Math.random() * (BREEZE_MAX_DELAY - BREEZE_MIN_DELAY);
    
    breezeTimeout = setTimeout(() => {
        playBreezeSound();
    }, delay * 1000);
}

function playBreezeSound(): void {
    if (!breezeAudio) return;
    
    breezeAudio.currentTime = 0;
    breezeAudio.play().then(() => {
        console.log('Breeze sound playing');
    }).catch((error) => {
        console.error('Failed to play breeze sound:', error);
        scheduleBreezeSound();
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
    
    fireplaceAudio.play().then(() => {
        console.log('Fireplace sound started' + (isIOS ? ' (iOS - no fade)' : ' (fading in)'));
    }).catch((error) => {
        console.error('Failed to play fireplace sound:', error);
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
function pauseAboveWaterSounds(): void {
    if (waterAudio1) waterAudio1.pause();
    if (waterAudio2) waterAudio2.pause();
    if (breezeAudio) breezeAudio.pause();
    if (fireplaceAudio && fireplaceActive) fireplaceAudio.pause();
    if (breezeTimeout) {
        clearTimeout(breezeTimeout);
        breezeTimeout = null;
    }
    console.log('Above-water sounds paused');
}

// Resume above-water ambient sounds
function resumeAboveWaterSounds(): void {
    if (activeWaterAudio) {
        activeWaterAudio.play().catch(e => console.error('Failed to resume water:', e));
    }
    scheduleBreezeSound();
    
    // Handle fireplace based on current day/night state
    if (!isDayTime()) {
        // It's night - resume or start fireplace
        if (fireplaceActive && fireplaceAudio) {
            fireplaceAudio.play().catch(e => console.error('Failed to resume fireplace:', e));
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
                fireplaceAudio.pause();
                fireplaceAudio.currentTime = 0;
            }
        }
    }
    console.log('Above-water sounds resumed');
}

// Start underwater ambient loop
function startUnderwaterAmbient(): void {
    if (!underwaterAmbAudio) return;
    underwaterAmbAudio.currentTime = 0;
    underwaterAmbAudio.volume = UNDERWATER_AMB_VOLUME;
    underwaterAmbAudio.play().catch(e => console.error('Failed to start underwater ambient:', e));
    console.log('Underwater ambient started');
}

// Stop underwater ambient loop
function stopUnderwaterAmbient(): void {
    if (!underwaterAmbAudio) return;
    underwaterAmbAudio.pause();
    underwaterAmbAudio.currentTime = 0;
    console.log('Underwater ambient stopped');
}

// Play dive transition SFX (bubbles going down)
export function playDiveSound(): void {
    if (!underwaterBubblesAudio || !audioInitialized) return;
    
    underwaterBubblesAudio.currentTime = 0;
    underwaterBubblesAudio.play().catch(e => console.error('Failed to play dive sound:', e));
    
    // Stop after 2 seconds
    setTimeout(() => {
        if (underwaterBubblesAudio) {
            underwaterBubblesAudio.pause();
            underwaterBubblesAudio.currentTime = 0;
        }
    }, TRANSITION_SFX_DURATION);
    
    console.log('Dive sound playing');
}

// Play surface transition SFX (coming out of water)
export function playSurfaceSound(): void {
    if (!surfaceSplashAudio || !audioInitialized) return;
    
    surfaceSplashAudio.currentTime = 0;
    // surfaceSplashAudio.play().catch(e => console.error('Failed to play surface sound:', e));
    
    // Stop after 2 seconds
    // setTimeout(() => {
    //     if (surfaceSplashAudio) {
    //         surfaceSplashAudio.pause();
    //         surfaceSplashAudio.currentTime = 0;
    //     }
    // }, TRANSITION_SFX_DURATION);
    
    console.log('Surface sound playing');
}

// Called when transitioning to underwater
export function transitionToUnderwater(): void {
    if (!audioInitialized || isCurrentlyUnderwater) return;
    isCurrentlyUnderwater = true;
    
    // Defer audio operations to prevent frame drops on mobile
    // Spread work across multiple frames
    requestAnimationFrame(() => {
        pauseAboveWaterSounds();
        requestAnimationFrame(() => {
            startUnderwaterAmbient();
        });
    });
}

// Called when transitioning to above water
export function transitionToAboveWater(): void {
    if (!audioInitialized || !isCurrentlyUnderwater) return;
    isCurrentlyUnderwater = false;
    
    // Defer audio operations to prevent frame drops on mobile
    // Spread work across multiple frames
    requestAnimationFrame(() => {
        stopUnderwaterAmbient();
        requestAnimationFrame(() => {
            resumeAboveWaterSounds();
        });
    });
}

export function Start(): void {
    wasDay = isDayTime();
}

export function Update(): void {
    if (!audioInitialized) return;
    
    const now = performance.now();
    
    // Periodic audio health check
    if (now - lastAudioCheck > AUDIO_CHECK_INTERVAL) {
        lastAudioCheck = now;
        checkAudioHealth();
    }
    
    const isDay = isDayTime();
    
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

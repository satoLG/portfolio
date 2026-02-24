// ============================================
// MEDIA PLAYER - Mini music player for radio
// ============================================

import { camera, pixelSizeValue } from "./Scene";
import { radio } from "../scene/Island";
import { Vector3 } from "three";
import { playUIButton, playUIBubbleExpand, playUIBubbleCollapse, getAudioContext, getMasterDestination, getMusicVolume, isMusicMuted } from "./Audio";
import { zoomToRadio, zoomOutFromRadio } from "./Control";
import WaveSurfer from 'wavesurfer.js';
import { t, onLanguageChange } from "./i18n";

// Above water camera Y position (must match Control.ts)
// (surfacing animation removed — bubble now tracks radio position directly)

// Song metadata map - add your songs here!
interface SongData {
    file: string;
    name: string;
    artist: string;
    cover?: string;  // Optional cover image
}

// Playlist that can be reordered
let playlist: SongData[] = [
    {
        file: 'audio/music/Aventure - Afternoon Coffee (freetouse.com).mp3',
        name: 'Afternoon Coffee',
        artist: 'Aventure',
        cover: 'images/music/afternooncoffee.webp'
    },
    {
        file: 'audio/music/Hazelwood - At Ease (freetouse.com).mp3',
        name: 'At Ease',
        artist: 'Hazelwood',
        cover: 'images/music/at_ease.webp'
    },
    {
        file: 'audio/music/massobeats - breeze (freetouse.com).mp3',
        name: 'breeze',
        artist: 'massobeats',
        cover: 'images/music/breeze.webp'
    },
    {
        file: 'audio/music/Aventure - Chill Walk (freetouse.com).mp3',
        name: 'Chill Walk',
        artist: 'Aventure',
        cover: 'images/music/chillwalk.webp'
    },
    {
        file: 'audio/music/Moavii - City Lights (freetouse.com).mp3',
        name: 'City Lights',
        artist: 'Moavii',
        cover: 'images/music/blur.webp'
    },
    {
        file: 'audio/music/Walen - Dark Heart (freetouse.com).mp3',
        name: 'Dark Heart',
        artist: 'Walen',
        cover: 'images/music/darkheart.webp'
    },
    {
        file: 'audio/music/Alegend - Dawn (freetouse.com).mp3',
        name: 'Dawn',
        artist: 'Alegend',
        cover: 'images/music/dawn.webp'
    },
    {
        file: 'audio/music/Moavii - Fly With Me (freetouse.com).mp3',
        name: 'Fly With Me',
        artist: 'Moavii',
        cover: 'images/music/flywithme.webp'
    },
    {
        file: 'audio/music/massobeats - honey jam (freetouse.com).mp3',
        name: 'honey jam',
        artist: 'massobeats',
        cover: 'images/music/massobeats.webp'
    },
    {
        file: 'audio/music/595751__yellowtree__late-nights-in-osaka.wav',
        name: 'Late Nights in Osaka',
        artist: 'yellowtree',
        cover: 'images/music/yellowtree.jpg'
    },
    {
        file: 'audio/music/Lukrembo - Memories (freetouse.com).mp3',
        name: 'Memories',
        artist: 'Lukrembo',
        cover: 'images/music/memories.webp'
    },
    {
        file: 'audio/music/massobeats - ocean (freetouse.com).mp3',
        name: 'ocean',
        artist: 'massobeats',
        cover: 'images/music/ocean.webp'
    },
    {
        file: 'audio/music/massobeats - peach prosecco (freetouse.com).mp3',
        name: 'peach prosecco',
        artist: 'massobeats',
        cover: 'images/music/prosecco.webp'
    },
    {
        file: 'audio/music/Hazelwood - Reflection (freetouse.com).mp3',
        name: 'Reflection',
        artist: 'Hazelwood',
        cover: 'images/music/reflection.webp'
    },
    {
        file: 'audio/music/Moavii - Stranded (freetouse.com).mp3',
        name: 'Stranded',
        artist: 'Moavii',
        cover: 'images/music/stranded.webp'
    },
    {
        file: 'audio/music/Project Ex - Tranquility (freetouse.com).mp3',
        name: 'Tranquility',
        artist: 'Project Ex',
        cover: 'images/music/tranquility.webp'
    },
    {
        file: 'audio/music/Moavii - Umbrella (freetouse.com).mp3',
        name: 'Umbrella',
        artist: 'Moavii',
        cover: 'images/music/umbrella.webp'
    },
];

// Default values
const DEFAULT_COVER = 'images/music-default.svg';
const DEFAULT_NAME = 'Unknown Track';
const DEFAULT_ARTIST = 'Unknown Artist';

// State
let audioElement: HTMLAudioElement | null = null;
let currentSongIndex = 0;
let isPlaying = false;
let pendingPlayOnReady = false;  // When true, auto-play when wavesurfer fires 'ready'
let isExpanded = false;

// Export isPlaying state for other modules
export function getIsPlaying(): boolean {
    return isPlaying;
}

export function getIsExpanded(): boolean {
    return isExpanded;
}

// Smoothed music intensity (0-1) derived from the frequency analyser.
// Updated every frame by drawAnalyser(). Other modules (e.g. Island radio
// animation) read this to react to the actual music energy.
let _musicIntensity = 0;
let _beatKick = 0;  // Impulse (0-1) that spikes on sudden beats, decays fast
let _intensityHistory = 0;  // Slow-moving average to detect relative spikes
const INTENSITY_ATTACK = 0.35;   // Fast attack — react quickly to rises
const INTENSITY_RELEASE = 0.08;  // Slow release — hold energy briefly
const BEAT_THRESHOLD = 0.06;     // Min raw jump to count as a beat
const BEAT_DECAY = 0.88;         // How fast the kick impulse decays per frame
const HISTORY_SMOOTH = 0.03;     // Very slow average for relative beat detection

export function getMusicIntensity(): number {
    return _musicIntensity;
}

/** Impulse value (0-1) that spikes on strong beats. Decays quickly. */
export function getBeatKick(): number {
    return _beatKick;
}

// Get current song cover
export function getCurrentCover(): string | undefined {
    if (playlist.length === 0) return undefined;
    return playlist[currentSongIndex].cover;
}
let isPlaylistView = false;  // Expanded playlist view
let isUnderwater = false;
let isLoopEnabled = false;  // Loop current song or go to next

// DOM Elements
let playerContainer: HTMLDivElement | null = null;

// Wavesurfer instance
let wavesurfer: WaveSurfer | null = null;

// Web Audio analyser for frequency visualization (API mode)
let analyserNode: AnalyserNode | null = null;
let analyserCanvas: HTMLCanvasElement | null = null;
let analyserCtx: CanvasRenderingContext2D | null = null;
let analyserAnimId: number = 0;
let mediaSourceConnected = false;

// Reusable typed array for analyser (avoids allocation per frame)
let analyserDataArray: Uint8Array<ArrayBuffer> | null = null;

// Underwater muffled music effect (API mode)
let musicLowpassFilter: BiquadFilterNode | null = null;
let musicGainNode: GainNode | null = null;
let musicVolumeGain: GainNode | null = null;
const MUFFLE_FILTER_CLEAN = 22000;   // Hz — reset value when above water
const MUFFLE_FILTER_ENTER = 200;     // Hz — immediate muffling when first entering water
const MUFFLE_FILTER_DEEP = 150;      // Hz — fully muffled at max depth
const MUFFLE_GAIN_MIN = 0.0;         // completely silent at max depth
const MUFFLE_GAIN_MAX = 1.0;         // full volume above water
const MUFFLE_DEPTH_MAX = 8.0;        // camera Y range: 0 to -8

// Retro sample-rate reduction for pixelation mode (API mode)
// 8-bit depth (retro quantization) + 8x sample-rate reduction (crunchy stepping)
// + gentle post-crusher lowpass to smooth aliasing harshness
let retroWorkletNode: AudioWorkletNode | null = null;
let retroSmoothFilter: BiquadFilterNode | null = null;  // post-crusher muffle
let retroBypass: GainNode | null = null;
let retroWet: GainNode | null = null;
let retroMerge: GainNode | null = null;
let retroActive = false;
let retroWorkletReady = false;
let retroWorkletLoading: Promise<void> | null = null;

const RETRO_PROCESSOR_CODE = `
class RetroProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'bitDepth', defaultValue: 16, minValue: 1, maxValue: 16 },
            { name: 'reduction', defaultValue: 1, minValue: 1, maxValue: 80 }
        ];
    }
    constructor() {
        super();
        this._held = [0, 0];
        this._count = [0, 0];
    }
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !input.length) return true;
        for (let ch = 0; ch < input.length; ch++) {
            const inp = input[ch];
            const out = output[ch];
            const b = parameters.bitDepth[0];
            const r = parameters.reduction[0];
            const steps = Math.pow(2, b);
            for (let i = 0; i < inp.length; i++) {
                this._count[ch] = (this._count[ch] || 0) + 1;
                if (this._count[ch] >= r) {
                    this._count[ch] = 0;
                    this._held[ch] = Math.round(inp[i] * steps) / steps;
                }
                out[i] = this._held[ch] || 0;
            }
        }
        return true;
    }
}
registerProcessor('retro-8bit-processor', RetroProcessor);
`;

function loadRetroWorklet(): Promise<void> {
    if (retroWorkletReady) return Promise.resolve();
    if (retroWorkletLoading) return retroWorkletLoading;
    retroWorkletLoading = (async () => {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const blob = new Blob([RETRO_PROCESSOR_CODE], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            await ctx.audioWorklet.addModule(url);
            URL.revokeObjectURL(url);
            retroWorkletReady = true;
        } catch (e) {
            console.warn('Could not load retro audio worklet:', e);
        }
    })();
    return retroWorkletLoading;
}

// Preloading system for faster song transitions
let preloadedAudios: Map<number, HTMLAudioElement> = new Map();

export function Start(): void {
    createPlayerUI();
    createAudioElement();
    initWavesurfer();
    updatePlayerDisplay();
    
    // Close media player when settings panel opens
    document.addEventListener('settings-opened', () => {
        if (isExpanded) {
            collapsePlayer();
        }
    });
    
    // Listen for mute changes from settings (via Web Audio GainNode)
    window.addEventListener('musicMuteChanged', (e: Event) => {
        const customEvent = e as CustomEvent;
        const muted = customEvent.detail.muted;
        if (musicVolumeGain) {
            musicVolumeGain.gain.value = muted ? 0 : getMusicVolume();
        }
    });

    // Listen for volume changes from settings (via Web Audio GainNode)
    window.addEventListener('musicVolumeChanged', (e: Event) => {
        const customEvent = e as CustomEvent;
        const volume = customEvent.detail.volume;
        if (musicVolumeGain) {
            musicVolumeGain.gain.value = isMusicMuted() ? 0 : volume;
        }
    });

    // Refresh dynamic text when language changes
    onLanguageChange(() => {
        updatePlaylistCount();
    });
}

function createPlayerUI(): void {
    playerContainer = document.createElement('div');
    playerContainer.className = 'media-player';
    // Hidden until expandPlayer() is called
    playerContainer.style.display = 'none';
    playerContainer.innerHTML = `
        <div class="player-expanded-content">
            <div class="player-header-bar">
                <button class="player-playlist-toggle" title="${t('player.showPlaylist')}" data-i18n-title="player.showPlaylist">
                    <svg class="icon-normal" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15V6"/>
                        <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/>
                        <path d="M12 12H3"/>
                        <path d="M16 6H3"/>
                        <path d="M12 18H3"/>
                    </svg>
                    <svg class="icon-pixel" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 13h6V5h6v4h-4v10h-8v-6zm2 2v2h4v-2h-4zM2 17h6v2H2v-2zm6-4H2v2h6v-2zM2 9h12v2H2V9zm12-4H2v2h12V5z"/>
                    </svg>
                </button>
                <button class="player-close" title="${t('player.minimize')}" data-i18n-title="player.minimize">
                    <svg class="icon-normal" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="4 14 10 14 10 20"/>
                        <polyline points="20 10 14 10 14 4"/>
                        <line x1="14" y1="10" x2="21" y2="3"/>
                        <line x1="3" y1="21" x2="10" y2="14"/>
                    </svg>
                    <svg class="icon-pixel" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17 3h-2v2h-2v2h-2V5H9V3H7v2h2v2h2v2h2V7h2V5h2V3zM4 13h16v-2H4v2zm9 4h-2v-2h2v2zm2 2h-2v-2h2v2zm0 0h2v2h-2v-2zm-6 0h2v-2H9v2zm0 0H7v2h2v-2z"/>
                    </svg>
                </button>
            </div>
            <div class="player-body">
                <div class="player-content">
                    <div class="player-cover">
                        <img src="${DEFAULT_COVER}" alt="Album cover" />
                    </div>
                    <div class="player-info">
                        <div class="player-title">${DEFAULT_NAME}</div>
                        <div class="player-artist">${DEFAULT_ARTIST}</div>
                    </div>
                </div>
            <div class="player-waveform-container">
                <div id="waveform"></div>
                <div class="player-time">
                    <span class="time-current">0:00</span>
                    <span class="time-total">0:00</span>
                </div>
            </div>
            <div class="player-controls">
                <button class="player-btn player-prev" title="${t('player.previous')}" data-i18n-title="player.previous">
                    <svg class="icon-normal" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                    </svg>
                    <svg class="icon-pixel" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 4h2v16H6V4zm12 0h-2v2h-2v3h-2v2h-2v2h2v3h2v2h2v2h2V4z"/>
                    </svg>
                </button>
                <button class="player-btn player-play" title="${t('player.play')}" data-i18n-title="player.play">
                    <svg class="icon-play icon-normal" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                    <svg class="icon-play icon-pixel" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 20H8V4h2v2h2v3h2v2h2v2h-2v2h-2v3h-2v2z"/>
                    </svg>
                    <svg class="icon-pause icon-normal" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                    <svg class="icon-pause icon-pixel" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 4H5v16h5V4zm9 0h-5v16h5V4z"/>
                    </svg>
                </button>
                <button class="player-btn player-next" title="${t('player.next')}" data-i18n-title="player.next">
                    <svg class="icon-normal" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                    </svg>
                    <svg class="icon-pixel" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 4h2v2h2v2h2v2h2v4h-2v2h-2v2H8v2H6V4zm12 0h-2v16h2V4z"/>
                    </svg>
                </button>
                <button class="player-btn player-loop" title="${t('player.loop')}" data-i18n-title="player.loop">
                    <svg class="icon-normal" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                    </svg>
                    <svg class="icon-pixel" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11 1H9v2h2v2H5v2H3v10h2v2h2v-2H5V7h6v2H9v2h2V9h2V7h2V5h-2V3h-2V1zm8 4h-2v2h2v10h-6v-2h2v-2h-2v2h-2v2H9v2h2v2h2v2h2v-2h-2v-2h6v-2h2V7h-2V5z"/>
                    </svg>
                </button>
            </div>
            <div class="player-playlist">
                <div class="playlist-header">
                    <span class="playlist-title" data-i18n="player.playlist">${t('player.playlist')}</span>
                    <span class="playlist-count"></span>
                </div>
                <div class="playlist-items"></div>
            </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(playerContainer);
    
    // Get elements
    const closeBtn = playerContainer.querySelector('.player-close') as HTMLButtonElement;
    const prevBtn = playerContainer.querySelector('.player-prev') as HTMLButtonElement;
    const playBtn = playerContainer.querySelector('.player-play') as HTMLButtonElement;
    const nextBtn = playerContainer.querySelector('.player-next') as HTMLButtonElement;
    // dragHandle removed - drag functionality disabled
    
    // Close button
    closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        collapsePlayer();
    });
    
    // Control buttons
    prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        previousSong(!audioElement?.paused);
    });
    
    playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlay();
    });
    
    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        nextSong(!audioElement?.paused);
    });
    
    // Loop button
    const loopBtn = playerContainer.querySelector('.player-loop') as HTMLButtonElement;
    loopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLoop();
    });
    
    // Playlist toggle button
    const playlistToggleBtn = playerContainer.querySelector('.player-playlist-toggle') as HTMLButtonElement;
    playlistToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlaylistView();
    });
    
    // Build playlist items
    buildPlaylistItems();

    // Prevent wheel/touch scroll on the entire media player from scrolling the 3D scene
    playerContainer.addEventListener('wheel', (e) => {
        e.stopPropagation();
    }, { passive: true });
    
    // Drag and resize functionality DISABLED - player stays centered
    // setupDragListeners();
    // setupResizeListeners();
}

/* DRAG DISABLED - Media player is now fixed position
function setupDragListeners(): void {
    if (!dragHandle) return;
    
    // Mouse drag
    dragHandle.addEventListener('mousedown', (e) => {
        if (!isExpanded || !playerContainer) return;
        e.preventDefault();
        startDragging(e.clientX, e.clientY);
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        updateDragPosition(e.clientX, e.clientY);
    });
    
    document.addEventListener('mouseup', stopDragging);
    
    // Touch drag
    dragHandle.addEventListener('touchstart', (e) => {
        if (!isExpanded || !playerContainer || e.touches.length === 0) return;
        e.preventDefault();
        const touch = e.touches[0];
        startDragging(touch.clientX, touch.clientY);
    }, { passive: false });
    
    document.addEventListener('touchmove', (e) => {
        if (!isDragging || e.touches.length === 0) return;
        e.preventDefault();
        const touch = e.touches[0];
        updateDragPosition(touch.clientX, touch.clientY);
    }, { passive: false });
    
    document.addEventListener('touchend', stopDragging);
}
*/

/* DRAG HELPER FUNCTIONS - No longer used
function startDragging(clientX: number, clientY: number): void {
    if (!playerContainer) return;
    
    isDragging = true;
    hasBeenDragged = true;
    
    const rect = playerContainer.getBoundingClientRect();
    dragStartX = clientX;
    dragStartY = clientY;
    elementStartX = rect.left;
    elementStartY = rect.top;
    
    playerContainer.style.transition = 'none';
    document.body.style.userSelect = 'none';
}

function updateDragPosition(clientX: number, clientY: number): void {
    if (!isDragging || !playerContainer) return;
    
    const deltaX = clientX - dragStartX;
    const deltaY = clientY - dragStartY;
    
    let newX = elementStartX + deltaX;
    let newY = elementStartY + deltaY;
    
    // Clamp to viewport
    const maxX = window.innerWidth - playerContainer.offsetWidth;
    const maxY = window.innerHeight - playerContainer.offsetHeight;
    newX = Math.max(0, Math.min(maxX, newX));
    newY = Math.max(0, Math.min(maxY, newY));
    
    playerContainer.style.left = `${newX}px`;
    playerContainer.style.top = `${newY}px`;
    playerContainer.style.transform = 'none';
}

function stopDragging(): void {
    if (!isDragging || !playerContainer) return;
    
    isDragging = false;
    playerContainer.style.transition = '';
    document.body.style.userSelect = '';
}
*/

/* RESIZE DISABLED - Media player has fixed width
function setupResizeListeners(): void {
    if (!playerContainer) return;
    
    const resizeHandles = playerContainer.querySelectorAll('.player-resize-handle');
    
    resizeHandles.forEach(handle => {
        // Mouse resize
        handle.addEventListener('mousedown', (e: Event) => {
            const mouseEvent = e as MouseEvent;
            if (!isExpanded || !playerContainer) return;
            mouseEvent.preventDefault();
            mouseEvent.stopPropagation();
            const dir = getResizeDirection(handle as HTMLElement);
            startResizing(mouseEvent.clientX, mouseEvent.clientY, dir);
        });
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        updateResize(e.clientX, e.clientY);
    });
    
    document.addEventListener('mouseup', stopResizing);
    
    // Touch resize on handles
    resizeHandles.forEach(handle => {
        handle.addEventListener('touchstart', (e: Event) => {
            const touchEvent = e as TouchEvent;
            if (!isExpanded || !playerContainer || touchEvent.touches.length === 0) return;
            touchEvent.preventDefault();
            touchEvent.stopPropagation();
            const touch = touchEvent.touches[0];
            const dir = getResizeDirection(handle as HTMLElement);
            startResizing(touch.clientX, touch.clientY, dir);
        }, { passive: false });
    });
    
    document.addEventListener('touchmove', (e) => {
        if (!isResizing || e.touches.length === 0) return;
        e.preventDefault();
        const touch = e.touches[0];
        updateResize(touch.clientX, touch.clientY);
    }, { passive: false });
    
    document.addEventListener('touchend', stopResizing);
    
    // Pinch to zoom on the player itself (horizontal only)
    playerContainer.addEventListener('touchstart', (e) => {
        if (!isExpanded || !playerContainer || e.touches.length !== 2) return;
        e.preventDefault();
        initialPinchDistance = getPinchDistance(e.touches);
        initialPinchWidth = playerContainer.offsetWidth;
    }, { passive: false });
    
    playerContainer.addEventListener('touchmove', (e) => {
        if (!isExpanded || !playerContainer || e.touches.length !== 2 || initialPinchDistance === 0) return;
        e.preventDefault();
        
        const currentDistance = getPinchDistance(e.touches);
        const scale = currentDistance / initialPinchDistance;
        
        let newWidth = Math.round(initialPinchWidth * scale);
        
        // Clamp width
        newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
        
        // Keep within viewport
        const rect = playerContainer.getBoundingClientRect();
        if (rect.left + newWidth > window.innerWidth) {
            newWidth = window.innerWidth - rect.left;
        }
        
        playerContainer.style.width = `${newWidth}px`;
    }, { passive: false });
    
    playerContainer.addEventListener('touchend', () => {
        initialPinchDistance = 0;
    });
}
*/

/* RESIZE HELPER FUNCTIONS - No longer used
function getPinchDistance(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getResizeDirection(handle: HTMLElement): string {
    if (handle.classList.contains('player-resize-e')) return 'e';
    if (handle.classList.contains('player-resize-w')) return 'w';
    return '';
}

function startResizing(clientX: number, _clientY: number, direction: string): void {
    if (!playerContainer) return;
    
    isResizing = true;
    resizeDirection = direction;
    resizeStartX = clientX;
    
    const rect = playerContainer.getBoundingClientRect();
    resizeStartWidth = rect.width;
    resizeStartLeft = rect.left;
    
    playerContainer.style.transition = 'none';
    document.body.style.userSelect = 'none';
}

function updateResize(clientX: number, _clientY: number): void {
    if (!isResizing || !playerContainer) return;
    
    const deltaX = clientX - resizeStartX;
    
    let newWidth = resizeStartWidth;
    let newLeft = resizeStartLeft;
    
    // Calculate new width based on direction (horizontal only)
    if (resizeDirection.includes('e')) {
        newWidth = resizeStartWidth + deltaX;
    }
    if (resizeDirection.includes('w')) {
        newWidth = resizeStartWidth - deltaX;
        newLeft = resizeStartLeft + deltaX;
    }
    
    // Clamp width
    newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
    
    // Adjust left position if width was clamped during west resize
    if (resizeDirection.includes('w')) {
        const widthDiff = resizeStartWidth - newWidth;
        newLeft = resizeStartLeft + widthDiff;
    }
    
    // Keep within viewport
    if (newLeft < 0) {
        newWidth += newLeft;
        newLeft = 0;
    }
    if (newLeft + newWidth > window.innerWidth) {
        newWidth = window.innerWidth - newLeft;
    }
    
    playerContainer.style.width = `${newWidth}px`;
    playerContainer.style.left = `${newLeft}px`;
}

function stopResizing(): void {
    if (!isResizing || !playerContainer) return;
    
    isResizing = false;
    resizeDirection = '';
    playerContainer.style.transition = '';
    document.body.style.userSelect = '';
}
*/

function createAudioElement(): void {
    audioElement = new Audio();
    audioElement.volume = 1;  // Always max pass-through — volume controlled via Web Audio GainNode
    // NOTE: Do NOT add an 'ended' listener here — wavesurfer's 'finish' event
    // already calls handleSongEnded(). Both fire from the same HTMLAudioElement,
    // so adding 'ended' here would double-trigger nextSong() and skip tracks.
    // Single source of truth: sync isPlaying from the actual audio element state
    audioElement.addEventListener('play', () => syncPlayState());
    audioElement.addEventListener('pause', () => syncPlayState());
}

// Read the real state from the audio element and update everything to match
function syncPlayState(): void {
    if (!audioElement) return;
    const playing = !audioElement.paused;
    if (playing === isPlaying) return;  // No change, skip DOM updates
    isPlaying = playing;
    updatePlayButton();
    updateBubblePlayingState();
}

// Preload adjacent songs into browser cache using fetch (no audio element swap)
function preloadAdjacentSongs(): void {
    if (playlist.length <= 1) return;
    
    const nextIndex = (currentSongIndex + 1) % playlist.length;
    const prevIndex = currentSongIndex === 0 ? playlist.length - 1 : currentSongIndex - 1;
    
    // Fetch files to prime browser cache - wavesurfer.load() will use cached version
    [nextIndex, prevIndex].forEach(idx => {
        if (idx !== currentSongIndex && playlist[idx] && !preloadedAudios.has(idx)) {
            fetch(playlist[idx].file).then(() => {
                preloadedAudios.set(idx, true as any); // Mark as cached
            }).catch(() => {});
        }
    });
    
    // Clean old entries
    for (const [index] of preloadedAudios.entries()) {
        if (index !== nextIndex && index !== prevIndex) {
            preloadedAudios.delete(index);
        }
    }
}

function initWavesurfer(): void {
    if (!playerContainer) return;
    
    const waveformContainer = playerContainer.querySelector('#waveform') as HTMLDivElement;
    if (!waveformContainer) return;
    
    // Create wavesurfer instance with mode-specific options
    const baseOptions = {
        container: waveformContainer,
        waveColor: 'rgba(255, 255, 255, 0.8)',
        progressColor: '#e53935',
        cursorColor: '#e53935',
        cursorWidth: 3,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 40,
        normalize: true,
        hideScrollbar: true,
        fillParent: true,
        interact: true,
        dragToSeek: true,
    };
    // Share the HTMLAudioElement so Media Session + background playback works
    wavesurfer = WaveSurfer.create({ ...baseOptions, media: audioElement! });
    
    // Add frequency analyser canvas as the waveform visual
    waveformContainer.style.position = 'relative';
    analyserCanvas = document.createElement('canvas');
    analyserCanvas.className = 'waveform-analyser waveform-analyser-interactive';
    waveformContainer.appendChild(analyserCanvas);
    analyserCtx = analyserCanvas.getContext('2d');
    
    // Click / drag to seek on the analyser canvas
    let seekDragging = false;
    const seekFromPointer = (clientX: number) => {
        if (!wavesurfer) return;
        const rect = analyserCanvas!.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        wavesurfer.seekTo(pct);
    };
    analyserCanvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        seekDragging = true;
        analyserCanvas!.setPointerCapture(e.pointerId);
        seekFromPointer(e.clientX);
    });
    analyserCanvas.addEventListener('pointermove', (e) => {
        if (seekDragging) seekFromPointer(e.clientX);
    });
    analyserCanvas.addEventListener('pointerup', (e) => {
        seekDragging = false;
        analyserCanvas!.releasePointerCapture(e.pointerId);
    });
    
    // Update time display
    wavesurfer.on('audioprocess', () => {
        updateTimeDisplay();
    });
    wavesurfer.on('seeking', () => {
        updateTimeDisplay();
    });
    wavesurfer.on('ready', () => {
        updateTimeDisplay();
        updateWaveformColors();
        preloadAdjacentSongs();
        // Auto-play if a song switch requested it
        if (pendingPlayOnReady && wavesurfer) {
            pendingPlayOnReady = false;
            wavesurfer.play();
        }
    });
    
    // Start analyser animation immediately so idle bars + progress are visible
    startAnalyserAnimation();
    
    wavesurfer.on('play', () => {
        _songEndHandled = false;  // Reset guard — new song is playing
        isPlaying = true;
        updatePlayButton();
        updateBubblePlayingState();
        connectMusicAnalyser();
        startAnalyserAnimation();
    });
    wavesurfer.on('pause', () => {
        isPlaying = false;
        updatePlayButton();
        updateBubblePlayingState();
        // Keep animation running so progress/idle bars stay visible
        startAnalyserAnimation();
    });
    wavesurfer.on('finish', () => handleSongEnded());
    
    // Handle resize with requestAnimationFrame for smooth, lag-free updates
    // Skip during animations to prevent lag on expand/collapse
    const resizeObserver = new ResizeObserver(() => {
        if (wavesurfer && isExpanded && !isAnimating) {
            requestAnimationFrame(() => {
                if (wavesurfer && isExpanded && !isAnimating) {
                    wavesurfer.setOptions({ height: 40 });
                }
            });
        }
    });
    resizeObserver.observe(waveformContainer);
    
    // Load first song waveform
    if (playlist.length > 0) {
        wavesurfer.load(playlist[0].file);
    }
}

// ============================================
// REAL-TIME FREQUENCY ANALYSER (API mode)
// ============================================
async function connectMusicAnalyser(): Promise<void> {
    if (mediaSourceConnected || !wavesurfer) return;
    mediaSourceConnected = true;
    const ctx = getAudioContext();
    if (!ctx) { mediaSourceConnected = false; return; }
    try {
        await loadRetroWorklet();

        const mediaEl = wavesurfer.getMediaElement();
        const source = ctx.createMediaElementSource(mediaEl);
        analyserNode = ctx.createAnalyser();
        analyserNode.fftSize = 128;
        analyserNode.smoothingTimeConstant = 0.8;

        // Underwater muffled effect
        musicLowpassFilter = ctx.createBiquadFilter();
        musicLowpassFilter.type = 'lowpass';
        musicLowpassFilter.frequency.value = MUFFLE_FILTER_CLEAN;
        musicLowpassFilter.Q.value = 0.7;

        musicGainNode = ctx.createGain();
        musicGainNode.gain.value = MUFFLE_GAIN_MAX;

        // Retro effect: worklet crusher with dry/wet split + post-crusher smoothing
        if (retroWorkletReady) {
            retroWorkletNode = new AudioWorkletNode(ctx, 'retro-8bit-processor');
        }
        retroSmoothFilter = ctx.createBiquadFilter();  // gentle muffle after crusher
        retroSmoothFilter.type = 'lowpass';
        retroSmoothFilter.frequency.value = 22050;  // open by default
        retroSmoothFilter.Q.value = 0.7;
        retroBypass = ctx.createGain();  // clean path
        retroBypass.gain.value = 1.0;
        retroWet = ctx.createGain();     // retro path
        retroWet.gain.value = 0.0;
        retroMerge = ctx.createGain();
        retroMerge.gain.value = 1.0;

        // Chain: source → muffle lowpass → muffle gain → split
        source.connect(musicLowpassFilter);
        musicLowpassFilter.connect(musicGainNode);
        //   clean path: gain → bypass → merge
        musicGainNode.connect(retroBypass);
        retroBypass.connect(retroMerge);
        //   retro path: gain → worklet → smooth filter → wet → merge
        if (retroWorkletNode) {
            musicGainNode.connect(retroWorkletNode);
            retroWorkletNode.connect(retroSmoothFilter);
        }
        retroSmoothFilter.connect(retroWet);
        retroWet.connect(retroMerge);
        //   merge → analyser → destination
        retroMerge.connect(analyserNode);

        // Music volume GainNode — controls volume/mute via Web Audio instead of HTMLAudioElement.volume
        musicVolumeGain = ctx.createGain();
        musicVolumeGain.gain.value = isMusicMuted() ? 0 : getMusicVolume();
        analyserNode.connect(musicVolumeGain);
        musicVolumeGain.connect(getMasterDestination() ?? ctx.destination);
    } catch (e) {
        console.warn('Could not connect music analyser:', e);
        mediaSourceConnected = false;
    }
}

function startAnalyserAnimation(): void {
    if (!analyserCanvas || !analyserCtx || analyserAnimId) return;
    const parent = analyserCanvas.parentElement;
    if (parent) {
        analyserCanvas.width = parent.clientWidth;
        analyserCanvas.height = parent.clientHeight;
    }
    drawAnalyser();
}

function drawAnalyser(): void {
    if (!analyserCtx || !analyserCanvas) { analyserAnimId = 0; return; }
    
    // Keep canvas sized to container
    const parent = analyserCanvas.parentElement;
    if (parent) {
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        if (w > 0 && h > 0 && (analyserCanvas.width !== w || analyserCanvas.height !== h)) {
            analyserCanvas.width = w;
            analyserCanvas.height = h;
        }
    }
    const { width, height } = analyserCanvas;
    if (width === 0 || height === 0) { analyserAnimId = requestAnimationFrame(drawAnalyser); return; }

    analyserCtx.clearRect(0, 0, width, height);
    
    // Get playback progress (0-1)
    let progress = 0;
    if (wavesurfer) {
        const dur = wavesurfer.getDuration();
        if (dur > 0) progress = wavesurfer.getCurrentTime() / dur;
    }
    const cursorX = progress * width;
    
    // If not playing or no analyser, draw idle bars with progress
    const bufferLength = analyserNode ? analyserNode.frequencyBinCount : 64;
    // Reuse typed array across frames — only reallocate if size changed
    if (!analyserDataArray || analyserDataArray.length !== bufferLength) {
        analyserDataArray = new Uint8Array(bufferLength);
    }
    
    if (isPlaying && analyserNode) {
        analyserNode.getByteFrequencyData(analyserDataArray);
        // Compute average intensity from frequency data (0-1)
        // Weight low frequencies (bass) more for better beat reactivity
        let sum = 0;
        let weightSum = 0;
        for (let i = 0; i < bufferLength; i++) {
            const weight = i < bufferLength * 0.25 ? 2.0 : 1.0;  // Bass bins get 2x weight
            sum += analyserDataArray[i] * weight;
            weightSum += 255 * weight;
        }
        const rawIntensity = sum / weightSum;
        
        // Asymmetric smoothing: fast attack, slow release
        const smooth = rawIntensity > _musicIntensity ? INTENSITY_ATTACK : INTENSITY_RELEASE;
        _musicIntensity += (rawIntensity - _musicIntensity) * smooth;
        
        // Beat detection: compare raw against slow-moving history
        const jump = rawIntensity - _intensityHistory;
        _intensityHistory += (rawIntensity - _intensityHistory) * HISTORY_SMOOTH;
        if (jump > BEAT_THRESHOLD) {
            // Scale kick by how big the jump is (capped at 1)
            _beatKick = Math.min(1, jump / 0.25);
        } else {
            _beatKick *= BEAT_DECAY;
        }
    } else {
        // Idle state: small ambient bars
        for (let i = 0; i < bufferLength; i++) {
            analyserDataArray[i] = 8 + Math.sin(i * 0.3 + Date.now() * 0.001) * 6;
        }
        // Decay everything when not playing
        _musicIntensity *= 0.95;
        _beatKick *= BEAT_DECAY;
    }

    const gap = 1;
    const barWidth = (width - gap * (bufferLength - 1)) / bufferLength;

    for (let i = 0; i < bufferLength; i++) {
        const value = analyserDataArray[i] / 255;
        const minBarH = 2;
        const barHeight = minBarH + value * (height - minBarH) * 0.85;
        const x = i * (barWidth + gap);
        const barCenter = x + barWidth / 2;
        
        // Played portion is bright red, unplayed is dim white
        if (barCenter <= cursorX) {
            const alpha = isPlaying ? (0.4 + value * 0.6) : 0.35;
            analyserCtx.fillStyle = `rgba(229, 57, 53, ${alpha.toFixed(2)})`;
        } else {
            const alpha = isPlaying ? (0.1 + value * 0.25) : 0.12;
            analyserCtx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
        }
        
        // Draw bars from bottom, rounded
        const y = height - barHeight;
        const radius = Math.min(barWidth / 2, 2);
        analyserCtx.beginPath();
        analyserCtx.moveTo(x + radius, y);
        analyserCtx.lineTo(x + barWidth - radius, y);
        analyserCtx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
        analyserCtx.lineTo(x + barWidth, height);
        analyserCtx.lineTo(x, height);
        analyserCtx.lineTo(x, y + radius);
        analyserCtx.quadraticCurveTo(x, y, x + radius, y);
        analyserCtx.fill();
    }
    
    // Draw cursor line
    if (progress > 0 && progress < 1) {
        analyserCtx.fillStyle = '#e53935';
        analyserCtx.fillRect(cursorX - 1, 0, 2, height);
    }

    analyserAnimId = requestAnimationFrame(drawAnalyser);
}

function updateTimeDisplay(): void {
    if (!wavesurfer || !playerContainer) return;
    
    const currentTime = wavesurfer.getCurrentTime();
    const duration = wavesurfer.getDuration();
    
    const currentEl = playerContainer.querySelector('.time-current') as HTMLSpanElement;
    const totalEl = playerContainer.querySelector('.time-total') as HTMLSpanElement;
    
    if (currentEl) currentEl.textContent = formatTime(currentTime);
    if (totalEl) totalEl.textContent = formatTime(duration);
}

function formatTime(seconds: number): string {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateWaveformColors(): void {
    if (!wavesurfer) return;
    
    // WaveSurfer is invisible; analyser canvas handles visuals
    wavesurfer.setOptions({
        waveColor: 'transparent',
        progressColor: 'transparent',
        cursorColor: 'transparent',
        cursorWidth: 0,
    });
}

// Expanded player dimensions (must match CSS)
const EXPANDED_WIDTH = 320;
const EDGE_OFFSET = 16;  // Padding from viewport edges
let isAnimating = false;  // Block resize during expand/collapse animation
const ANIM_DURATION = 400;  // ms — must match CSS transition duration

// Reusable Vector3 for radio screen projection
const _radioPos = new Vector3();

/** Project the radio's 3D position to screen coordinates */
function getRadioScreenPos(): { x: number; y: number } {
    radio.getWorldPosition(_radioPos);
    _radioPos.y += 0.15;  // Slight offset above radio center
    const screenPos = _radioPos.project(camera);
    return {
        x: (screenPos.x * 0.5 + 0.5) * window.innerWidth,
        y: (-screenPos.y * 0.5 + 0.5) * window.innerHeight,
    };
}

export function expandPlayer(): void {
    if (isExpanded || !playerContainer) return;
    isExpanded = true;
    isAnimating = true;

    // Close settings panel if open
    document.dispatchEvent(new CustomEvent('player-opened'));

    // Play collapse sound (inverted)
    playUIBubbleCollapse();

    // Zoom camera to radio when above water
    if (!isUnderwater) {
        zoomToRadio();
    }

    // --- Position player at its final expanded location ---
    const centerX = (window.innerWidth - EXPANDED_WIDTH) / 2;
    const topY = Math.max(EDGE_OFFSET + 20, window.innerHeight * 0.15);
    const maxX = window.innerWidth - EXPANDED_WIDTH - EDGE_OFFSET;
    const maxY = window.innerHeight - 240 - EDGE_OFFSET;
    const finalX = Math.max(EDGE_OFFSET, Math.min(maxX, centerX));
    const finalY = Math.max(EDGE_OFFSET, Math.min(maxY, topY));

    playerContainer.style.transition = 'none';
    playerContainer.style.display = '';
    playerContainer.classList.add('expanded');
    playerContainer.style.left = `${finalX}px`;
    playerContainer.style.top = `${finalY}px`;

    // Force layout so we can measure the final bounding rect
    playerContainer.offsetHeight;

    // --- Set transform-origin to the radio's screen position relative to the player ---
    const rect = playerContainer.getBoundingClientRect();
    const radioScreen = getRadioScreenPos();
    const originX = radioScreen.x - rect.left;
    const originY = radioScreen.y - rect.top;

    // Start state: scale(0) at the radio's exact screen position
    playerContainer.style.transformOrigin = `${originX}px ${originY}px`;
    playerContainer.style.transform = 'scale(0)';
    playerContainer.style.opacity = '0';

    // Force flush so browser registers the start state
    playerContainer.offsetHeight;

    // --- Animate: grow outward from the radio point ---
    playerContainer.style.transition = `transform ${ANIM_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${Math.round(ANIM_DURATION * 0.4)}ms ease`;
    playerContainer.style.transform = 'scale(1)';
    playerContainer.style.opacity = '1';

    // After animation finishes, clean up inline overrides
    setTimeout(() => {
        if (playerContainer && isExpanded) {
            playerContainer.style.transition = '';
            playerContainer.style.transform = '';
            playerContainer.style.transformOrigin = '';
            playerContainer.style.opacity = '';
            isAnimating = false;
            if (wavesurfer) wavesurfer.setOptions({ height: 40 });
        }
    }, ANIM_DURATION + 50);
}

function collapsePlayer(): void {
    if (!isExpanded || !playerContainer) return;
    isExpanded = false;
    isAnimating = true;
    
    // Exit playlist view if active
    if (isPlaylistView) {
        isPlaylistView = false;
        playerContainer.classList.remove('playlist-view');
        const toggleBtn = playerContainer.querySelector('.player-playlist-toggle') as HTMLButtonElement;
        if (toggleBtn) toggleBtn.classList.remove('active');
        const playlistEl = playerContainer.querySelector('.player-playlist') as HTMLDivElement;
        if (playlistEl) playlistEl.style.maxHeight = '';
    }
    
    // Play expand sound (inverted)
    playUIBubbleExpand();
    
    // Zoom out from radio when above water
    if (!isUnderwater) {
        zoomOutFromRadio();
    }
    
    // --- Set transform-origin to the radio's screen position relative to the player ---
    const rect = playerContainer.getBoundingClientRect();
    const radioScreen = getRadioScreenPos();
    const originX = radioScreen.x - rect.left;
    const originY = radioScreen.y - rect.top;

    playerContainer.style.transformOrigin = `${originX}px ${originY}px`;
    playerContainer.style.transition = `transform ${ANIM_DURATION}ms cubic-bezier(0.5, 0, 0.84, 0), opacity ${Math.round(ANIM_DURATION * 0.5)}ms ease ${Math.round(ANIM_DURATION * 0.4)}ms`;
    playerContainer.style.transform = 'scale(0)';
    playerContainer.style.opacity = '0';

    // After animation finishes, hide and clean up
    setTimeout(() => {
        if (playerContainer && !isExpanded) {
            playerContainer.classList.remove('expanded');
            playerContainer.style.display = 'none';
            playerContainer.style.transition = '';
            playerContainer.style.transform = '';
            playerContainer.style.transformOrigin = '';
            playerContainer.style.opacity = '';
            playerContainer.style.left = '';
            playerContainer.style.top = '';
        }
        isAnimating = false;
    }, ANIM_DURATION + 50);
}

function togglePlay(): void {
    if (!wavesurfer && !audioElement) return;
    
    // Play button sound
    playUIButton();
    
    if (wavesurfer) {
        wavesurfer.playPause();
    } else if (audioElement) {
        if (isPlaying) {
            audioElement.pause();
        } else {
            audioElement.play().catch(e => console.error('Failed to play:', e));
        }
    }
}

function toggleLoop(): void {
    isLoopEnabled = !isLoopEnabled;
    updateLoopButton();
}

function updateLoopButton(): void {
    if (!playerContainer) return;
    const loopBtn = playerContainer.querySelector('.player-loop') as HTMLButtonElement;
    if (isLoopEnabled) {
        loopBtn.classList.add('active');
    } else {
        loopBtn.classList.remove('active');
    }
}

// Guard against duplicate 'finish' events — wavesurfer can fire 'finish' a second
// time when loading a new song (the old media element state triggers it).
let _songEndHandled = false;

function handleSongEnded(): void {
    if (_songEndHandled) return;
    _songEndHandled = true;

    if (isLoopEnabled) {
        // Loop the current song
        _songEndHandled = false;  // allow next loop end to fire
        if (wavesurfer) {
            wavesurfer.seekTo(0);
            wavesurfer.play();
        } else if (audioElement) {
            audioElement.currentTime = 0;
            audioElement.play().catch(e => console.error('Failed to loop:', e));
        }
    } else {
        // Go to next song (wraps to first when at end) and keep playing
        nextSong(true);
    }
}

function previousSong(autoPlay: boolean = false): void {
    currentSongIndex--;
    if (currentSongIndex < 0) {
        currentSongIndex = playlist.length - 1;
    }
    loadSong(currentSongIndex, autoPlay);
}

function nextSong(autoPlay: boolean = false): void {
    currentSongIndex++;
    if (currentSongIndex >= playlist.length) {
        currentSongIndex = 0;
    }
    loadSong(currentSongIndex, autoPlay);
}

function loadSong(index: number, forcePlay: boolean = false): void {
    if (playlist.length === 0) return;
    
    // Decide if we should auto-play: either forced or was already playing
    const shouldPlay = forcePlay || (audioElement ? !audioElement.paused : isPlaying);
    const songFile = playlist[index].file;
    
    // Store intent so the wavesurfer 'ready' handler can auto-play
    pendingPlayOnReady = shouldPlay;
    
    updatePlayerDisplay();
    
    // Reset time display to 0:00 immediately
    if (playerContainer) {
        const currentEl = playerContainer.querySelector('.time-current') as HTMLSpanElement;
        if (currentEl) currentEl.textContent = '0:00';
    }
    
    // wavesurfer.load() sets audioElement.src internally (they share the same element).
    // Let wavesurfer be the single owner of .src to avoid double-set conflicts.
    if (wavesurfer) {
        try {
            wavesurfer.load(songFile);
        } catch {
            // Fallback if wavesurfer.load fails: set src directly
            if (audioElement) {
                audioElement.src = songFile;
                if (shouldPlay) audioElement.play().catch(() => {});
            }
        }
    } else if (audioElement) {
        audioElement.src = songFile;
        if (shouldPlay) audioElement.play().catch(() => {});
    }
    
    // Mobile fallback: if wavesurfer 'ready' doesn't fire (e.g. screen locked),
    // start playback directly after a short delay
    if (shouldPlay && audioElement) {
        setTimeout(() => {
            if (pendingPlayOnReady && audioElement && audioElement.paused) {
                pendingPlayOnReady = false;
                audioElement.play().catch(() => {});
            }
        }, 1500);
    }
    
    // Preload adjacent songs into browser cache
    setTimeout(() => preloadAdjacentSongs(), 100);
}

function updatePlayerDisplay(): void {
    if (!playerContainer || playlist.length === 0) return;
    
    const song = playlist[currentSongIndex];
    const coverImg = playerContainer.querySelector('.player-cover img') as HTMLImageElement;
    const titleEl = playerContainer.querySelector('.player-title') as HTMLDivElement;
    const artistEl = playerContainer.querySelector('.player-artist') as HTMLDivElement;
    
    coverImg.src = song.cover || DEFAULT_COVER;
    titleEl.textContent = song.name || DEFAULT_NAME;
    artistEl.textContent = song.artist || DEFAULT_ARTIST;
    
    // Update playlist view if visible
    updatePlaylistHighlight();
}

// ============================================
// PLAYLIST VIEW
// ============================================

function togglePlaylistView(): void {
    if (!playerContainer) return;
    
    isPlaylistView = !isPlaylistView;
    
    if (isPlaylistView) {
        // Calculate available space for the playlist based on player position
        const rect = playerContainer.getBoundingClientRect();
        const playlistEl = playerContainer.querySelector('.player-playlist') as HTMLDivElement;
        
        if (playlistEl) {
            // Space from bottom of current player content to bottom of viewport (with margin)
            const bottomMargin = 40;
            const availableBelow = window.innerHeight - rect.bottom - bottomMargin;
            // Clamp between a minimum useful height and max desired
            const playlistMaxHeight = Math.max(100, Math.min(350, availableBelow));
            playlistEl.style.maxHeight = `${playlistMaxHeight}px`;
        }
        
        playerContainer.classList.add('playlist-view');
        updatePlaylistCount();
    } else {
        playerContainer.classList.remove('playlist-view');
        // Reset inline max-height so CSS takes over next time
        const playlistEl = playerContainer.querySelector('.player-playlist') as HTMLDivElement;
        if (playlistEl) {
            playlistEl.style.maxHeight = '';
        }
    }
    
    // Update toggle button state
    const toggleBtn = playerContainer.querySelector('.player-playlist-toggle') as HTMLButtonElement;
    toggleBtn.classList.toggle('active', isPlaylistView);
}

let playlistScrollListenerAttached = false;

function buildPlaylistItems(): void {
    if (!playerContainer) return;
    
    const playlistItemsContainer = playerContainer.querySelector('.playlist-items') as HTMLDivElement;
    if (!playlistItemsContainer) return;
    
    playlistItemsContainer.innerHTML = '';
    
    // Prevent scroll events from propagating to the scene (only attach once)
    if (!playlistScrollListenerAttached) {
        playlistScrollListenerAttached = true;
        
        playlistItemsContainer.addEventListener('wheel', (e) => {
            e.stopPropagation();
            // Only prevent default if we can scroll in the direction
            const { scrollTop, scrollHeight, clientHeight } = playlistItemsContainer;
            const atTop = scrollTop === 0;
            const atBottom = scrollTop + clientHeight >= scrollHeight;
            
            if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
                // At scroll boundary, prevent default to stop page scroll
                e.preventDefault();
            }
        }, { passive: false });
        
        // Also prevent touch scroll from propagating
        playlistItemsContainer.addEventListener('touchmove', (e) => {
            e.stopPropagation();
        }, { passive: true });
    }
    
    playlist.forEach((song, index) => {
        const item = document.createElement('div');
        item.className = 'playlist-item';
        item.dataset.index = index.toString();
        item.draggable = true;
        
        item.innerHTML = `
            <div class="playlist-item-drag">
                <svg class="icon-normal" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.5"/>
                    <circle cx="15" cy="6" r="1.5"/>
                    <circle cx="9" cy="12" r="1.5"/>
                    <circle cx="15" cy="12" r="1.5"/>
                    <circle cx="9" cy="18" r="1.5"/>
                    <circle cx="15" cy="18" r="1.5"/>
                </svg>
                <svg class="icon-pixel" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5 3H3v2h2V3zm14 4h2v6h-2V9H9v10h4v2H7V7h12zM7 3h2v2H7V3zM5 7H3v2h2V7zm-2 4h2v2H3v-2zm2 4H3v2h2v-2zm6-12h2v2h-2V3zm6 0h-2v2h2V3zm-2 14v-2h6v2h-2v2h-2v2h-2v-4zm4 2v2h2v-2h-2z"/>
                </svg>
            </div>
            <img class="playlist-item-cover" src="${song.cover || DEFAULT_COVER}" alt="" />
            <div class="playlist-item-info">
                <div class="playlist-item-name">${song.name}</div>
                <div class="playlist-item-artist">${song.artist}</div>
            </div>
        `;
        
        // Click to play this song
        item.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            // Don't trigger if clicking the drag handle
            if (target.closest('.playlist-item-drag')) return;
            
            currentSongIndex = index;
            loadSong(index, true);
        });
        
        // Drag and drop for reordering
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);
        
        playlistItemsContainer.appendChild(item);
    });
    
    updatePlaylistHighlight();
    updatePlaylistCount();
}

function updatePlaylistHighlight(): void {
    if (!playerContainer) return;
    
    const items = playerContainer.querySelectorAll('.playlist-item');
    items.forEach((item, index) => {
        item.classList.toggle('active', index === currentSongIndex);
    });
}

function updatePlaylistCount(): void {
    if (!playerContainer) return;
    
    const countEl = playerContainer.querySelector('.playlist-count') as HTMLSpanElement;
    if (countEl) {
        countEl.textContent = `${playlist.length} ${t('player.songs')}`;
    }
}

// Drag and drop handlers for playlist reordering
let draggedItem: HTMLElement | null = null;
let draggedIndex: number = -1;

function handleDragStart(e: DragEvent): void {
    const target = e.target as HTMLElement;
    const item = target.closest('.playlist-item') as HTMLElement;
    if (!item) return;
    
    draggedItem = item;
    draggedIndex = parseInt(item.dataset.index || '0');
    
    item.classList.add('dragging');
    
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedIndex.toString());
    }
}

function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
    }
}

function handleDragEnter(e: DragEvent): void {
    const target = e.target as HTMLElement;
    const item = target.closest('.playlist-item') as HTMLElement;
    if (item && item !== draggedItem) {
        item.classList.add('drag-over');
    }
}

function handleDragLeave(e: DragEvent): void {
    const target = e.target as HTMLElement;
    const item = target.closest('.playlist-item') as HTMLElement;
    if (item) {
        item.classList.remove('drag-over');
    }
}

function handleDrop(e: DragEvent): void {
    e.preventDefault();
    
    const target = e.target as HTMLElement;
    const dropItem = target.closest('.playlist-item') as HTMLElement;
    if (!dropItem || !draggedItem || dropItem === draggedItem) return;
    
    const dropIndex = parseInt(dropItem.dataset.index || '0');
    if (draggedIndex === dropIndex) return;
    
    // Remember which song is currently playing (by reference)
    const currentSong = playlist[currentSongIndex];
    
    // Reorder the playlist — adjust insertion index when moving down,
    // because the first splice shifts all subsequent items back by one.
    const [movedSong] = playlist.splice(draggedIndex, 1);
    const insertAt = draggedIndex < dropIndex ? dropIndex - 1 : dropIndex;
    playlist.splice(insertAt, 0, movedSong);
    
    // Update currentSongIndex to follow the currently playing song
    currentSongIndex = playlist.indexOf(currentSong);
    
    // Rebuild the playlist UI
    buildPlaylistItems();
    
    dropItem.classList.remove('drag-over');
}

function handleDragEnd(): void {
    if (draggedItem) {
        draggedItem.classList.remove('dragging');
    }
    
    // Remove all drag-over classes
    if (playerContainer) {
        const items = playerContainer.querySelectorAll('.playlist-item');
        items.forEach(item => item.classList.remove('drag-over'));
    }
    
    draggedItem = null;
    draggedIndex = -1;
}

function updatePlayButton(): void {
    if (!playerContainer) return;
    
    const playBtn = playerContainer.querySelector('.player-play') as HTMLButtonElement;
    if (!playBtn) return;
    
    if (isPlaying) {
        playBtn.classList.add('playing');
    } else {
        playBtn.classList.remove('playing');
    }
}

// Update bubble state when playing/paused
function updateBubblePlayingState(): void {
    if (!playerContainer) return;
    
    if (isPlaying) {
        playerContainer.classList.add('is-playing');
    } else {
        playerContainer.classList.remove('is-playing');
    }
    
}

// Track day mode for waveform color updates
let wasDayMode = false;

// Update audio effects (underwater muffle, retro, etc.)
export function Update(): void {
    if (!playerContainer || !radio || radio.children.length === 0) return;
    
    // Check for day/night mode changes to update waveform colors
    const isDayMode = document.body.classList.contains('day-mode');
    if (isDayMode !== wasDayMode) {
        wasDayMode = isDayMode;
        updateWaveformColors();
    }
    
    // Check underwater state from body class
    const wasUnderwater = isUnderwater;
    isUnderwater = document.body.classList.contains('underwater');
    
    // --- Underwater music effect ---
    if (wasUnderwater && !isUnderwater) {
        // Just surfaced — reset filter + gain to clean state
        if (musicLowpassFilter) musicLowpassFilter.frequency.value = MUFFLE_FILTER_CLEAN;
        if (musicGainNode) musicGainNode.gain.value = MUFFLE_GAIN_MAX;
    }
    
    // Progressive muffled effect — every frame while underwater
    if (isUnderwater) {
        const depth = Math.max(0, -camera.position.y);  // 0 at surface, 8 at sea floor
        const t = Math.min(depth / MUFFLE_DEPTH_MAX, 1.0);  // 0..1
        // Exponential sweep from 800Hz (surface) down to 150Hz (deep)
        const filterFreq = MUFFLE_FILTER_ENTER * Math.pow(MUFFLE_FILTER_DEEP / MUFFLE_FILTER_ENTER, t);
        const gain = MUFFLE_GAIN_MAX * (1.0 - t * (MUFFLE_GAIN_MAX - MUFFLE_GAIN_MIN));
        if (musicLowpassFilter) musicLowpassFilter.frequency.value = filterFreq;
        if (musicGainNode) musicGainNode.gain.value = Math.max(0, gain);
    }
    
    // Retro sample-rate reduction synced with pixelation
    if (retroWorkletNode && retroBypass && retroWet) {
        const shouldRetro = pixelSizeValue > 0;
        if (shouldRetro && !retroActive) {
            // Set worklet params: 8-bit depth, 8x sample-rate reduction
            const bitParam = retroWorkletNode.parameters.get('bitDepth');
            const redParam = retroWorkletNode.parameters.get('reduction');
            if (bitParam) bitParam.value = 8;
            if (redParam) redParam.value = 8;
            retroBypass.gain.value = 0.0;  // mute clean
            retroWet.gain.value = 1.0;     // unmute retro
            retroActive = true;
        }
        // Update post-crusher muffle based on pixelation level (every frame while active)
        if (shouldRetro && retroSmoothFilter) {
            // medium (5) → 6kHz, high (10) → 8kHz
            retroSmoothFilter.frequency.value = pixelSizeValue >= 10 ? 8000 : 6000;
        }
        if (!shouldRetro && retroActive) {
            // Reset worklet to passthrough
            const bitParam = retroWorkletNode.parameters.get('bitDepth');
            const redParam = retroWorkletNode.parameters.get('reduction');
            if (bitParam) bitParam.value = 16;
            if (redParam) redParam.value = 1;
            // Open filter back up
            if (retroSmoothFilter) retroSmoothFilter.frequency.value = 22050;
            retroBypass.gain.value = 1.0;  // unmute clean
            retroWet.gain.value = 0.0;     // mute retro
            retroActive = false;
        }
    }
}

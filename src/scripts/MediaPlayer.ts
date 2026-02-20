// ============================================
// MEDIA PLAYER - Mini music player for radio
// ============================================

import { camera, pixelSizeValue } from "./Scene";
import { radio } from "../scene/Island";
import { Vector3 } from "three";
import { playUIButton, playUIBubbleExpand, playUIBubbleCollapse, getAudioContext, getMusicVolume } from "./Audio";
import { zoomToRadio, zoomOutFromRadio, getSavedCameraPosition, DEFAULT_CAMERA_X, DEFAULT_CAMERA_Z } from "./Control";
import WaveSurfer from 'wavesurfer.js';
import { t, onLanguageChange } from "./i18n";

// ============================================
// MEDIA SESSION API INTEGRATION
// ============================================

// Default metadata for the site
const DEFAULT_MEDIA_METADATA = {
    title: 'leosato.',
    artist: 'Interactive 3D Portfolio',
    album: '',
    artwork: [
        { src: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png' },
        { src: '/icons/icon-128x128.png', sizes: '128x128', type: 'image/png' },
        { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png' },
        { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' }
    ]
};

function setMediaSessionMetadata(title: string, artist: string, artwork: MediaImage[]): void {
    if (!('mediaSession' in navigator)) return;
    
    navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        artwork
    });
}

function setDefaultMediaSession(): void {
    setMediaSessionMetadata(
        DEFAULT_MEDIA_METADATA.title,
        DEFAULT_MEDIA_METADATA.artist,
        DEFAULT_MEDIA_METADATA.artwork
    );
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
    }
}

function updateMediaSessionForSong(song: SongData): void {
    if (!('mediaSession' in navigator)) return;
    
    const artwork: MediaImage[] = song.cover 
        ? [{ src: song.cover, sizes: '512x512', type: 'image/jpeg' }]
        : DEFAULT_MEDIA_METADATA.artwork;
    
    setMediaSessionMetadata(song.name || 'Unknown Track', song.artist || 'Unknown Artist', artwork);
}

function updateMediaSessionPlaybackState(playing: boolean): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

function updateMediaSessionPosition(): void {
    if (!('mediaSession' in navigator) || !audioElement) return;
    
    try {
        navigator.mediaSession.setPositionState({
            duration: audioElement.duration || 0,
            playbackRate: audioElement.playbackRate,
            position: audioElement.currentTime || 0
        });
    } catch {
        // Some browsers may not support setPositionState
    }
}

function setupMediaSessionHandlers(): void {
    if (!('mediaSession' in navigator)) return;
    
    navigator.mediaSession.setActionHandler('play', () => {
        if (wavesurfer) {
            wavesurfer.play();
        } else if (audioElement) {
            audioElement.play();
        }
    });
    
    navigator.mediaSession.setActionHandler('pause', () => {
        if (wavesurfer) {
            wavesurfer.pause();
        } else if (audioElement) {
            audioElement.pause();
        }
    });
    
    navigator.mediaSession.setActionHandler('previoustrack', () => {
        previousSong(!audioElement?.paused);
    });
    
    navigator.mediaSession.setActionHandler('nexttrack', () => {
        nextSong(!audioElement?.paused);
    });
    
    navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
            if (wavesurfer) {
                const duration = wavesurfer.getDuration();
                if (duration > 0) {
                    wavesurfer.seekTo(details.seekTime / duration);
                }
            } else if (audioElement) {
                audioElement.currentTime = details.seekTime;
            }
            updateMediaSessionPosition();
        }
    });
    
    // Set default metadata initially
    setDefaultMediaSession();
}

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
        file: 'audio/music/320526__benpm__ambient-piano-music-3.wav',
        name: 'Ambient Piano Music 3',
        artist: 'benpm',
        cover: 'images/music/ben.jpg'
    },
    {
        file: 'audio/music/595751__yellowtree__late-nights-in-osaka.wav',
        name: 'Late Nights in Osaka',
        artist: 'yellowtree',
        cover: 'images/music/yellowtree.jpg'
    },
    {
        file: 'audio/music/Aventure - Afternoon Coffee (freetouse.com).mp3',
        name: 'Afternoon Coffee',
        artist: 'Aventure',
        cover: 'images/music/afternooncoffee.webp'
    },
    {
        file: 'audio/music/Aventure - Chill Walk (freetouse.com).mp3',
        name: 'Chill Walk',
        artist: 'Aventure',
        cover: 'images/music/chillwalk.webp'
    },
    {
        file: 'audio/music/Hazelwood - Reflection (freetouse.com).mp3',
        name: 'Reflection',
        artist: 'Hazelwood',
        cover: 'images/music/reflection.webp'
    },
    {
        file: 'audio/music/massobeats - breeze (freetouse.com).mp3',
        name: 'breeze',
        artist: 'massobeats',
        cover: 'images/music/breeze.webp'
    },
    {
        file: 'audio/music/massobeats - honey jam (freetouse.com).mp3',
        name: 'honey jam',
        artist: 'massobeats',
        cover: 'images/music/massobeats.webp'
    },
    {
        file: 'audio/music/massobeats - ocean (freetouse.com).mp3',
        name: 'ocean',
        artist: 'massobeats',
        cover: 'images/music/ocean.webp'
    },
    {
        file: 'audio/music/Moavii - City Lights (freetouse.com).mp3',
        name: 'City Lights',
        artist: 'Moavii',
        cover: 'images/music/blur.webp'
    },
    {
        file: 'audio/music/Moavii - Fly With Me (freetouse.com).mp3',
        name: 'Fly With Me',
        artist: 'Moavii',
        cover: 'images/music/flywithme.webp'
    },
    {
        file: 'audio/music/Moavii - Stranded (freetouse.com).mp3',
        name: 'Stranded',
        artist: 'Moavii',
        cover: 'images/music/stranded.webp'
    },
    {
        file: 'audio/music/Moavii - Umbrella (freetouse.com).mp3',
        name: 'Umbrella',
        artist: 'Moavii',
        cover: 'images/music/umbrella.webp'
    }
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

// Get current song cover
export function getCurrentCover(): string | undefined {
    if (playlist.length === 0) return undefined;
    return playlist[currentSongIndex].cover;
}
let isPlaylistView = false;  // Expanded playlist view
let isUnderwater = false;
let closedWhileUnderwater = false;
let isLoopEnabled = false;  // Loop current song or go to next

// Drag state (drag disabled, only keeping minimal state)
let isDragging = false;
let hasBeenDragged = false;

// Radio screen position (for returning after drag)
let radioScreenX = 0;
let radioScreenY = 0;
let hasInitialPosition = false;  // Track if we've set the initial position

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
    setupMediaSessionHandlers();
    
    // Close media player when settings panel opens
    document.addEventListener('settings-opened', () => {
        if (isExpanded) {
            collapsePlayer();
        }
    });
    
    // Listen for mute changes from settings
    window.addEventListener('musicMuteChanged', (e: Event) => {
        const customEvent = e as CustomEvent;
        const muted = customEvent.detail.muted;
        if (audioElement) {
            audioElement.muted = muted;
        }
    });

    // Listen for volume changes from settings
    window.addEventListener('musicVolumeChanged', (e: Event) => {
        const customEvent = e as CustomEvent;
        const volume = customEvent.detail.volume;
        if (audioElement) {
            audioElement.volume = volume;
        }
    });

    // Refresh dynamic text when language changes
    onLanguageChange(() => {
        updatePlaylistCount();
    });
}

function createPlayerUI(): void {
    playerContainer = document.createElement('div');
    playerContainer.className = 'media-player bubble';
    // Hide until initial position is set (prevents flash at wrong position)
    playerContainer.style.opacity = '0';
    playerContainer.innerHTML = `
        <span class="music-note"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>
        <img class="bubble-cover" src="" alt="" />
        <div class="player-expanded-content">
            <div class="player-header-bar">
                <button class="player-playlist-toggle" title="${t('player.showPlaylist')}" data-i18n-title="player.showPlaylist">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15V6"/>
                        <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/>
                        <path d="M12 12H3"/>
                        <path d="M16 6H3"/>
                        <path d="M12 18H3"/>
                    </svg>
                </button>
                <button class="player-close" title="${t('player.minimize')}" data-i18n-title="player.minimize">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="4 14 10 14 10 20"/>
                        <polyline points="20 10 14 10 14 4"/>
                        <line x1="14" y1="10" x2="21" y2="3"/>
                        <line x1="3" y1="21" x2="10" y2="14"/>
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
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                    </svg>
                </button>
                <button class="player-btn player-play" title="${t('player.play')}" data-i18n-title="player.play">
                    <svg class="icon-play" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                    <svg class="icon-pause" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                </button>
                <button class="player-btn player-next" title="${t('player.next')}" data-i18n-title="player.next">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                    </svg>
                </button>
                <button class="player-btn player-loop" title="${t('player.loop')}" data-i18n-title="player.loop">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
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
    
    // Bubble click to expand
    playerContainer.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        // Only expand if clicking on the bubble itself (music note, its SVG children, or container when in bubble mode)
        const clickedMusicNote = target.closest('.music-note');
        if (!isExpanded && !isDragging && (target === playerContainer || clickedMusicNote)) {
            expandPlayer();
        }
    });
    
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
    audioElement.volume = getMusicVolume();
    audioElement.addEventListener('ended', () => handleSongEnded());
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
    if (playing) {
        if (playlist.length > 0) {
            updateMediaSessionForSong(playlist[currentSongIndex]);
        }
        updateMediaSessionPlaybackState(true);
    } else {
        updateMediaSessionPlaybackState(false);
        if (audioElement.currentTime === 0) {
            setDefaultMediaSession();
        }
    }
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
        // Update Media Session position every second (throttled)
        if (audioElement && Math.floor(audioElement.currentTime) !== Math.floor(audioElement.currentTime - 0.25)) {
            updateMediaSessionPosition();
        }
    });
    wavesurfer.on('seeking', () => {
        updateTimeDisplay();
        updateMediaSessionPosition();
    });
    wavesurfer.on('ready', () => {
        updateTimeDisplay();
        updateWaveformColors();
        updateMediaSessionPosition();
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
        analyserNode.connect(ctx.destination);
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
    } else {
        // Idle state: small ambient bars
        for (let i = 0; i < bufferLength; i++) {
            analyserDataArray[i] = 8 + Math.sin(i * 0.3 + Date.now() * 0.001) * 6;
        }
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

function expandPlayer(): void {
    if (isExpanded || !playerContainer) return;
    isExpanded = true;
    isAnimating = true;  // Block resize during animation
    hasBeenDragged = true;  // Mark as dragged so it doesn't snap back to radio
    
    // Close settings panel if open
    document.dispatchEvent(new CustomEvent('player-opened'));
    
    // Play collapse sound (inverted)
    playUIBubbleCollapse();
    
    // Zoom camera to radio when above water
    if (!isUnderwater) {
        zoomToRadio();
    }
    
    // Clear any conflicting inline styles
    playerContainer.style.bottom = '';
    playerContainer.style.right = '';
    playerContainer.style.position = '';
    playerContainer.style.transform = '';
    
    // SIMPLIFIED POSITIONING: Always centered horizontally, top portion of screen
    // Works both above water and underwater
    const centerX = (window.innerWidth - EXPANDED_WIDTH) / 2;
    const topY = Math.max(EDGE_OFFSET + 20, window.innerHeight * 0.15);  // 15% from top
    
    // Clamp to ensure it stays within viewport
    const maxX = window.innerWidth - EXPANDED_WIDTH - EDGE_OFFSET;
    const maxY = window.innerHeight - 240 - EDGE_OFFSET;  // Min height 240px
    
    const finalX = Math.max(EDGE_OFFSET, Math.min(maxX, centerX));
    const finalY = Math.max(EDGE_OFFSET, Math.min(maxY, topY));
    
    // Set position before transitioning
    playerContainer.style.left = `${finalX}px`;
    playerContainer.style.top = `${finalY}px`;
    
    // Restore full transitions for expand/collapse animation
    playerContainer.style.transition = '';
    playerContainer.classList.remove('bubble');
    playerContainer.classList.add('expanded');
    
    // Allow resize after animation completes (400ms transition)
    setTimeout(() => {
        isAnimating = false;
        // Trigger one resize now that animation is done
        if (wavesurfer && isExpanded) {
            wavesurfer.setOptions({ height: 40 });
        }
    }, 400);
}

function collapsePlayer(): void {
    if (!isExpanded || !playerContainer) return;
    isExpanded = false;
    
    // Exit playlist view if active
    if (isPlaylistView) {
        isPlaylistView = false;
        playerContainer.classList.remove('playlist-view');
        const toggleBtn = playerContainer.querySelector('.player-playlist-toggle') as HTMLButtonElement;
        if (toggleBtn) toggleBtn.classList.remove('active');
        // Clear inline max-height so CSS max-height:0 takes effect on next expand
        const playlistEl = playerContainer.querySelector('.player-playlist') as HTMLDivElement;
        if (playlistEl) playlistEl.style.maxHeight = '';
    }
    
    // Play expand sound (inverted)
    playUIBubbleExpand();
    
    // Zoom out from radio when above water
    if (!isUnderwater) {
        zoomOutFromRadio();
    }
    
    // Remove pop-in class so it doesn't replay animation on collapse
    playerContainer.classList.remove('pop-in-animate');
    
    // Reset any custom width/height from resize
    playerContainer.style.width = '';
    playerContainer.style.height = '';
    
    // Restore full transition for smooth animation back to bubble
    playerContainer.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    
    playerContainer.classList.remove('expanded');
    playerContainer.classList.add('bubble');
    
    // Calculate where radio WILL BE after camera zooms out
    let targetRadioX = radioScreenX;
    let targetRadioY = radioScreenY;
    
    if (!isUnderwater) {
        // Get saved camera position (where camera will return to)
        const savedCam = getSavedCameraPosition();
        
        // Temporarily move camera to saved position to calculate correct projection
        const currentCamX = camera.position.x;
        const currentCamY = camera.position.y;
        const currentCamZ = camera.position.z;
        
        // Set camera to saved position
        camera.position.x = savedCam.x !== undefined ? savedCam.x : DEFAULT_CAMERA_X;
        camera.position.y = savedCam.y;
        camera.position.z = savedCam.z !== undefined ? savedCam.z : DEFAULT_CAMERA_Z;
        camera.updateMatrixWorld();
        
        // Now project radio position with camera at saved position
        const radioPos = new Vector3();
        radio.getWorldPosition(radioPos);
        radioPos.y += 0.35;  // Same offset used in Update
        
        const screenPos = radioPos.clone().project(camera);
        targetRadioX = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
        targetRadioY = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
        
        // Restore camera to current position
        camera.position.x = currentCamX;
        camera.position.y = currentCamY;
        camera.position.z = currentCamZ;
        camera.updateMatrixWorld();
    }
    
    // Animate back to calculated radio position
    playerContainer.style.left = `${targetRadioX}px`;
    playerContainer.style.top = `${targetRadioY}px`;
    playerContainer.style.transform = 'translate(-50%, -50%)';
    
    // Wait for animation to complete before letting Update() take over
    setTimeout(() => {
        hasBeenDragged = false;
        // Reset transition to default
        if (playerContainer) {
            playerContainer.style.transition = '';
        }
    }, 450);  // Slightly longer than 0.4s transition
    
    // If underwater, mark that we closed it underwater
    if (isUnderwater) {
        closedWhileUnderwater = true;
    }
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

function handleSongEnded(): void {
    if (isLoopEnabled) {
        // Loop the current song
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
    
    // Update bubble cover as well
    updateBubbleCover();
    
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
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.5"/>
                    <circle cx="15" cy="6" r="1.5"/>
                    <circle cx="9" cy="12" r="1.5"/>
                    <circle cx="15" cy="12" r="1.5"/>
                    <circle cx="9" cy="18" r="1.5"/>
                    <circle cx="15" cy="18" r="1.5"/>
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
    
    // Reorder the playlist
    const movedSong = playlist.splice(draggedIndex, 1)[0];
    playlist.splice(dropIndex, 0, movedSong);
    
    // Update currentSongIndex if needed
    if (currentSongIndex === draggedIndex) {
        currentSongIndex = dropIndex;
    } else if (draggedIndex < currentSongIndex && dropIndex >= currentSongIndex) {
        currentSongIndex--;
    } else if (draggedIndex > currentSongIndex && dropIndex <= currentSongIndex) {
        currentSongIndex++;
    }
    
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
    
    const playIcon = playerContainer.querySelector('.icon-play') as SVGElement;
    const pauseIcon = playerContainer.querySelector('.icon-pause') as SVGElement;
    
    if (isPlaying) {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
    } else {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
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
    
    // Update bubble cover separately (not tied to playing state)
    updateBubbleCover();
}

// Update bubble cover image - shows cover only when playing
function updateBubbleCover(): void {
    if (!playerContainer) return;
    
    const bubbleCover = playerContainer.querySelector('.bubble-cover') as HTMLImageElement;
    const musicNote = playerContainer.querySelector('.music-note') as HTMLElement;
    
    const cover = playlist[currentSongIndex]?.cover;
    
    // Only show cover if playing AND song has a cover
    if (isPlaying && cover && bubbleCover) {
        // Preload new image before switching
        const newImg = new Image();
        newImg.onload = () => {
            bubbleCover.src = cover;
            bubbleCover.style.display = 'block';
            if (musicNote) musicNote.style.display = 'none';
        };
        newImg.src = cover;
    } else {
        // Not playing or no cover - show music icon
        if (bubbleCover) bubbleCover.style.display = 'none';
        if (musicNote) musicNote.style.display = '';
    }
}

// Track day mode for waveform color updates
let wasDayMode = false;
// Smooth fade timer for surfacing transition (opacity only, not position)
let surfaceFadeTimer = 0;
const SURFACE_FADE_DELAY = 0.25;   // seconds to wait before fading in after surfacing

// Reusable Vector3 for radio projection (avoids per-frame allocation)
const _radioPos = new Vector3();

// Update position to follow radio in 3D space
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
    
    // Tick surface fade timer
    if (surfaceFadeTimer > 0) {
        surfaceFadeTimer -= 0.016;  // ~60fps frame time
    }
    
    // --- Underwater music effect ---
    if (!wasUnderwater && isUnderwater) {
        // Just went underwater — immediately hide bubble (no fade)
        playerContainer.style.opacity = '0';
        playerContainer.style.pointerEvents = 'none';
    } else if (wasUnderwater && !isUnderwater) {
        // Just surfaced — start fade delay (bubble stays hidden while camera settles)
        surfaceFadeTimer = SURFACE_FADE_DELAY;
        
        // Reset filter + gain to clean state
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
    
    // If just surfaced and was closed underwater, show bubble again
    if (wasUnderwater && !isUnderwater && closedWhileUnderwater) {
        closedWhileUnderwater = false;
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
    
    // Project radio world position to screen coordinates every frame
    radio.getWorldPosition(_radioPos);
    _radioPos.y += 0.35;
    const screenPos = _radioPos.project(camera);
    radioScreenX = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    radioScreenY = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
    
    // Check if radio is in front of camera
    const isInFront = screenPos.z < 1 && screenPos.z > 0;
    
    // Determine bubble visibility
    const isSurfacing = surfaceFadeTimer > 0;
    const shouldHideBubble = isUnderwater || isSurfacing || (!isInFront || closedWhileUnderwater) || isExpanded;
    
    // ABOVE WATER: Follow radio position directly (no CSS transition on position)
    if (!isUnderwater && !isExpanded) {
        if (!hasBeenDragged && !isDragging) {
            // Set position every frame — instant tracking, no lag
            playerContainer.style.left = `${radioScreenX}px`;
            playerContainer.style.top = `${radioScreenY}px`;
            playerContainer.style.transform = 'translate(-50%, -50%)';
            
            // First time position is set — show bubble with pop-in animation
            if (!hasInitialPosition) {
                hasInitialPosition = true;
                playerContainer.style.opacity = '1';
                playerContainer.classList.add('pop-in-animate');
            }
        }
        
        // Handle visibility
        if (shouldHideBubble) {
            playerContainer.style.opacity = '0';
            playerContainer.style.pointerEvents = 'none';
        } else {
            playerContainer.style.opacity = '1';
            playerContainer.style.pointerEvents = 'auto';
        }
    }
}

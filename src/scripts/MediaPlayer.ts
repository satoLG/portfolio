// ============================================
// MEDIA PLAYER - Mini music player for radio
// ============================================

import { camera } from "./Scene";
import { radio } from "../scene/Island";
import { Vector3 } from "three";
import { playUIButton, playUIBubbleExpand, playUIBubbleCollapse } from "./Audio";
import WaveSurfer from 'wavesurfer.js';

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
        cover: undefined
    },
    {
        file: 'audio/music/595751__yellowtree__late-nights-in-osaka.wav',
        name: 'Late Nights in Osaka',
        artist: 'yellowtree',
        cover: undefined
    },
    {
        file: 'audio/music/Aventure - Afternoon Coffee (freetouse.com).mp3',
        name: 'Afternoon Coffee',
        artist: 'Aventure',
        cover: undefined
    },
    {
        file: 'audio/music/Aventure - Chill Walk (freetouse.com).mp3',
        name: 'Chill Walk',
        artist: 'Aventure',
        cover: undefined
    },
    {
        file: 'audio/music/Aventure - Moody Weather (freetouse.com).mp3',
        name: 'Moody Weather',
        artist: 'Aventure',
        cover: undefined
    },
    {
        file: 'audio/music/Hazelwood - Reflection (freetouse.com).mp3',
        name: 'Reflection',
        artist: 'Hazelwood',
        cover: 'images/music/reflection.webp'
    },
    {
        file: 'audio/music/Hoffy Beats - Riding the Waves (freetouse.com).mp3',
        name: 'Riding the Waves',
        artist: 'Hoffy Beats',
        cover: undefined
    },
    {
        file: 'audio/music/Lukrembo - Spaceship (freetouse.com).mp3',
        name: 'Spaceship',
        artist: 'Lukrembo',
        cover: undefined
    },
    {
        file: 'audio/music/massobeats - breeze (freetouse.com).mp3',
        name: 'Breeze',
        artist: 'massobeats',
        cover: 'images/music/massobeats.webp'
    },
    {
        file: 'audio/music/massobeats - honey jam (freetouse.com).mp3',
        name: 'Honey Jam',
        artist: 'massobeats',
        cover: 'images/music/massobeats.webp'
    },
    {
        file: 'audio/music/massobeats - ocean (freetouse.com).mp3',
        name: 'Ocean',
        artist: 'massobeats',
        cover: 'images/music/massobeats.webp'
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
        file: 'audio/music/Moavii - Midnight Bliss (freetouse.com).mp3',
        name: 'Midnight Bliss',
        artist: 'Moavii',
        cover: undefined
    },
    {
        file: 'audio/music/Moavii - Sprinkles (freetouse.com).mp3',
        name: 'Sprinkles',
        artist: 'Moavii',
        cover: undefined
    },
    {
        file: 'audio/music/Moavii - Stranded (freetouse.com).mp3',
        name: 'Stranded',
        artist: 'Moavii',
        cover: undefined
    },
    {
        file: 'audio/music/Moavii - Sunset Dreams (freetouse.com).mp3',
        name: 'Sunset Dreams',
        artist: 'Moavii',
        cover: undefined
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
let isExpanded = false;
let isPlaylistView = false;  // Expanded playlist view
let isUnderwater = false;
let closedWhileUnderwater = false;
let isLoopEnabled = false;  // Loop current song or go to next

// Drag state
let isDragging = false;
let hasBeenDragged = false;
let dragStartX = 0;
let dragStartY = 0;
let elementStartX = 0;
let elementStartY = 0;

// Radio screen position (for returning after drag)
let radioScreenX = 0;
let radioScreenY = 0;

// DOM Elements
let playerContainer: HTMLDivElement | null = null;
let dragHandle: HTMLDivElement | null = null;

// Wavesurfer instance
let wavesurfer: WaveSurfer | null = null;

export function Start(): void {
    createPlayerUI();
    createAudioElement();
    initWavesurfer();
    updatePlayerDisplay();
    
    // Listen for mute changes from settings
    window.addEventListener('musicMuteChanged', (e: Event) => {
        const customEvent = e as CustomEvent;
        if (audioElement) {
            audioElement.muted = customEvent.detail.muted;
        }
    });
}

function createPlayerUI(): void {
    playerContainer = document.createElement('div');
    playerContainer.className = 'media-player bubble pop-in-animate';
    playerContainer.innerHTML = `
        <span class="music-note">♪</span>
        <div class="player-expanded-content">
            <div class="player-drag-handle"></div>
            <button class="player-close" title="Close">×</button>
            <button class="player-playlist-toggle" title="Show playlist">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15V6"/>
                    <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/>
                    <path d="M12 12H3"/>
                    <path d="M16 6H3"/>
                    <path d="M12 18H3"/>
                </svg>
            </button>
            <div class="player-content">
                <div class="player-cover">
                    <img src="${DEFAULT_COVER}" alt="Album cover" />
                </div>
                <div class="player-info">
                    <div class="player-title">${DEFAULT_NAME}</div>
                    <div class="player-artist">${DEFAULT_ARTIST}</div>
                </div>
            </div>
            <div class="player-controls">
                <button class="player-btn player-prev" title="Previous">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                    </svg>
                </button>
                <button class="player-btn player-play" title="Play">
                    <svg class="icon-play" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                    <svg class="icon-pause" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                </button>
                <button class="player-btn player-next" title="Next">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                    </svg>
                </button>
                <button class="player-btn player-loop" title="Loop">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                    </svg>
                </button>
            </div>
            <div class="player-waveform-container">
                <div id="waveform"></div>
                <div class="player-time">
                    <span class="time-current">0:00</span>
                    <span class="time-total">0:00</span>
                </div>
            </div>
            <div class="player-playlist">
                <div class="playlist-header">
                    <span class="playlist-title">Playlist</span>
                    <span class="playlist-count"></span>
                </div>
                <div class="playlist-items"></div>
            </div>
        </div>
    `;
    
    document.body.appendChild(playerContainer);
    
    // Get elements
    const closeBtn = playerContainer.querySelector('.player-close') as HTMLButtonElement;
    const prevBtn = playerContainer.querySelector('.player-prev') as HTMLButtonElement;
    const playBtn = playerContainer.querySelector('.player-play') as HTMLButtonElement;
    const nextBtn = playerContainer.querySelector('.player-next') as HTMLButtonElement;
    dragHandle = playerContainer.querySelector('.player-drag-handle') as HTMLDivElement;
    
    // Bubble click to expand
    playerContainer.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        // Only expand if clicking on the bubble itself (music note or container when in bubble mode)
        if (!isExpanded && !isDragging && (target === playerContainer || target.classList.contains('music-note'))) {
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
        previousSong();
    });
    
    playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlay();
    });
    
    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        nextSong();
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
    
    // Drag functionality - only on drag handle
    setupDragListeners();
}

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

function createAudioElement(): void {
    audioElement = new Audio();
    audioElement.volume = 0.5;
    audioElement.addEventListener('ended', () => handleSongEnded());
    audioElement.addEventListener('play', () => {
        isPlaying = true;
        updatePlayButton();
    });
    audioElement.addEventListener('pause', () => {
        isPlaying = false;
        updatePlayButton();
    });
    
    // Don't load first song here - wavesurfer will handle it
}

function initWavesurfer(): void {
    if (!playerContainer) return;
    
    const waveformContainer = playerContainer.querySelector('#waveform') as HTMLDivElement;
    if (!waveformContainer) return;
    
    // Create wavesurfer instance
    wavesurfer = WaveSurfer.create({
        container: waveformContainer,
        waveColor: 'rgba(255, 255, 255, 0.3)',
        progressColor: 'rgba(74, 158, 255, 0.8)',
        cursorColor: 'rgba(255, 255, 255, 0.5)',
        cursorWidth: 1,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 32,
        normalize: true,
        hideScrollbar: true,
        fillParent: true,
        media: audioElement!,
    });
    
    // Update time display
    wavesurfer.on('audioprocess', updateTimeDisplay);
    wavesurfer.on('seeking', updateTimeDisplay);
    wavesurfer.on('ready', () => {
        updateTimeDisplay();
        updateWaveformColors();
    });
    
    // Load first song waveform
    if (playlist.length > 0) {
        wavesurfer.load(playlist[0].file);
    }
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
    
    const isDayMode = document.body.classList.contains('day-mode');
    
    if (isDayMode) {
        wavesurfer.setOptions({
            waveColor: 'rgba(10, 37, 64, 0.25)',
            progressColor: 'rgba(30, 100, 180, 0.7)',
            cursorColor: 'rgba(10, 37, 64, 0.4)',
        });
    } else {
        wavesurfer.setOptions({
            waveColor: 'rgba(255, 255, 255, 0.3)',
            progressColor: 'rgba(74, 158, 255, 0.8)',
            cursorColor: 'rgba(255, 255, 255, 0.5)',
        });
    }
}

// Expanded player dimensions (must match CSS)
const EXPANDED_WIDTH = 240;
const EXPANDED_HEIGHT = 200;  // Approximate height
const EDGE_OFFSET = 16;  // Padding from viewport edges

function expandPlayer(): void {
    if (isExpanded || !playerContainer) return;
    isExpanded = true;
    hasBeenDragged = true;  // Mark as dragged so it doesn't snap back to radio
    
    // Play expand sound
    playUIBubbleExpand();
    
    // Calculate position: place above the radio bubble, keep within viewport
    let expandX = radioScreenX - EXPANDED_WIDTH / 2;
    let expandY = radioScreenY - EXPANDED_HEIGHT + 50;  // 1px above bubble
    
    // Clamp to viewport with offset
    const maxX = window.innerWidth - EXPANDED_WIDTH - EDGE_OFFSET;
    const maxY = window.innerHeight - EXPANDED_HEIGHT - EDGE_OFFSET;
    
    expandX = Math.max(EDGE_OFFSET, Math.min(maxX, expandX));
    expandY = Math.max(EDGE_OFFSET, Math.min(maxY, expandY));
    
    // Set position before transitioning
    playerContainer.style.left = `${expandX}px`;
    playerContainer.style.top = `${expandY}px`;
    playerContainer.style.transform = 'none';
    
    // Restore full transitions for expand/collapse animation
    playerContainer.style.transition = '';
    playerContainer.classList.remove('bubble');
    playerContainer.classList.add('expanded');
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
    }
    
    // Play collapse sound
    playUIBubbleCollapse();
    
    // Remove pop-in class so it doesn't replay animation on collapse
    playerContainer.classList.remove('pop-in-animate');
    
    // Restore full transition for smooth animation back to bubble
    playerContainer.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    
    playerContainer.classList.remove('expanded');
    playerContainer.classList.add('bubble');
    
    // Animate back to radio position
    playerContainer.style.left = `${radioScreenX}px`;
    playerContainer.style.top = `${radioScreenY}px`;
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
    
    const wasPlaying = isPlaying;
    const songFile = playlist[index].file;
    
    updatePlayerDisplay();
    
    // Use wavesurfer to load (it controls the audio element)
    if (wavesurfer) {
        // Wait for wavesurfer to be ready before playing
        wavesurfer.once('ready', () => {
            if (wasPlaying || forcePlay) {
                wavesurfer!.play();
            }
        });
        wavesurfer.load(songFile);
    } else if (audioElement) {
        // Fallback if wavesurfer not available
        audioElement.src = songFile;
        if (wasPlaying || forcePlay) {
            audioElement.play().catch(e => console.error('Failed to play:', e));
        }
    }
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
        playerContainer.classList.add('playlist-view');
        updatePlaylistCount();
        
        // Adjust position if player would go off-screen with wider playlist view
        const PLAYLIST_WIDTH = 320;
        const currentLeft = parseFloat(playerContainer.style.left) || 0;
        const maxX = window.innerWidth - PLAYLIST_WIDTH - EDGE_OFFSET;
        
        if (currentLeft > maxX) {
            playerContainer.style.left = `${maxX}px`;
        }
    } else {
        playerContainer.classList.remove('playlist-view');
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
        countEl.textContent = `${playlist.length} songs`;
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

// Track day mode for waveform color updates
let wasDayMode = false;

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
    
    // If just surfaced and was closed underwater, show bubble again
    if (wasUnderwater && !isUnderwater && closedWhileUnderwater) {
        closedWhileUnderwater = false;
    }
    
    // Get radio world position
    const radioPos = new Vector3();
    radio.getWorldPosition(radioPos);
    
    // Add offset above the radio
    radioPos.y += 0.35;
    
    // Project to screen coordinates
    const screenPos = radioPos.clone().project(camera);
    
    // Convert to CSS pixels
    radioScreenX = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    radioScreenY = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
    
    // Check if radio is in front of camera (z < 1)
    const isInFront = screenPos.z < 1 && screenPos.z > 0;
    
    // Visibility logic:
    // - Hide bubble when underwater
    // - Hide bubble when expanded
    // - Hide when radio is behind camera
    // - Hide if closed while underwater (until surface)
    const shouldHideBubble = isUnderwater || isExpanded || !isInFront || closedWhileUnderwater;
    
    // If not dragged, follow radio position instantly (no transition lag)
    if (!hasBeenDragged && !isDragging) {
        // Disable transition for position updates when following radio
        if (!isExpanded) {
            playerContainer.style.transition = 'opacity 0.3s ease, background 0.4s ease';
        }
        playerContainer.style.left = `${radioScreenX}px`;
        playerContainer.style.top = `${radioScreenY}px`;
        playerContainer.style.transform = 'translate(-50%, -50%)';
    }
    
    // Handle visibility
    if (shouldHideBubble && !isExpanded) {
        playerContainer.style.opacity = '0';
        playerContainer.style.pointerEvents = 'none';
    } else {
        playerContainer.style.opacity = '1';
        playerContainer.style.pointerEvents = 'auto';
    }
}

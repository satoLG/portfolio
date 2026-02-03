// ============================================
// MEDIA PLAYER - Mini music player for radio
// ============================================

import { camera } from "./Scene";
import { radio } from "../scene/Island";
import { Vector3 } from "three";

// Song metadata map - add your songs here!
interface SongData {
    file: string;
    name: string;
    artist: string;
    cover?: string;  // Optional cover image
}

const SONGS: SongData[] = [
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
let isUnderwater = false;
let closedWhileUnderwater = false;

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

export function Start(): void {
    createPlayerUI();
    createAudioElement();
    updatePlayerDisplay();
}

function createPlayerUI(): void {
    playerContainer = document.createElement('div');
    playerContainer.className = 'media-player bubble';
    playerContainer.innerHTML = `
        <span class="music-note">♪</span>
        <div class="player-expanded-content">
            <div class="player-drag-handle"></div>
            <button class="player-close" title="Close">×</button>
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
    audioElement.addEventListener('ended', () => nextSong());
    audioElement.addEventListener('play', () => {
        isPlaying = true;
        updatePlayButton();
    });
    audioElement.addEventListener('pause', () => {
        isPlaying = false;
        updatePlayButton();
    });
    
    // Load first song
    if (SONGS.length > 0) {
        audioElement.src = SONGS[0].file;
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
    
    // Restore full transition for smooth animation back to bubble
    playerContainer.style.transition = '';
    
    playerContainer.classList.remove('expanded');
    playerContainer.classList.add('bubble');
    
    // Animate back to radio position
    playerContainer.style.left = `${radioScreenX}px`;
    playerContainer.style.top = `${radioScreenY}px`;
    playerContainer.style.transform = 'translate(-50%, -50%)';
    
    // Wait for animation to complete before letting Update() take over
    setTimeout(() => {
        hasBeenDragged = false;
    }, 450);  // Slightly longer than 0.4s transition
    
    // If underwater, mark that we closed it underwater
    if (isUnderwater) {
        closedWhileUnderwater = true;
    }
}

function togglePlay(): void {
    if (!audioElement) return;
    
    if (isPlaying) {
        audioElement.pause();
    } else {
        audioElement.play().catch(e => console.error('Failed to play:', e));
    }
}

function previousSong(): void {
    currentSongIndex--;
    if (currentSongIndex < 0) {
        currentSongIndex = SONGS.length - 1;
    }
    loadSong(currentSongIndex);
}

function nextSong(): void {
    currentSongIndex++;
    if (currentSongIndex >= SONGS.length) {
        currentSongIndex = 0;
    }
    loadSong(currentSongIndex);
}

function loadSong(index: number): void {
    if (!audioElement || SONGS.length === 0) return;
    
    const wasPlaying = isPlaying;
    audioElement.src = SONGS[index].file;
    updatePlayerDisplay();
    
    if (wasPlaying) {
        audioElement.play().catch(e => console.error('Failed to play:', e));
    }
}

function updatePlayerDisplay(): void {
    if (!playerContainer || SONGS.length === 0) return;
    
    const song = SONGS[currentSongIndex];
    const coverImg = playerContainer.querySelector('.player-cover img') as HTMLImageElement;
    const titleEl = playerContainer.querySelector('.player-title') as HTMLDivElement;
    const artistEl = playerContainer.querySelector('.player-artist') as HTMLDivElement;
    
    coverImg.src = song.cover || DEFAULT_COVER;
    titleEl.textContent = song.name || DEFAULT_NAME;
    artistEl.textContent = song.artist || DEFAULT_ARTIST;
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

// Update position to follow radio in 3D space
export function Update(): void {
    if (!playerContainer || !radio || radio.children.length === 0) return;
    
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

import { webglContainer, pixelSizeValue, SetPixelSize, setShadowsEnabled, colorFilterValue, SetColorFilter, setDPR, setShadowResolution, isMobile, showOcean } from "./Scene";
import type { ColorFilter } from "./Scene";
import { toggleDayNight, isDayTime, getDayNightBlend, setInitialDayNight } from "../scene/Skybox";
import { startAudio, transitionToUnderwater, transitionToAboveWater, setNatureMuted, setMusicMuted, setInterfaceMuted, setCharacterMuted, setNatureVolume, setMusicVolume, setInterfaceVolume, setCharacterVolume, getNatureVolume, getMusicVolume, getInterfaceVolume, getCharacterVolume, isCharacterMuted, preloadUISounds, playUISwitchDay, playUISwitchNight, playUISpinOpen, playUISpinClose } from "./Audio";
import { getCameraY, setIntroProgress, enableScroll } from "./Control";
import { beginDescent as beginCloudDescent } from "../effects/CloudSprites.ts";
import { setLoadingCallback } from "../scene/Island";
import { t, setLanguage, type Language } from "./i18n";

const THEME_STORAGE_KEY = 'portfolio-theme-mode';

// ── Celebration particle burst ───────────────────────────────────────────────
const PARTICLE_COUNT = 14;  // easy to tweak
const PARTICLE_BLUES = ['#40a4ff', '#2b7cd4', '#1a5faa']; // 3 blue tones

function spawnParticles(button: HTMLElement, container: HTMLElement): void {
    const rect = button.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = rect.width / 2;  // spawn on the button edge
    const baseStep = (Math.PI * 2) / PARTICLE_COUNT;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const angle = baseStep * i + (Math.random() - 0.5) * 0.5;
        // Start position: on button edge
        const startX = cx + Math.cos(angle) * radius;
        const startY = cy + Math.sin(angle) * radius;
        // Fly-out distance from edge
        const flyDist = 30 + Math.random() * 30;
        const dx = Math.cos(angle) * flyDist;
        const dy = Math.sin(angle) * flyDist;
        const size = 5 + Math.random() * 7;
        const dur = 500 + Math.random() * 300;
        const color = PARTICLE_BLUES[i % 3];

        const dot = document.createElement('span');
        dot.className = 'burst-dot';
        dot.style.left = `${startX}px`;
        dot.style.top = `${startY}px`;
        dot.style.width = `${size}px`;
        dot.style.height = `${size}px`;
        dot.style.backgroundColor = color;
        dot.style.setProperty('--dx', `${dx}px`);
        dot.style.setProperty('--dy', `${dy}px`);
        dot.style.setProperty('--dur', `${dur}ms`);
        container.appendChild(dot);

        setTimeout(() => dot.remove(), dur + 50);
    }
}

// Track previous camera Y for detecting surface crossing
let previousCameraY = 1;
let audioIsUnderwater = false;

// Restore saved theme preference
function restoreThemePreference(): void {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'night') {
        setInitialDayNight(false);
        document.body.classList.add('night-mode');
    } else {
        // Default to day or saved 'day'
        setInitialDayNight(true);
        document.body.classList.add('day-mode');
    }
}

// Save theme preference
function saveThemePreference(isDay: boolean): void {
    localStorage.setItem(THEME_STORAGE_KEY, isDay ? 'day' : 'night');
}

export function Start(): void {
    // Restore theme before UI is created
    restoreThemePreference();
    
    // Create blur overlay (uses opacity transition which works on iOS)
    // This is more reliable than trying to transition filter on canvas
    const blurOverlay = document.createElement("div");
    blurOverlay.id = "blur-overlay";
    document.body.appendChild(blurOverlay);
    
    // Start overlay with circular headphone button
    const startOverlay = document.createElement("div");
    startOverlay.id = "start-overlay";
    
    const startButton = document.createElement("button");
    startButton.id = "start-button";
    startButton.disabled = true; // Disabled until loading complete
    startButton.innerHTML = `
        <div class="water-fill">
            <div class="wave-wrapper">
                <svg class="wave-svg" viewBox="0 0 800 20" preserveAspectRatio="none">
                    <path class="wave wave2" d="M0 8 Q 10 3, 20 8 T 40 8 T 60 8 T 80 8 T 100 8 T 120 8 T 140 8 T 160 8 T 180 8 T 200 8 T 220 8 T 240 8 T 260 8 T 280 8 T 300 8 T 320 8 T 340 8 T 360 8 T 380 8 T 400 8 T 420 8 T 440 8 T 460 8 T 480 8 T 500 8 T 520 8 T 540 8 T 560 8 T 580 8 T 600 8 T 620 8 T 640 8 T 660 8 T 680 8 T 700 8 T 720 8 T 740 8 T 760 8 T 780 8 T 800 8 V 20 H 0 Z"/>
                </svg>
            </div>
        </div>
        <span class="loading-percent">0</span>
        <svg class="headphone-icon icon-normal" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>
        </svg>
        <svg class="headphone-icon icon-pixel" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 4H5v2H3v14h7v-8H5V6h14v6h-5v8h7V6h-2V4zm-3 10h3v4h-3v-4zm-8 0v4H5v-4h3z"/>
        </svg>
    `;
    
    // Track animated progress (for smooth animation even on fast loads)
    let displayedProgress = 0;
    let targetProgress = 0;
    let loadingComplete = false;
    const minAnimationDuration = 6000; // Minimum 6 seconds to see the animation
    const startTime = performance.now();
    
    const percentText = startButton.querySelector('.loading-percent') as HTMLElement;
    const waterFill = startButton.querySelector('.water-fill') as HTMLElement;

    const BLUR_MAX = 50; // Starting blur in px

    let rAFStopped = false;

    // Animation loop for smooth progress
    function animateProgress() {
        const elapsed = performance.now() - startTime;
        const timeProgress = Math.min(elapsed / minAnimationDuration, 1);
        
        // Use the slower of time-based or actual loading progress
        // This ensures animation takes at least minAnimationDuration
        const effectiveTarget = Math.min(targetProgress, timeProgress + (targetProgress * 0.3));
        
        if (displayedProgress < effectiveTarget) {
            // Smooth increment
            const diff = effectiveTarget - displayedProgress;
            const increment = Math.max(0.005, diff * 0.08);
            displayedProgress = Math.min(displayedProgress + increment, effectiveTarget);
        }
        
        const percent = Math.floor(displayedProgress * 100);
        percentText.textContent = String(percent);
        // Fill to 105% so waves go past the top and aren't visible
        waterFill.style.setProperty('--fill-level', `${displayedProgress * 105}%`);

        // Blur overlay fades with progress
        const blurPx = BLUR_MAX * (1 - displayedProgress);
        blurOverlay.style.backdropFilter = `blur(${blurPx}px)`;
        blurOverlay.style.setProperty('-webkit-backdrop-filter', `blur(${blurPx}px)`);
        
        // Check if we've reached 100% and both conditions are met
        if (displayedProgress >= 0.99 && targetProgress >= 1 && !loadingComplete) {
            displayedProgress = 1;
            percentText.textContent = '100';
            waterFill.style.setProperty('--fill-level', '105%');
            loadingComplete = true;
            rAFStopped = true; // stop the rAF loop — CSS handles the wave from here
            // Celebrate: bounce + particle burst (simultaneously)
            startButton.style.opacity = '1';
            startButton.style.transform = 'scale(1)';
            startButton.classList.add('celebrate-bounce');
            spawnParticles(startButton, startOverlay);
            // Transition to headphone icon after bounce peaks
            setTimeout(() => {
                startButton.classList.add('loaded');
                startButton.disabled = false;
                // Freeze animation state BEFORE removing celebrate-bounce so the
                // base bouncy-pop-in animation doesn't replay (inline style wins
                // over a normal CSS rule; celebrate-bounce's !important still wins
                // while the class is present).
                startButton.style.animation = 'none';
                startButton.classList.remove('celebrate-bounce');
            }, 600);
        }
        
        // Always keep the loop alive — wave must scroll even when progress is stalled
        if (!rAFStopped) {
            requestAnimationFrame(animateProgress);
        }
    }
    
    // Start animation loop
    requestAnimationFrame(animateProgress);
    
    // Track loading progress
    setLoadingCallback((progress: number) => {
        setIntroProgress(progress);
        targetProgress = progress;
    });
    startButton.onclick = function() {
        // Start audio (must happen synchronously in click handler for iOS)
        startAudio();

        // Reveal the ocean (hidden during loading to avoid visible edge at intro camera height)
        showOcean();
        beginCloudDescent();

        // Enable scrolling / trigger cinematic camera descent
        // (scene already rendering from frame 1 — camera descends from sky intro position)
        enableScroll();
        
        // Mark as started
        document.body.classList.add('started');
        
        // Bounce out animation for the button
        // Clear the frozen animation state so bounce-out can take over.
        startButton.style.removeProperty('animation');
        startButton.classList.add('bounce-out');
        
        // Fade out blur overlay — start immediately so the reveal
        // unfolds across the full 2s ease-in-out transition rather than
        // popping in after the button animation finishes.
        blurOverlay.classList.add('fade-out');
        
        // Hide the start button overlay after bounce-out
        setTimeout(() => {
            startOverlay.classList.add('hidden');
        }, 600);
        
        // Defer UI sounds preload to not compete with critical audio
        setTimeout(() => {
            preloadUISounds();
        }, 1000);
        
        // Trigger bouncy pop-in for header elements with stagger
        setTimeout(() => {
            document.body.classList.add('header-visible');
            
            // Start typewriter effect for name after header pops in
            setTimeout(() => {
                typewriterEffect();
            }, 400);
        }, 300);
        
        // Dive button will appear after scrolling down, not during intro
        // setTimeout(() => {
        //     document.body.classList.add('dive-visible');
        // }, 600);
        
        // Enable radio interaction after a short delay
        setTimeout(() => {
            document.body.classList.add('music-visible');
        }, 800);
        
        // Remove overlays from DOM after animation completes.
        setTimeout(() => {
            startOverlay.remove();
            blurOverlay.classList.add('hidden');
            rAFStopped = true;
        }, 2500);
    };
    
    startOverlay.appendChild(startButton);
    document.body.appendChild(startOverlay);
    
    // Header container (hidden initially)
    const header = document.createElement("header");
    header.className = "site-header";
    webglContainer.appendChild(header);

    // Name display on top left (text hidden initially for typewriter effect)
    const nameDisplay = document.createElement("div");
    nameDisplay.className = "name-display";
    nameDisplay.innerHTML = `
        <img class="name-logo" src="/favicon.svg" alt="logo" width="40" height="40" />
        <span class="name-text"></span>
    `;
    header.appendChild(nameDisplay);

    // Header right controls container
    const headerControls = document.createElement("div");
    headerControls.className = "header-controls";

    // Theme toggle (sun/moon)
    const themeToggle = document.createElement("label");
    themeToggle.className = "theme-toggle";
    themeToggle.title = t('tooltip.toggleTheme');
    themeToggle.setAttribute('data-i18n-title', 'tooltip.toggleTheme');
    themeToggle.innerHTML = `
        <input type="checkbox" />
        <span class="theme-toggle-sr">Toggle theme</span>
        <svg
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            width="1em"
            height="1em"
            fill="currentColor"
            class="theme-toggle__classic icon-normal"
            viewBox="0 0 24 24"
        >
            <clipPath id="theme-toggle__classic__cutout">
                <path d="M0 0h25a1 1 0 0 0 10 10v14H0Z" />
            </clipPath>
            <g clip-path="url(#theme-toggle__classic__cutout)" stroke="currentColor" stroke-linecap="round">
                <circle cx="12" cy="12" r="5" />
                <g stroke-width="2">
                    <path d="M12 1.4v2.4" />
                    <path d="M12 20.2v2.4" />
                    <path d="M1.4 12h2.4" />
                    <path d="M20.2 12h2.4" />
                    <path d="M3.7 3.7l2.5 2.5" />
                    <path d="M17.8 17.8l2.5 2.5" />
                    <path d="M17.8 6.2l2.5-2.5" />
                    <path d="M3.7 20.3l2.5-2.5" />
                </g>
            </g>
        </svg>
        <svg class="icon-pixel pixel-sun" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="1em" height="1em" viewBox="0 0 400 400" fill="currentColor">
            <rect x="186.7" y="0" width="26.7" height="53.3"/>
            <rect x="53.3" y="53.3" width="26.7" height="26.7"/>
            <rect x="320" y="53.3" width="26.7" height="26.7"/>
            <rect x="80" y="80" width="26.7" height="26.7"/>
            <rect x="160" y="80" width="80" height="26.7"/>
            <rect x="293.3" y="80" width="26.7" height="26.7"/>
            <rect x="133.3" y="106.7" width="133.4" height="26.7"/>
            <rect x="106.7" y="133.3" width="186.6" height="26.7"/>
            <rect x="80" y="160" width="240" height="80"/>
            <rect x="0" y="186.7" width="53.3" height="26.7"/>
            <rect x="346.7" y="186.7" width="53.3" height="26.7"/>
            <rect x="106.7" y="240" width="186.6" height="26.7"/>
            <rect x="133.3" y="266.7" width="133.4" height="26.7"/>
            <rect x="80" y="293.3" width="26.7" height="26.7"/>
            <rect x="160" y="293.3" width="80" height="26.7"/>
            <rect x="293.3" y="293.3" width="26.7" height="26.7"/>
            <rect x="53.3" y="320" width="26.7" height="26.7"/>
            <rect x="320" y="320" width="26.7" height="26.7"/>
            <rect x="186.7" y="346.7" width="26.7" height="53.3"/>
        </svg>
        <svg class="icon-pixel pixel-moon" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="1em" height="1em" viewBox="0 0 400 400" fill="currentColor">
            <rect x="133.3" y="0" width="80" height="26.7"/>
            <rect x="80" y="26.7" width="106.7" height="26.7"/>
            <rect x="53.3" y="53.3" width="106.7" height="26.7"/>
            <rect x="26.7" y="80" width="106.6" height="53.3"/>
            <rect x="0" y="133.3" width="133.3" height="80"/>
            <rect x="373.3" y="186.7" width="26.7" height="26.7"/>
            <rect x="0" y="213.3" width="160" height="26.7"/>
            <rect x="346.7" y="213.3" width="53.3" height="26.7"/>
            <rect x="0" y="240" width="186.7" height="26.7"/>
            <rect x="320" y="240" width="80" height="26.7"/>
            <rect x="26.7" y="266.7" width="186.6" height="26.7"/>
            <rect x="293.3" y="266.7" width="80" height="26.7"/>
            <rect x="26.7" y="293.3" width="346.6" height="26.7"/>
            <rect x="53.3" y="320" width="293.4" height="26.7"/>
            <rect x="80" y="346.7" width="240" height="26.7"/>
            <rect x="133.3" y="373.3" width="133.4" height="26.7"/>
        </svg>
    `;
    headerControls.appendChild(themeToggle);
    
    // Get the checkbox input and sync with day/night
    const themeInput = themeToggle.querySelector('input') as HTMLInputElement;
    // Set initial state (unchecked = day/sun, checked = night/moon)
    themeInput.checked = !isDayTime();
    
    themeInput.addEventListener('change', function() {
        // Play appropriate sound before toggling
        if (isDayTime()) {
            playUISwitchDay();  // Going to night
        } else {
            playUISwitchNight();    // Going to day
        }
        toggleDayNight();
        saveThemePreference(isDayTime());
    });
    
    // Settings menu (right of theme toggle)
    const settingsContainer = document.createElement("div");
    settingsContainer.className = "settings-container";
    
    const settingsButton = document.createElement("button");
    settingsButton.className = "settings-button";
    settingsButton.title = t('tooltip.settings');
    settingsButton.setAttribute('data-i18n-title', 'tooltip.settings');
    settingsButton.innerHTML = `
        <svg class="icon-normal" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <circle cx="12" cy="12" r="4"/>
        </svg>
        <svg class="icon-pixel" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="m21,10v-1h-1v-2h1v-2h-1v-1h-1v-1h-2v1h-2v-1h-1V1h-4v2h-1v1h-2v-1h-2v1h-1v1h-1v2h1v2h-1v1H1v4h2v1h1v2h-1v2h1v1h1v1h2v-1h2v1h1v2h4v-2h1v-1h2v1h2v-1h1v-1h1v-2h-1v-2h1v-1h2v-4h-2Zm0,3h-1v1h-1v1h-1v2h1v2h-2v-1h-2v1h-1v1h-1v1h-2v-1h-1v-1h-1v-1h-2v1h-2v-2h1v-2h-1v-1h-1v-1h-1v-2h1v-1h1v-1h1v-2h-1v-2h2v1h2v-1h1v-1h1v-1h2v1h1v1h1v1h2v-1h2v2h-1v2h1v1h1v1h1v2Z"/>
            <path d="m16,10v-1h-1v-1h-1v-1h-4v1h-1v1h-1v1h-1v4h1v1h1v1h1v1h4v-1h1v-1h1v-1h1v-4h-1Zm-1,4h-1v1h-4v-1h-1v-4h1v-1h4v1h1v4Z"/>
        </svg>
    `;
    settingsContainer.appendChild(settingsButton);
    
    const settingsPanel = document.createElement("div");
    settingsPanel.className = "settings-panel";
    
    // SVG icon templates (normal + pixel art variants)
    const volumeOnSvg = `<svg class="icon-on icon-normal" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg><svg class="icon-on icon-pixel" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11 2h2v20h-2v-2H9v-2h2V6H9V4h2V2zM7 8V6h2v2H7zm0 8H3V8h4v2H5v4h2v2zm0 0v2h2v-2H7zm10-6h-2v4h2v-4zm2-2h2v8h-2V8zm0 8v2h-4v-2h4zm0-10v2h-4V6h4z"/></svg>`;
    const volumeOffSvg = `<svg class="icon-off icon-normal" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg><svg class="icon-off icon-pixel" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2h-2v2H9v2H7v2H3v8h4v2h2v2h2v2h2V2zM9 18v-2H7v-2H5v-4h2V8h2V6h2v12H9zm10-6.777h-2v-2h-2v2h2v2h-2v2h2v-2h2v2h2v-2h-2v-2zm0 0h2v-2h-2v2z"/></svg>`;
    const toggleOnSvg = `<svg class="icon-on icon-normal" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><svg class="icon-on icon-pixel" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18 6h2v2h-2V6zm-2 4V8h2v2h-2zm-2 2v-2h2v2h-2zm-2 2h2v-2h-2v2zm-2 2h2v-2h-2v2zm-2 0v2h2v-2H8zm-2-2h2v2H6v-2zm0 0H4v-2h2v2z"/></svg>`;
    const toggleOffSvg = `<svg class="icon-off icon-normal" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg><svg class="icon-off icon-pixel" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 5h2v2H5V5zm4 4H7V7h2v2zm2 2H9V9h2v2zm2 0h-2v2H9v2H7v2H5v2h2v-2h2v-2h2v-2h2v2h2v2h2v2h2v-2h-2v-2h-2v-2h-2v-2zm2-2v2h-2V9h2zm2-2v2h-2V7h2zm0 0V5h2v2h-2z"/></svg>`;
    const tabArrowSvg = `<svg class="tab-arrow icon-normal" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg><svg class="tab-arrow icon-pixel" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 8H5v2h2v2h2v2h2v2h2v-2h2v-2h2v-2h2V8h-2v2h-2v2h-2v2h-2v-2H9v-2H7V8z"/></svg>`;
    
    // Current settings for initial UI state
    const curPixel = pixelSizeValue;

    // ── Graphics settings ──────────────────────────────────────────────────────────
    function loadQ(key: string, def: string): string { return localStorage.getItem('portfolio-q-' + key) ?? def; }
    function saveQ(key: string, val: string): void  { localStorage.setItem('portfolio-q-' + key, val); }

    const _isMobileQ = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
    const curGfx = {
        quality:    loadQ('quality',    _isMobileQ ? 'low' : 'medium'),
    };

    function applyQualityPreset(preset: string): void {
        switch (preset) {
            case 'low':
                setDPR(1);
                setShadowsEnabled(false);
                setShadowResolution(256);
                break;
            case 'medium':
                setDPR(isMobile ? 1.5 : 2);
                setShadowsEnabled(true);
                setShadowResolution(isMobile ? 512 : 1024);
                break;
            case 'high':
                setDPR(2);
                setShadowsEnabled(true);
                setShadowResolution(2048);
                break;
        }
    }
    applyQualityPreset(curGfx.quality);

    const currentLanguage = localStorage.getItem('portfolio-language') || 'en-us';
    const natureVol = Math.round(getNatureVolume() * 100);
    const musicVol = Math.round(getMusicVolume() * 100);
    const interfaceVol = Math.round(getInterfaceVolume() * 100);
    const characterVol = Math.round(getCharacterVolume() * 100);
    
    // Restore tab states from localStorage
    const savedTabStates = localStorage.getItem('portfolio-settings-tabs');
    const tabStates = savedTabStates ? JSON.parse(savedTabStates) : { audio: false, graphics: false, misc: false, language: false };
    
    settingsPanel.innerHTML = `
        <div class="settings-tab${tabStates.audio ? ' open' : ''}" data-tab="audio">
            <button class="settings-tab-header">
                <span data-i18n="tab.audio">${t('tab.audio')}</span>
                ${tabArrowSvg}
            </button>
            <div class="settings-tab-content">
                <div class="settings-row">
                    <span class="settings-label" data-i18n="settings.nature">${t('settings.nature')}</span>
                    <input type="range" class="volume-slider nature-volume" min="0" max="100" value="${natureVol}">
                    <button class="settings-toggle nature-toggle" data-active="true">${volumeOnSvg}${volumeOffSvg}</button>
                </div>
                <div class="settings-row">
                    <span class="settings-label" data-i18n="settings.music">${t('settings.music')}</span>
                    <input type="range" class="volume-slider music-volume" min="0" max="100" value="${musicVol}">
                    <button class="settings-toggle music-toggle" data-active="true">${volumeOnSvg}${volumeOffSvg}</button>
                </div>
                <div class="settings-row">
                    <span class="settings-label" data-i18n="settings.interface">${t('settings.interface')}</span>
                    <input type="range" class="volume-slider interface-volume" min="0" max="100" value="${interfaceVol}">
                    <button class="settings-toggle interface-toggle" data-active="true">${volumeOnSvg}${volumeOffSvg}</button>
                </div>
                <div class="settings-row">
                    <span class="settings-label" data-i18n="settings.character">${t('settings.character')}</span>
                    <input type="range" class="volume-slider character-volume" min="0" max="100" value="${characterVol}">
                    <button class="settings-toggle character-toggle" data-active="true">${volumeOnSvg}${volumeOffSvg}</button>
                </div>
            </div>
        </div>
        <div class="settings-tab${tabStates.graphics ? ' open' : ''}" data-tab="graphics">
            <button class="settings-tab-header">
                <span data-i18n="tab.graphics">${t('tab.graphics')}</span>
                ${tabArrowSvg}
            </button>
            <div class="settings-tab-content">
                <div class="settings-row" style="padding-bottom:2px">
                    <span class="settings-label" data-i18n="settings.quality">${t('settings.quality')}</span>
                </div>
                <div class="settings-row" style="padding-top:2px">
                    <div class="settings-mode-switch quality-switch">
                        <button class="mode-option${curGfx.quality === 'low' ? ' active' : ''}" data-value="low" data-i18n="settings.low">${t('settings.low')}</button>
                        <button class="mode-option${curGfx.quality === 'medium' ? ' active' : ''}" data-value="medium" data-i18n="settings.medium">${t('settings.medium')}</button>
                        <button class="mode-option${curGfx.quality === 'high' ? ' active' : ''}" data-value="high" data-i18n="settings.high">${t('settings.high')}</button>
                    </div>
                </div>

            </div>
        </div>
        <div class="settings-tab${tabStates.misc ? ' open' : ''}" data-tab="misc">
            <button class="settings-tab-header">
                <span data-i18n="tab.misc">${t('tab.misc')}</span>
                ${tabArrowSvg}
            </button>
            <div class="settings-tab-content">
                <div class="settings-row" style="padding-bottom:2px">
                    <span class="settings-label" data-i18n="settings.pixelation">${t('settings.pixelation')}</span>
                </div>
                <div class="settings-row" style="padding-top:2px">
                    <div class="settings-mode-switch pixelation-switch">
                        <button class="mode-option${curPixel === 0 ? ' active' : ''}" data-value="0" data-i18n="settings.none">${t('settings.none')}</button>
                        <button class="mode-option${curPixel === 5 ? ' active' : ''}" data-value="5" data-i18n="settings.medium">${t('settings.medium')}</button>
                        <button class="mode-option${curPixel === 10 ? ' active' : ''}" data-value="10" data-i18n="settings.high">${t('settings.high')}</button>
                    </div>
                </div>
                <div class="settings-row" style="padding-bottom:2px">
                    <span class="settings-label" data-i18n="settings.colorFilter">${t('settings.colorFilter')}</span>
                </div>
                <div class="settings-row" style="padding-top:2px">
                    <div class="settings-mode-switch color-filter-switch">
                        <button class="mode-option${colorFilterValue === 'none' ? ' active' : ''}" data-value="none" data-i18n="settings.none">${t('settings.none')}</button>
                        <button class="mode-option${colorFilterValue === 'bw' ? ' active' : ''}" data-value="bw" data-i18n="settings.bw">${t('settings.bw')}</button>
                        <button class="mode-option${colorFilterValue === 'sepia' ? ' active' : ''}" data-value="sepia" data-i18n="settings.sepia">${t('settings.sepia')}</button>
                    </div>
                </div>
            </div>
        </div>
        <div class="settings-tab${tabStates.language ? ' open' : ''}" data-tab="language">
            <button class="settings-tab-header">
                <span data-i18n="tab.language">${t('tab.language')}</span>
                ${tabArrowSvg}
            </button>
            <div class="settings-tab-content">
                <div class="language-options">
                    <button class="language-option${currentLanguage === 'pt-br' ? ' active' : ''}" data-value="pt-br">
                        <div class="flag-wrapper">
                            <div class="flag-column" style="--delay: 0ms; background: #009b3a"></div>
                            <div class="flag-column" style="--delay: 60ms; background: linear-gradient(#009b3a 0%, #009b3a 40%, #fedd00 40%, #fedd00 60%, #009b3a 60%, #009b3a 100%)"></div>
                            <div class="flag-column" style="--delay: 120ms; background: linear-gradient(#009b3a 0%, #009b3a 28%, #fedd00 28%, #fedd00 72%, #009b3a 72%, #009b3a 100%)"></div>
                            <div class="flag-column" style="--delay: 180ms; background: linear-gradient(#009b3a 0%, #009b3a 18%, #fedd00 18%, #fedd00 36%, #002776 36%, #002776 64%, #fedd00 64%, #fedd00 82%, #009b3a 82%, #009b3a 100%)"></div>
                            <div class="flag-column" style="--delay: 240ms; background: linear-gradient(#009b3a 0%, #009b3a 10%, #fedd00 10%, #fedd00 35%, #002776 35%, #002776 65%, #fedd00 65%, #fedd00 90%, #009b3a 90%, #009b3a 100%)"></div>
                            <div class="flag-column" style="--delay: 300ms; background: linear-gradient(#009b3a 0%, #009b3a 18%, #fedd00 18%, #fedd00 36%, #002776 36%, #002776 64%, #fedd00 64%, #fedd00 82%, #009b3a 82%, #009b3a 100%)"></div>
                            <div class="flag-column" style="--delay: 360ms; background: linear-gradient(#009b3a 0%, #009b3a 28%, #fedd00 28%, #fedd00 72%, #009b3a 72%, #009b3a 100%)"></div>
                            <div class="flag-column" style="--delay: 420ms; background: linear-gradient(#009b3a 0%, #009b3a 40%, #fedd00 40%, #fedd00 60%, #009b3a 60%, #009b3a 100%)"></div>
                            <div class="flag-column" style="--delay: 480ms; background: #009b3a"></div>
                        </div>
                        <span>PT-BR</span>
                    </button>
                    <button class="language-option${currentLanguage === 'en-us' ? ' active' : ''}" data-value="en-us">
                        <div class="flag-wrapper">
                            <div class="flag-column" style="--delay: 0ms; background: linear-gradient(#3c3b6e 0%, #3c3b6e 54%, #fff 54%, #fff 62%, #b22234 62%, #b22234 69%, #fff 69%, #fff 77%, #b22234 77%, #b22234 85%, #fff 85%, #fff 92%, #b22234 92%, #b22234 100%)"></div>
                            <div class="flag-column" style="--delay: 60ms; background: linear-gradient(#3c3b6e 0%, #3c3b6e 54%, #fff 54%, #fff 62%, #b22234 62%, #b22234 69%, #fff 69%, #fff 77%, #b22234 77%, #b22234 85%, #fff 85%, #fff 92%, #b22234 92%, #b22234 100%)"></div>
                            <div class="flag-column" style="--delay: 120ms; background: linear-gradient(#3c3b6e 0%, #3c3b6e 54%, #fff 54%, #fff 62%, #b22234 62%, #b22234 69%, #fff 69%, #fff 77%, #b22234 77%, #b22234 85%, #fff 85%, #fff 92%, #b22234 92%, #b22234 100%)"></div>
                            <div class="flag-column" style="--delay: 180ms; background: linear-gradient(#3c3b6e 0%, #3c3b6e 54%, #fff 54%, #fff 62%, #b22234 62%, #b22234 69%, #fff 69%, #fff 77%, #b22234 77%, #b22234 85%, #fff 85%, #fff 92%, #b22234 92%, #b22234 100%)"></div>
                            <div class="flag-column" style="--delay: 240ms; background: linear-gradient(#b22234 0%, #b22234 8%, #fff 8%, #fff 15%, #b22234 15%, #b22234 23%, #fff 23%, #fff 31%, #b22234 31%, #b22234 38%, #fff 38%, #fff 46%, #b22234 46%, #b22234 54%, #fff 54%, #fff 62%, #b22234 62%, #b22234 69%, #fff 69%, #fff 77%, #b22234 77%, #b22234 85%, #fff 85%, #fff 92%, #b22234 92%, #b22234 100%)"></div>
                            <div class="flag-column" style="--delay: 300ms; background: linear-gradient(#b22234 0%, #b22234 8%, #fff 8%, #fff 15%, #b22234 15%, #b22234 23%, #fff 23%, #fff 31%, #b22234 31%, #b22234 38%, #fff 38%, #fff 46%, #b22234 46%, #b22234 54%, #fff 54%, #fff 62%, #b22234 62%, #b22234 69%, #fff 69%, #fff 77%, #b22234 77%, #b22234 85%, #fff 85%, #fff 92%, #b22234 92%, #b22234 100%)"></div>
                            <div class="flag-column" style="--delay: 360ms; background: linear-gradient(#b22234 0%, #b22234 8%, #fff 8%, #fff 15%, #b22234 15%, #b22234 23%, #fff 23%, #fff 31%, #b22234 31%, #b22234 38%, #fff 38%, #fff 46%, #b22234 46%, #b22234 54%, #fff 54%, #fff 62%, #b22234 62%, #b22234 69%, #fff 69%, #fff 77%, #b22234 77%, #b22234 85%, #fff 85%, #fff 92%, #b22234 92%, #b22234 100%)"></div>
                            <div class="flag-column" style="--delay: 420ms; background: linear-gradient(#b22234 0%, #b22234 8%, #fff 8%, #fff 15%, #b22234 15%, #b22234 23%, #fff 23%, #fff 31%, #b22234 31%, #b22234 38%, #fff 38%, #fff 46%, #b22234 46%, #b22234 54%, #fff 54%, #fff 62%, #b22234 62%, #b22234 69%, #fff 69%, #fff 77%, #b22234 77%, #b22234 85%, #fff 85%, #fff 92%, #b22234 92%, #b22234 100%)"></div>
                            <div class="flag-column" style="--delay: 480ms; background: linear-gradient(#b22234 0%, #b22234 8%, #fff 8%, #fff 15%, #b22234 15%, #b22234 23%, #fff 23%, #fff 31%, #b22234 31%, #b22234 38%, #fff 38%, #fff 46%, #b22234 46%, #b22234 54%, #fff 54%, #fff 62%, #b22234 62%, #b22234 69%, #fff 69%, #fff 77%, #b22234 77%, #b22234 85%, #fff 85%, #fff 92%, #b22234 92%, #b22234 100%)"></div>
                        </div>
                        <span>EN-US</span>
                    </button>
                </div>
            </div>
        </div>
    `;
    settingsContainer.appendChild(settingsPanel);
    headerControls.appendChild(settingsContainer);
    header.appendChild(headerControls);

    // Prevent wheel/touch scroll inside settings panel from scrolling the 3D scene
    settingsPanel.addEventListener('wheel', (e) => {
        e.stopPropagation();
    }, { passive: false });
    settingsPanel.addEventListener('touchmove', (e) => {
        e.stopPropagation();
    }, { passive: false });
    
    // Collapsible tab headers with state persistence
    settingsPanel.querySelectorAll('.settings-tab-header').forEach(tabHeader => {
        tabHeader.addEventListener('click', (e) => {
            e.stopPropagation();
            const tab = (tabHeader as HTMLElement).parentElement!;
            tab.classList.toggle('open');
            
            // Save tab states to localStorage
            const tabName = tab.getAttribute('data-tab');
            if (tabName) {
                const states = JSON.parse(localStorage.getItem('portfolio-settings-tabs') || '{}');
                states[tabName] = tab.classList.contains('open');
                localStorage.setItem('portfolio-settings-tabs', JSON.stringify(states));
            }
        });
    });
    
    // Settings button click - toggle panel
    let settingsOpen = false;
    settingsButton.addEventListener('click', () => {
        settingsOpen = !settingsOpen;
        settingsPanel.classList.toggle('open', settingsOpen);
        settingsButton.classList.toggle('active', settingsOpen);
        // Cog rotation animation + spin sound
        if (settingsOpen) {
            settingsButton.classList.remove('cog-close');
            settingsButton.classList.add('cog-open');
            playUISpinOpen();
            document.dispatchEvent(new CustomEvent('settings-opened'));
        } else {
            settingsButton.classList.remove('cog-open');
            settingsButton.classList.add('cog-close');
            playUISpinClose();
        }
    });
    
    // Close settings when media player opens
    document.addEventListener('player-opened', () => {
        if (settingsOpen) {
            settingsOpen = false;
            settingsPanel.classList.remove('open');
            settingsButton.classList.remove('active');
            settingsButton.classList.remove('cog-open');
            settingsButton.classList.add('cog-close');
            playUISpinClose();
        }
    });
    
    // Close settings when clicking outside
    document.addEventListener('click', (e) => {
        if (settingsOpen && !settingsContainer.contains(e.target as Node)) {
            settingsOpen = false;
            settingsPanel.classList.remove('open');
            settingsButton.classList.remove('active');
            settingsButton.classList.remove('cog-open');
            settingsButton.classList.add('cog-close');
            playUISpinClose();
        }
    });
    
    // ---- Confirmation Modal ----
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'confirm-modal-overlay';
    modalOverlay.innerHTML = `
        <div class="confirm-modal">
            <div class="confirm-modal-title"></div>
            <div class="confirm-modal-text"></div>
            <div class="confirm-modal-buttons">
                <button class="confirm-modal-btn cancel" data-i18n="modal.cancel">${t('modal.cancel')}</button>
                <button class="confirm-modal-btn confirm" data-i18n="modal.confirm">${t('modal.confirm')}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modalOverlay);
    
    const modalTitle = modalOverlay.querySelector('.confirm-modal-title') as HTMLElement;
    const modalText = modalOverlay.querySelector('.confirm-modal-text') as HTMLElement;
    const modalCancel = modalOverlay.querySelector('.confirm-modal-btn.cancel') as HTMLButtonElement;
    const modalConfirm = modalOverlay.querySelector('.confirm-modal-btn.confirm') as HTMLButtonElement;
    
    let modalResolve: ((confirmed: boolean) => void) | null = null;
    
    // @ts-ignore: Kept for future use (preset confirmations, etc.)
    function showConfirmModal(title: string, text: string): Promise<boolean> {
        modalTitle.textContent = title;
        modalText.textContent = text;
        modalOverlay.classList.add('open');
        return new Promise((resolve) => {
            modalResolve = resolve;
        });
    }
    
    function closeModal(confirmed: boolean) {
        modalOverlay.classList.remove('open');
        if (modalResolve) {
            modalResolve(confirmed);
            modalResolve = null;
        }
    }
    
    modalCancel.addEventListener('click', () => closeModal(false));
    modalConfirm.addEventListener('click', () => closeModal(true));
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal(false);
    });
    
    // ---- Helper: sync slider fill to value via CSS custom property ----
    function updateSliderFill(slider: HTMLInputElement): void {
        const pct = ((parseInt(slider.value) - parseInt(slider.min)) / (parseInt(slider.max) - parseInt(slider.min))) * 100;
        slider.style.setProperty('--progress', `${pct}%`);
    }

    // ---- Audio Toggles ----
    const natureToggle = settingsPanel.querySelector('.nature-toggle') as HTMLButtonElement;
    const natureSlider = settingsPanel.querySelector('.nature-volume') as HTMLInputElement;
    updateSliderFill(natureSlider);
    natureToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = natureToggle.dataset.active === 'true';
        natureToggle.dataset.active = (!isActive).toString();
        setNatureMuted(isActive);
    });
    natureSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        updateSliderFill(natureSlider);
        const value = parseInt(natureSlider.value) / 100;
        setNatureVolume(value);
        if (value > 0 && natureToggle.dataset.active === 'false') {
            natureToggle.dataset.active = 'true';
            setNatureMuted(false);
        }
    });
    
    const musicToggle = settingsPanel.querySelector('.music-toggle') as HTMLButtonElement;
    const musicSlider = settingsPanel.querySelector('.music-volume') as HTMLInputElement;
    updateSliderFill(musicSlider);
    musicToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = musicToggle.dataset.active === 'true';
        musicToggle.dataset.active = (!isActive).toString();
        setMusicMuted(isActive);
    });
    musicSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        updateSliderFill(musicSlider);
        const value = parseInt(musicSlider.value) / 100;
        setMusicVolume(value);
        if (value > 0 && musicToggle.dataset.active === 'false') {
            musicToggle.dataset.active = 'true';
            setMusicMuted(false);
        }
    });
    
    const interfaceToggle = settingsPanel.querySelector('.interface-toggle') as HTMLButtonElement;
    const interfaceSlider = settingsPanel.querySelector('.interface-volume') as HTMLInputElement;
    updateSliderFill(interfaceSlider);
    interfaceToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = interfaceToggle.dataset.active === 'true';
        interfaceToggle.dataset.active = (!isActive).toString();
        setInterfaceMuted(isActive);
    });
    interfaceSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        updateSliderFill(interfaceSlider);
        const value = parseInt(interfaceSlider.value) / 100;
        setInterfaceVolume(value);
        if (value > 0 && interfaceToggle.dataset.active === 'false') {
            interfaceToggle.dataset.active = 'true';
            setInterfaceMuted(false);
        }
    });

    const characterToggle = settingsPanel.querySelector('.character-toggle') as HTMLButtonElement;
    const characterSlider = settingsPanel.querySelector('.character-volume') as HTMLInputElement;
    updateSliderFill(characterSlider);
    characterToggle.dataset.active = (!isCharacterMuted()).toString();
    characterToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = characterToggle.dataset.active === 'true';
        characterToggle.dataset.active = (!isActive).toString();
        setCharacterMuted(isActive);
    });
    characterSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        updateSliderFill(characterSlider);
        const value = parseInt(characterSlider.value) / 100;
        setCharacterVolume(value);
        if (value > 0 && characterToggle.dataset.active === 'false') {
            characterToggle.dataset.active = 'true';
            setCharacterMuted(false);
        }
    });
    
    // ---- Graphics Controls ----
    const qualitySwitch = settingsPanel.querySelector('.quality-switch') as HTMLElement;
    qualitySwitch.querySelectorAll('.mode-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = (btn as HTMLElement).dataset.value || 'medium';
            qualitySwitch.querySelectorAll('.mode-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            curGfx.quality = value;
            saveQ('quality', value);
            applyQualityPreset(value);
        });
    });

    // ---- Misc Controls: Pixelation Mode Switch ----
    const pixelationSwitch = settingsPanel.querySelector('.pixelation-switch') as HTMLElement;
    pixelationSwitch.querySelectorAll('.mode-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = parseInt((btn as HTMLElement).dataset.value || '0');
            pixelationSwitch.querySelectorAll('.mode-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            SetPixelSize(value);
        });
    });
    
    // ---- Misc Controls: Color Filter Switch ----
    const colorFilterSwitch = settingsPanel.querySelector('.color-filter-switch') as HTMLElement;
    colorFilterSwitch.querySelectorAll('.mode-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = (btn as HTMLElement).dataset.value as ColorFilter;
            colorFilterSwitch.querySelectorAll('.mode-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            SetColorFilter(value || 'none');
        });
    });


    // ---- Language Controls ----
    const languageOptions = settingsPanel.querySelectorAll('.language-option');
    languageOptions.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = (btn as HTMLElement).dataset.value as Language;
            languageOptions.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setLanguage(value || 'en-us');
        });
    });

}

// Track previous blend class to avoid redundant DOM mutations
let _lastBlendClass: 'day' | 'night' = 'day';
let _lastBlendValue = -1;

export function Update(): void {
    // Update CSS custom property for smooth day/night color transitions
    // Only update when value actually changed (avoid style recalc every frame)
    const blend = getDayNightBlend();
    const rounded = Math.round(blend * 1000) / 1000; // 3 decimal places
    if (rounded !== _lastBlendValue) {
        _lastBlendValue = rounded;
        document.documentElement.style.setProperty('--day-night-blend', rounded.toString());
    }
    
    // Update body class for CSS targeting â€” only swap once at threshold
    const newClass = blend < 0.5 ? 'day' : 'night';
    if (newClass !== _lastBlendClass) {
        _lastBlendClass = newClass;
        // Defer the class swap to avoid layout thrashing mid-render
        requestAnimationFrame(() => {
            if (newClass === 'day') {
                document.body.classList.remove('night-mode');
                document.body.classList.add('day-mode');
            } else {
                document.body.classList.remove('day-mode');
                document.body.classList.add('night-mode');
            }
        });
    }
    
    // Update underwater state and audio transitions
    const cameraY = getCameraY();
    
    // Detect when camera actually crosses the surface (Y = 0)
    // Play transition sounds when button clicked, but switch ambient audio when crossing Y=0
    const crossedToUnderwater = previousCameraY >= 0 && cameraY < 0;
    const crossedToSurface = previousCameraY < 0 && cameraY >= 0;
    
    if (crossedToUnderwater && !audioIsUnderwater) {
        audioIsUnderwater = true;
        // Defer CSS change to next frame to avoid layout thrashing
        requestAnimationFrame(() => {
            document.body.classList.add('underwater');
        });
        transitionToUnderwater();
    } else if (crossedToSurface && audioIsUnderwater) {
        audioIsUnderwater = false;
        // Defer CSS change to next frame to avoid layout thrashing
        requestAnimationFrame(() => {
            document.body.classList.remove('underwater');
        });
        transitionToAboveWater();
    }
    
    previousCameraY = cameraY;
}

// Typewriter effect for name (optimized for mobile)
function typewriterEffect(): void {
    const nameText = document.querySelector('.name-text') as HTMLElement;
    if (!nameText) return;
    
    const text = 'leosato.';
    let i = 0;
    const speed = 100;  // ms per character
    let lastTime = 0;
    
    function type(currentTime: number): void {
        if (i >= text.length) return;
        
        if (currentTime - lastTime >= speed) {
            nameText.textContent += text.charAt(i);
            i++;
            lastTime = currentTime;
        }
        
        if (i < text.length) {
            requestAnimationFrame(type);
        }
    }
    
    requestAnimationFrame(type);
}

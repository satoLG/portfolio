import { body, antialias, shadowsEnabled, pixelSizeValue, SetPixelSize, setShadowsEnabled } from "./Scene";
import { toggleDayNight, isDayTime, getDayNightBlend, setInitialDayNight } from "../scene/Skybox";
import { startAudio, transitionToUnderwater, transitionToAboveWater, setNatureMuted, setMusicMuted, setInterfaceMuted, preloadUISounds, playUISwitchDay, playUISwitchNight } from "./Audio";
import { getCameraY, setIntroProgress, enableScroll } from "./Control";
import { setLoadingCallback } from "../scene/Island";
import { t, setLanguage, type Language } from "./i18n";

const THEME_STORAGE_KEY = 'portfolio-theme-mode';

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
            <svg class="wave-svg" viewBox="0 0 800 20" preserveAspectRatio="none">
                <path class="wave wave2" d="M0 8 Q 10 3, 20 8 T 40 8 T 60 8 T 80 8 T 100 8 T 120 8 T 140 8 T 160 8 T 180 8 T 200 8 T 220 8 T 240 8 T 260 8 T 280 8 T 300 8 T 320 8 T 340 8 T 360 8 T 380 8 T 400 8 T 420 8 T 440 8 T 460 8 T 480 8 T 500 8 T 520 8 T 540 8 T 560 8 T 580 8 T 600 8 T 620 8 T 640 8 T 660 8 T 680 8 T 700 8 T 720 8 T 740 8 T 760 8 T 780 8 T 800 8 V 20 H 0 Z"/>
            </svg>
        </div>
        <span class="loading-percent">0</span>
        <svg class="headphone-icon" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>
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
        
        // Check if we've reached 100% and both conditions are met
        if (displayedProgress >= 0.99 && targetProgress >= 1 && !loadingComplete) {
            displayedProgress = 1;
            percentText.textContent = '100';
            waterFill.style.setProperty('--fill-level', '105%');
            loadingComplete = true;
            // Transition to headphone icon
            setTimeout(() => {
                startButton.classList.add('loaded');
                startButton.disabled = false;
            }, 400);
        }
        
        if (!loadingComplete) {
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
        
        // Enable scrolling
        enableScroll();
        
        // Mark as started
        document.body.classList.add('started');
        
        // Bounce out animation for the button
        startButton.classList.add('bounce-out');
        
        // Fade out blur overlay after button bounce-out animation
        setTimeout(() => {
            blurOverlay.classList.add('fade-out');
        }, 400);
        
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
        
        // Trigger bouncy pop-in for music bubble
        setTimeout(() => {
            document.body.classList.add('music-visible');
        }, 800);
        
        // Remove overlays from DOM after animation completes
        setTimeout(() => {
            startOverlay.remove();
            blurOverlay.classList.add('hidden');
        }, 2500);
    };
    
    startOverlay.appendChild(startButton);
    document.body.appendChild(startOverlay);
    
    // Header container (hidden initially)
    const header = document.createElement("header");
    header.className = "site-header";
    body.appendChild(header);

    // Name display on top left (text hidden initially for typewriter effect)
    const nameDisplay = document.createElement("div");
    nameDisplay.className = "name-display";
    nameDisplay.innerHTML = `
        <svg class="name-logo" viewBox="0 0 306.9224976339871 287.74164466181446" width="40" height="40">
            <g transform="translate(113.76741935958444 18.48087556932103) rotate(11.942992448689342 -20.2546601161624 33.09458545165097)" stroke="none"><path fill="#257433" d="M 22.44,5.92 Q 22.44,5.92 15.96,12.15 9.47,18.39 2.73,24.10 -4.01,29.81 -12.45,36.88 -20.89,43.94 -26.04,49.23 -31.19,54.53 -36.13,58.61 -41.08,62.69 -45.51,66.41 -49.95,70.12 -49.82,70.80 -49.68,71.48 -50.71,72.45 -51.74,73.43 -53.02,74.02 -54.31,74.62 -55.72,74.78 -57.13,74.93 -58.51,74.63 -59.89,74.32 -61.11,73.59 -62.32,72.87 -63.24,71.79 -64.16,70.71 -64.69,69.39 -65.21,68.08 -65.29,66.66 -65.37,65.25 -64.99,63.88 -64.61,62.51 -63.82,61.34 -63.03,60.17 -61.90,59.31 -60.77,58.45 -59.43,58.00 -58.09,57.54 -56.67,57.54 -55.25,57.54 -53.91,57.99 -52.57,58.44 -51.44,59.30 -50.31,60.16 -49.51,61.33 -48.72,62.50 -48.34,63.86 -47.96,65.23 -48.03,66.64 -48.11,68.06 -48.63,69.38 -49.15,70.69 -50.07,71.77 -50.99,72.85 -52.20,73.59 -53.41,74.32 -54.80,74.62 -56.18,74.93 -57.59,74.78 -59.00,74.62 -60.28,74.03 -61.57,73.44 -62.60,72.46 -63.63,71.49 -64.29,70.24 -64.96,68.99 -65.19,67.59 -65.42,66.19 -65.19,64.79 -64.96,63.39 -64.30,62.14 -63.64,60.89 -63.64,60.89 -63.64,60.89 -60.94,58.19 -58.25,55.49 -53.97,53.27 -49.68,51.05 -45.16,48.13 -40.64,45.21 -35.10,39.62 -29.56,34.04 -21.55,26.70 -13.54,19.35 -7.67,13.56 -1.79,7.77 4.03,0.92 9.86,-5.92 10.66,-6.59 11.46,-7.25 12.40,-7.71 13.33,-8.16 14.35,-8.38 15.37,-8.60 16.41,-8.57 17.45,-8.54 18.46,-8.26 19.46,-7.98 20.37,-7.47 21.27,-6.96 22.03,-6.24 22.79,-5.53 23.36,-4.65 23.92,-3.78 24.26,-2.79 24.60,-1.81 24.70,-0.77 24.79,0.26 24.63,1.29 24.48,2.32 24.08,3.28 23.68,4.24 23.06,5.08 22.44,5.92 22.44,5.92 L 22.44,5.92 Z"></path></g>
            <g transform="translate(226.72156988017605 14.903121304138836) rotate(71.86189085367849 -20.2546601161624 33.09458545165097)" stroke="none"><path fill="#257433" d="M 22.44,5.92 Q 22.44,5.92 15.96,12.15 9.47,18.39 2.73,24.10 -4.01,29.81 -12.45,36.88 -20.89,43.94 -26.04,49.23 -31.19,54.53 -36.13,58.61 -41.08,62.69 -45.51,66.41 -49.95,70.12 -49.82,70.80 -49.68,71.48 -50.71,72.45 -51.74,73.43 -53.02,74.02 -54.31,74.62 -55.72,74.78 -57.13,74.93 -58.51,74.63 -59.89,74.32 -61.11,73.59 -62.32,72.87 -63.24,71.79 -64.16,70.71 -64.69,69.39 -65.21,68.08 -65.29,66.66 -65.37,65.25 -64.99,63.88 -64.61,62.51 -63.82,61.34 -63.03,60.17 -61.90,59.31 -60.77,58.45 -59.43,58.00 -58.09,57.54 -56.67,57.54 -55.25,57.54 -53.91,57.99 -52.57,58.44 -51.44,59.30 -50.31,60.16 -49.51,61.33 -48.72,62.50 -48.34,63.86 -47.96,65.23 -48.03,66.64 -48.11,68.06 -48.63,69.38 -49.15,70.69 -50.07,71.77 -50.99,72.85 -52.20,73.59 -53.41,74.32 -54.80,74.62 -56.18,74.93 -57.59,74.78 -59.00,74.62 -60.28,74.03 -61.57,73.44 -62.60,72.46 -63.63,71.49 -64.29,70.24 -64.96,68.99 -65.19,67.59 -65.42,66.19 -65.19,64.79 -64.96,63.39 -64.30,62.14 -63.64,60.89 -63.64,60.89 -63.64,60.89 -60.94,58.19 -58.25,55.49 -53.97,53.27 -49.68,51.05 -45.16,48.13 -40.64,45.21 -35.10,39.62 -29.56,34.04 -21.55,26.70 -13.54,19.35 -7.67,13.56 -1.79,7.77 4.03,0.92 9.86,-5.92 10.66,-6.59 11.46,-7.25 12.40,-7.71 13.33,-8.16 14.35,-8.38 15.37,-8.60 16.41,-8.57 17.45,-8.54 18.46,-8.26 19.46,-7.98 20.37,-7.47 21.27,-6.96 22.03,-6.24 22.79,-5.53 23.36,-4.65 23.92,-3.78 24.26,-2.79 24.60,-1.81 24.70,-0.77 24.79,0.26 24.63,1.29 24.48,2.32 24.08,3.28 23.68,4.24 23.06,5.08 22.44,5.92 22.44,5.92 L 22.44,5.92 Z"></path></g>
            <g transform="translate(101.85835381507286 102.9729819552748) rotate(250.27110855087375 -20.2546601161624 33.09458545165097)" stroke="none"><path fill="#1971c2" d="M 22.44,5.92 Q 22.44,5.92 15.96,12.15 9.47,18.39 2.73,24.10 -4.01,29.81 -12.45,36.88 -20.89,43.94 -26.04,49.23 -31.19,54.53 -36.13,58.61 -41.08,62.69 -45.51,66.41 -49.95,70.12 -49.82,70.80 -49.68,71.48 -50.71,72.45 -51.74,73.43 -53.02,74.02 -54.31,74.62 -55.72,74.78 -57.13,74.93 -58.51,74.63 -59.89,74.32 -61.11,73.59 -62.32,72.87 -63.24,71.79 -64.16,70.71 -64.69,69.39 -65.21,68.08 -65.29,66.66 -65.37,65.25 -64.99,63.88 -64.61,62.51 -63.82,61.34 -63.03,60.17 -61.90,59.31 -60.77,58.45 -59.43,58.00 -58.09,57.54 -56.67,57.54 -55.25,57.54 -53.91,57.99 -52.57,58.44 -51.44,59.30 -50.31,60.16 -49.51,61.33 -48.72,62.50 -48.34,63.86 -47.96,65.23 -48.03,66.64 -48.11,68.06 -48.63,69.38 -49.15,70.69 -50.07,71.77 -50.99,72.85 -52.20,73.59 -53.41,74.32 -54.80,74.62 -56.18,74.93 -57.59,74.78 -59.00,74.62 -60.28,74.03 -61.57,73.44 -62.60,72.46 -63.63,71.49 -64.29,70.24 -64.96,68.99 -65.19,67.59 -65.42,66.19 -65.19,64.79 -64.96,63.39 -64.30,62.14 -63.64,60.89 -63.64,60.89 -63.64,60.89 -60.94,58.19 -58.25,55.49 -53.97,53.27 -49.68,51.05 -45.16,48.13 -40.64,45.21 -35.10,39.62 -29.56,34.04 -21.55,26.70 -13.54,19.35 -7.67,13.56 -1.79,7.77 4.03,0.92 9.86,-5.92 10.66,-6.59 11.46,-7.25 12.40,-7.71 13.33,-8.16 14.35,-8.38 15.37,-8.60 16.41,-8.57 17.45,-8.54 18.46,-8.26 19.46,-7.98 20.37,-7.47 21.27,-6.96 22.03,-6.24 22.79,-5.53 23.36,-4.65 23.92,-3.78 24.26,-2.79 24.60,-1.81 24.70,-0.77 24.79,0.26 24.63,1.29 24.48,2.32 24.08,3.28 23.68,4.24 23.06,5.08 22.44,5.92 22.44,5.92 L 22.44,5.92 Z"></path></g>
            <g transform="translate(237.08040489017594 98.40094416100953) rotate(11.942992448689342 -20.2546601161624 33.09458545165097)" stroke="none"><path fill="#fa5252" d="M 22.44,5.92 Q 22.44,5.92 15.96,12.15 9.47,18.39 2.73,24.10 -4.01,29.81 -12.45,36.88 -20.89,43.94 -26.04,49.23 -31.19,54.53 -36.13,58.61 -41.08,62.69 -45.51,66.41 -49.95,70.12 -49.82,70.80 -49.68,71.48 -50.71,72.45 -51.74,73.43 -53.02,74.02 -54.31,74.62 -55.72,74.78 -57.13,74.93 -58.51,74.63 -59.89,74.32 -61.11,73.59 -62.32,72.87 -63.24,71.79 -64.16,70.71 -64.69,69.39 -65.21,68.08 -65.29,66.66 -65.37,65.25 -64.99,63.88 -64.61,62.51 -63.82,61.34 -63.03,60.17 -61.90,59.31 -60.77,58.45 -59.43,58.00 -58.09,57.54 -56.67,57.54 -55.25,57.54 -53.91,57.99 -52.57,58.44 -51.44,59.30 -50.31,60.16 -49.51,61.33 -48.72,62.50 -48.34,63.86 -47.96,65.23 -48.03,66.64 -48.11,68.06 -48.63,69.38 -49.15,70.69 -50.07,71.77 -50.99,72.85 -52.20,73.59 -53.41,74.32 -54.80,74.62 -56.18,74.93 -57.59,74.78 -59.00,74.62 -60.28,74.03 -61.57,73.44 -62.60,72.46 -63.63,71.49 -64.29,70.24 -64.96,68.99 -65.19,67.59 -65.42,66.19 -65.19,64.79 -64.96,63.39 -64.30,62.14 -63.64,60.89 -63.64,60.89 -63.64,60.89 -60.94,58.19 -58.25,55.49 -53.97,53.27 -49.68,51.05 -45.16,48.13 -40.64,45.21 -35.10,39.62 -29.56,34.04 -21.55,26.70 -13.54,19.35 -7.67,13.56 -1.79,7.77 4.03,0.92 9.86,-5.92 10.66,-6.59 11.46,-7.25 12.40,-7.71 13.33,-8.16 14.35,-8.38 15.37,-8.60 16.41,-8.57 17.45,-8.54 18.46,-8.26 19.46,-7.98 20.37,-7.47 21.27,-6.96 22.03,-6.24 22.79,-5.53 23.36,-4.65 23.92,-3.78 24.26,-2.79 24.60,-1.81 24.70,-0.77 24.79,0.26 24.63,1.29 24.48,2.32 24.08,3.28 23.68,4.24 23.06,5.08 22.44,5.92 22.44,5.92 L 22.44,5.92 Z"></path></g>
            <g transform="translate(237.7772846433785 219.56768204356183) rotate(11.942992448689342 -20.2546601161624 33.09458545165097)" stroke="none"><path fill="#fa5252" d="M 22.44,5.92 Q 22.44,5.92 15.96,12.15 9.47,18.39 2.73,24.10 -4.01,29.81 -12.45,36.88 -20.89,43.94 -26.04,49.23 -31.19,54.53 -36.13,58.61 -41.08,62.69 -45.51,66.41 -49.95,70.12 -49.82,70.80 -49.68,71.48 -50.71,72.45 -51.74,73.43 -53.02,74.02 -54.31,74.62 -55.72,74.78 -57.13,74.93 -58.51,74.63 -59.89,74.32 -61.11,73.59 -62.32,72.87 -63.24,71.79 -64.16,70.71 -64.69,69.39 -65.21,68.08 -65.29,66.66 -65.37,65.25 -64.99,63.88 -64.61,62.51 -63.82,61.34 -63.03,60.17 -61.90,59.31 -60.77,58.45 -59.43,58.00 -58.09,57.54 -56.67,57.54 -55.25,57.54 -53.91,57.99 -52.57,58.44 -51.44,59.30 -50.31,60.16 -49.51,61.33 -48.72,62.50 -48.34,63.86 -47.96,65.23 -48.03,66.64 -48.11,68.06 -48.63,69.38 -49.15,70.69 -50.07,71.77 -50.99,72.85 -52.20,73.59 -53.41,74.32 -54.80,74.62 -56.18,74.93 -57.59,74.78 -59.00,74.62 -60.28,74.03 -61.57,73.44 -62.60,72.46 -63.63,71.49 -64.29,70.24 -64.96,68.99 -65.19,67.59 -65.42,66.19 -65.19,64.79 -64.96,63.39 -64.30,62.14 -63.64,60.89 -63.64,60.89 -63.64,60.89 -60.94,58.19 -58.25,55.49 -53.97,53.27 -49.68,51.05 -45.16,48.13 -40.64,45.21 -35.10,39.62 -29.56,34.04 -21.55,26.70 -13.54,19.35 -7.67,13.56 -1.79,7.77 4.03,0.92 9.86,-5.92 10.66,-6.59 11.46,-7.25 12.40,-7.71 13.33,-8.16 14.35,-8.38 15.37,-8.60 16.41,-8.57 17.45,-8.54 18.46,-8.26 19.46,-7.98 20.37,-7.47 21.27,-6.96 22.03,-6.24 22.79,-5.53 23.36,-4.65 23.92,-3.78 24.26,-2.79 24.60,-1.81 24.70,-0.77 24.79,0.26 24.63,1.29 24.48,2.32 24.08,3.28 23.68,4.24 23.06,5.08 22.44,5.92 22.44,5.92 L 22.44,5.92 Z"></path></g>
            <g transform="translate(104.75161888910088 219.79988627206956) rotate(72.59730030203424 -20.2546601161624 33.09458545165097)" stroke="none"><path fill="#1971c2" d="M 22.44,5.92 Q 22.44,5.92 15.96,12.15 9.47,18.39 2.73,24.10 -4.01,29.81 -12.45,36.88 -20.89,43.94 -26.04,49.23 -31.19,54.53 -36.13,58.61 -41.08,62.69 -45.51,66.41 -49.95,70.12 -49.82,70.80 -49.68,71.48 -50.71,72.45 -51.74,73.43 -53.02,74.02 -54.31,74.62 -55.72,74.78 -57.13,74.93 -58.51,74.63 -59.89,74.32 -61.11,73.59 -62.32,72.87 -63.24,71.79 -64.16,70.71 -64.69,69.39 -65.21,68.08 -65.29,66.66 -65.37,65.25 -64.99,63.88 -64.61,62.51 -63.82,61.34 -63.03,60.17 -61.90,59.31 -60.77,58.45 -59.43,58.00 -58.09,57.54 -56.67,57.54 -55.25,57.54 -53.91,57.99 -52.57,58.44 -51.44,59.30 -50.31,60.16 -49.51,61.33 -48.72,62.50 -48.34,63.86 -47.96,65.23 -48.03,66.64 -48.11,68.06 -48.63,69.38 -49.15,70.69 -50.07,71.77 -50.99,72.85 -52.20,73.59 -53.41,74.32 -54.80,74.62 -56.18,74.93 -57.59,74.78 -59.00,74.62 -60.28,74.03 -61.57,73.44 -62.60,72.46 -63.63,71.49 -64.29,70.24 -64.96,68.99 -65.19,67.59 -65.42,66.19 -65.19,64.79 -64.96,63.39 -64.30,62.14 -63.64,60.89 -63.64,60.89 -63.64,60.89 -60.94,58.19 -58.25,55.49 -53.97,53.27 -49.68,51.05 -45.16,48.13 -40.64,45.21 -35.10,39.62 -29.56,34.04 -21.55,26.70 -13.54,19.35 -7.67,13.56 -1.79,7.77 4.03,0.92 9.86,-5.92 10.66,-6.59 11.46,-7.25 12.40,-7.71 13.33,-8.16 14.35,-8.38 15.37,-8.60 16.41,-8.57 17.45,-8.54 18.46,-8.26 19.46,-7.98 20.37,-7.47 21.27,-6.96 22.03,-6.24 22.79,-5.53 23.36,-4.65 23.92,-3.78 24.26,-2.79 24.60,-1.81 24.70,-0.77 24.79,0.26 24.63,1.29 24.48,2.32 24.08,3.28 23.68,4.24 23.06,5.08 22.44,5.92 22.44,5.92 L 22.44,5.92 Z"></path></g>
            <g transform="translate(186.57051777231345 195.22358901701762) rotate(313.22858131591363 -20.2546601161624 33.09458545165097)" stroke="none"><path fill="#fa5252" d="M 22.44,5.92 Q 22.44,5.92 15.96,12.15 9.47,18.39 2.73,24.10 -4.01,29.81 -12.45,36.88 -20.89,43.94 -26.04,49.23 -31.19,54.53 -36.13,58.61 -41.08,62.69 -45.51,66.41 -49.95,70.12 -49.82,70.80 -49.68,71.48 -50.71,72.45 -51.74,73.43 -53.02,74.02 -54.31,74.62 -55.72,74.78 -57.13,74.93 -58.51,74.63 -59.89,74.32 -61.11,73.59 -62.32,72.87 -63.24,71.79 -64.16,70.71 -64.69,69.39 -65.21,68.08 -65.29,66.66 -65.37,65.25 -64.99,63.88 -64.61,62.51 -63.82,61.34 -63.03,60.17 -61.90,59.31 -60.77,58.45 -59.43,58.00 -58.09,57.54 -56.67,57.54 -55.25,57.54 -53.91,57.99 -52.57,58.44 -51.44,59.30 -50.31,60.16 -49.51,61.33 -48.72,62.50 -48.34,63.86 -47.96,65.23 -48.03,66.64 -48.11,68.06 -48.63,69.38 -49.15,70.69 -50.07,71.77 -50.99,72.85 -52.20,73.59 -53.41,74.32 -54.80,74.62 -56.18,74.93 -57.59,74.78 -59.00,74.62 -60.28,74.03 -61.57,73.44 -62.60,72.46 -63.63,71.49 -64.29,70.24 -64.96,68.99 -65.19,67.59 -65.42,66.19 -65.19,64.79 -64.96,63.39 -64.30,62.14 -63.64,60.89 -63.64,60.89 -63.64,60.89 -60.94,58.19 -58.25,55.49 -53.97,53.27 -49.68,51.05 -45.16,48.13 -40.64,45.21 -35.10,39.62 -29.56,34.04 -21.55,26.70 -13.54,19.35 -7.67,13.56 -1.79,7.77 4.03,0.92 9.86,-5.92 10.66,-6.59 11.46,-7.25 12.40,-7.71 13.33,-8.16 14.35,-8.38 15.37,-8.60 16.41,-8.57 17.45,-8.54 18.46,-8.26 19.46,-7.98 20.37,-7.47 21.27,-6.96 22.03,-6.24 22.79,-5.53 23.36,-4.65 23.92,-3.78 24.26,-2.79 24.60,-1.81 24.70,-0.77 24.79,0.26 24.63,1.29 24.48,2.32 24.08,3.28 23.68,4.24 23.06,5.08 22.44,5.92 22.44,5.92 L 22.44,5.92 Z"></path></g>
            <g transform="translate(55.6883643082524 139.06951280153305) rotate(311.9412996319167 -20.2546601161624 33.09458545165097)" stroke="none"><path fill="#1971c2" d="M 22.44,5.92 Q 22.44,5.92 15.96,12.15 9.47,18.39 2.73,24.10 -4.01,29.81 -12.45,36.88 -20.89,43.94 -26.04,49.23 -31.19,54.53 -36.13,58.61 -41.08,62.69 -45.51,66.41 -49.95,70.12 -49.82,70.80 -49.68,71.48 -50.71,72.45 -51.74,73.43 -53.02,74.02 -54.31,74.62 -55.72,74.78 -57.13,74.93 -58.51,74.63 -59.89,74.32 -61.11,73.59 -62.32,72.87 -63.24,71.79 -64.16,70.71 -64.69,69.39 -65.21,68.08 -65.29,66.66 -65.37,65.25 -64.99,63.88 -64.61,62.51 -63.82,61.34 -63.03,60.17 -61.90,59.31 -60.77,58.45 -59.43,58.00 -58.09,57.54 -56.67,57.54 -55.25,57.54 -53.91,57.99 -52.57,58.44 -51.44,59.30 -50.31,60.16 -49.51,61.33 -48.72,62.50 -48.34,63.86 -47.96,65.23 -48.03,66.64 -48.11,68.06 -48.63,69.38 -49.15,70.69 -50.07,71.77 -50.99,72.85 -52.20,73.59 -53.41,74.32 -54.80,74.62 -56.18,74.93 -57.59,74.78 -59.00,74.62 -60.28,74.03 -61.57,73.44 -62.60,72.46 -63.63,71.49 -64.29,70.24 -64.96,68.99 -65.19,67.59 -65.42,66.19 -65.19,64.79 -64.96,63.39 -64.30,62.14 -63.64,60.89 -63.64,60.89 -63.64,60.89 -60.94,58.19 -58.25,55.49 -53.97,53.27 -49.68,51.05 -45.16,48.13 -40.64,45.21 -35.10,39.62 -29.56,34.04 -21.55,26.70 -13.54,19.35 -7.67,13.56 -1.79,7.77 4.03,0.92 9.86,-5.92 10.66,-6.59 11.46,-7.25 12.40,-7.71 13.33,-8.16 14.35,-8.38 15.37,-8.60 16.41,-8.57 17.45,-8.54 18.46,-8.26 19.46,-7.98 20.37,-7.47 21.27,-6.96 22.03,-6.24 22.79,-5.53 23.36,-4.65 23.92,-3.78 24.26,-2.79 24.60,-1.81 24.70,-0.77 24.79,0.26 24.63,1.29 24.48,2.32 24.08,3.28 23.68,4.24 23.06,5.08 22.44,5.92 22.44,5.92 L 22.44,5.92 Z"></path></g>
            <g transform="translate(286.6082246247313 127.31728142073405) rotate(132.97861451431436 -20.2546601161624 33.09458545165097)" stroke="none"><path fill="#fa5252" d="M 22.44,5.92 Q 22.44,5.92 15.96,12.15 9.47,18.39 2.73,24.10 -4.01,29.81 -12.45,36.88 -20.89,43.94 -26.04,49.23 -31.19,54.53 -36.13,58.61 -41.08,62.69 -45.51,66.41 -49.95,70.12 -49.82,70.80 -49.68,71.48 -50.71,72.45 -51.74,73.43 -53.02,74.02 -54.31,74.62 -55.72,74.78 -57.13,74.93 -58.51,74.63 -59.89,74.32 -61.11,73.59 -62.32,72.87 -63.24,71.79 -64.16,70.71 -64.69,69.39 -65.21,68.08 -65.29,66.66 -65.37,65.25 -64.99,63.88 -64.61,62.51 -63.82,61.34 -63.03,60.17 -61.90,59.31 -60.77,58.45 -59.43,58.00 -58.09,57.54 -56.67,57.54 -55.25,57.54 -53.91,57.99 -52.57,58.44 -51.44,59.30 -50.31,60.16 -49.51,61.33 -48.72,62.50 -48.34,63.86 -47.96,65.23 -48.03,66.64 -48.11,68.06 -48.63,69.38 -49.15,70.69 -50.07,71.77 -50.99,72.85 -52.20,73.59 -53.41,74.32 -54.80,74.62 -56.18,74.93 -57.59,74.78 -59.00,74.62 -60.28,74.03 -61.57,73.44 -62.60,72.46 -63.63,71.49 -64.29,70.24 -64.96,68.99 -65.19,67.59 -65.42,66.19 -65.19,64.79 -64.96,63.39 -64.30,62.14 -63.64,60.89 -63.64,60.89 -63.64,60.89 -60.94,58.19 -58.25,55.49 -53.97,53.27 -49.68,51.05 -45.16,48.13 -40.64,45.21 -35.10,39.62 -29.56,34.04 -21.55,26.70 -13.54,19.35 -7.67,13.56 -1.79,7.77 4.03,0.92 9.86,-5.92 10.66,-6.59 11.46,-7.25 12.40,-7.71 13.33,-8.16 14.35,-8.38 15.37,-8.60 16.41,-8.57 17.45,-8.54 18.46,-8.26 19.46,-7.98 20.37,-7.47 21.27,-6.96 22.03,-6.24 22.79,-5.53 23.36,-4.65 23.92,-3.78 24.26,-2.79 24.60,-1.81 24.70,-0.77 24.79,0.26 24.63,1.29 24.48,2.32 24.08,3.28 23.68,4.24 23.06,5.08 22.44,5.92 22.44,5.92 L 22.44,5.92 Z"></path></g>
            <g transform="translate(225.83055197218528 71.73334038772953) rotate(11.942992448689342 -20.2546601161624 33.09458545165097)" stroke="none"><path fill="#257433" d="M 22.44,5.92 Q 22.44,5.92 15.96,12.15 9.47,18.39 2.73,24.10 -4.01,29.81 -12.45,36.88 -20.89,43.94 -26.04,49.23 -31.19,54.53 -36.13,58.61 -41.08,62.69 -45.51,66.41 -49.95,70.12 -49.82,70.80 -49.68,71.48 -50.71,72.45 -51.74,73.43 -53.02,74.02 -54.31,74.62 -55.72,74.78 -57.13,74.93 -58.51,74.63 -59.89,74.32 -61.11,73.59 -62.32,72.87 -63.24,71.79 -64.16,70.71 -64.69,69.39 -65.21,68.08 -65.29,66.66 -65.37,65.25 -64.99,63.88 -64.61,62.51 -63.82,61.34 -63.03,60.17 -61.90,59.31 -60.77,58.45 -59.43,58.00 -58.09,57.54 -56.67,57.54 -55.25,57.54 -53.91,57.99 -52.57,58.44 -51.44,59.30 -50.31,60.16 -49.51,61.33 -48.72,62.50 -48.34,63.86 -47.96,65.23 -48.03,66.64 -48.11,68.06 -48.63,69.38 -49.15,70.69 -50.07,71.77 -50.99,72.85 -52.20,73.59 -53.41,74.32 -54.80,74.62 -56.18,74.93 -57.59,74.78 -59.00,74.62 -60.28,74.03 -61.57,73.44 -62.60,72.46 -63.63,71.49 -64.29,70.24 -64.96,68.99 -65.19,67.59 -65.42,66.19 -65.19,64.79 -64.96,63.39 -64.30,62.14 -63.64,60.89 -63.64,60.89 -63.64,60.89 -60.94,58.19 -58.25,55.49 -53.97,53.27 -49.68,51.05 -45.16,48.13 -40.64,45.21 -35.10,39.62 -29.56,34.04 -21.55,26.70 -13.54,19.35 -7.67,13.56 -1.79,7.77 4.03,0.92 9.86,-5.92 10.66,-6.59 11.46,-7.25 12.40,-7.71 13.33,-8.16 14.35,-8.38 15.37,-8.60 16.41,-8.57 17.45,-8.54 18.46,-8.26 19.46,-7.98 20.37,-7.47 21.27,-6.96 22.03,-6.24 22.79,-5.53 23.36,-4.65 23.92,-3.78 24.26,-2.79 24.60,-1.81 24.70,-0.77 24.79,0.26 24.63,1.29 24.48,2.32 24.08,3.28 23.68,4.24 23.06,5.08 22.44,5.92 22.44,5.92 L 22.44,5.92 Z"></path></g>
            <g transform="translate(153.29719935275716 190.35925028615236) rotate(313.22858131591363 -20.2546601161624 33.09458545165097)" stroke="none"><path fill="#1971c2" d="M 22.44,5.92 Q 22.44,5.92 15.96,12.15 9.47,18.39 2.73,24.10 -4.01,29.81 -12.45,36.88 -20.89,43.94 -26.04,49.23 -31.19,54.53 -36.13,58.61 -41.08,62.69 -45.51,66.41 -49.95,70.12 -49.82,70.80 -49.68,71.48 -50.71,72.45 -51.74,73.43 -53.02,74.02 -54.31,74.62 -55.72,74.78 -57.13,74.93 -58.51,74.63 -59.89,74.32 -61.11,73.59 -62.32,72.87 -63.24,71.79 -64.16,70.71 -64.69,69.39 -65.21,68.08 -65.29,66.66 -65.37,65.25 -64.99,63.88 -64.61,62.51 -63.82,61.34 -63.03,60.17 -61.90,59.31 -60.77,58.45 -59.43,58.00 -58.09,57.54 -56.67,57.54 -55.25,57.54 -53.91,57.99 -52.57,58.44 -51.44,59.30 -50.31,60.16 -49.51,61.33 -48.72,62.50 -48.34,63.86 -47.96,65.23 -48.03,66.64 -48.11,68.06 -48.63,69.38 -49.15,70.69 -50.07,71.77 -50.99,72.85 -52.20,73.59 -53.41,74.32 -54.80,74.62 -56.18,74.93 -57.59,74.78 -59.00,74.62 -60.28,74.03 -61.57,73.44 -62.60,72.46 -63.63,71.49 -64.29,70.24 -64.96,68.99 -65.19,67.59 -65.42,66.19 -65.19,64.79 -64.96,63.39 -64.30,62.14 -63.64,60.89 -63.64,60.89 -63.64,60.89 -60.94,58.19 -58.25,55.49 -53.97,53.27 -49.68,51.05 -45.16,48.13 -40.64,45.21 -35.10,39.62 -29.56,34.04 -21.55,26.70 -13.54,19.35 -7.67,13.56 -1.79,7.77 4.03,0.92 9.86,-5.92 10.66,-6.59 11.46,-7.25 12.40,-7.71 13.33,-8.16 14.35,-8.38 15.37,-8.60 16.41,-8.57 17.45,-8.54 18.46,-8.26 19.46,-7.98 20.37,-7.47 21.27,-6.96 22.03,-6.24 22.79,-5.53 23.36,-4.65 23.92,-3.78 24.26,-2.79 24.60,-1.81 24.70,-0.77 24.79,0.26 24.63,1.29 24.48,2.32 24.08,3.28 23.68,4.24 23.06,5.08 22.44,5.92 22.44,5.92 L 22.44,5.92 Z"></path></g>
            <g transform="translate(108.65155053824537 72.83118723604764) rotate(250.27110855087375 -20.2546601161624 33.09458545165097)" stroke="none"><path fill="#257433" d="M 22.44,5.92 Q 22.44,5.92 15.96,12.15 9.47,18.39 2.73,24.10 -4.01,29.81 -12.45,36.88 -20.89,43.94 -26.04,49.23 -31.19,54.53 -36.13,58.61 -41.08,62.69 -45.51,66.41 -49.95,70.12 -49.82,70.80 -49.68,71.48 -50.71,72.45 -51.74,73.43 -53.02,74.02 -54.31,74.62 -55.72,74.78 -57.13,74.93 -58.51,74.63 -59.89,74.32 -61.11,73.59 -62.32,72.87 -63.24,71.79 -64.16,70.71 -64.69,69.39 -65.21,68.08 -65.29,66.66 -65.37,65.25 -64.99,63.88 -64.61,62.51 -63.82,61.34 -63.03,60.17 -61.90,59.31 -60.77,58.45 -59.43,58.00 -58.09,57.54 -56.67,57.54 -55.25,57.54 -53.91,57.99 -52.57,58.44 -51.44,59.30 -50.31,60.16 -49.51,61.33 -48.72,62.50 -48.34,63.86 -47.96,65.23 -48.03,66.64 -48.11,68.06 -48.63,69.38 -49.15,70.69 -50.07,71.77 -50.99,72.85 -52.20,73.59 -53.41,74.32 -54.80,74.62 -56.18,74.93 -57.59,74.78 -59.00,74.62 -60.28,74.03 -61.57,73.44 -62.60,72.46 -63.63,71.49 -64.29,70.24 -64.96,68.99 -65.19,67.59 -65.42,66.19 -65.19,64.79 -64.96,63.39 -64.30,62.14 -63.64,60.89 -63.64,60.89 -63.64,60.89 -60.94,58.19 -58.25,55.49 -53.97,53.27 -49.68,51.05 -45.16,48.13 -40.64,45.21 -35.10,39.62 -29.56,34.04 -21.55,26.70 -13.54,19.35 -7.67,13.56 -1.79,7.77 4.03,0.92 9.86,-5.92 10.66,-6.59 11.46,-7.25 12.40,-7.71 13.33,-8.16 14.35,-8.38 15.37,-8.60 16.41,-8.57 17.45,-8.54 18.46,-8.26 19.46,-7.98 20.37,-7.47 21.27,-6.96 22.03,-6.24 22.79,-5.53 23.36,-4.65 23.92,-3.78 24.26,-2.79 24.60,-1.81 24.70,-0.77 24.79,0.26 24.63,1.29 24.48,2.32 24.08,3.28 23.68,4.24 23.06,5.08 22.44,5.92 22.44,5.92 L 22.44,5.92 Z"></path></g>
        </svg>
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
            class="theme-toggle__classic"
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
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <circle cx="12" cy="12" r="4"/>
        </svg>
    `;
    settingsContainer.appendChild(settingsButton);
    
    const settingsPanel = document.createElement("div");
    settingsPanel.className = "settings-panel";
    
    // SVG icon templates
    const volumeOnSvg = `<svg class="icon-on" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg>`;
    const volumeOffSvg = `<svg class="icon-off" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>`;
    const toggleOnSvg = `<svg class="icon-on" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const toggleOffSvg = `<svg class="icon-off" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>`;
    const tabArrowSvg = `<svg class="tab-arrow" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
    
    // Current settings for initial UI state
    const currentAudioMode = localStorage.getItem('portfolio-audio-mode') || 'api';
    const curAA = antialias;
    const curShadows = shadowsEnabled;
    const curPixel = pixelSizeValue;
    const curPreset = (curAA && curShadows) ? 'high' : (!curAA && !curShadows) ? 'low' : 'custom';
    const currentLanguage = localStorage.getItem('portfolio-language') || 'en-us';
    
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
                <div class="settings-row" style="padding-bottom:2px">
                    <span class="settings-label" data-i18n="settings.audioMode">${t('settings.audioMode')}</span>
                </div>
                <div class="settings-row" style="padding-top:2px">
                    <div class="settings-mode-switch audio-mode-switch">
                        <button class="mode-option${currentAudioMode === 'api' ? ' active' : ''}" data-value="api" data-i18n="settings.webAudioApi">${t('settings.webAudioApi')}</button>
                        <button class="mode-option${currentAudioMode === 'tag' ? ' active' : ''}" data-value="tag" data-i18n="settings.audioTag">${t('settings.audioTag')}</button>
                    </div>
                </div>
                <div class="settings-row">
                    <span class="settings-label" data-i18n="settings.nature">${t('settings.nature')}</span>
                    <button class="settings-toggle nature-toggle" data-active="true">${volumeOnSvg}${volumeOffSvg}</button>
                </div>
                <div class="settings-row">
                    <span class="settings-label" data-i18n="settings.music">${t('settings.music')}</span>
                    <button class="settings-toggle music-toggle" data-active="true">${volumeOnSvg}${volumeOffSvg}</button>
                </div>
                <div class="settings-row">
                    <span class="settings-label" data-i18n="settings.interface">${t('settings.interface')}</span>
                    <button class="settings-toggle interface-toggle" data-active="true">${volumeOnSvg}${volumeOffSvg}</button>
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
                    <span class="settings-label" data-i18n="settings.preset">${t('settings.preset')}</span>
                </div>
                <div class="settings-row" style="padding-top:2px">
                    <div class="settings-mode-switch preset-switch">
                        <button class="mode-option${curPreset === 'low' ? ' active' : ''}" data-value="low" data-i18n="settings.low">${t('settings.low')}</button>
                        <button class="mode-option${curPreset === 'custom' ? ' active' : ''}" data-value="custom" data-i18n="settings.custom">${t('settings.custom')}</button>
                        <button class="mode-option${curPreset === 'high' ? ' active' : ''}" data-value="high" data-i18n="settings.high">${t('settings.high')}</button>
                    </div>
                </div>
                <div class="settings-row">
                    <span class="settings-label" data-i18n="settings.antialias">${t('settings.antialias')}</span>
                    <button class="settings-toggle antialias-toggle" data-active="${curAA}">${toggleOnSvg}${toggleOffSvg}</button>
                </div>
                <div class="settings-row">
                    <span class="settings-label" data-i18n="settings.shadows">${t('settings.shadows')}</span>
                    <button class="settings-toggle shadows-toggle" data-active="${curShadows}">${toggleOnSvg}${toggleOffSvg}</button>
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
    });
    
    // Close settings when clicking outside
    document.addEventListener('click', (e) => {
        if (settingsOpen && !settingsContainer.contains(e.target as Node)) {
            settingsOpen = false;
            settingsPanel.classList.remove('open');
            settingsButton.classList.remove('active');
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
    
    // ---- Audio Mode Switch ----
    const audioModeSwitch = settingsPanel.querySelector('.audio-mode-switch') as HTMLElement;
    audioModeSwitch.querySelectorAll('.mode-option').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const newMode = (btn as HTMLElement).dataset.value!;
            const oldMode = localStorage.getItem('portfolio-audio-mode') || 'api';
            if (newMode === oldMode) return;
            
            const confirmed = await showConfirmModal(
                t('modal.changeAudioMode'),
                newMode === 'api'
                    ? t('modal.webAudioApiDesc')
                    : t('modal.audioTagDesc')
            );
            
            if (confirmed) {
                localStorage.setItem('portfolio-audio-mode', newMode);
                window.location.reload();
            }
        });
    });
    
    // ---- Audio Toggles ----
    const natureToggle = settingsPanel.querySelector('.nature-toggle') as HTMLButtonElement;
    natureToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = natureToggle.dataset.active === 'true';
        natureToggle.dataset.active = (!isActive).toString();
        setNatureMuted(isActive);
    });
    
    const musicToggle = settingsPanel.querySelector('.music-toggle') as HTMLButtonElement;
    musicToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = musicToggle.dataset.active === 'true';
        musicToggle.dataset.active = (!isActive).toString();
        setMusicMuted(isActive);
    });
    
    const interfaceToggle = settingsPanel.querySelector('.interface-toggle') as HTMLButtonElement;
    interfaceToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = interfaceToggle.dataset.active === 'true';
        interfaceToggle.dataset.active = (!isActive).toString();
        setInterfaceMuted(isActive);
    });
    
    // ---- Graphics Controls ----
    const presetSwitch = settingsPanel.querySelector('.preset-switch') as HTMLElement;
    const antialiasToggle = settingsPanel.querySelector('.antialias-toggle') as HTMLButtonElement;
    const shadowsToggle = settingsPanel.querySelector('.shadows-toggle') as HTMLButtonElement;
    
    function updatePresetIndicator() {
        const aa = antialiasToggle.dataset.active === 'true';
        const shd = shadowsToggle.dataset.active === 'true';
        presetSwitch.querySelectorAll('.mode-option').forEach(b => b.classList.remove('active'));
        if (aa && shd) {
            presetSwitch.querySelector('[data-value="high"]')?.classList.add('active');
        } else if (!aa && !shd) {
            presetSwitch.querySelector('[data-value="low"]')?.classList.add('active');
        } else {
            presetSwitch.querySelector('[data-value="custom"]')?.classList.add('active');
        }
    }
    
    // Preset switch
    presetSwitch.querySelectorAll('.mode-option').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const preset = (btn as HTMLElement).dataset.value!;
            if (preset === 'custom') return; // Custom is just an indicator
            const isLow = preset === 'low';
            const newAA = !isLow;
            const newShadows = !isLow;
            const currentAA = antialiasToggle.dataset.active === 'true';
            
            if (newAA !== currentAA) {
                const confirmed = await showConfirmModal(
                    isLow ? t('modal.switchToLow') : t('modal.switchToHigh'),
                    isLow ? t('modal.presetLowDesc') : t('modal.presetHighDesc')
                );
                if (!confirmed) return;
                localStorage.setItem('portfolio-antialias', newAA.toString());
                localStorage.setItem('portfolio-shadows', newShadows.toString());
                window.location.reload();
                return;
            }
            
            // No antialias change — apply immediately
            shadowsToggle.dataset.active = newShadows.toString();
            setShadowsEnabled(newShadows);
            
            updatePresetIndicator();
        });
    });
    
    // Antialias toggle
    antialiasToggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isActive = antialiasToggle.dataset.active === 'true';
        const newValue = !isActive;
        
        const confirmed = await showConfirmModal(
            newValue ? t('modal.enableAntialias') : t('modal.disableAntialias'),
            t('modal.antialiasDesc')
        );
        
        if (confirmed) {
            localStorage.setItem('portfolio-antialias', newValue.toString());
            window.location.reload();
        }
    });
    
    // Shadows toggle
    shadowsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = shadowsToggle.dataset.active === 'true';
        const newValue = !isActive;
        shadowsToggle.dataset.active = newValue.toString();
        setShadowsEnabled(newValue);
        updatePresetIndicator();
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

export function Update(): void {
    // Update CSS custom property for smooth day/night color transitions
    const blend = getDayNightBlend();
    document.documentElement.style.setProperty('--day-night-blend', blend.toString());
    
    // Update body class for CSS targeting
    if (blend < 0.5) {
        document.body.classList.remove('night-mode');
        document.body.classList.add('day-mode');
    } else {
        document.body.classList.remove('day-mode');
        document.body.classList.add('night-mode');
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

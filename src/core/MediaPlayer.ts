// ============================================
// MEDIA PLAYER - Mini music player for radio
// ============================================

import { camera, pixelSizeValue } from "./Scene";
import { unlock as unlockAchievement } from './Achievements';
import { radio } from "../scene/Island";
import { Vector3 } from "three";
import { CSS3DPanel } from "../effects/CSS3DPanel";
import { islandPosition, radioOffset } from "../scene/config/IslandConfig";
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
        file: 'audio/music/Walen - Dark Heart (freetouse.com).mp3',
        name: 'Dark Heart',
        artist: 'Walen',
        cover: 'images/music/darkheart.webp'
    },
    {
        file: 'audio/music/Moavii - Fly With Me (freetouse.com).mp3',
        name: 'Fly With Me',
        artist: 'Moavii',
        cover: 'images/music/flywithme.webp'
    },
    {
        file: 'audio/music/595751__yellowtree__late-nights-in-osaka.mp3',
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
    {
        file: 'audio/music/Aetheric - After the Storm (freetouse.com).mp3',
        name: 'After the Storm',
        artist: 'Aetheric',
        cover: 'images/music/after_storm.webp'
    },
    {
        file: 'audio/music/Aetheric - Echoes of the Fields (freetouse.com).mp3',
        name: 'Echoes of the Fields',
        artist: 'Aetheric',
        cover: 'images/music/echoes_of_fields.webp'
    },
    {
        file: 'audio/music/Aetheric - The Sea (freetouse.com).mp3',
        name: 'The Sea',
        artist: 'Aetheric',
        cover: 'images/music/the_sea.webp'
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

// ── Transition-guard flag ─────────────────────────────────────────────────────
// Set to true while wavesurfer is loading a new track.  During this window the
// HTMLAudioElement fires a spurious 'pause' event (internally changing src)
// which would otherwise flip isPlaying=false and break the button state.
let _isLoadingNewSong = false;

// ── Watchdog stall detection ──────────────────────────────────────────────────
let _watchdogLastTime = -1;   // audioElement.currentTime sampled by the watchdog
let _watchdogStallCount = 0;  // consecutive intervals where currentTime hasn't moved

// DOM Elements
let playerContainer: HTMLDivElement | null = null;

// CSS3D panel — the player floats in the scene, anchored to the radio and
// billboarded to face the camera (see effects/CSS3DPanel).
let playerPanel: CSS3DPanel | null = null;
// Bigger = smaller panel in-scene. High enough that the 320px DOM is scaled
// DOWN (crisp) rather than up (blurry) at the radio-zoom framing. Tweak to resize.
const PLAYER_PX_PER_UNIT = 545;

// Panel translucency — how hard its punch dissolves the canvas. Mirrors the
// settings menu's 66/70% background so the two surfaces read as the same UI.
const PLAYER_PUNCH = 0.80;
// With anchor:'top' this is where the panel's TOP edge sits; the body extends
// downward from here (and further growth — playlist — also goes down, kept
// off the island by the max-height cap in CSS). 1.15 puts the top just under
// the radio-zoom frustum ceiling (~1.46wu at fov 50.5, 1.5wu away).
const PLAYER_ANCHOR_UP   = 0.90;  // world units above the radio (tweak height)
// The panel rises STRAIGHT UP out of the radio — same X and Z, only Y changes.
// It used to carry a forward offset to clear the notice board, which put it on a
// diagonal from the thing it belongs to and read as crooked. The radio has since
// moved clear of the board on its own, so the offset bought nothing and cost the
// one alignment that matters: a panel that comes out of an object should look
// like it came out of that object.
// Anchor to the radio's REST position (config), NOT radio.getWorldPosition():
// the radio bounces to the music beat, and following the live transform made
// the whole panel jitter, which made the buttons hard to hit.
const RADIO_REST_X = islandPosition.x + radioOffset.x;
const RADIO_REST_Y = islandPosition.y + radioOffset.y;
const RADIO_REST_Z = islandPosition.z + radioOffset.z;

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

// Cache of pre-computed waveform peaks per track URL. Without this, wavesurfer
// internally decodes each track's MP3 to Float32 PCM (~10× expansion, ~50-150 MB
// per ~5 MB track) every time .load() is called, and keeps every prior track's
// decoded data alive for the session. After 6-10 track switches that alone
// reaches several hundred MB of unrecoverable RAM growth.
const peaksCache = new Map<string, number[][]>();

/** Pull peaks out of wavesurfer after a decode and store them so subsequent
 *  plays of the same track skip the decode entirely. */
function cachePeaksAfterReady(url: string): void {
    if (!wavesurfer) return;
    wavesurfer.once('ready', () => {
        const ws = wavesurfer;
        if (!ws) return;
        // Defer off the current animation frame. exportPeaks() scans all decoded
        // PCM samples (O(millions)) and can block the main thread for 10-30 ms —
        // enough to drop a frame if 'ready' fires during a camera zoom animation.
        setTimeout(() => {
            try {
                const exported = ws.exportPeaks({ maxLength: 1024, precision: 1000 });
                peaksCache.set(url, exported);
            } catch { /* ignore — non-fatal */ }
        }, 0);
    });
}

/** Preload all playlist tracks into browser cache via fetch() */
export function preloadAllTracks(): void {
    for (let i = 0; i < playlist.length; i++) {
        if (preloadedAudios.has(i)) continue;
        fetch(playlist[i].file).then(() => {
            preloadedAudios.set(i, true as any);
        }).catch(() => {});
    }
}

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

    // ── Tab-visibility recovery ───────────────────────────────────────────────
    // When the user backgrounds the tab and comes back:
    //   • The Web Audio AudioContext may have been suspended by the browser.
    //   • On mobile, the HTMLAudioElement may have been paused.
    // Resume both so music continues without requiring a manual press.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;

        // Always try to resume the AudioContext — harmless if already running.
        const ctx = getAudioContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }

        // If we were supposed to be playing but the element was paused by the
        // browser (common on iOS when backgrounding), resume it now.
        // The return from background counts as a user-activation context on most
        // browsers, so .play() is typically allowed here.
        if (isPlaying && !pendingPlayOnReady && audioElement && audioElement.paused) {
            audioElement.play().catch(() => {});
        }
    });

    // ── Periodic watchdog (every 5 s) ─────────────────────────────────────────
    // Purpose 1: Hard-sync the play/pause button to the real audio element state
    //            so any edge-case desync is corrected within 5 s.
    // Purpose 2: Detect audio that has ended without the 'finish' event firing
    //            (can happen after tab backgrounding / AudioContext suspension)
    //            and advance to the next song.
    // Purpose 3: Detect a stall where isPlaying=true but currentTime is frozen
    //            (AudioContext suspended mid-song) and attempt to recover.
    setInterval(() => {
        if (!audioElement || _isLoadingNewSong || pendingPlayOnReady) return;

        // ── Hard state sync ────────────────────────────────────────────────────
        const actuallyPlaying = !audioElement.paused && !audioElement.ended;
        if (actuallyPlaying !== isPlaying) {
            isPlaying = actuallyPlaying;
            updatePlayButton();
            updateBubblePlayingState();
        }

        // ── Stuck-ended recovery ───────────────────────────────────────────────
        // Song ended but 'finish' event was swallowed (e.g. network issue or
        // AudioContext was suspended exactly at song end).
        if (isPlaying && audioElement.ended && !isLoopEnabled) {
            console.warn('[MediaPlayer] Watchdog: audio ended without finish event — advancing');
            _songEndHandled = false;
            handleSongEnded();
            return;
        }

        // ── Stall recovery: currentTime frozen while playing ──────────────────
        if (isPlaying && !audioElement.paused && !audioElement.ended) {
            const t = audioElement.currentTime;
            if (_watchdogLastTime >= 0 && Math.abs(t - _watchdogLastTime) < 0.1) {
                _watchdogStallCount++;
                if (_watchdogStallCount >= 2) {
                    // Frozen for ~10 s while supposedly playing — try to kick it
                    console.warn('[MediaPlayer] Watchdog: playback appears stalled, attempting recovery');
                    _watchdogStallCount = 0;
                    const ctx = getAudioContext();
                    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
                    audioElement.play().catch(() => {});
                }
            } else {
                _watchdogStallCount = 0;
            }
            _watchdogLastTime = t;
        } else {
            _watchdogLastTime = -1;
            _watchdogStallCount = 0;
        }
    }, 5000);
}

function createPlayerUI(): void {
    playerContainer = document.createElement('div');
    // Always carry the `expanded` class — the CSS3D panel now owns show/hide via
    // its open/close animation, so there is no collapsed/screen-space state.
    playerContainer.className = 'media-player expanded';
    playerContainer.innerHTML = `
        <div class="player-expanded-content">
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
            </div>
        </div>
    `;
    
    // Mount the player inside a CSS3D panel that lives in the scene (anchored to
    // the radio, billboarded). Modal → it grabs the canvas pointer while open so
    // every button/waveform/link stays fully interactive; clicking outside the
    // panel collapses it (mirrors the old "click canvas to close").
    playerPanel = new CSS3DPanel({
        pxPerUnit: PLAYER_PX_PER_UNIT,
        radiusPx: 14,
        modal: true,
        maskPad: 12,
        // Known compact size (cover+info, waveform, controls — no header/playlist).
        initialSize: { w: 320, h: 250 },
        // Transparent, single ink region: punch ONE rounded rect that wraps ALL
        // the content together (no per-element boxes, no border ring). The panel
        // fill (black day / white night) shows inside that rect; the scene shows
        // around it.
        transparent: true,
        inkBounds: true,
        inkSelectors: [
            '.player-content', '.player-waveform-container', '.player-controls',
        ],
        inkPad: 14,
        inkRadius: 16,
        inkBorderBand: 0,
        // Top edge stays fixed; any growth extends DOWNWARD only.
        anchor: 'top',
        // Thin 3D line from the panel bottom down to the radio.
        connector: true,
        // See-through panel, at the settings menu's own ratio (its background is
        // 66% at night / 70% by day). Here the remaining fraction is the LIVE
        // SCENE rather than a blurred page background, because the punch is what
        // goes partial — the DOM fill stays opaque (see style.css).
        //
        // Text does not suffer for it: the residual scene is added equally to
        // the glyphs and to the fill behind them, so it lifts both and leaves
        // their separation at PLAYER_PUNCH x the full contrast — around 160
        // levels, which carries easily.
        punchAlpha: PLAYER_PUNCH,
        // A lit pane in front of the ink so the player answers to the scene's
        // light instead of sitting on it as a flat decal — it warms under the
        // midday sun and goes quiet at night, and the sheen slides across as the
        // camera moves. Interaction is untouched (see the glass notes in
        // CSS3DPanel). Meant to be felt rather than noticed; if you can point at
        // it, glassOpacity is too high.
        glass: true,
        glassOpacity: 0.20,
        glassRoughness: 0.30,
    });
    playerPanel.content.appendChild(playerContainer);
    refreshConnectorColor();
    playerPanel.setOnOutsideClick(() => { if (isExpanded) collapsePlayer(); });

    // Get elements (header/playlist/close removed — collapse via outside click)
    const prevBtn = playerContainer.querySelector('.player-prev') as HTMLButtonElement;
    const playBtn = playerContainer.querySelector('.player-play') as HTMLButtonElement;
    const nextBtn = playerContainer.querySelector('.player-next') as HTMLButtonElement;

    // Control buttons. Bind on POINTERUP, not click: the panel DOM lives behind
    // the WebGL canvas (pointer-events:none while modal), and on iOS WebKit the
    // synthesized `click` doesn't fire reliably for elements in the transformed
    // CSS3D subtree — but pointer events do (the waveform seek proves it). Using
    // pointerup makes every button behave like the waveform.
    const onTap = (btn: HTMLButtonElement, fn: () => void) => {
        btn.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            e.preventDefault();
            fn();
        });
    };
    // previousSong/nextSong read `isPlaying` (authoritative state) rather than
    // audioElement.paused which may be unreliable mid-transition.
    onTap(prevBtn, () => previousSong(isPlaying));
    onTap(playBtn, () => togglePlay());
    onTap(nextBtn, () => nextSong(isPlaying));
    const loopBtn = playerContainer.querySelector('.player-loop') as HTMLButtonElement;
    onTap(loopBtn, () => toggleLoop());

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

    // 'canplay' fires earlier than wavesurfer's 'ready' event (which waits for
    // full waveform decode). Using it as a play trigger makes song starts more
    // reliable — especially on mobile and after tab backgrounding where 'ready'
    // may be delayed by seconds or may never fire at all.
    audioElement.addEventListener('canplay', () => {
        if (!pendingPlayOnReady) return;
        pendingPlayOnReady = false;
        _isLoadingNewSong = false;
        // Let wavesurfer drive playback if it's available (keeps waveform in sync)
        if (wavesurfer) {
            wavesurfer.play().catch(() => audioElement?.play().catch(() => {}));
        } else {
            audioElement!.play().catch(() => {});
        }
    });

    // Safety net: if the audio errors out during load, clear the loading flag
    // so subsequent state changes aren't silently suppressed.
    audioElement.addEventListener('error', () => {
        _isLoadingNewSong = false;
        pendingPlayOnReady = false;
    });
}

// Read the real state from the audio element and update everything to match.
// Suppressed during song-load transitions to prevent the mid-load spurious
// 'pause' event from flipping isPlaying=false while a new track is queued.
function syncPlayState(): void {
    if (!audioElement) return;
    if (_isLoadingNewSong) return;  // Ignore transient pause events during src swap
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
    analyserCanvas.addEventListener('pointerleave', () => {
        if (seekDragging) seekDragging = false;
    });
    analyserCanvas.addEventListener('lostpointercapture', () => {
        seekDragging = false;
    });
    
    // Update time display
    wavesurfer.on('audioprocess', () => {
        updateTimeDisplay();
    });
    wavesurfer.on('seeking', () => {
        updateTimeDisplay();
    });
    wavesurfer.on('ready', () => {
        _isLoadingNewSong = false;  // Transition complete — re-enable syncPlayState
        updateTimeDisplay();
        updateWaveformColors();
        preloadAdjacentSongs();
        // Auto-play if a song switch requested it and canplay hasn't fired yet
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
        unlockAchievement('music');
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
        const firstUrl = playlist[0].file;
        wavesurfer.load(firstUrl);
        cachePeaksAfterReady(firstUrl);
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

/** Bar tone that contrasts with the panel ink fill, tracking the settings-menu
 *  palette the panel now uses: light fill by day → marine-blue bars, dark fill
 *  at night → white bars. Day = body.day-mode. */
function _waveBaseColor(alpha = 1): string {
    const day = document.body.classList.contains('day-mode');
    const c = day ? '10,37,64' : '255,255,255';
    return alpha >= 1 ? `rgb(${c})` : `rgba(${c},${alpha})`;
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

    // Skip canvas work while the player is expanding/collapsing. The player is
    // behind a CSS scale(0→1) transition so nothing is visible yet, and the
    // 64-bar canvas draw competes with the Three.js render loop for frame budget
    // during the camera zoom — causing the sustained stutter the pug zoom avoids.
    if (isAnimating) { analyserAnimId = requestAnimationFrame(drawAnalyser); return; }

    analyserCtx.clearRect(0, 0, width, height);

    // Get playback progress (0-1)
    let progress = 0;
    if (wavesurfer) {
        const dur = wavesurfer.getDuration();
        if (dur > 0) progress = wavesurfer.getCurrentTime() / dur;
    }
    const cursorX = progress * width;

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
            const weight = i < bufferLength * 0.25 ? 2.0 : 1.0;
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
            _beatKick = Math.min(1, jump / 0.25);
        } else {
            _beatKick *= BEAT_DECAY;
        }
    } else {
        // Idle state: small ambient bars
        for (let i = 0; i < bufferLength; i++) {
            analyserDataArray[i] = 8 + Math.sin(i * 0.3 + Date.now() * 0.001) * 6;
        }
        _musicIntensity *= 0.95;
        _beatKick *= BEAT_DECAY;
    }

    const gap = 1;
    const barWidth = (width - gap * (bufferLength - 1)) / bufferLength;
    const radius = Math.min(barWidth / 2, 2);
    const minBarH = 2;

    if (isPlaying) {
        // Playing: two passes — one fillStyle per pass (no per-bar string allocs).
        // Use globalAlpha for per-bar intensity; no rgba template strings or toFixed().
        analyserCtx.fillStyle = '#e53935';
        for (let i = 0; i < bufferLength; i++) {
            const value = analyserDataArray[i] / 255;
            const x = i * (barWidth + gap);
            if (x + barWidth * 0.5 > cursorX) continue;
            const barHeight = minBarH + value * (height - minBarH) * 0.85;
            const y = height - barHeight;
            analyserCtx.globalAlpha = 0.4 + value * 0.6;
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
        // Unplayed bars use the panel's text tone so they stay visible on both
        // the black (day) and white (night) ink fill. Played bars stay red.
        analyserCtx.fillStyle = _waveBaseColor();
        for (let i = 0; i < bufferLength; i++) {
            const value = analyserDataArray[i] / 255;
            const x = i * (barWidth + gap);
            if (x + barWidth * 0.5 <= cursorX) continue;
            const barHeight = minBarH + value * (height - minBarH) * 0.85;
            const y = height - barHeight;
            analyserCtx.globalAlpha = 0.1 + value * 0.25;
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
        analyserCtx.globalAlpha = 1.0;
    } else {
        // Idle: fixed alpha per group — build compound paths and call fill() once
        // per color (2 fill() calls total vs. 64 before).
        analyserCtx.fillStyle = 'rgba(229,57,53,0.35)';
        analyserCtx.beginPath();
        for (let i = 0; i < bufferLength; i++) {
            const value = analyserDataArray[i] / 255;
            const x = i * (barWidth + gap);
            if (x + barWidth * 0.5 > cursorX) continue;
            const barHeight = minBarH + value * (height - minBarH) * 0.85;
            const y = height - barHeight;
            analyserCtx.moveTo(x + radius, y);
            analyserCtx.lineTo(x + barWidth - radius, y);
            analyserCtx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
            analyserCtx.lineTo(x + barWidth, height);
            analyserCtx.lineTo(x, height);
            analyserCtx.lineTo(x, y + radius);
            analyserCtx.quadraticCurveTo(x, y, x + radius, y);
        }
        analyserCtx.fill();

        analyserCtx.fillStyle = _waveBaseColor(0.14);
        analyserCtx.beginPath();
        for (let i = 0; i < bufferLength; i++) {
            const value = analyserDataArray[i] / 255;
            const x = i * (barWidth + gap);
            if (x + barWidth * 0.5 <= cursorX) continue;
            const barHeight = minBarH + value * (height - minBarH) * 0.85;
            const y = height - barHeight;
            analyserCtx.moveTo(x + radius, y);
            analyserCtx.lineTo(x + barWidth - radius, y);
            analyserCtx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
            analyserCtx.lineTo(x + barWidth, height);
            analyserCtx.lineTo(x, height);
            analyserCtx.lineTo(x, y + radius);
            analyserCtx.quadraticCurveTo(x, y, x + radius, y);
        }
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

let isAnimating = false;  // Block resize during expand/collapse animation
const ANIM_DURATION = 700;  // ms — full line+panel sequence (waveform right-sizes after)

/** Live panel translucency (0..1) — 1 = opaque. Judging "see-through but still
 *  readable" needs the real sky behind it, so it is settable at runtime. */
export function setPlayerPanelPunch(v: number): void {
    playerPanel?.setPunchAlpha(v);
}

/** The connector line's colour — the panel's own fill, so the line reads as the
 *  panel reaching down to the radio rather than as a separate mark.
 *
 *  These are hard-coded rather than read back with getComputedStyle, which is
 *  what this did at first. That read is a FORCED SYNCHRONOUS STYLE RECALC, and
 *  it fired on the day/night flip — the one moment the whole stylesheet has just
 *  been invalidated by the class swap, over a CSS3D subtree with a composited
 *  surface per element. Paying a full synchronous recalc exactly then is the
 *  most expensive possible time to ask. Two constants and a note to keep them in
 *  step with .media-player.expanded cost nothing and stall nothing. */
const CONNECTOR_DAY = 0xd4d4d4;    // matches rgb(212,212,212) in style.css
const CONNECTOR_NIGHT = 0x142838;  // matches rgb(20,40,60)
let _connectorHex = CONNECTOR_NIGHT;
function refreshConnectorColor(): void {
    _connectorHex = document.body.classList.contains('day-mode') ? CONNECTOR_DAY : CONNECTOR_NIGHT;
}

/** Anchor the CSS3D panel above the radio's REST position (static — see the
 *  RADIO_REST_* note). Fixed pose so the panel never jitters with the beat.
 *  Also drives the connector line (down to the radio) + its colour, which is the
 *  panel's own fill: the line reads as the panel reaching down to the radio
 *  rather than as a separate mark drawn over the island. */
function syncPanelAnchor(): void {
    if (!playerPanel) return;
    playerPanel.setWorldPosition(RADIO_REST_X, RADIO_REST_Y + PLAYER_ANCHOR_UP, RADIO_REST_Z);
    // Reach down into the radio body (was stopping above the antenna).
    playerPanel.setConnectorTarget(RADIO_REST_X, RADIO_REST_Y - 0.10, RADIO_REST_Z);
    playerPanel.setConnectorColor(_connectorHex);
}

export function expandPlayer(): void {
    if (isExpanded || !playerContainer || !playerPanel) return;
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

    // Anchor + open the in-scene panel (the CSS3D panel owns the pop animation,
    // billboarding and the punch hole — no screen-space positioning here).
    syncPanelAnchor();
    playerPanel.open();

    // After the pop settles, right-size the waveform (matches old timing).
    setTimeout(() => {
        if (isExpanded) {
            isAnimating = false;
            if (wavesurfer) wavesurfer.setOptions({ height: 40 });
        }
    }, ANIM_DURATION + 50);
}

export function collapsePlayer(): void {
    if (!isExpanded || !playerContainer || !playerPanel) return;
    isExpanded = false;
    isAnimating = true;

    // Play expand sound (inverted)
    playUIBubbleExpand();

    // Zoom out from radio when above water
    if (!isUnderwater) {
        zoomOutFromRadio();
    }

    playerPanel.close(() => { isAnimating = false; });
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
    playerPanel?.requestRepaint();
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
    
    // Decide if we should auto-play: either forced or was already playing.
    // Use the authoritative `isPlaying` flag rather than audioElement.paused —
    // the element may already be pausing mid-transition, giving a false reading.
    const shouldPlay = forcePlay || isPlaying;
    const songFile = playlist[index].file;
    
    // Mark that a load is in progress so syncPlayState() ignores the transient
    // 'pause' event that HTMLAudioElement fires when its src is changed.
    _isLoadingNewSong = true;
    // Allow the upcoming song's 'finish' event to fire, even if the previous
    // song also ended (otherwise the second song end is swallowed by the guard).
    _songEndHandled = false;
    
    // Store intent so wavesurfer 'ready' / canplay handlers can auto-play
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
        // wavesurfer 7's load() internally replaces the decoded data of the
        // previous track — supplying `peaks` short-circuits the decode entirely.
        // We rely on that to keep at most one track's decoded PCM in memory at
        // a time. (Calling .empty() before .load() also fires its own 'ready'
        // event, which would consume `pendingPlayOnReady` before the real load
        // completes — breaking the song-end auto-advance.)
        const cachedPeaks = peaksCache.get(songFile);
        try {
            if (cachedPeaks) {
                // Skip wavesurfer's internal decode entirely.
                wavesurfer.load(songFile, cachedPeaks);
            } else {
                wavesurfer.load(songFile);
                cachePeaksAfterReady(songFile);
            }
        } catch {
            // Fallback if wavesurfer.load fails: set src directly
            _isLoadingNewSong = false;
            if (audioElement) {
                audioElement.src = songFile;
                if (shouldPlay) audioElement.play().catch(() => {});
            }
        }
    } else if (audioElement) {
        _isLoadingNewSong = false;
        audioElement.src = songFile;
        if (shouldPlay) audioElement.play().catch(() => {});
    }
    
    // Last-resort fallback: if neither 'canplay' nor wavesurfer 'ready' fires
    // (e.g. network timeout, locked screen on iOS), attempt playback after 3 s.
    // This timeout is intentionally generous — mobile browsers often delay media
    // events by 1-2 s when the tab is freshly foregrounded.
    if (shouldPlay && audioElement) {
        setTimeout(() => {
            if (pendingPlayOnReady && audioElement && audioElement.paused) {
                pendingPlayOnReady = false;
                _isLoadingNewSong = false;
                audioElement.play().catch(() => {});
            }
        }, 3000);
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

    // The panel is composited behind the canvas and the camera is static while
    // the user skips tracks — nudge the CSS3D layer so the new art/labels are
    // actually rasterised. The cover also decodes asynchronously, so repaint
    // again once it lands.
    playerPanel?.requestRepaint();
    const decoded = coverImg.decode?.();
    if (decoded) {
        const repaint = () => playerPanel?.requestRepaint();
        decoded.then(repaint, repaint);
    }

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
            // Inherit the current play/pause state rather than always starting
            // playback — if the user was paused, the new song loads paused too.
            loadSong(index, isPlaying);
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
    // The play↔pause glyph swap is a display:none/block flip inside the CSS3D
    // layer, which the compositor can serve from its existing tiles — same
    // stale-raster trap as the control icons (see CSS3DPanel.requestRepaint).
    playerPanel?.requestRepaint();
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

    // Keep the in-scene panel glued to the radio while it's open.
    if (isExpanded) syncPanelAnchor();

    // Check for day/night mode changes to update waveform colors
    const isDayMode = document.body.classList.contains('day-mode');
    if (isDayMode !== wasDayMode) {
        wasDayMode = isDayMode;
        updateWaveformColors();
        refreshConnectorColor();
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

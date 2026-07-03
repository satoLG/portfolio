/**
 * Debug — press H to toggle scene debug GUI
 *
 * Combines:
 *  - Performance panel (FPS, CPU, memory, camera position)
 *  - lil-gui panel with live controls for every scene object
 */

import { BufferGeometry, Group, Line, LineBasicMaterial, Vector3 } from "three";
import { webglContainer, camera, cameraForward } from "./Scene";
import { deltaTime } from "./Time";

// ── Performance panel ────────────────────────────────────────────────────────

export const debugging = false;
const axesSize = 0.06;

let showPanel = debugging;
export let showAll  = debugging;
export let showFps  = debugging;
export let showCpu  = debugging;
export let showMem  = debugging;
export let showPos  = debugging;
export let showAxes = debugging;
export const axes = new Group();
axes.visible = debugging;

export function changeShowAll(value: boolean): void { showAll = value; }

export function allVisible(value: boolean): void {
    showAll = value;
    fpsVisible(showAll); cpuVisible(showAll); memVisible(showAll);
    posVisible(showAll); axesVisible(showAll);
}
export function fpsVisible(value: boolean): void {
    showFps = value;
    showPanel = showFps || showCpu || showMem || showPos;
    debugPanel.style.display = showPanel ? "block" : "none";
    fpsDiv.style.display = showFps ? "block" : "none";
}
export function cpuVisible(value: boolean): void {
    showCpu = value;
    showPanel = showFps || showCpu || showMem || showPos;
    debugPanel.style.display = showPanel ? "block" : "none";
    cpuDiv.style.display = showCpu ? "block" : "none";
}
export function memVisible(value: boolean): void {
    showMem = value;
    showPanel = showFps || showCpu || showMem || showPos;
    debugPanel.style.display = showPanel ? "block" : "none";
    memDiv.style.display = showMem ? "block" : "none";
}
export function posVisible(value: boolean): void {
    showPos = value;
    showPanel = showFps || showCpu || showMem || showPos;
    debugPanel.style.display = showPanel ? "block" : "none";
    posDiv.style.display = showPos ? "block" : "none";
}
export function axesVisible(value: boolean): void {
    showAxes = value;
    axes.visible = showAxes;
}

const debugPanel = document.createElement("debug") as HTMLElement;
const fpsDiv = document.createElement("div");
const cpuDiv = document.createElement("div");
const memDiv = document.createElement("div");
const posDiv = document.createElement("div");

let fps = 0, frameTime = 0, deltaTimeSum = 0, cpuTime = 0, cpuUsage = 0;
let mem: Performance["memory"] | undefined = undefined;
let lastRefresh = 0, frameCount = 0, cpuSum = 0, cpuDeltaSum = 0, lastFrame = 0;
let _now: number, _axesVec: Vector3;

declare global {
    interface Performance {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number; };
    }
}

function initPerfPanel(): void {
    debugPanel.style.display = showPanel ? "block" : "none";
    fpsDiv.style.display = showFps ? "block" : "none";
    cpuDiv.style.display = showCpu ? "block" : "none";
    memDiv.style.display = showMem ? "block" : "none";
    posDiv.style.display = showPos ? "block" : "none";
    debugPanel.appendChild(fpsDiv);
    debugPanel.appendChild(cpuDiv);
    debugPanel.appendChild(memDiv);
    debugPanel.appendChild(posDiv);
    webglContainer.appendChild(debugPanel);

    function AxisLine(a: Vector3, b: Vector3, color: number): Line {
        return new Line(new BufferGeometry().setFromPoints([a, b]), new LineBasicMaterial({ color }));
    }
    axes.add(AxisLine(new Vector3(0,0,0), new Vector3(axesSize,0,0), 0xff0000));
    axes.add(AxisLine(new Vector3(0,0,0), new Vector3(0,axesSize,0), 0x00ff00));
    axes.add(AxisLine(new Vector3(0,0,0), new Vector3(0,0,axesSize), 0x0000ff));
    allVisible(showAll);
    lastRefresh = performance.now();
}

export function Update(): void {
    frameCount++;
    deltaTimeSum += deltaTime;
    _now = performance.now();
    cpuDeltaSum += _now - lastFrame;
    lastFrame = _now;
    if (lastRefresh + 500 <= _now) {
        frameTime  = deltaTimeSum / frameCount;
        fps        = Math.round(1 / frameTime * 10) / 10;
        frameTime  = Math.round(frameTime * 10000) / 10;
        cpuTime    = Math.round(cpuSum / frameCount * 10) / 10;
        cpuUsage   = Math.round(cpuTime / (cpuDeltaSum / frameCount) * 1000) / 10;
        frameCount = 0; deltaTimeSum = 0; cpuSum = 0; cpuDeltaSum = 0;
        mem = performance.memory;
        lastRefresh = _now;
    }
    fpsDiv.textContent = "FPS: " + fps + " (" + frameTime + " MS)";
    cpuDiv.textContent = "CPU: " + cpuTime + " MS (" + cpuUsage + "%)";
    memDiv.textContent = mem
        ? "Memory: " + Math.round(mem.usedJSHeapSize / 1048576 * 10) / 10 + " MB / " + Math.round(mem.jsHeapSizeLimit / 104857.6) / 10 + " MB"
        : "Memory: cannot measure";
    posDiv.textContent = "Position: " + Math.round(camera.position.x * 10) / 10 + ", " + Math.round(camera.position.y * 10) / 10 + ", " + Math.round(camera.position.z * 10) / 10;
    _axesVec = new Vector3().copy(cameraForward);
    axes.position.set(_axesVec.x, _axesVec.y, _axesVec.z);
}

let beginTime = 0;
export function Begin(): void { beginTime = performance.now(); }
export function End(): void   { cpuSum += performance.now() - beginTime; }

// ── Scene GUI ────────────────────────────────────────────────────────────────

import GUI from 'lil-gui';
import { Color, Object3D } from 'three';
import {
    island,
    firecamp,
    tree,
    bush,
    bushRadio,
    bushRadio2,
    bushPug,
    radio,
    sword,
    pug,
    tent,
    dogBed,
    littleRocks,
    apple1,
    apple2,
    apple3,
    mossRock1,
    mossRock2a,
    mossRock2b,
    mossRock3a,
    mossRock3b,
    mossRock3c,
    foldingTrayTable,
    tentDogBed,
    rugRound,
    lantern,
    dogBowl,
    dogBiscuit,
    clusterMainPatches,
    clusterTreePatches,
    proceduralGrassMesh,
    respawnFoliage,
    setGrassCount,
    exclRadii,
    setExclRadius,
    grassYOffset,
    setGrassYOffset,
    grassEdgePadding,
    setGrassEdgePadding,
    grassEdgeFalloffRadius,
    setGrassEdgeFalloffRadius,
    grassMinEdgeScale,
    setGrassMinEdgeScale,
    grassShadowOpacity,
    setShadowFloorOpacity,
    grassShadowColor,
    grassShadowYOffset,
    setShadowFloorYOffset,
    grassShadowSpread,
    setShadowFloorSpread,
    setShadowFloorColor,
    setGrassColorBase,
    setGrassColorTip,
    islandSurfaceGrassColor,
    islandSurfaceGrassStrength,
    islandSurfaceGrassGreenThreshold,
    islandSurfaceGrassNormalThreshold,
    islandSurfaceGrassMaskSoftness,
    islandSurfaceGrassTopFillStrength,
    islandSurfaceGrassTopFillNormalThreshold,
    islandSurfacePointLightInfluence,
    islandCampfireGroundColor,
    islandCampfireGroundRadius,
    islandCampfireGroundSoftness,
    islandCampfireGroundStrength,
    islandCampfireGroundNormalThreshold,
    islandRockMatchColor,
    islandRockMatchStrength,
    islandRockMatchSaturation,
    islandRockMatchBrightness,
    islandRockMatchColorTint,
    islandRockMatchGreenThreshold,
    islandRockMatchGreenStrength,
    islandRockMatchGreenColor,
    setIslandRockMatchColor,
    setIslandRockMatchStrength,
    setIslandRockMatchSaturation,
    setIslandRockMatchBrightness,
    setIslandRockMatchColorTint,
    setIslandRockMatchGreenThreshold,
    setIslandRockMatchGreenStrength,
    setIslandRockMatchGreenColor,
    setIslandSurfaceGrassColor,
    setIslandSurfaceGrassStrength,
    setIslandSurfaceGrassGreenThreshold,
    setIslandSurfaceGrassNormalThreshold,
    setIslandSurfaceGrassMaskSoftness,
    setIslandSurfaceGrassTopFillStrength,
    setIslandSurfaceGrassTopFillNormalThreshold,
    setIslandSurfacePointLightInfluence,
    setIslandCampfireGroundColor,
    setIslandCampfireGroundRadius,
    setIslandCampfireGroundSoftness,
    setIslandCampfireGroundStrength,
    setIslandCampfireGroundNormalThreshold,
    foliageWindStrength,
    setFoliageWindStrength,
    grassWobbleStrength,
    setGrassWobbleStrength,
    grassMaxHeight,
    setGrassMaxHeight,
    appleWindStrength,
    setAppleWindStrength,
    appleSwingStiffness,
    setAppleSwingStiffness,
    appleSwingDamping,
    setAppleSwingDamping,
    appleClickImpulse,
    setAppleClickImpulse,
    type FoliageCluster,
} from '../scene/Island';
import * as Island from '../scene/Island';
import { APPLE_RESPAWN_FADE_DURATION, APPLE_CLICK_COUNT_TO_FALL, MAX_GROUND_APPLES, APPLE_RESPAWN_DELAY } from '../scene/config/IslandConfig';
import { physicsConfig, refreshContactMaterial, setDebugEnabled, rebuildPhysicsWorld } from '../scene/Physics';
import {
    oceanAbsorptionUniform,
    normalMapScaleUniform,
    normalMapStrengthUniform,
    waveVelocity1Uniform,
    waveVelocity2Uniform,
    edgeFadeDistanceUniform,
    horizonFadeStartUniform,
    horizonFadeEndUniform,
    surfaceWaveAmplitudeUniform,
    surfaceWaveLengthUniform,
    surfaceWaveSpeedUniform,
    surfaceWaveRangeUniform,
    surfaceWaveForwardBiasUniform,
    surfaceWaveSteepnessUniform,
    surfaceColorUniform,
    surfaceOpacityUniform,
    reflectionFresnelPowerUniform,
    reflectionFloorUniform,
    skyReflectionBrightnessUniform,
    skyReflFalloffUniform,
    foamCenterOffsetUniform,
    foamRadiusUniform,
    foamWidthUniform,
    foamIntensityUniform,
    foamAnimSpeedUniform,
    foamEdgeNoiseAmtUniform,
    foamWobbleAmtUniform,
    foamWobbleFreqUniform,
    foamWobbleSpeedUniform,
    foamLineFrequencyUniform,
    foamLineThicknessUniform,
    foamLineCountUniform,
    foamLineBreakupUniform,
    foamLineColorUniform,
    waterBlurStrengthUniform,
    waterBlurRadiusUniform,
    waterBlurOpacityUniform,
    waterlineCompositeOpacityUniform,
    waterlineYUniform,
    edgeFoamWidthUniform,
    edgeFoamIntensityUniform,
    edgeFoamUnderwaterMulUniform,
    edgeFoamColorUniform,
    edgeFoamFadeStartZUniform,
    edgeFoamFadeEndZUniform,
    underwaterFogDistUniform,
} from '../materials/OceanMaterial';
import * as WindLines from '../effects/WindLines';
import { fireLightConfig } from '../scene/Fire';
import * as SeaFloorDecor from '../scene/SeaFloorDecor';
import {
    setDistortion as setUnderwaterDistortion,
    setDistortionSpeed as setUnderwaterSpeed,
    setDistortionScale as setUnderwaterScale,
    setDistortionEdgeFade as setUnderwaterEdgeFade,
} from '../effects/PostProcess';
import {
    distortionStrength as DISTORTION_STRENGTH,
    distortionSpeed as DISTORTION_SPEED,
    distortionScale as DISTORTION_SCALE,
    distortionEdgeFade as DISTORTION_EDGE_FADE,
    rippleSpeed as RIPPLE_SPEED,
    rippleLifetime as RIPPLE_LIFETIME,
    rippleWidth as RIPPLE_WIDTH,
    rippleNormalStrength as RIPPLE_NORMAL_STRENGTH,
    rippleMaxClickDistance as RIPPLE_MAX_CLICK_DISTANCE,
    jellyfishLightConfig,
    edgeFoamFadeStartZDesktop as CFG_EF_FADE_START_Z_DESKTOP,
    edgeFoamFadeEndZDesktop as CFG_EF_FADE_END_Z_DESKTOP,
    edgeFoamFadeStartZMobile as CFG_EF_FADE_START_Z_MOBILE,
    edgeFoamFadeEndZMobile as CFG_EF_FADE_END_Z_MOBILE,
} from '../scene/config/OceanConfig';
import { phoneZoomConfig, cabanaZoomConfig, cabanaRevealConfig, mainCameraConfig, isWebPageMode, toggleCameraMode } from './Control';
import { cabanaDomeRadius } from '../scene/config/CabanaConfig';
import { mobileFov, mobileBreakpointWidth, aboveWaterBottomY as CFG_ABOVE_BOTTOM, aboveWaterBottomYMobile as CFG_ABOVE_BOTTOM_MOBILE, underwaterTopY as CFG_UNDER_TOP, underwaterTopYMobile as CFG_UNDER_TOP_MOBILE } from '../scene/config/CameraConfig';
import { SetFOV, scene as threeScene } from './Scene';
import { phoneScreenConfig, updateOverlayStyle } from './PhoneScreen';
import { grassColorBase as _grassColorBase, grassColorTip as _grassColorTip } from '../scene/ProceduralGrass';

let gui: GUI | null = null;
let visible = false;

/** Shared by the 'H' keydown shortcut and the on-screen tap target below. */
function toggleVisible(): void {
    visible = !visible;
    visible ? gui?.show() : gui?.hide();
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Round to 4 decimal places — enough precision for copy-paste */
const r = (n: number) => Math.round(n * 10000) / 10000;

function debounce(fn: () => void, ms: number): () => void {
    let timer: ReturnType<typeof setTimeout>;
    return () => { clearTimeout(timer); timer = setTimeout(fn, ms); };
}

// ─── object folder ──────────────────────────────────────────────────────────

interface ObjOpts {
    /** Half-width of the position sliders. Ignored when smaller than
     *  POS_RANGE_DEFAULT — caller-tightened ranges get widened automatically
     *  so testing in the GUI is never blocked by an arbitrary cap. */
    posRange?: number;
    /** [min, max] for the uniform scale slider. Omit to hide scale.
     *  Values get widened against SCALE_RANGE_DEFAULT for the same reason. */
    scaleRange?: [number, number];
    /** Which rotation axes to expose. Omit to hide rotation. */
    rotAxes?: Array<'x' | 'y' | 'z'>;
}

// Generous defaults so every object's sliders cover anything the user might
// want to try while iterating in the GUI. Per-call overrides can only WIDEN
// these — never narrow them — because tight caps tend to block exploration.
const POS_RANGE_DEFAULT = 50;
const SCALE_RANGE_DEFAULT: [number, number] = [0.001, 20];

/**
 * Builds a folder with position (X/Y/Z), optional uniform scale, and optional
 * per-axis rotation sliders. Console-logs a copy-paste snippet on every change.
 */
function addObjectFolder(
    parent: GUI,
    label: string,
    obj: Object3D,
    opts: ObjOpts = {},
) {
    const posRange = Math.max(opts.posRange ?? 0, POS_RANGE_DEFAULT);
    const scaleRange: [number, number] | undefined = opts.scaleRange
        ? [
            Math.min(opts.scaleRange[0], SCALE_RANGE_DEFAULT[0]),
            Math.max(opts.scaleRange[1], SCALE_RANGE_DEFAULT[1]),
        ]
        : undefined;
    const { rotAxes } = opts;
    const folder = parent.addFolder(label);

    // ── log helper ──
    const logAll = () => {
        const pos = `pos=(${r(obj.position.x)}, ${r(obj.position.y)}, ${r(obj.position.z)})`;
        const sc  = scaleRange ? `  scale=${r(obj.scale.x)}` : '';
        let   rot = '';
        if (rotAxes && rotAxes.length > 0) {
            const parts = rotAxes.map(a => `${a}=${r(obj.rotation[a])}`).join(', ');
            rot = `  rot=(${parts})`;
        }
        console.log(`[Debug] ${label}  ${pos}${sc}${rot}`);
    };

    // ── position ──
    const cx = r(obj.position.x);
    const cy = r(obj.position.y);
    const cz = r(obj.position.z);

    const pos = {
        get x() { return r(obj.position.x); },
        set x(v: number) { obj.position.x = v; logAll(); },
        get y() { return r(obj.position.y); },
        set y(v: number) { obj.position.y = v; logAll(); },
        get z() { return r(obj.position.z); },
        set z(v: number) { obj.position.z = v; logAll(); },
    };
    folder.add(pos, 'x', cx - posRange, cx + posRange, 0.001).name('Pos X').listen();
    folder.add(pos, 'y', cy - posRange, cy + posRange, 0.001).name('Pos Y').listen();
    folder.add(pos, 'z', cz - posRange, cz + posRange, 0.001).name('Pos Z').listen();

    // ── scale ──
    if (scaleRange) {
        const sc = {
            get scale() { return r(obj.scale.x); },
            set scale(v: number) { obj.scale.setScalar(v); logAll(); },
        };
        folder.add(sc, 'scale', scaleRange[0], scaleRange[1], 0.001).name('Scale').listen();
    }

    // ── rotation ──
    if (rotAxes && rotAxes.length > 0) {
        const PI = Math.PI;
        for (const axis of rotAxes) {
            const proxy: Record<string, number> = {};
            Object.defineProperty(proxy, axis, {
                get: ()  => r((obj.rotation as any)[axis]),
                set: (v: number) => { (obj.rotation as any)[axis] = v; logAll(); },
                enumerable: true,
                configurable: true,
            });
            folder
                .add(proxy, axis, -PI, PI, 0.001)
                .name(`Rot ${axis.toUpperCase()}`)
                .listen();
        }
    }

    folder.close();
    return folder;
}

/**
 * Cluster folder — Center X/Z, Min/Max Radius, Count.
 * Changes update the cluster object then call respawnFoliage() after a 300 ms debounce.
 * DEPRECATED — no longer used, kept to avoid breaking code that may reference it.
 */
function addClusterFolder(
    _gui: GUI,
    _label: string,
    _which: FoliageCluster,
    _cluster: object,
    _countKey: string,
    _setCount: (n: number) => void,
) { /* no-op */ }

// ─── public API ─────────────────────────────────────────────────────────────

export function Start(): void {
    initPerfPanel();

    // Poll until foliage patches exist, then build the GUI
    const tryBuild = () => {
        if (!proceduralGrassMesh && clusterMainPatches.length === 0 && clusterTreePatches.length === 0) {
            requestAnimationFrame(tryBuild);
            return;
        }
        buildGUI();
    };
    requestAnimationFrame(tryBuild);

    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'h' || e.key === 'H') toggleVisible();
    });
}

function injectLevaCSS(): void {
    if (document.getElementById('leva-style-override')) return;
    const style = document.createElement('style');
    style.id = 'leva-style-override';
    style.textContent = `
/* ════════════════════════════════════════════════════════════════════════════
   Leva-inspired theme for lil-gui
   Colors & metrics lifted from pmndrs/leva default theme (stitches.config)
   ════════════════════════════════════════════════════════════════════════════ */

.lil-gui {
  /* ── Leva palette ── */
  --background-color: #181c20;
  --text-color: #fefefe;
  --title-background-color: #292d39;
  --title-text-color: #fefefe;
  --widget-color: #373c4b;
  --hover-color: #424856;
  --focus-color: #4d5568;
  --number-color: #3c93ff;
  --string-color: #a2db3c;

  /* ── Typography ── */
  --font-size: 11px;
  --input-font-size: 11px;
  --font-family: system-ui, sans-serif;
  --font-family-mono: ui-monospace, SFMono-Regular, Menlo, 'Roboto Mono', monospace;

  /* ── Geometry ── */
  --padding: 6px;
  --spacing: 2px;
  --widget-height: 24px;
  --title-height: 28px;
  --name-width: 40%;
  --slider-knob-width: 2px;
  --slider-input-width: 27%;
  --widget-border-radius: 4px;
  --folder-indent: 8px;
  --checkbox-size: 16px;
  --scrollbar-width: 5px;
}

/* ── Root panel ── */
.lil-gui.lil-root {
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 0 12px 0 #00000066;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  max-height: calc(100vh - 76px - 16px);
}

/* ── Title bar ── */
.lil-gui.lil-root > .lil-title {
  background: #292d39;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.3px;
  height: 36px;
  line-height: 36px;
  padding: 0 12px;
  border-bottom: 1px solid #373c4b;
}

/* ── Top-level folder titles ── */
.lil-gui.lil-root > .lil-children > .lil-gui > .lil-title {
  background: #212630;
  border-color: #2a3040;
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  color: #8c92a4;
  height: 28px;
  line-height: 28px;
  padding: 0 10px;
}

@media (hover: hover) {
  body:not(.lil-dragging) .lil-gui.lil-root > .lil-children > .lil-gui > .lil-title:hover {
    background: #262c38;
    color: #b8bdd0;
  }
}

/* ── Nested folder titles ── */
.lil-gui .lil-gui .lil-gui > .lil-title {
  font-weight: 500;
  font-size: 11px;
  color: #8c92a4;
  padding-left: 4px;
}

/* ── Nested folder left border ── */
.lil-gui .lil-gui .lil-gui > .lil-children {
  border-left-color: #373c4b;
}

/* ── Scrollbar ── */
.lil-gui.lil-root > .lil-children::-webkit-scrollbar-thumb {
  background: #535760;
  border-radius: 4px;
}

/* ── Controller rows ── */
.lil-controller {
  padding: 0 8px;
  margin: 1px 0;
  min-height: 26px;
}
.lil-controller > .lil-name {
  color: #8c92a4;
  font-size: 10.5px;
}

/* ── Slider track ── */
.lil-controller.lil-number .lil-slider {
  border-radius: 4px;
  height: 22px;
  background: #373c4b;
}

/* ── Slider fill — Leva accent gradient ── */
.lil-controller.lil-number .lil-fill {
  background: linear-gradient(90deg, #0066dc, #007bff);
  border-right-color: #3c93ff;
  border-radius: 4px 0 0 4px;
}

@media (hover: hover) {
  .lil-controller.lil-number .lil-slider:hover {
    background: #424856;
  }
}

/* ── Number inputs ── */
.lil-gui input[type=text],
.lil-gui input[type=number] {
  background: #373c4b;
  border-radius: 4px;
  color: #fefefe;
  height: 22px;
}
.lil-gui input[type=text]:focus,
.lil-gui input[type=number]:focus {
  background: #4d5568;
  box-shadow: 0 0 0 1px #007bff;
}

/* ── Checkbox ── */
.lil-gui input[type=checkbox] {
  border-radius: 4px;
  background: #373c4b;
}
.lil-gui input[type=checkbox]:checked {
  background: #007bff;
}

/* ── Select / option display ── */
.lil-controller.lil-option .lil-display {
  border-radius: 4px;
  background: #373c4b;
  height: 22px;
  line-height: 22px;
  font-size: 10.5px;
}
@media (hover: hover) {
  .lil-controller.lil-option .lil-widget:hover .lil-display {
    background: #424856;
  }
}

/* ── Buttons (e.g. Copy Config) ── */
.lil-gui .lil-controller button {
  background: #007bff;
  color: #fff;
  border-radius: 4px;
  height: 20px;
  padding: 0 10px;
  font-weight: 600;
  font-size: 9px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  transition: background 0.15s ease, transform 0.1s ease;
}
@media (hover: hover) {
  .lil-gui .lil-controller button:hover {
    background: #3c93ff;
  }
  .lil-gui .lil-controller button:focus {
    box-shadow: 0 0 0 2px #0066dc88;
  }
}
.lil-gui .lil-controller button:active {
  background: #0066dc;
  transform: scale(0.97);
}

/* ── Color display ── */
.lil-controller.lil-color .lil-display {
  border-radius: 4px;
  height: 22px;
}

/* ── Transition for folder open/close ── */
.lil-gui.lil-transition > .lil-children {
  transition-duration: 250ms;
}

/* ── Panel close animation (tweak) ── */
.lil-gui.lil-closed > .lil-children {
  transform: translateY(-5px);
}
`;
    document.head.appendChild(style);
}

function buildGUI(): void {
    injectLevaCSS();
    gui = new GUI({ title: 'Debug  [H]', width: 300 });
    gui.domElement.style.position = 'fixed';
    gui.domElement.style.top = '76px';   // below the site-header (~74px tall)
    gui.domElement.style.right = '8px';
    gui.domElement.style.zIndex = '9999';
    // Prevent wheel events from reaching the canvas/scene
    gui.domElement.addEventListener('wheel', (e: WheelEvent) => { e.stopPropagation(); }, { passive: false });

    // ── Top-level group folders (SKY → SURFACE → OCEAN → SEAFLOOR → CAMERA → PHYSICS) ──
    const skyFolder      = gui.addFolder('Sky');
    const surfaceFolder  = gui.addFolder('Surface');
    const oceanFolder    = gui.addFolder('Ocean');
    const seafloorFolder = gui.addFolder('Seafloor');
    const cameraFolder   = gui.addFolder('Camera');
    const physicsFolder  = gui.addFolder('Physics');
    physicsFolder.close();

    // Fog distortion state — must be declared before copy actions
    const _fogState = {
        distortion: DISTORTION_STRENGTH,
        speed:      DISTORTION_SPEED,
        scale:      DISTORTION_SCALE,
        edgeFade:   DISTORTION_EDGE_FADE,
    };

    // ── Foliage color state (hoisted here so copyConfig can read it) ─────────────
    const LS_KEY_GRASS = 'island-grass-colors-v2';
    const _storedColors = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY_GRASS) ?? '{}'); } catch { return {}; } })();
    const foliageColorState = {
        baseColor: _storedColors.baseColor ?? _grassColorBase.getHexString().replace(/^/, '#'),
        tipColor:  _storedColors.tipColor  ?? _grassColorTip.getHexString().replace(/^/, '#'),
    };

    // ── Copy Config ───────────────────────────────────────────────────────────
    const actions = {
        copyConfig: () => {
            const f = (n: number) => n.toFixed(4);
            const ip = island.position;
            const content = [
                `// src/scene/IslandConfig.ts`,
                `// Island placement configuration — generated by Debug.`,
                `// Paste this entire file to replace src/scene/IslandConfig.ts`,
                ``,
                `// ── Positions ─────────────────────────────────────────────────────────────────`,
                `export const islandPosition = { x: ${f(ip.x)}, y: ${f(ip.y)}, z: ${f(ip.z)} };`,
                `export const firecampOffset = { x: ${f(firecamp.position.x - ip.x)}, y: ${f(firecamp.position.y - ip.y)}, z: ${f(firecamp.position.z - ip.z)} };`,
                `export const treeOffset = { x: ${f(tree.position.x - ip.x)}, y: ${f(tree.position.y - ip.y)}, z: ${f(tree.position.z - ip.z)} };`,
                `export const bushOffset = { x: ${f(bush.position.x - ip.x)}, y: ${f(bush.position.y - ip.y)}, z: ${f(bush.position.z - ip.z)} };`,
                `export const bushRadioOffset = { x: ${f(bushRadio.position.x - ip.x)}, y: ${f(bushRadio.position.y - ip.y)}, z: ${f(bushRadio.position.z - ip.z)} };`,
                `export const bushRadio2Offset = { x: ${f(bushRadio2.position.x - ip.x)}, y: ${f(bushRadio2.position.y - ip.y)}, z: ${f(bushRadio2.position.z - ip.z)} };`,
                `export const bushPugOffset   = { x: ${f(bushPug.position.x - ip.x)}, y: ${f(bushPug.position.y - ip.y)}, z: ${f(bushPug.position.z - ip.z)} };`,
                `export const radioOffset    = { x: ${f(radio.position.x - ip.x)}, y: ${f(radio.position.y - ip.y)}, z: ${f(radio.position.z - ip.z)} };`,
                `export const swordOffset    = { x: ${f(sword.position.x - ip.x)}, y: ${f(sword.position.y - ip.y)}, z: ${f(sword.position.z - ip.z)} };`,
                `export const pugOffset      = { x: ${f(pug.position.x - ip.x)}, y: ${f(pug.position.y - ip.y)}, z: ${f(pug.position.z - ip.z)} };`,
                `export const tentOffset     = { x: ${f(tent.position.x - ip.x)}, y: ${f(tent.position.y - ip.y)}, z: ${f(tent.position.z - ip.z)} };`,
                `export const dogBedOffset      = { x: ${f(dogBed.position.x - ip.x)}, y: ${f(dogBed.position.y - ip.y)}, z: ${f(dogBed.position.z - ip.z)} };`,
                `export const littleRocksOffset = { x: ${f(littleRocks.position.x - ip.x)}, y: ${f(littleRocks.position.y - ip.y)}, z: ${f(littleRocks.position.z - ip.z)} };`,
                `export const phoneOffset       = { x: ${f(Island.phone.position.x - ip.x)}, y: ${f(Island.phone.position.y - ip.y)}, z: ${f(Island.phone.position.z - ip.z)} };`,
                `export const apple1Offset      = { x: ${f(apple1.position.x - ip.x)}, y: ${f(apple1.position.y - ip.y)}, z: ${f(apple1.position.z - ip.z)} };`,
                `export const apple2Offset      = { x: ${f(apple2.position.x - ip.x)}, y: ${f(apple2.position.y - ip.y)}, z: ${f(apple2.position.z - ip.z)} };`,
                `export const apple3Offset      = { x: ${f(apple3.position.x - ip.x)}, y: ${f(apple3.position.y - ip.y)}, z: ${f(apple3.position.z - ip.z)} };`,
                `export const mossRock1Offset   = { x: ${f(mossRock1.position.x  - ip.x)}, y: ${f(mossRock1.position.y  - ip.y)}, z: ${f(mossRock1.position.z  - ip.z)} };`,
                `export const mossRock2aOffset  = { x: ${f(mossRock2a.position.x - ip.x)}, y: ${f(mossRock2a.position.y - ip.y)}, z: ${f(mossRock2a.position.z - ip.z)} };`,
                `export const mossRock2bOffset  = { x: ${f(mossRock2b.position.x - ip.x)}, y: ${f(mossRock2b.position.y - ip.y)}, z: ${f(mossRock2b.position.z - ip.z)} };`,
                `export const mossRock3aOffset  = { x: ${f(mossRock3a.position.x - ip.x)}, y: ${f(mossRock3a.position.y - ip.y)}, z: ${f(mossRock3a.position.z - ip.z)} };`,
                `export const mossRock3bOffset  = { x: ${f(mossRock3b.position.x - ip.x)}, y: ${f(mossRock3b.position.y - ip.y)}, z: ${f(mossRock3b.position.z - ip.z)} };`,
                `export const mossRock3cOffset  = { x: ${f(mossRock3c.position.x - ip.x)}, y: ${f(mossRock3c.position.y - ip.y)}, z: ${f(mossRock3c.position.z - ip.z)} };`,
                `export const foldingTrayTableOffset = { x: ${f(foldingTrayTable.position.x - ip.x)}, y: ${f(foldingTrayTable.position.y - ip.y)}, z: ${f(foldingTrayTable.position.z - ip.z)} };`,
                `export const tentDogBedOffset       = { x: ${f(tentDogBed.position.x       - ip.x)}, y: ${f(tentDogBed.position.y       - ip.y)}, z: ${f(tentDogBed.position.z       - ip.z)} };`,
                `export const rugRoundOffset         = { x: ${f(rugRound.position.x         - ip.x)}, y: ${f(rugRound.position.y         - ip.y)}, z: ${f(rugRound.position.z         - ip.z)} };`,
                `export const lanternOffset          = { x: ${f(lantern.position.x          - ip.x)}, y: ${f(lantern.position.y          - ip.y)}, z: ${f(lantern.position.z          - ip.z)} };`,
                `export const dogBowlOffset          = { x: ${f(dogBowl.position.x          - ip.x)}, y: ${f(dogBowl.position.y          - ip.y)}, z: ${f(dogBowl.position.z          - ip.z)} };`,
                `export const dogBiscuitOffset       = { x: ${f(dogBiscuit.position.x       - ip.x)}, y: ${f(dogBiscuit.position.y       - ip.y)}, z: ${f(dogBiscuit.position.z       - ip.z)} };`,
                ``,
                `// ── Scales ────────────────────────────────────────────────────────────────────`,
                `export const islandScale      = ${f(island.scale.x)};`,
                `export const firecampScale    = ${f(firecamp.scale.x)};`,
                `export const treeScale    = ${f(tree.scale.x)};`,
                `export const bushScale    = ${f(bush.scale.x)};`,
                `export const bushRadioScale = ${f(bushRadio.scale.x)};`,
                `export const bushRadio2Scale = ${f(bushRadio2.scale.x)};`,
                `export const bushPugScale   = ${f(bushPug.scale.x)};`,
                `export const radioScale       = ${f(radio.scale.x)};`,
                `export const swordScale       = ${f(sword.scale.x)};`,
                `export const pugScale         = ${f(pug.scale.x)};`,
                `export const tentScale        = ${f(tent.scale.x)};`,
                `export const dogBedScale      = ${f(dogBed.scale.x)};`,
                `export const littleRocksScale = ${f(littleRocks.scale.x)};`,
                `export const phoneScale       = ${f(Island.phone.scale.x)};`,
                `export const apple1Scale      = ${f(apple1.scale.x)};`,
                `export const apple2Scale      = ${f(apple2.scale.x)};`,
                `export const apple3Scale      = ${f(apple3.scale.x)};`,
                `export const mossRock1Scale   = ${f(mossRock1.scale.x)};`,
                `export const mossRock2aScale  = ${f(mossRock2a.scale.x)};`,
                `export const mossRock2bScale  = ${f(mossRock2b.scale.x)};`,
                `export const mossRock3aScale  = ${f(mossRock3a.scale.x)};`,
                `export const mossRock3bScale  = ${f(mossRock3b.scale.x)};`,
                `export const mossRock3cScale  = ${f(mossRock3c.scale.x)};`,
                `export const foldingTrayTableScale = ${f(foldingTrayTable.scale.x)};`,
                `export const tentDogBedScale       = ${f(tentDogBed.scale.x)};`,
                `export const rugRoundScale         = ${f(rugRound.scale.x)};`,
                `export const lanternScale          = ${f(lantern.scale.x)};`,
                `export const dogBowlScale          = ${f(dogBowl.scale.x)};`,
                `export const dogBiscuitScale       = ${f(dogBiscuit.scale.x)};`,
                ``,
                `// ── Rotations ─────────────────────────────────────────────────────────────────`,
                `export const treeRotY   = ${f(tree.rotation.y)};`,
                `export const bushRotY   = ${f(bush.rotation.y)};`,
                `export const bushRadioRotY = ${f(bushRadio.rotation.y)};`,
                `export const bushRadio2RotY = ${f(bushRadio2.rotation.y)};`,
                `export const bushPugRotY   = ${f(bushPug.rotation.y)};`,
                `export const radioRotY      = ${f(radio.rotation.y)};`,
                `export const swordRot       = { x: ${f(sword.rotation.x)}, y: ${f(sword.rotation.y)}, z: ${f(sword.rotation.z)} };`,
                `export const pugRotY        = ${f(pug.rotation.y)};`,
                `export const tentRotY       = ${f(tent.rotation.y)};`,
                `export const dogBedRotY     = ${f(dogBed.rotation.y)};`,
                `export const littleRocksRot = { x: ${f(littleRocks.rotation.x)}, y: ${f(littleRocks.rotation.y)}, z: ${f(littleRocks.rotation.z)} };`,
                `export const phoneRot       = { x: ${f(Island.phone.rotation.x)}, y: ${f(Island.phone.rotation.y)}, z: ${f(Island.phone.rotation.z)} };`,
                `export const apple1RotY     = ${f(apple1.rotation.y)};`,
                `export const apple2RotY     = ${f(apple2.rotation.y)};`,
                `export const apple3RotY     = ${f(apple3.rotation.y)};`,
                `export const mossRock1Rot   = { x: ${f(mossRock1.rotation.x)},  y: ${f(mossRock1.rotation.y)},  z: ${f(mossRock1.rotation.z)} };`,
                `export const mossRock2aRot  = { x: ${f(mossRock2a.rotation.x)}, y: ${f(mossRock2a.rotation.y)}, z: ${f(mossRock2a.rotation.z)} };`,
                `export const mossRock2bRot  = { x: ${f(mossRock2b.rotation.x)}, y: ${f(mossRock2b.rotation.y)}, z: ${f(mossRock2b.rotation.z)} };`,
                `export const mossRock3aRot  = { x: ${f(mossRock3a.rotation.x)}, y: ${f(mossRock3a.rotation.y)}, z: ${f(mossRock3a.rotation.z)} };`,
                `export const mossRock3bRot  = { x: ${f(mossRock3b.rotation.x)}, y: ${f(mossRock3b.rotation.y)}, z: ${f(mossRock3b.rotation.z)} };`,
                `export const mossRock3cRot  = { x: ${f(mossRock3c.rotation.x)}, y: ${f(mossRock3c.rotation.y)}, z: ${f(mossRock3c.rotation.z)} };`,
                `export const foldingTrayTableRot = { x: ${f(foldingTrayTable.rotation.x)}, y: ${f(foldingTrayTable.rotation.y)}, z: ${f(foldingTrayTable.rotation.z)} };`,
                `export const tentDogBedRot       = { x: ${f(tentDogBed.rotation.x)},       y: ${f(tentDogBed.rotation.y)},       z: ${f(tentDogBed.rotation.z)} };`,
                `export const rugRoundRot         = { x: ${f(rugRound.rotation.x)},         y: ${f(rugRound.rotation.y)},         z: ${f(rugRound.rotation.z)} };`,
                `export const lanternRot          = { x: ${f(lantern.rotation.x)},          y: ${f(lantern.rotation.y)},          z: ${f(lantern.rotation.z)} };`,
                `export const dogBowlRot          = { x: ${f(dogBowl.rotation.x)},          y: ${f(dogBowl.rotation.y)},          z: ${f(dogBowl.rotation.z)} };`,
                `export const dogBiscuitRot       = { x: ${f(dogBiscuit.rotation.x)},       y: ${f(dogBiscuit.rotation.y)},       z: ${f(dogBiscuit.rotation.z)} };`,
                ``,
                `// ── Island surface grass filter ──────────────────────────────────────────────`,
                `export const ISLAND_SURFACE_GRASS_COLOR = '${Island.islandSurfaceGrassColor}'; // sRGB hex`,
                `export const ISLAND_SURFACE_GRASS_STRENGTH = ${Island.islandSurfaceGrassStrength.toFixed(4)}; // 0 = original texture, 1 = full tint`,
                `export const ISLAND_SURFACE_GRASS_GREEN_THRESHOLD = ${Island.islandSurfaceGrassGreenThreshold.toFixed(4)}; // green dominance needed for mask`,
                `export const ISLAND_SURFACE_GRASS_NORMAL_THRESHOLD = ${Island.islandSurfaceGrassNormalThreshold.toFixed(4)}; // upward-facing normal needed`,
                `export const ISLAND_SURFACE_GRASS_MASK_SOFTNESS = ${Island.islandSurfaceGrassMaskSoftness.toFixed(4)}; // feather for color/normal mask`,
                `export const ISLAND_SURFACE_GRASS_TOP_FILL_STRENGTH = ${Island.islandSurfaceGrassTopFillStrength.toFixed(4)}; // fills upward top faces that miss the color mask`,
                `export const ISLAND_SURFACE_GRASS_TOP_FILL_NORMAL_THRESHOLD = ${Island.islandSurfaceGrassTopFillNormalThreshold.toFixed(4)}; // lower upward-facing normal cutoff for top fill`,
                `export const ISLAND_SURFACE_POINT_LIGHT_INFLUENCE = ${Island.islandSurfacePointLightInfluence.toFixed(4)}; // lowers fire point-light faceting on island only`,
                `export const ISLAND_CAMPFIRE_GROUND_COLOR = '${Island.islandCampfireGroundColor}'; // sRGB hex`,
                `export const ISLAND_CAMPFIRE_GROUND_RADIUS = ${Island.islandCampfireGroundRadius.toFixed(4)};`,
                `export const ISLAND_CAMPFIRE_GROUND_SOFTNESS = ${Island.islandCampfireGroundSoftness.toFixed(4)};`,
                `export const ISLAND_CAMPFIRE_GROUND_STRENGTH = ${Island.islandCampfireGroundStrength.toFixed(4)};`,
                `export const ISLAND_CAMPFIRE_GROUND_NORMAL_THRESHOLD = ${Island.islandCampfireGroundNormalThreshold.toFixed(4)}; // upward-facing normal needed for ground tint`,
                ``,
                `// ── Island rock-match color grade ─────────────────────────────────────────────`,
                `export const ISLAND_ROCK_MATCH_COLOR = '${Island.islandRockMatchColor}'; // sRGB hex — target rock tint`,
                `export const ISLAND_ROCK_MATCH_STRENGTH = ${Island.islandRockMatchStrength.toFixed(4)}; // overall blend on rock areas (0 = off)`,
                `export const ISLAND_ROCK_MATCH_SATURATION = ${Island.islandRockMatchSaturation.toFixed(4)}; // 1 = keep original saturation, 0 = grayscale`,
                `export const ISLAND_ROCK_MATCH_BRIGHTNESS = ${Island.islandRockMatchBrightness.toFixed(4)}; // 1 = keep, >1 lifts the dark underside`,
                `export const ISLAND_ROCK_MATCH_COLOR_TINT = ${Island.islandRockMatchColorTint.toFixed(4)}; // how much the target color tints (0..1)`,
                `export const ISLAND_ROCK_MATCH_GREEN_THRESHOLD = ${Island.islandRockMatchGreenThreshold.toFixed(4)}; // green dominance to treat a pixel as moss`,
                `export const ISLAND_ROCK_MATCH_GREEN_STRENGTH = ${Island.islandRockMatchGreenStrength.toFixed(4)}; // tint applied to underside moss (protected from gray)`,
                `export const ISLAND_ROCK_MATCH_GREEN_COLOR = '${Island.islandRockMatchGreenColor}'; // sRGB hex — underside moss tint (matches surface grass)`,
                ``,
                `// ── Bush flower colors ───────────────────────────────────────────────────────`,
                `export const bushFlowerColor      = '${Island.bushFlowerConfig.main}';`,
                `export const bushRadioFlowerColor = '${Island.bushFlowerConfig.radio}';`,
                `export const bushRadio2FlowerColor = '${Island.bushFlowerConfig.radio2}';`,
                `export const bushPugFlowerColor   = '${Island.bushFlowerConfig.pug}';`,
                ``,
                `// ── Apple wind sway ───────────────────────────────────────────────────────────────`,
                `export const APPLE_WIND_STRENGTH   = ${appleWindStrength.toFixed(4)};  // TWEAK: Background sway amplitude (0 = off, 0.3 = strong)`,
                `export const APPLE_SWING_STIFFNESS = ${appleSwingStiffness.toFixed(1)};    // TWEAK: Spring K (rad/s²) — higher = faster oscillation`,
                `export const APPLE_SWING_DAMPING   = ${appleSwingDamping.toFixed(1)};     // TWEAK: Damping D — higher = settles faster`,
                `export const APPLE_CLICK_IMPULSE   = ${appleClickImpulse.toFixed(1)};     // TWEAK: Angular velocity kick on click (rad/s)`,
                `export const APPLE_RESPAWN_FADE_DURATION = ${APPLE_RESPAWN_FADE_DURATION.toFixed(1)};`,
                `export const APPLE_CLICK_COUNT_TO_FALL  = ${APPLE_CLICK_COUNT_TO_FALL};`,
                `export const MAX_GROUND_APPLES          = ${MAX_GROUND_APPLES};`,
                `export const APPLE_RESPAWN_DELAY        = ${Island.appleRespawnDelay.toFixed(1)};  // TWEAK: Seconds after landing before tree apple respawns`,
                ``,
                `// ── Golden apple easter egg ─────────────────────────────────────────────────────`,
                `export const GOLDEN_APPLE_INTERVAL      = ${Island.goldenAppleConfig.interval};`,
                `export const GOLDEN_APPLE_COLOR         = '${Island.goldenAppleConfig.color}';`,
                `export const GOLDEN_APPLE_EMISSIVE      = '${Island.goldenAppleConfig.emissive}';`,
                `export const GOLDEN_APPLE_EMISSIVE_INTENSITY = ${Island.goldenAppleConfig.emissiveIntensity.toFixed(2)};`,
                `export const GOLDEN_APPLE_COLOR_Y_CUTOFF    = ${Island.goldenAppleConfig.colorYCutoff.toFixed(2)};`,
                `export const GOLDEN_APPLE_LIGHT_COLOR       = '${Island.goldenAppleConfig.lightColor}';`,
                `export const GOLDEN_APPLE_LIGHT_INTENSITY   = ${Island.goldenAppleConfig.lightIntensity.toFixed(2)};`,
                `export const GOLDEN_APPLE_LIGHT_DISTANCE    = ${Island.goldenAppleConfig.lightDistance.toFixed(2)};`,
                `export const GOLDEN_APPLE_LIGHT_DECAY       = ${Island.goldenAppleConfig.lightDecay.toFixed(2)};`,
                ``,
                `// ── Foliage ────────────────────────────────────────────────────────────`,
                `export const GRASS_COUNT          = ${Island.GRASS_COUNT};`,
                `export const GRASS_Y_OFFSET        = ${grassYOffset.toFixed(4)};`,
                `export const GRASS_COLOR_BASE      = '${foliageColorState.baseColor}'; // sRGB hex`,
                `export const GRASS_COLOR_TIP       = '${foliageColorState.tipColor}';  // sRGB hex`,
                `export const FOLIAGE_WIND_STRENGTH = ${foliageWindStrength.toFixed(4)};`,
                `export const GRASS_WOBBLE_STRENGTH  = ${Island.grassWobbleStrength.toFixed(3)};  // constant base sway`,
                `export const GRASS_MAX_HEIGHT       = ${Island.grassMaxHeight.toFixed(3)};  // max blade height`,
                `export const GRASS_EDGE_FALLOFF_RADIUS = ${grassEdgeFalloffRadius.toFixed(2)};   // probe radius for edge blade taper`,
                `export const GRASS_MIN_EDGE_SCALE      = ${grassMinEdgeScale.toFixed(2)};   // minimum blade scale at island edge (0–1)`,
                `export const GRASS_SHADOW_OPACITY      = ${grassShadowOpacity.toFixed(2)};   // alpha of dark AO floor under grass`,
                `export const GRASS_SHADOW_COLOR        = '${Island.grassShadowColor}'; // sRGB dark green-black`,
                `export const GRASS_SHADOW_Y_OFFSET     = ${Island.grassShadowYOffset.toFixed(3)};  // Y below average surface (negative = lower than blades)`,
                `export const GRASS_SHADOW_SPREAD       = ${Island.grassShadowSpread.toFixed(2)};   // disc radius scale (1.0 = cluster width)`,
                ``,
                `// ── Spawn edge padding ────────────────────────────────────────────────────────`,
                `export const SURFACE_EDGE_PADDING = ${Island.grassEdgePadding.toFixed(3)};`,
                ``,
                `// ── Exclusion zone radii (grass spawn clearance around each surface object) ───`,
                `export const EXCL_R_BONFIRE = ${exclRadii.bonfire.toFixed(2)};`,
                `export const EXCL_R_TENT    = ${exclRadii.tent.toFixed(2)};   // custom tent — increase to push grass further out`,
                `export const EXCL_R_TREE    = ${exclRadii.tree.toFixed(2)};`,
                `export const EXCL_R_PUG     = ${exclRadii.pug.toFixed(2)};`,
                `export const EXCL_R_RADIO   = ${exclRadii.radio.toFixed(2)};`,
                `export const EXCL_R_ROCKS   = ${exclRadii.rocks.toFixed(2)};`,
                ``,
                `// ── Fire light ───────────────────────────────────────────────────────────────────`,
                `export const FIRE_LIGHT_INTENSITY = ${fireLightConfig.intensity.toFixed(2)};   // Base intensity multiplier (before flicker)`,
                `export const FIRE_LIGHT_RANGE     = ${fireLightConfig.range.toFixed(2)};   // PointLight max range in world units`,
                `export const FIRE_LIGHT_DECAY     = 2.0;   // Light falloff (2 = physically based)`,
                `export const FIRE_LIGHT_FLICKER   = ${fireLightConfig.flicker.toFixed(2)};   // 0 = steady, 1 = heavy flicker`,
                ``,
                `// ── Phone ─────────────────────────────────────────────────────────────────────`,
                `export const phoneZoomHeight = ${f(phoneZoomConfig.height)};`,
                `export const phoneZoomTilt   = ${f(phoneZoomConfig.tilt)};`,
                `export const phoneZoomPitch  = ${f(phoneZoomConfig.pitch)};`,
                `export const phoneZoomFov    = ${phoneZoomConfig.fov};`,
                `export const phoneScreenWidth   = ${f(phoneScreenConfig.screenWidth)};`,
                `export const phoneScreenHeight  = ${f(phoneScreenConfig.screenHeight)};`,
                `export const phoneScreenOffsetX = ${f(phoneScreenConfig.offsetX)};`,
                `export const phoneScreenOffsetY = ${f(phoneScreenConfig.offsetY)};`,
                `export const phoneScreenOffsetZ = ${f(phoneScreenConfig.offsetZ)};`,
                `export const phoneOverlayOpacity      = ${f(phoneScreenConfig.overlayOpacity)};`,
                `export const phoneOverlayTintR        = ${phoneScreenConfig.overlayTintR};`,
                `export const phoneOverlayTintG        = ${phoneScreenConfig.overlayTintG};`,
                `export const phoneOverlayTintB        = ${phoneScreenConfig.overlayTintB};`,
                `export const phoneOverlayGlareOpacity = ${f(phoneScreenConfig.overlayGlareOpacity)};`,
                `export const phoneOverlayGlareAngle   = ${phoneScreenConfig.overlayGlareAngle};`,
            ].join('\n');
            navigator.clipboard.writeText(content).then(() => {
                console.log('[Debug] IslandConfig.ts content copied to clipboard!');
            });
        },
    };
    surfaceFolder.add(actions, 'copyConfig').name('Copy IslandConfig.ts');

    const oceanActions = {
        copyOceanConfig: () => {
            const f = (n: number) => n.toFixed(4);
            const vel1 = waveVelocity1Uniform.value;
            const vel2 = waveVelocity2Uniform.value;
            const sc   = surfaceColorUniform.value;
            const abs  = oceanAbsorptionUniform.value;
            const flc  = foamLineColorUniform.value;
            const efc  = edgeFoamColorUniform.value;
            const _efIsMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
            const content = [
                `// src/scene/OceanConfig.ts`,
                `// Ocean visual configuration — generated by Debug.`,
                `// Paste this entire file to replace src/scene/OceanConfig.ts`,
                ``,
                `// ── Foam ─────────────────────────────────────────────────────────────────────`,
                `export const foamCenterOffset = { x: ${f(foamCenterOffsetUniform.value.x)}, y: ${f(foamCenterOffsetUniform.value.y)} }; // XZ nudge on top of the auto-baked island center`,
                `export const foamRadius       = ${f(foamRadiusUniform.value as number)}; // >1 pushes ring outward, <1 pulls inward`,
                `export const foamWidth        = ${f(foamWidthUniform.value as number)}; // width of the foam band`,
                `export const foamIntensity    = ${f(foamIntensityUniform.value as number)}; // overall foam brightness`,
                `export const foamAnimSpeed    = ${f(foamAnimSpeedUniform.value as number)}; // speed of animated shimmer`,
                `export const foamEdgeNoiseAmt = ${f(foamEdgeNoiseAmtUniform.value as number)}; // brightness shimmer near edge`,
                `export const foamWobbleAmt    = ${f(foamWobbleAmtUniform.value as number)}; // world-unit wobble of the foam line`,
                `export const foamWobbleFreq   = ${f(foamWobbleFreqUniform.value as number)}; // spatial frequency of the wobble`,
                `export const foamWobbleSpeed  = ${f(foamWobbleSpeedUniform.value as number)}; // how fast the wobble animates`,
                `export const foamLineFrequency = ${f(foamLineFrequencyUniform.value as number)};`,
                `export const foamLineThickness = ${f(foamLineThicknessUniform.value as number)};`,
                `export const foamLineCount     = ${f(foamLineCountUniform.value as number)};`,
                `export const foamLineBreakup   = ${f(foamLineBreakupUniform.value as number)};`,
                `export const foamLineColor     = { r: ${f(flc.x)}, g: ${f(flc.y)}, b: ${f(flc.z)} };`,
                ``,
                `// ── Ocean Waves (normal-map scroll) ──────────────────────────────────────────`,
                `export const normalMapScale    = ${f(normalMapScaleUniform.value as number)};`,
                `export const normalMapStrength = ${f(normalMapStrengthUniform.value as number)};`,
                `export const waveVelocity1     = { x: ${f(vel1.x)}, y: ${f(vel1.y)} };`,
                `export const waveVelocity2     = { x: ${f(vel2.x)}, y: ${f(vel2.y)} };`,
                `export const edgeFadeDistance  = ${f(edgeFadeDistanceUniform.value as number)};`,
                `export const horizonFadeStart  = ${f(horizonFadeStartUniform.value as number)};`,
                `export const horizonFadeEnd    = ${f(horizonFadeEndUniform.value as number)};`,
                ``,
                `// ── Surface Vertex Displacement (near-camera swell) ──────────────────────────`,
                `// Real geometry waves applied ONLY to the strip of ocean in front of the camera`,
                `// — amplitude fades to 0 with distance so it fuses seamlessly with the flat`,
                `// surface. Gives the waterline a wavy silhouette when entering/exiting the water.`,
                `export const surfaceWaveAmplitude   = ${f(surfaceWaveAmplitudeUniform.value as number)}; // max vertical displacement (world units) near the camera`,
                `export const surfaceWaveLength      = ${f(surfaceWaveLengthUniform.value as number)}; // wavelength in world units (keep ≥ ~4× vertex spacing)`,
                `export const surfaceWaveSpeed       = ${f(surfaceWaveSpeedUniform.value as number)}; // animation speed of the swell`,
                `export const surfaceWaveRange       = ${f(surfaceWaveRangeUniform.value as number)}; // XZ distance from camera over which the waves fade to flat`,
                `export const surfaceWaveForwardBias = ${f(surfaceWaveForwardBiasUniform.value as number)}; // 0 = full radial ring around camera, 1 = only directly ahead`,
                `export const surfaceWaveSteepness   = ${f(surfaceWaveSteepnessUniform.value as number)}; // blend of the cross wave layer — adds choppiness`,
                ``,
                `// ── Ocean Surface ─────────────────────────────────────────────────────────────`,
                `export const surfaceColor   = { r: ${f(sc.x)}, g: ${f(sc.y)}, b: ${f(sc.z)} }; // RGB tint (1,1,1 = no tint)`,
                `export const surfaceOpacity = ${f(surfaceOpacityUniform.value as number)};`,
                `export const waterBlurStrength = ${f(waterBlurStrengthUniform.value as number)};`,
                `export const waterBlurRadius   = ${f(waterBlurRadiusUniform.value as number)};`,
                `export const waterBlurOpacity  = ${f(waterBlurOpacityUniform.value as number)};`,
                `export const waterlineCompositeOpacity = ${f(waterlineCompositeOpacityUniform.value as number)};`,
                ``,
                `// ── Waterline (Y is used by apple buoyancy physics) ──────────────────────────`,
                `export const waterlineY         = ${f(waterlineYUniform.value as number)};`,
                ``,
                `// ── Edge-foam (ocean-side depth intersection foam) ──────────────────────────`,
                `// Industry-standard "intersection foam": the ocean shader reads the opaque`,
                `// scene depth and brightens fragments where the ocean grazes geometry behind`,
                `// it. Fully independent from the SDF foam ring around the island silhouette.`,
                `export const edgeFoamWidth     = ${f(edgeFoamWidthUniform.value as number)};  // world-space distance over which foam fades to nothing`,
                `export const edgeFoamIntensity = ${f(edgeFoamIntensityUniform.value as number)};  // overall brightness of the depth-intersection foam`,
                `export const edgeFoamUnderwaterMul = ${f(edgeFoamUnderwaterMulUniform.value as number)};  // dimming factor for the same effect with camera below water (silvery refraction sheen)`,
                `export const edgeFoamColor     = { r: ${f(efc.x)}, g: ${f(efc.y)}, b: ${f(efc.z)} };`,
                ``,
                `// World-Z fade for edge foam. iOS 16-bit depth buffer causes flicker on back`,
                `// rocks (z ≈ -4.7..-5.6). Fade starts at the pug's world Z where precision is`,
                `// clean, fully gone behind. Desktop is off-scene. Pug Z = islandZ(-3.3) + pugOffsetZ(+1.0)`,
                `export const edgeFoamFadeStartZDesktop = ${f(_efIsMobile ? CFG_EF_FADE_START_Z_DESKTOP : edgeFoamFadeStartZUniform.value as number)};`,
                `export const edgeFoamFadeEndZDesktop   = ${f(_efIsMobile ? CFG_EF_FADE_END_Z_DESKTOP : edgeFoamFadeEndZUniform.value as number)};`,
                `export const edgeFoamFadeStartZMobile  = ${f(_efIsMobile ? edgeFoamFadeStartZUniform.value as number : CFG_EF_FADE_START_Z_MOBILE)};`,
                `export const edgeFoamFadeEndZMobile    = ${f(_efIsMobile ? edgeFoamFadeEndZUniform.value as number : CFG_EF_FADE_END_Z_MOBILE)};`,
                ``,
                `// ── Reflection ────────────────────────────────────────────────────────────────`,
                `export const reflectionFresnelPower = ${f(reflectionFresnelPowerUniform.value as number)}; // lower = visible at more angles`,
                `export const reflectionFloor        = ${f(reflectionFloorUniform.value as number)}; // minimum reflectivity at any angle`,
                `export const skyReflectionBrightness = ${f(skyReflectionBrightnessUniform.value as number)}; // scales the analytical skybox reflection (0 = none, 1 = full)`,
                `export const skyReflFalloff         = ${f(skyReflFalloffUniform.value as number)}; // sharpens near→far gradient: 1 = linear, 2 = squared, 4 = very steep`,
                ``,
                `// ── Underwater ────────────────────────────────────────────────────────────────`,
                `export const oceanAbsorption    = { r: ${f(abs.x)}, g: ${f(abs.y)}, b: ${f(abs.z)} }; // per-channel fog depth`,
                `export const underwaterFogDist  = ${f(underwaterFogDistUniform.value as number)};                                  // far distance — objects beyond this are fully fogged`,
                `export const distortionStrength = ${f(_fogState.distortion)};`,
                `export const distortionSpeed    = ${f(_fogState.speed)};`,
                `export const distortionScale    = ${f(_fogState.scale)};`,
                `export const distortionEdgeFade = ${f(_fogState.edgeFade)};`,
                ``,
                `// ── Fish / Jellyfish Lighting ───────────────────────────────────────────────`,
                `// Drives the per-jellyfish PointLight (candela-ish intensity + reach in world`,
                `// units). Material recompiles are avoided by keeping light *count* constant —`,
                `// only the values below change at runtime.`,
                `export const jellyfishLightConfig = {`,
                `    intensity: ${f(jellyfishLightConfig.intensity)},`,
                `    distance: ${f(jellyfishLightConfig.distance)},`,
                `};`,
                ``,
                `// ── Click Ripple Effect ───────────────────────────────────────────────────────`,
                `export const rippleSpeed           = ${RIPPLE_SPEED};    // World-units/sec the ring expands (max radius = speed × lifetime)`,
                `export const rippleLifetime        = ${RIPPLE_LIFETIME};    // Seconds before the wave fully fades out`,
                `export const rippleWidth           = ${RIPPLE_WIDTH};   // Width of the wave band in world units`,
                `export const rippleNormalStrength  = ${RIPPLE_NORMAL_STRENGTH};    // Normal-perturbation amplitude — keep in line with wave normals`,
                `export const rippleMaxClickDistance = ${RIPPLE_MAX_CLICK_DISTANCE};  // Max XZ distance (world units) from camera for the effect to trigger`,
            ].join('\n');
            navigator.clipboard.writeText(content).then(() => {
                console.log('[Debug] OceanConfig.ts content copied to clipboard!');
            });
        },
    };
    oceanFolder.add(oceanActions, 'copyOceanConfig').name('Copy OceanConfig.ts');

    // ── Ocean subfolders — alphabetical order ─────────────────────────────────
    const foamFolder  = oceanFolder.addFolder('Foam');
    const reflFolder  = oceanFolder.addFolder('Reflection');
    const surfFolder  = oceanFolder.addFolder('Surface Color');
    const fogFolder   = oceanFolder.addFolder('Underwater');
    const wavesFolder = oceanFolder.addFolder('Waves');
    const oceanFishFolder = oceanFolder.addFolder('Fish');

    const jellyLightFolder = oceanFishFolder.addFolder('Jellyfish Lights');
    jellyLightFolder.add(jellyfishLightConfig, 'intensity', 0, 10, 0.05).name('Intensity').listen();
    jellyLightFolder.add(jellyfishLightConfig, 'distance', 0.05, 5, 0.05).name('Distance').listen();
    jellyLightFolder.close();
    oceanFishFolder.close();

    const skyActions = {
        copySkyConfig: () => {
            const f  = (n: number) => n.toFixed(4);
            const fi = (n: number) => String(Math.round(n));
            const wc = WindLines.config;
            const content = [
                `// src/scene/config/SkyConfig.ts`,
                `// Sky visual configuration (wind lines) - generated by Debug.`,
                `// Paste this entire file to replace src/scene/config/SkyConfig.ts`,
                ``,
                `// ── Wind Lines: Spawning ──────────────────────────────────────────────────────`,
                `export const maxLines  = ${fi(wc.maxLines)};`,
                `export const spawnRate = ${f(wc.spawnRate)};       // lines spawned per second at full breeze intensity`,
                `export const rampUp    = ${f(wc.rampUp)};     // seconds to reach full intensity (breeze start)`,
                `export const rampDown  = ${f(wc.rampDown)};     // seconds to fade out (breeze end)`,
                ``,
                `// ── Wind Lines: Line shape ────────────────────────────────────────────────────`,
                `export const minLength = ${fi(wc.minLength)};      // px`,
                `export const maxLength = ${fi(wc.maxLength)};     // px`,
                `export const tiltY     = ${f(wc.tiltY)};    // downward drift — px per px traveled left (0 = horizontal)`,
                ``,
                `// ── Wind Lines: Vertical spread ───────────────────────────────────────────────`,
                `export const minWorldY = ${f(wc.minWorldY)};   // lowest spawn Y in Three.js world units`,
                `export const maxWorldY = ${f(wc.maxWorldY)};   // highest spawn Y in Three.js world units`,
                ``,
                `// ── Wind Lines: Width ─────────────────────────────────────────────────────────`,
                `export const minWidth  = ${f(wc.minWidth)};     // px`,
                `export const maxWidth  = ${f(wc.maxWidth)};     // px`,
                ``,
                `// ── Wind Lines: Speed ─────────────────────────────────────────────────────────`,
                `export const minSpeed  = ${fi(wc.minSpeed)};     // px/s`,
                `export const maxSpeed  = ${fi(wc.maxSpeed)};     // px/s`,
                ``,
                `// ── Wind Lines: Appearance ────────────────────────────────────────────────────`,
                `export const lineOpacity = ${f(wc.lineOpacity)};  // peak opacity per line (0–1)`,
                `export const colorR      = ${fi(wc.colorR)};   // RGB 0–255`,
                `export const colorG      = ${fi(wc.colorG)};`,
                `export const colorB      = ${fi(wc.colorB)};`,
                ``,
                `// ── Wind Lines: Wave / wobble ─────────────────────────────────────────────────`,
                `export const waveAmplitude = ${f(wc.waveAmplitude)};   // max vertical displacement (px); 0 = straight lines`,
                `export const waveFrequency = ${f(wc.waveFrequency)}; // full sine cycles per line (1 = one wave, 2 = two waves)`,
                `export const waveSpeed     = ${f(wc.waveSpeed)};// animation speed — radians per second phase shift`,
                `export const waveSegments  = ${fi(wc.waveSegments)};  // sub-divisions per line (higher = smoother, min 4)`,
                ``,
                `// ── Wind Lines: 3D World-Space Depth ─────────────────────────────────────────`,
                `export const minZOffset = ${f(wc.minZOffset)};  // Z offset relative to island Z (negative = further from camera)`,
                `export const maxZOffset =  ${f(wc.maxZOffset)};  // Z offset relative to island Z (positive = closer to camera)`,
                ``,
                `// ── Wind Lines: Island Proximity Fade ────────────────────────────────────────`,
                `export const islandDisappearDist = ${f(wc.islandDisappearDist)};  // dist where lines START fading out (moving away from island)`,
                `export const islandAppearDist    = ${f(wc.islandAppearDist)};  // dist where lines START appearing (approaching island)`,
            ].join('\n');
            navigator.clipboard.writeText(content).then(() => {
                console.log('[Debug] SkyConfig.ts content copied to clipboard!');
            });
        },
    };
    skyFolder.add(skyActions, 'copySkyConfig').name('Copy SkyConfig.ts');

    // ── Sky subfolders — alphabetical order ───────────────────────────────────
    const windFolder  = skyFolder.addFolder('Wind Lines');

    // ── Surface objects — alphabetical order ─────────────────────────────────
    addObjectFolder(surfaceFolder, 'Dog Bed', dogBed,       { scaleRange: [0.01, 1.5], rotAxes: ['y']           });

    const firecampObjFolder = addObjectFolder(surfaceFolder, 'Firecamp',  firecamp,  { scaleRange: [0.1,  5.0]                           });
    // Fire light sub-folder — controls feed directly into fireLightConfig used by Fire.Update()
    const fireLightFolder = firecampObjFolder.addFolder('Fire Light');
    fireLightFolder.add(fireLightConfig, 'intensity', 0, 10,  0.1 ).name('Intensity');
    fireLightFolder.add(fireLightConfig, 'range',     0, 20,  0.5 ).name('Range');
    fireLightFolder.add(fireLightConfig, 'flicker',   0,  1,  0.01).name('Flicker');
    fireLightFolder.close();

    // ── Foliage (inside Surface) ──────────────────────────────────────────────────
    {
        const LS_KEY = LS_KEY_GRASS;
        const storedColors = _storedColors;
        const colorState = foliageColorState;
        const foliageFolder = surfaceFolder.addFolder('Foliage');
        const doRespawn = debounce(() => respawnFoliage('grass'), 300);

        // Count
        const countProxy = { get count() { return Island.GRASS_COUNT; }, set count(v: number) { setGrassCount(v); doRespawn(); } };
        foliageFolder.add(countProxy, 'count', 0, 400, 1).name('Count').listen();

        // Edge padding
        const paddingProxy = { get pad() { return r(grassEdgePadding); }, set pad(v: number) { setGrassEdgePadding(v); } };
        foliageFolder.add(paddingProxy, 'pad', 0, 0.5, 0.01).name('Edge Padding').listen();

        // Y offset
        const yProxy = { get y() { return r(grassYOffset); }, set y(v: number) { setGrassYOffset(v); } };
        foliageFolder.add(yProxy, 'y', -0.2, 0.3, 0.005).name('Y Offset').listen();

        // Use Three.js Color to parse sRGB hex → linear, so the picker hex
        // matches the actual rendered color (including when eyedropper is used).
        const applyBase = (hex: string) => { const c = new Color(hex); setGrassColorBase(c.r, c.g, c.b); };
        const applyTip  = (hex: string) => { const c = new Color(hex); setGrassColorTip(c.r,  c.g, c.b); };
        // Apply stored (or default) colors immediately on GUI init, then respawn
        applyBase(colorState.baseColor);
        applyTip(colorState.tipColor);
        doRespawn();

        foliageFolder.addColor(colorState, 'baseColor')
            .name('Color Base')
            .onChange((hex: string) => {
                applyBase(hex);
                localStorage.setItem(LS_KEY, JSON.stringify(colorState));
                doRespawn();
            });
        foliageFolder.addColor(colorState, 'tipColor')
            .name('Color Tip')
            .onChange((hex: string) => {
                applyTip(hex);
                localStorage.setItem(LS_KEY, JSON.stringify(colorState));
                doRespawn();
            });

        // Wind strength (live) — initial value from exported foliageWindStrength
        const windProxy = { wind: foliageWindStrength };
        foliageFolder.add(windProxy, 'wind', 0, 0.3, 0.005)
            .name('Wind Strength').onChange((v: number) => setFoliageWindStrength(v));

        // Wobble strength — constant sway, always present regardless of breeze
        const wobbleProxy = { wobble: grassWobbleStrength };
        foliageFolder.add(wobbleProxy, 'wobble', 0, 0.2, 0.001)
            .name('Wobble Strength').onChange((v: number) => setGrassWobbleStrength(v));

        // Blade height — requires respawn to rebuild geometry
        const heightProxy = {
            get height() { return r(grassMaxHeight); },
            set height(v: number) { setGrassMaxHeight(v); doRespawn(); },
        };
        foliageFolder.add(heightProxy, 'height', 0.01, 0.3, 0.005).name('Blade Height').listen();

        // Edge falloff radius — probes this far from each blade to detect proximity to island edge
        const edgeFalloffProxy = {
            get radius() { return r(grassEdgeFalloffRadius); },
            set radius(v: number) { setGrassEdgeFalloffRadius(v); doRespawn(); },
        };
        foliageFolder.add(edgeFalloffProxy, 'radius', 0, 0.8, 0.01).name('Edge Falloff Radius').listen();

        // Minimum blade scale applied at the island perimeter
        const minScaleProxy = {
            get scale() { return r(grassMinEdgeScale); },
            set scale(v: number) { setGrassMinEdgeScale(v); doRespawn(); },
        };
        foliageFolder.add(minScaleProxy, 'scale', 0, 1, 0.01).name('Min Edge Scale').listen();

        // Shadow floor opacity — live, no respawn needed
        const shadowProxy = {
            get opacity() { return r(grassShadowOpacity); },
            set opacity(v: number) { setShadowFloorOpacity(v); },
        };
        foliageFolder.add(shadowProxy, 'opacity', 0, 1, 0.01).name('Shadow Opacity').listen();

        // Shadow Y offset — pushes shadow below grass blades (negative = lower), requires respawn
        const shadowYProxy = {
            get offset() { return r(grassShadowYOffset); },
            set offset(v: number) { setShadowFloorYOffset(v); respawnFoliage('grass'); },
        };
        foliageFolder.add(shadowYProxy, 'offset', -0.1, 0.1, 0.001).name('Shadow Y Offset').listen();

        // Shadow spread — disc radius relative to spawn spread (1.0 = full cluster width)
        const shadowSpreadProxy = {
            get spread() { return r(grassShadowSpread); },
            set spread(v: number) { setShadowFloorSpread(v); respawnFoliage('grass'); },
        };
        foliageFolder.add(shadowSpreadProxy, 'spread', 0.1, 2.0, 0.01).name('Shadow Spread').listen();

        // Shadow floor color — requires respawn to rebake geometry
        const shadowColorProxy = { color: grassShadowColor };
        foliageFolder.addColor(shadowColorProxy, 'color').name('Shadow Color')
            .onChange((v: string) => { setShadowFloorColor(v); respawnFoliage('grass'); });

        // Respawn button
        foliageFolder.add({ respawn: () => respawnFoliage('grass') }, 'respawn').name('Respawn Grass');

        // Exclusion radii
        const exclFolder = foliageFolder.addFolder('Exclusion Radii');
        exclFolder.close();
        (['bonfire', 'tent', 'tree', 'pug', 'radio', 'rocks'] as const).forEach(key => {
            exclFolder.add(exclRadii, key, 0, 1.5, 0.01)
                .name(key.charAt(0).toUpperCase() + key.slice(1))
                .listen()
                .onChange((v: number) => { setExclRadius(key, v); doRespawn(); });
        });

        foliageFolder.close();
    }

    const islandFolder = addObjectFolder(surfaceFolder, 'Island', island, { scaleRange: [0.01, 1.0] });
    {
        const surfaceFilterFolder = islandFolder.addFolder('Surface Grass Filter');
        const filterProxy = {
            color: islandSurfaceGrassColor,
            strength: islandSurfaceGrassStrength,
            greenThreshold: islandSurfaceGrassGreenThreshold,
            normalThreshold: islandSurfaceGrassNormalThreshold,
            softness: islandSurfaceGrassMaskSoftness,
            topFillStrength: islandSurfaceGrassTopFillStrength,
            topFillNormalThreshold: islandSurfaceGrassTopFillNormalThreshold,
            pointLight: islandSurfacePointLightInfluence,
        };

        surfaceFilterFolder.addColor(filterProxy, 'color')
            .name('Tint Color')
            .onChange((v: string) => {
                filterProxy.color = v;
                setIslandSurfaceGrassColor(v);
            });
        surfaceFilterFolder.add(filterProxy, 'strength', 0, 1, 0.01)
            .name('Strength')
            .listen()
            .onChange((v: number) => setIslandSurfaceGrassStrength(v));
        surfaceFilterFolder.add(filterProxy, 'greenThreshold', -0.2, 0.5, 0.005)
            .name('Green Threshold')
            .listen()
            .onChange((v: number) => setIslandSurfaceGrassGreenThreshold(v));
        surfaceFilterFolder.add(filterProxy, 'normalThreshold', -0.2, 1.0, 0.01)
            .name('Normal Threshold')
            .listen()
            .onChange((v: number) => setIslandSurfaceGrassNormalThreshold(v));
        surfaceFilterFolder.add(filterProxy, 'softness', 0.001, 0.8, 0.005)
            .name('Mask Softness')
            .listen()
            .onChange((v: number) => setIslandSurfaceGrassMaskSoftness(v));
        surfaceFilterFolder.add(filterProxy, 'topFillStrength', 0, 1, 0.01)
            .name('Top Fill Strength')
            .listen()
            .onChange((v: number) => setIslandSurfaceGrassTopFillStrength(v));
        surfaceFilterFolder.add(filterProxy, 'topFillNormalThreshold', -0.2, 1.0, 0.01)
            .name('Top Fill Normal')
            .listen()
            .onChange((v: number) => setIslandSurfaceGrassTopFillNormalThreshold(v));
        surfaceFilterFolder.add(filterProxy, 'pointLight', 0, 1, 0.01)
            .name('Point Light Influence')
            .listen()
            .onChange((v: number) => setIslandSurfacePointLightInfluence(v));
        surfaceFilterFolder.close();

        const campfireGroundFolder = islandFolder.addFolder('Campfire Ground Tint');
        const campfireProxy = {
            color: islandCampfireGroundColor,
            radius: islandCampfireGroundRadius,
            softness: islandCampfireGroundSoftness,
            strength: islandCampfireGroundStrength,
            normalThreshold: islandCampfireGroundNormalThreshold,
        };
        campfireGroundFolder.addColor(campfireProxy, 'color')
            .name('Color')
            .onChange((v: string) => {
                campfireProxy.color = v;
                setIslandCampfireGroundColor(v);
            });
        campfireGroundFolder.add(campfireProxy, 'radius', 0, 2.5, 0.01)
            .name('Radius')
            .listen()
            .onChange((v: number) => setIslandCampfireGroundRadius(v));
        campfireGroundFolder.add(campfireProxy, 'softness', 0.001, 2.0, 0.01)
            .name('Softness')
            .listen()
            .onChange((v: number) => setIslandCampfireGroundSoftness(v));
        campfireGroundFolder.add(campfireProxy, 'strength', 0, 1, 0.01)
            .name('Strength')
            .listen()
            .onChange((v: number) => setIslandCampfireGroundStrength(v));
        campfireGroundFolder.add(campfireProxy, 'normalThreshold', -0.2, 1.0, 0.01)
            .name('Ground Normal')
            .listen()
            .onChange((v: number) => setIslandCampfireGroundNormalThreshold(v));
        campfireGroundFolder.close();
    }

    {
        const rockMatchFolder = islandFolder.addFolder('Rock Match Filter');
        const rockMatchProxy = {
            color: islandRockMatchColor,
            strength: islandRockMatchStrength,
            saturation: islandRockMatchSaturation,
            brightness: islandRockMatchBrightness,
            colorTint: islandRockMatchColorTint,
        };
        rockMatchFolder.addColor(rockMatchProxy, 'color')
            .name('Target Color')
            .onChange((v: string) => {
                rockMatchProxy.color = v;
                setIslandRockMatchColor(v);
            });
        rockMatchFolder.add(rockMatchProxy, 'strength', 0, 1, 0.01)
            .name('Strength')
            .listen()
            .onChange((v: number) => setIslandRockMatchStrength(v));
        rockMatchFolder.add(rockMatchProxy, 'saturation', 0, 1, 0.01)
            .name('Saturation')
            .listen()
            .onChange((v: number) => setIslandRockMatchSaturation(v));
        rockMatchFolder.add(rockMatchProxy, 'brightness', 0, 2, 0.01)
            .name('Brightness')
            .listen()
            .onChange((v: number) => setIslandRockMatchBrightness(v));
        rockMatchFolder.add(rockMatchProxy, 'colorTint', 0, 1, 0.01)
            .name('Color Tint')
            .listen()
            .onChange((v: number) => setIslandRockMatchColorTint(v));
        const rockMatchGreenProxy = {
            greenColor: islandRockMatchGreenColor,
            greenThreshold: islandRockMatchGreenThreshold,
            greenStrength: islandRockMatchGreenStrength,
        };
        rockMatchFolder.addColor(rockMatchGreenProxy, 'greenColor')
            .name('Moss Color')
            .onChange((v: string) => {
                rockMatchGreenProxy.greenColor = v;
                setIslandRockMatchGreenColor(v);
            });
        rockMatchFolder.add(rockMatchGreenProxy, 'greenThreshold', -0.2, 0.5, 0.005)
            .name('Moss Threshold')
            .listen()
            .onChange((v: number) => setIslandRockMatchGreenThreshold(v));
        rockMatchFolder.add(rockMatchGreenProxy, 'greenStrength', 0, 1, 0.01)
            .name('Moss Strength')
            .listen()
            .onChange((v: number) => setIslandRockMatchGreenStrength(v));
        rockMatchFolder.close();
    }
    addObjectFolder(surfaceFolder, 'Little Rocks', littleRocks, { scaleRange: [0.01, 1.0], rotAxes: ['x', 'y', 'z'] });

    {
        const mossRocksFolder = surfaceFolder.addFolder('Moss Rocks');
        addObjectFolder(mossRocksFolder, 'Moss Rock 1',    mossRock1,  { scaleRange: [0.05, 2.0], rotAxes: ['x', 'y', 'z'] });
        addObjectFolder(mossRocksFolder, 'Moss Rock 2 A',  mossRock2a, { scaleRange: [0.05, 2.0], rotAxes: ['x', 'y', 'z'] });
        addObjectFolder(mossRocksFolder, 'Moss Rock 2 B',  mossRock2b, { scaleRange: [0.05, 2.0], rotAxes: ['x', 'y', 'z'] });
        addObjectFolder(mossRocksFolder, 'Moss Rock 3 A',  mossRock3a, { scaleRange: [0.05, 2.0], rotAxes: ['x', 'y', 'z'] });
        addObjectFolder(mossRocksFolder, 'Moss Rock 3 B',  mossRock3b, { scaleRange: [0.05, 2.0], rotAxes: ['x', 'y', 'z'] });
        addObjectFolder(mossRocksFolder, 'Moss Rock 3 C',  mossRock3c, { scaleRange: [0.05, 2.0], rotAxes: ['x', 'y', 'z'] });
        mossRocksFolder.close();
    }

    {
        const tentFolder = surfaceFolder.addFolder('Tent Interior');
        addObjectFolder(tentFolder, 'Folding Tray Table', foldingTrayTable, { scaleRange: [0.02, 1.0], rotAxes: ['x', 'y', 'z'] });
        addObjectFolder(tentFolder, 'Tent Dog Bed',       tentDogBed,       { scaleRange: [0.02, 1.0], rotAxes: ['x', 'y', 'z'] });
        addObjectFolder(tentFolder, 'Rug Round',          rugRound,         { scaleRange: [0.02, 1.0], rotAxes: ['x', 'y', 'z'] });
        addObjectFolder(tentFolder, 'Lantern',            lantern,          { scaleRange: [0.02, 1.0], rotAxes: ['x', 'y', 'z'] });
        addObjectFolder(tentFolder, 'Dog Bowl',           dogBowl,          { scaleRange: [0.01, 0.5], rotAxes: ['x', 'y', 'z'] });
        addObjectFolder(tentFolder, 'Dog Biscuit',        dogBiscuit,       { scaleRange: [0.005, 0.3], rotAxes: ['x', 'y', 'z'] });
        tentFolder.close();
    }

    {
        const appleFolder = surfaceFolder.addFolder('Apple');
        addObjectFolder(appleFolder, 'Apple 1', apple1, { scaleRange: [0.01, 0.5], rotAxes: ['y'] });
        addObjectFolder(appleFolder, 'Apple 2', apple2, { scaleRange: [0.01, 0.5], rotAxes: ['y'] });
        addObjectFolder(appleFolder, 'Apple 3', apple3, { scaleRange: [0.01, 0.5], rotAxes: ['y'] });

        const appleWindFolder = appleFolder.addFolder('Apple Swing');
        const swingProxy = {
            windStrength: appleWindStrength,
            stiffness:    appleSwingStiffness,
            damping:      appleSwingDamping,
            impulse:      appleClickImpulse,
        };
        appleWindFolder.add(swingProxy, 'windStrength', 0, 0.5, 0.005)
            .name('Wind Sway Strength')
            .onChange((v: number) => setAppleWindStrength(v));
        appleWindFolder.add(swingProxy, 'stiffness', 1, 50, 0.5)
            .name('Swing Stiffness')
            .onChange((v: number) => setAppleSwingStiffness(v));
        appleWindFolder.add(swingProxy, 'damping', 0.5, 15, 0.1)
            .name('Swing Damping')
            .onChange((v: number) => setAppleSwingDamping(v));
        appleWindFolder.add(swingProxy, 'impulse', 0, 8, 0.1)
            .name('Click Impulse (rad/s)')
            .onChange((v: number) => setAppleClickImpulse(v));
        appleWindFolder.add({ v: APPLE_CLICK_COUNT_TO_FALL }, 'v', 1, 10, 1)
            .name('Clicks to Fall')
            .listen();
        appleWindFolder.add({ v: MAX_GROUND_APPLES }, 'v', 1, 20, 1)
            .name('Max Ground Apples')
            .listen();
        appleWindFolder.add({ v: APPLE_RESPAWN_FADE_DURATION }, 'v', 0.1, 5, 0.1)
            .name('Fade Duration (s)')
            .listen();
        const respawnDelayProxy = { delay: Island.appleRespawnDelay };
        appleWindFolder.add(respawnDelayProxy, 'delay', 0, 3, 0.1)
            .name('Respawn Delay (s)')
            .onChange((v: number) => Island.setAppleRespawnDelay(v));
        appleWindFolder.close();

        const goldenFolder = appleFolder.addFolder('Golden Apple');
        const liveUpdate = () => Island.updateAllGoldenApples();
        const goldenActions = {
            copyGoldenAppleConfig: () => {
                const content = [
                    `// -- Golden apple easter egg ---------------------------------------------------`,
                    `export const GOLDEN_APPLE_INTERVAL      = ${Island.goldenAppleConfig.interval};`,
                    `export const GOLDEN_APPLE_COLOR         = '${Island.goldenAppleConfig.color}';`,
                    `export const GOLDEN_APPLE_EMISSIVE      = '${Island.goldenAppleConfig.emissive}';`,
                    `export const GOLDEN_APPLE_EMISSIVE_INTENSITY = ${Island.goldenAppleConfig.emissiveIntensity.toFixed(2)};`,
                    `export const GOLDEN_APPLE_COLOR_Y_CUTOFF    = ${Island.goldenAppleConfig.colorYCutoff.toFixed(2)};`,
                    `export const GOLDEN_APPLE_LIGHT_COLOR       = '${Island.goldenAppleConfig.lightColor}';`,
                    `export const GOLDEN_APPLE_LIGHT_INTENSITY   = ${Island.goldenAppleConfig.lightIntensity.toFixed(2)};`,
                    `export const GOLDEN_APPLE_LIGHT_DISTANCE    = ${Island.goldenAppleConfig.lightDistance.toFixed(2)};`,
                    `export const GOLDEN_APPLE_LIGHT_DECAY       = ${Island.goldenAppleConfig.lightDecay.toFixed(2)};`,
                ].join('\n') + '\n';
                navigator.clipboard.writeText(content).then(() => {
                    console.log('[Debug] Golden apple config copied to clipboard!');
                });
            },
        };
        goldenFolder.add(Island.goldenAppleConfig, 'interval', 1, 20, 1)
            .name('Every Nth Respawn');
        goldenFolder.addColor(Island.goldenAppleConfig, 'color')
            .name('Gold Tint')
            .onChange(liveUpdate);
        goldenFolder.addColor(Island.goldenAppleConfig, 'emissive')
            .name('Emissive Color')
            .onChange(liveUpdate);
        goldenFolder.add(Island.goldenAppleConfig, 'emissiveIntensity', 0, 2, 0.05)
            .name('Emissive Intensity')
            .onChange(liveUpdate);
        goldenFolder.add(Island.goldenAppleConfig, 'colorYCutoff', 0, 1, 0.05)
            .name('Gold Max Y')
            .onChange(liveUpdate);
        goldenFolder.addColor(Island.goldenAppleConfig, 'lightColor')
            .name('Light Color')
            .onChange(liveUpdate);
        goldenFolder.add(Island.goldenAppleConfig, 'lightIntensity', 0, 3, 0.05)
            .name('Light Intensity')
            .onChange(liveUpdate);
        goldenFolder.add(Island.goldenAppleConfig, 'lightDistance', 0.1, 5, 0.1)
            .name('Light Distance')
            .onChange(liveUpdate);
        goldenFolder.add(Island.goldenAppleConfig, 'lightDecay', 0, 5, 0.1)
            .name('Light Decay')
            .onChange(liveUpdate);
        goldenFolder.add(goldenActions, 'copyGoldenAppleConfig')
            .name('Copy Golden Config');
        goldenFolder.open();
        appleFolder.close();
    }

    {
        const applePhysicsFolder = physicsFolder.addFolder('Apple');
        applePhysicsFolder.add(physicsConfig, 'gravity', -30, 0, 0.1)
            .name('Gravity');
        applePhysicsFolder.add(physicsConfig, 'appleBodyYOffset', -0.3, 0.3, 0.005)
            .name('Body Y Offset');

        // Compound corner spheres
        const compoundFolder = applePhysicsFolder.addFolder('Compound Spheres');
        compoundFolder.add(physicsConfig, 'sphereRadius', 0.005, 0.1, 0.001).name('Sphere Radius');
        compoundFolder.add(physicsConfig, 'sphereSpread', 0.005, 0.1, 0.001).name('Corner Spread');
        compoundFolder.add(physicsConfig, 'sphereYTop', -0.1, 0.1, 0.001).name('Top Y');
        compoundFolder.add(physicsConfig, 'sphereYBottom', -0.1, 0.1, 0.001).name('Bottom Y');
        compoundFolder.close();

        applePhysicsFolder.add(physicsConfig, 'appleMass', 0.01, 2, 0.01)
            .name('Mass (kg)');
        applePhysicsFolder.add(physicsConfig, 'linearDamping', 0, 1, 0.01)
            .name('Linear Damping');
        applePhysicsFolder.add(physicsConfig, 'angularDamping', 0, 1, 0.01)
            .name('Angular Damping');
        applePhysicsFolder.add(physicsConfig, 'friction', 0, 2, 0.05)
            .name('Friction')
            .onChange(() => refreshContactMaterial());
        applePhysicsFolder.add(physicsConfig, 'restitution', 0, 1, 0.05)
            .name('Restitution (bounce)')
            .onChange(() => refreshContactMaterial());
        applePhysicsFolder.add(physicsConfig, 'sleepSpeedLimit', 0.01, 1, 0.01)
            .name('Sleep Speed Limit');
        applePhysicsFolder.add(physicsConfig, 'sleepTimeLimit', 0.1, 5, 0.1)
            .name('Sleep Time Limit');
        applePhysicsFolder.add(physicsConfig, 'safetyPlaneY', -10, 0, 0.1)
            .name('Safety Plane Y');
        applePhysicsFolder.add(physicsConfig, 'substeps', 1, 30, 1)
            .name('Substeps');
        applePhysicsFolder.add(physicsConfig, 'treeTrunkMaxY', -2, 1, 0.01)
            .name('Tree Trunk Max Y')
            .onChange(() => rebuildPhysicsWorld());

        const debugProxy = { wireframe: false };
        applePhysicsFolder.add(debugProxy, 'wireframe')
            .name('Show Wireframe')
            .onChange((v: boolean) => setDebugEnabled(v, threeScene));

        applePhysicsFolder.add({
            copyPhysicsConfig: () => {
                const content = [
                    `// src/scene/config/Physics/AppleConfig.ts`,
                    `// Apple physics configuration — generated by Debug.`,
                    `// Paste this entire file to replace src/scene/config/Physics/AppleConfig.ts`,
                    ``,
                    `// ── World ─────────────────────────────────────────────────────────────────────`,
                    `export const GRAVITY           = ${physicsConfig.gravity.toFixed(2)};`,
                    `export const SUBSTEPS          = ${physicsConfig.substeps};`,
                    `export const SAFETY_PLANE_Y   = ${physicsConfig.safetyPlaneY.toFixed(1)};`,
                    ``,
                    `// ── Apple body (compound: 4 corner spheres) ─────────────────────────────────`,
                    `export const APPLE_BODY_Y_OFFSET = ${physicsConfig.appleBodyYOffset.toFixed(2)};  // offset whole compound center from visual center`,
                    `export const APPLE_MASS        = ${physicsConfig.appleMass.toFixed(2)};    // kg`,
                    `export const LINEAR_DAMPING    = ${physicsConfig.linearDamping.toFixed(2)};`,
                    `export const ANGULAR_DAMPING   = ${physicsConfig.angularDamping.toFixed(2)};`,
                    ``,
                    `// All 4 spheres share a radius and spread — adjust these two to resize the cage`,
                    `export const SPHERE_RADIUS     = ${physicsConfig.sphereRadius.toFixed(3)};   // individual sphere radius`,
                    `export const SPHERE_SPREAD     = ${physicsConfig.sphereSpread.toFixed(3)};   // distance from center to each corner`,
                    `export const SPHERE_Y_TOP      = ${physicsConfig.sphereYTop.toFixed(3)};   // Y offset for top pair`,
                    `export const SPHERE_Y_BOTTOM   = ${physicsConfig.sphereYBottom.toFixed(3)};  // Y offset for bottom pair`,
                    ``,
                    `// ── Contact material ──────────────────────────────────────────────────────────`,
                    `export const FRICTION          = ${physicsConfig.friction.toFixed(2)};`,
                    `export const RESTITUTION       = ${physicsConfig.restitution.toFixed(2)};`,
                    ``,
                    `// ── Sleep detection ───────────────────────────────────────────────────────────`,
                    `export const SLEEP_SPEED_LIMIT = ${physicsConfig.sleepSpeedLimit.toFixed(2)};`,
                    `export const SLEEP_TIME_LIMIT  = ${physicsConfig.sleepTimeLimit.toFixed(2)};`,
                    ``,
                    `// ── Collider geometry ─────────────────────────────────────────────────────────`,
                    `export const TREE_TRUNK_MAX_Y  = ${physicsConfig.treeTrunkMaxY.toFixed(2)};    // world-space Y cutoff — only trunk geometry below this gets a collider`,
                ].join('\n') + '\n';
                navigator.clipboard.writeText(content).then(() => {
                    console.log('📋 PhysicsConfig.ts copied to clipboard');
                });
            }
        }, 'copyPhysicsConfig').name('📋 Copy Physics Config');

        applePhysicsFolder.close();
    }

    addObjectFolder(surfaceFolder, 'Tree', tree,  { scaleRange: [0.1,  2.0], rotAxes: ['y']           });
    const addBushFolder = (label: string, obj: Object3D, key: 'main' | 'radio' | 'radio2' | 'pug') => {
        const folder = addObjectFolder(surfaceFolder, label, obj, { scaleRange: [0.01, 2.0], rotAxes: ['y'] });
        const colorProxy = { flower: Island.bushFlowerConfig[key] };
        folder.addColor(colorProxy, 'flower')
            .name('Flower Color')
            .onChange((v: string) => Island.setBushFlowerColor(key, v));
        return folder;
    };
    addBushFolder('Bush', bush, 'main');
    addBushFolder('Bush Radio', bushRadio, 'radio');
    addBushFolder('Bush Radio 2', bushRadio2, 'radio2');
    addBushFolder('Bush Pug', bushPug, 'pug');

    const phoneFolder = addObjectFolder(surfaceFolder, 'Phone', Island.phone, { scaleRange: [0.01, 1.0], rotAxes: ['x', 'y', 'z'] });

    const phoneZoomFolder = phoneFolder.addFolder('Zoom');
    phoneZoomFolder.add(phoneZoomConfig, 'height', 0.05, 1.0,  0.005).name('Height above phone').listen();
    phoneZoomFolder.add(phoneZoomConfig, 'tilt',  -0.5,  0.5,  0.01 ).name('Tilt (Z offset)').listen();
    phoneZoomFolder.add(phoneZoomConfig, 'pitch', -1.57, -0.1,  0.01 ).name('Pitch (radians)').listen();
    phoneZoomFolder.add(phoneZoomConfig, 'fov',   5,     70,   0.5  ).name('FOV (telephoto)').listen();
    phoneZoomFolder.close();

    const screenFolder = phoneFolder.addFolder('Screen');
    screenFolder.add(phoneScreenConfig, 'screenWidth',  0.01, 0.5, 0.001).name('Screen Width (wu)').listen();
    screenFolder.add(phoneScreenConfig, 'screenHeight', 0.01, 0.8, 0.001).name('Screen Height (wu)').listen();
    screenFolder.add(phoneScreenConfig, 'offsetX', -0.2, 0.2, 0.001).name('Offset X').listen();
    screenFolder.add(phoneScreenConfig, 'offsetY', -0.1, 0.2, 0.001).name('Offset Y (above surf)').listen();
    screenFolder.add(phoneScreenConfig, 'offsetZ', -0.2, 0.2, 0.001).name('Offset Z').listen();
    screenFolder.close();

    const overlayFolder = phoneFolder.addFolder('Overlay');
    overlayFolder.add(phoneScreenConfig, 'overlayOpacity',      0, 1,   0.001).name('Tint Opacity').listen()
        .onChange(() => updateOverlayStyle());
    overlayFolder.add(phoneScreenConfig, 'overlayTintR',        0, 255, 1).name('Tint R').listen()
        .onChange(() => updateOverlayStyle());
    overlayFolder.add(phoneScreenConfig, 'overlayTintG',        0, 255, 1).name('Tint G').listen()
        .onChange(() => updateOverlayStyle());
    overlayFolder.add(phoneScreenConfig, 'overlayTintB',        0, 255, 1).name('Tint B').listen()
        .onChange(() => updateOverlayStyle());
    overlayFolder.add(phoneScreenConfig, 'overlayGlareOpacity', 0, 1,   0.001).name('Glare Opacity').listen()
        .onChange(() => updateOverlayStyle());
    overlayFolder.add(phoneScreenConfig, 'overlayGlareAngle',   0, 360, 1).name('Glare Angle (deg)').listen()
        .onChange(() => updateOverlayStyle());
    overlayFolder.close();

    const pugFolder = addObjectFolder(surfaceFolder, 'Pug', pug, { scaleRange: [0.01, 2.0], rotAxes: ['y'] });

    // Add animation select lazily — the pug GLB may still be loading when the GUI builds.
    (function waitForPugAnims() {
        if (Island.pugAnimClips.length === 0) { requestAnimationFrame(waitForPugAnims); return; }

        const options: Record<string, number> = {};
        Island.pugAnimClips.forEach((clip, i) => {
            options[clip.name ? `${clip.name}  (${i})` : `Animation ${i}`] = i;
        });

        const proxy = {
            get anim() { return Island.pugCurrentAnimIndex; },
            set anim(v: number) { Island.setPugAnimation(v); },
        };
        pugFolder.add(proxy, 'anim', options).name('Animation').listen();
    })();

    addObjectFolder(surfaceFolder, 'Radio',     radio,     { scaleRange: [0.01, 1.0], rotAxes: ['y']           });
    addObjectFolder(surfaceFolder, 'Sword',     sword,     { scaleRange: [0.01, 1.0], rotAxes: ['x', 'y', 'z'] });
    addObjectFolder(surfaceFolder, 'Tent',      tent,      { scaleRange: [0.1,  5.0], rotAxes: ['y']           });

    // ── Ocean Reflection ────────────────────────────────────────────────
    const reflProxy = {
        get fresnelPower() { return reflectionFresnelPowerUniform.value as number; },
        set fresnelPower(v){ reflectionFresnelPowerUniform.value = v; },
        get floor()        { return reflectionFloorUniform.value as number; },
        set floor(v)       { reflectionFloorUniform.value = v; },
        get skyBrightness(){ return skyReflectionBrightnessUniform.value as number; },
        set skyBrightness(v){ skyReflectionBrightnessUniform.value = v; },
        get skyFalloff()   { return skyReflFalloffUniform.value as number; },
        set skyFalloff(v)  { skyReflFalloffUniform.value = v; },
    };

    reflFolder.add(reflProxy, 'fresnelPower', 0.2, 4.0, 0.05)
        .name('Fresnel Power  (angle range)')
        .listen()
        .onChange((v: number) => { reflectionFresnelPowerUniform.value = v; });

    reflFolder.add(reflProxy, 'floor', 0, 0.8, 0.01)
        .name('Fresnel Floor  (min brightness)')
        .listen()
        .onChange((v: number) => { reflectionFloorUniform.value = v; });

    reflFolder.add(reflProxy, 'skyBrightness', 0, 1, 0.01)
        .name('Sky Refl Brightness')
        .listen()
        .onChange((v: number) => { skyReflectionBrightnessUniform.value = v; });

    reflFolder.add(reflProxy, 'skyFalloff', 0.5, 8.0, 0.1)
        .name('Sky Refl Falloff  (near→far)')
        .listen()
        .onChange((v: number) => { skyReflFalloffUniform.value = v; });

    reflFolder.close();

    // ── Ocean Waves ──────────────────────────────────────────────────────────
    const wavesProxy = {
        get nmScale()    { return normalMapScaleUniform.value as number; },
        set nmScale(v)   { normalMapScaleUniform.value = v; },
        get nmStrength() { return normalMapStrengthUniform.value as number; },
        set nmStrength(v){ normalMapStrengthUniform.value = v; },
        get vel1x()      { return waveVelocity1Uniform.value.x; },
        set vel1x(v)     { waveVelocity1Uniform.value.x = v; },
        get vel1y()      { return waveVelocity1Uniform.value.y; },
        set vel1y(v)     { waveVelocity1Uniform.value.y = v; },
        get vel2x()      { return waveVelocity2Uniform.value.x; },
        set vel2x(v)     { waveVelocity2Uniform.value.x = v; },
        get vel2y()      { return waveVelocity2Uniform.value.y; },
        set vel2y(v)     { waveVelocity2Uniform.value.y = v; },
        get edgeFade()   { return edgeFadeDistanceUniform.value as number; },
        set edgeFade(v)  { edgeFadeDistanceUniform.value = v; },
        get horizonFadeStart() { return horizonFadeStartUniform.value as number; },
        set horizonFadeStart(v) { horizonFadeStartUniform.value = v; },
        get horizonFadeEnd()   { return horizonFadeEndUniform.value as number; },
        set horizonFadeEnd(v)  { horizonFadeEndUniform.value = v; },
        get dispAmp()    { return surfaceWaveAmplitudeUniform.value as number; },
        set dispAmp(v)   { surfaceWaveAmplitudeUniform.value = v; },
        get dispLen()    { return surfaceWaveLengthUniform.value as number; },
        set dispLen(v)   { surfaceWaveLengthUniform.value = v; },
        get dispSpeed()  { return surfaceWaveSpeedUniform.value as number; },
        set dispSpeed(v) { surfaceWaveSpeedUniform.value = v; },
        get dispRange()  { return surfaceWaveRangeUniform.value as number; },
        set dispRange(v) { surfaceWaveRangeUniform.value = v; },
        get dispFwd()    { return surfaceWaveForwardBiasUniform.value as number; },
        set dispFwd(v)   { surfaceWaveForwardBiasUniform.value = v; },
        get dispSteep()  { return surfaceWaveSteepnessUniform.value as number; },
        set dispSteep(v) { surfaceWaveSteepnessUniform.value = v; },
    };

    wavesFolder.add(wavesProxy, 'nmScale',    0, 1,    0.001).name('NormalMap Scale').listen();
    wavesFolder.add(wavesProxy, 'nmStrength', 0, 3,    0.01 ).name('NormalMap Strength').listen();
    wavesFolder.add(wavesProxy, 'vel1x',   -0.5, 0.5,  0.001).name('Wave1 Vel X').listen();
    wavesFolder.add(wavesProxy, 'vel1y',   -0.5, 0.5,  0.001).name('Wave1 Vel Y').listen();
    wavesFolder.add(wavesProxy, 'vel2x',   -0.5, 0.5,  0.001).name('Wave2 Vel X').listen();
    wavesFolder.add(wavesProxy, 'vel2y',   -0.5, 0.5,  0.001).name('Wave2 Vel Y').listen();
    wavesFolder.add(wavesProxy, 'edgeFade', 0,   5,    0.01 ).name('Edge Fade Distance').listen();
    wavesFolder.add(wavesProxy, 'horizonFadeStart', 0, 1, 0.005).name('Horizon Haze Start (angle)').listen();
    wavesFolder.add(wavesProxy, 'horizonFadeEnd',   0, 1, 0.005).name('Horizon Haze End (angle)').listen();

    // Near-camera vertex displacement (real geometry swell ahead of the camera)
    wavesFolder.add(wavesProxy, 'dispAmp',   0,   0.4,  0.001).name('Displace Amplitude').listen();
    wavesFolder.add(wavesProxy, 'dispLen',   0.5, 30,   0.1  ).name('Displace Wavelength').listen();
    wavesFolder.add(wavesProxy, 'dispSpeed', 0,   3,    0.01 ).name('Displace Speed').listen();
    wavesFolder.add(wavesProxy, 'dispRange', 1,   80,   0.5  ).name('Displace Range').listen();
    wavesFolder.add(wavesProxy, 'dispFwd',   0,   1,    0.01 ).name('Forward Bias').listen();
    wavesFolder.add(wavesProxy, 'dispSteep', 0,   1,    0.01 ).name('Displace Steepness').listen();

    wavesFolder.close();

    // ── Ocean Surface ────────────────────────────────────────────────────────
    const surfProxy = {
        get r()       { return surfaceColorUniform.value.x; },
        set r(v)      { surfaceColorUniform.value.x = v; },
        get g()       { return surfaceColorUniform.value.y; },
        set g(v)      { surfaceColorUniform.value.y = v; },
        get b()       { return surfaceColorUniform.value.z; },
        set b(v)      { surfaceColorUniform.value.z = v; },
        get opacity() { return surfaceOpacityUniform.value as number; },
        set opacity(v){ surfaceOpacityUniform.value = v; },
    };

    surfFolder.add(surfProxy, 'r', 0, 2, 0.01).name('Tint R').listen();
    surfFolder.add(surfProxy, 'g', 0, 2, 0.01).name('Tint G').listen();
    surfFolder.add(surfProxy, 'b', 0, 2, 0.01).name('Tint B').listen();
    surfFolder.add(surfProxy, 'opacity', 0, 1, 0.01).name('Surface Opacity').listen();

    surfFolder.close();

    // ── Ocean Foam ───────────────────────────────────────────────────────────
    const foamProxy = {
        get offsetX()    { return foamCenterOffsetUniform.value.x; },
        set offsetX(v)   { foamCenterOffsetUniform.value.x = v; },
        get offsetZ()    { return foamCenterOffsetUniform.value.y; },
        set offsetZ(v)   { foamCenterOffsetUniform.value.y = v; },
        get radius()     { return foamRadiusUniform.value as number; },
        set radius(v)    { foamRadiusUniform.value = v; },
        get width()      { return foamWidthUniform.value as number; },
        set width(v)     { foamWidthUniform.value = v; },
        get intensity()  { return foamIntensityUniform.value as number; },
        set intensity(v) { foamIntensityUniform.value = v; },
        get animSpeed()  { return foamAnimSpeedUniform.value as number; },
        set animSpeed(v) { foamAnimSpeedUniform.value = v; },
        get edgeNoise()  { return foamEdgeNoiseAmtUniform.value as number; },
        set edgeNoise(v) { foamEdgeNoiseAmtUniform.value = v; },
        get wobbleAmt()  { return foamWobbleAmtUniform.value as number; },
        set wobbleAmt(v) { foamWobbleAmtUniform.value = v; },
        get wobbleFreq() { return foamWobbleFreqUniform.value as number; },
        set wobbleFreq(v){ foamWobbleFreqUniform.value = v; },
        get wobbleSpd()  { return foamWobbleSpeedUniform.value as number; },
        set wobbleSpd(v) { foamWobbleSpeedUniform.value = v; },
        get lineFreq()   { return foamLineFrequencyUniform.value as number; },
        set lineFreq(v)  { foamLineFrequencyUniform.value = v; },
        get lineThick()  { return foamLineThicknessUniform.value as number; },
        set lineThick(v) { foamLineThicknessUniform.value = v; },
        get lineCount()  { return foamLineCountUniform.value as number; },
        set lineCount(v) { foamLineCountUniform.value = v; },
        get breakup()    { return foamLineBreakupUniform.value as number; },
        set breakup(v)   { foamLineBreakupUniform.value = v; },
        get colorR()     { return foamLineColorUniform.value.x; },
        set colorR(v)    { foamLineColorUniform.value.x = v; },
        get colorG()     { return foamLineColorUniform.value.y; },
        set colorG(v)    { foamLineColorUniform.value.y = v; },
        get colorB()     { return foamLineColorUniform.value.z; },
        set colorB(v)    { foamLineColorUniform.value.z = v; },
    };

    foamFolder.add(foamProxy, 'offsetX',   -5,  5,   0.01).name('Center Offset X').listen();
    foamFolder.add(foamProxy, 'offsetZ',   -5,  5,   0.01).name('Center Offset Z').listen();
    foamFolder.add(foamProxy, 'radius',   0.5,  1.5, 0.01).name('Ring Radius').listen();
    foamFolder.add(foamProxy, 'width',      0,  1,   0.001).name('Band Width').listen();
    foamFolder.add(foamProxy, 'intensity',  0,  2,   0.01).name('Intensity').listen();
    foamFolder.add(foamProxy, 'animSpeed',  0,  3,   0.01).name('Anim Speed').listen();
    foamFolder.add(foamProxy, 'edgeNoise',  0,  1,   0.01).name('Edge Noise').listen();
    foamFolder.add(foamProxy, 'wobbleAmt',  0,  1,   0.01).name('Wobble Amount').listen();
    foamFolder.add(foamProxy, 'wobbleFreq', 0, 10,   0.1 ).name('Wobble Freq').listen();
    foamFolder.add(foamProxy, 'wobbleSpd',  0,  3,   0.01).name('Wobble Speed').listen();
    foamFolder.add(foamProxy, 'lineFreq',   0, 30,   0.1 ).name('Line Frequency').listen();
    foamFolder.add(foamProxy, 'lineThick',  0, 0.12, 0.001).name('Line Thickness').listen();
    foamFolder.add(foamProxy, 'lineCount',  1,  6,   1   ).name('Line Count').listen();
    foamFolder.add(foamProxy, 'breakup',    0,  1,   0.01).name('Line Breakup').listen();
    foamFolder.add(foamProxy, 'colorR',     0,  2,   0.01).name('Line Color R').listen();
    foamFolder.add(foamProxy, 'colorG',     0,  2,   0.01).name('Line Color G').listen();
    foamFolder.add(foamProxy, 'colorB',     0,  2,   0.01).name('Line Color B').listen();

    foamFolder.close();

    const surfaceBlurFolder = oceanFolder.addFolder('Surface Blur');
    const surfaceBlurProxy = {
        get blurStrength() { return waterBlurStrengthUniform.value as number; },
        set blurStrength(v) { waterBlurStrengthUniform.value = v; },
        get blurRadius() { return waterBlurRadiusUniform.value as number; },
        set blurRadius(v) { waterBlurRadiusUniform.value = v; },
        get blurOpacity() { return waterBlurOpacityUniform.value as number; },
        set blurOpacity(v) { waterBlurOpacityUniform.value = v; },
        get compositeOpacity() { return waterlineCompositeOpacityUniform.value as number; },
        set compositeOpacity(v) { waterlineCompositeOpacityUniform.value = v; },
        get y() { return waterlineYUniform.value as number; },
        set y(v) { waterlineYUniform.value = v; },
    };
    surfaceBlurFolder.add(surfaceBlurProxy, 'blurStrength', 0, 0.05, 0.0005).name('Blur Strength').listen();
    surfaceBlurFolder.add(surfaceBlurProxy, 'blurRadius', 0, 6, 0.1).name('Blur Radius').listen();
    surfaceBlurFolder.add(surfaceBlurProxy, 'blurOpacity', 0, 1, 0.01).name('Blur Opacity').listen();
    surfaceBlurFolder.add(surfaceBlurProxy, 'compositeOpacity', 0, 1, 0.01).name('Composite Opacity').listen();
    surfaceBlurFolder.add(surfaceBlurProxy, 'y', -1, 1, 0.005).name('Waterline Y (buoyancy)').listen();
    surfaceBlurFolder.close();

    const edgeFoamFolder = oceanFolder.addFolder('Edge Foam (depth)');
    const edgeFoamProxy = {
        get width()     { return edgeFoamWidthUniform.value as number; },
        set width(v)    { edgeFoamWidthUniform.value = v; },
        get intensity() { return edgeFoamIntensityUniform.value as number; },
        set intensity(v) { edgeFoamIntensityUniform.value = v; },
        get underwaterMul() { return edgeFoamUnderwaterMulUniform.value as number; },
        set underwaterMul(v) { edgeFoamUnderwaterMulUniform.value = v; },
        get colorR()    { return edgeFoamColorUniform.value.x; },
        set colorR(v)   { edgeFoamColorUniform.value.x = v; },
        get colorG()    { return edgeFoamColorUniform.value.y; },
        set colorG(v)   { edgeFoamColorUniform.value.y = v; },
        get colorB()    { return edgeFoamColorUniform.value.z; },
        set colorB(v)   { edgeFoamColorUniform.value.z = v; },
        get fadeStartZ() { return edgeFoamFadeStartZUniform.value as number; },
        set fadeStartZ(v) { edgeFoamFadeStartZUniform.value = v; },
        get fadeEndZ()   { return edgeFoamFadeEndZUniform.value as number; },
        set fadeEndZ(v)  { edgeFoamFadeEndZUniform.value = v; },
    };
    edgeFoamFolder.add(edgeFoamProxy, 'width', 0, 2, 0.01).name('Width (world units)').listen();
    edgeFoamFolder.add(edgeFoamProxy, 'intensity', 0, 3, 0.01).name('Intensity (above water)').listen();
    edgeFoamFolder.add(edgeFoamProxy, 'underwaterMul', 0, 1.5, 0.01).name('Underwater dim').listen();
    edgeFoamFolder.add(edgeFoamProxy, 'colorR', 0, 2, 0.01).name('Color R').listen();
    edgeFoamFolder.add(edgeFoamProxy, 'colorG', 0, 2, 0.01).name('Color G').listen();
    edgeFoamFolder.add(edgeFoamProxy, 'colorB', 0, 2, 0.01).name('Color B').listen();
    edgeFoamFolder.add(edgeFoamProxy, 'fadeStartZ', -60, 5, 0.1).name('Fade start Z (full)').listen();
    edgeFoamFolder.add(edgeFoamProxy, 'fadeEndZ', -60, 5, 0.1).name('Fade end Z (gone)').listen();
    edgeFoamFolder.close();

    // ── Wind Lines ────────────────────────────────────────────────────────────
    const wc = WindLines.config;

    const windProxy = {
        // spawning
        get maxLines()    { return wc.maxLines; },
        set maxLines(v)   { wc.maxLines = Math.round(v); },
        get spawnRate()   { return wc.spawnRate; },
        set spawnRate(v)  { wc.spawnRate = v; },
        get rampUp()      { return wc.rampUp; },
        set rampUp(v)     { wc.rampUp = v; },
        get rampDown()    { return wc.rampDown; },
        set rampDown(v)   { wc.rampDown = v; },
        // line
        get minLength()   { return wc.minLength; },
        set minLength(v)  { wc.minLength = v; },
        get maxLength()   { return wc.maxLength; },
        set maxLength(v)  { wc.maxLength = v; },
        get tiltY()       { return wc.tiltY; },
        set tiltY(v)      { wc.tiltY = v; },
        get minWorldY()   { return wc.minWorldY; },
        set minWorldY(v)  { wc.minWorldY = v; },
        get maxWorldY()   { return wc.maxWorldY; },
        set maxWorldY(v)  { wc.maxWorldY = v; },
        // width
        get minWidth()    { return wc.minWidth; },
        set minWidth(v)   { wc.minWidth = v; },
        get maxWidth()    { return wc.maxWidth; },
        set maxWidth(v)   { wc.maxWidth = v; },
        // speed
        get minSpeed()    { return wc.minSpeed; },
        set minSpeed(v)   { wc.minSpeed = v; },
        get maxSpeed()    { return wc.maxSpeed; },
        set maxSpeed(v)   { wc.maxSpeed = v; },
        // appearance
        get lineOpacity() { return wc.lineOpacity; },
        set lineOpacity(v){ wc.lineOpacity = v; },
        get colorR()      { return wc.colorR; },
        set colorR(v)     { wc.colorR = Math.round(v); },
        get colorG()      { return wc.colorG; },
        set colorG(v)     { wc.colorG = Math.round(v); },
        get colorB()      { return wc.colorB; },
        set colorB(v)     { wc.colorB = Math.round(v); },
        // wave
        get waveAmplitude()  { return wc.waveAmplitude; },
        set waveAmplitude(v) { wc.waveAmplitude = v; },
        get waveFrequency()  { return wc.waveFrequency; },
        set waveFrequency(v) { wc.waveFrequency = v; },
        get waveSpeed()      { return wc.waveSpeed; },
        set waveSpeed(v)     { wc.waveSpeed = v; },
        get waveSegments()   { return wc.waveSegments; },
        set waveSegments(v)  { wc.waveSegments = Math.round(v); },
        // depth
        get minZOffset()          { return wc.minZOffset; },
        set minZOffset(v)         { wc.minZOffset = v; },
        get maxZOffset()          { return wc.maxZOffset; },
        set maxZOffset(v)         { wc.maxZOffset = v; },
        // proximity fade
        get islandDisappearDist() { return wc.islandDisappearDist; },
        set islandDisappearDist(v){ wc.islandDisappearDist = v; },
        get islandAppearDist()    { return wc.islandAppearDist; },
        set islandAppearDist(v)   { wc.islandAppearDist = v; },
    };

    const windSpawnFolder = windFolder.addFolder('Spawning');
    windSpawnFolder.add(windProxy, 'maxLines',  1, 50,  1   ).name('Max Lines').listen();
    windSpawnFolder.add(windProxy, 'spawnRate', 0, 20,  0.1 ).name('Spawn Rate (lines/s)').listen();
    windSpawnFolder.add(windProxy, 'rampUp',    0.1, 5, 0.05).name('Ramp Up (s)').listen();
    windSpawnFolder.add(windProxy, 'rampDown',  0.1,10, 0.1 ).name('Ramp Down (s)').listen();
    windSpawnFolder.close();

    const windLineFolder = windFolder.addFolder('Line Shape');
    windLineFolder.add(windProxy, 'minLength',  10, 500,  1    ).name('Min Length (px)').listen();
    windLineFolder.add(windProxy, 'maxLength',  10, 800,  1    ).name('Max Length (px)').listen();
    windLineFolder.add(windProxy, 'tiltY',       0,  0.3, 0.001).name('Tilt Y').listen();
    windLineFolder.add(windProxy, 'minWorldY', -5,  5,  0.05).name('Y Spawn Min (world)').listen();
    windLineFolder.add(windProxy, 'maxWorldY', -5,  5,  0.05).name('Y Spawn Max (world)').listen();
    windLineFolder.close();

    const windVisFolder = windFolder.addFolder('Appearance');
    windVisFolder.add(windProxy, 'minWidth',    0.1, 5,   0.05 ).name('Min Width (px)').listen();
    windVisFolder.add(windProxy, 'maxWidth',    0.1, 8,   0.05 ).name('Max Width (px)').listen();
    windVisFolder.add(windProxy, 'minSpeed',    10, 1500, 5    ).name('Min Speed (px/s)').listen();
    windVisFolder.add(windProxy, 'maxSpeed',    10, 2000, 5    ).name('Max Speed (px/s)').listen();
    windVisFolder.add(windProxy, 'lineOpacity',  0,  1,   0.01 ).name('Line Opacity').listen();
    windVisFolder.add(windProxy, 'colorR',       0, 255,  1    ).name('Color R').listen();
    windVisFolder.add(windProxy, 'colorG',       0, 255,  1    ).name('Color G').listen();
    windVisFolder.add(windProxy, 'colorB',       0, 255,  1    ).name('Color B').listen();
    windVisFolder.close();

    const windWaveFolder = windFolder.addFolder('Wave / Wobble');
    windWaveFolder.add(windProxy, 'waveAmplitude',  0, 40,  0.5).name('Amplitude (px)').listen();
    windWaveFolder.add(windProxy, 'waveFrequency',  0,  6,  0.1).name('Frequency (cycles/line)').listen();
    windWaveFolder.add(windProxy, 'waveSpeed',      0, 10,  0.1).name('Speed (rad/s)').listen();
    windWaveFolder.add(windProxy, 'waveSegments',   4, 60,  1  ).name('Segments (quality)').listen();
    windWaveFolder.close();

    const windDepthFolder = windFolder.addFolder('3D Depth (Z spread)');
    windDepthFolder.add(windProxy, 'minZOffset', -6, 0,   0.1).name('Z Offset Min (further)').listen();
    windDepthFolder.add(windProxy, 'maxZOffset', -2, 4,   0.1).name('Z Offset Max (closer)').listen();
    windDepthFolder.close();

    const windFadeFolder = windFolder.addFolder('Proximity Fade');
    windFadeFolder.add(windProxy, 'islandDisappearDist', 0, 20, 0.1).name('Fade-out dist left of island').listen();
    windFadeFolder.add(windProxy, 'islandAppearDist',    0, 20, 0.1).name('Fade-in dist right of island').listen();
    windFadeFolder.close();

    windFolder.close();
    // ── Underwater Fog ───────────────────────────────────────────────────────
    const fogProxy = {
        get absR()       { return oceanAbsorptionUniform.value.x; },
        set absR(v)      { oceanAbsorptionUniform.value.x = v; },
        get absG()       { return oceanAbsorptionUniform.value.y; },
        set absG(v)      { oceanAbsorptionUniform.value.y = v; },
        get absB()       { return oceanAbsorptionUniform.value.z; },
        set absB(v)      { oceanAbsorptionUniform.value.z = v; },
        get fogDist()    { return underwaterFogDistUniform.value; },
        set fogDist(v)   { underwaterFogDistUniform.value = v; },
        get distortion() { return _fogState.distortion; },
        set distortion(v){ _fogState.distortion = v; setUnderwaterDistortion(v); },
        get speed()      { return _fogState.speed; },
        set speed(v)     { _fogState.speed = v; setUnderwaterSpeed(v); },
        get scale()      { return _fogState.scale; },
        set scale(v)     { _fogState.scale = v; setUnderwaterScale(v); },
        get edgeFade()   { return _fogState.edgeFade; },
        set edgeFade(v)  { _fogState.edgeFade = v; setUnderwaterEdgeFade(v); },
    };

    fogFolder.add(fogProxy, 'absR',  0, 1,    0.001 ).name('Absorption R').listen();
    fogFolder.add(fogProxy, 'absG',  0, 1,    0.001 ).name('Absorption G').listen();
    fogFolder.add(fogProxy, 'absB',  0, 1,    0.001 ).name('Absorption B').listen();
    fogFolder.add(fogProxy, 'fogDist', 1, 400, 1    ).name('Fog Far Distance').listen();
    fogFolder.add(fogProxy, 'distortion', 0, 0.05,  0.0001).name('Distortion Strength').listen();
    fogFolder.add(fogProxy, 'speed',      0, 5,     0.01  ).name('Distortion Speed').listen();
    fogFolder.add(fogProxy, 'scale',      0, 30,    0.1   ).name('Distortion Scale').listen();
    fogFolder.add(fogProxy, 'edgeFade',   0, 0.2,   0.001 ).name('Distortion Edge Fade').listen();

    fogFolder.close();

    // ── Seafloor Decorations ──────────────────────────────────────────────────
    const sfFolder = seafloorFolder;
    const sf = SeaFloorDecor.config;

    // ── Copy config action ────────────────────────────────────────────────────
    const sfActions = {
        copyConfig: () => {
            const f = (n: number) => n.toFixed(4);
            const content = [
                `// src/scene/config/SeaFloorConfig.ts`,
                `// Explicit placement for every seafloor decoration.`,
                `// All rotations are in radians.`,
                ``,
                `// -- Coral Rocks ---------------------------------------------------------------`,
                `export const rock1 = { x: ${f(sf.rock1.x)}, y: ${f(sf.rock1.y)}, z: ${f(sf.rock1.z)}, scale: ${f(sf.rock1.scale)}, rx: ${f(sf.rock1.rx)}, ry: ${f(sf.rock1.ry)}, rz: ${f(sf.rock1.rz)} };`,
                `export const rock2 = { x: ${f(sf.rock2.x)}, y: ${f(sf.rock2.y)}, z: ${f(sf.rock2.z)}, scale: ${f(sf.rock2.scale)}, rx: ${f(sf.rock2.rx)}, ry: ${f(sf.rock2.ry)}, rz: ${f(sf.rock2.rz)} };`,
                `export const rock3 = { x: ${f(sf.rock3.x)}, y: ${f(sf.rock3.y)}, z: ${f(sf.rock3.z)}, scale: ${f(sf.rock3.scale)}, rx: ${f(sf.rock3.rx)}, ry: ${f(sf.rock3.ry)}, rz: ${f(sf.rock3.rz)} };`,
                ``,
                `// -- Corals --------------------------------------------------------------------`,
                `export const coral1 = { x: ${f(sf.coral1.x)}, y: ${f(sf.coral1.y)}, z: ${f(sf.coral1.z)}, scale: ${f(sf.coral1.scale)}, rx: ${f(sf.coral1.rx)}, ry: ${f(sf.coral1.ry)}, rz: ${f(sf.coral1.rz)}, r: ${f(sf.coral1.r)}, g: ${f(sf.coral1.g)}, b: ${f(sf.coral1.b)} };`,
                `export const coral2 = { x: ${f(sf.coral2.x)}, y: ${f(sf.coral2.y)}, z: ${f(sf.coral2.z)}, scale: ${f(sf.coral2.scale)}, rx: ${f(sf.coral2.rx)}, ry: ${f(sf.coral2.ry)}, rz: ${f(sf.coral2.rz)}, r: ${f(sf.coral2.r)}, g: ${f(sf.coral2.g)}, b: ${f(sf.coral2.b)} };`,
                `export const coral3 = { x: ${f(sf.coral3.x)}, y: ${f(sf.coral3.y)}, z: ${f(sf.coral3.z)}, scale: ${f(sf.coral3.scale)}, rx: ${f(sf.coral3.rx)}, ry: ${f(sf.coral3.ry)}, rz: ${f(sf.coral3.rz)}, r: ${f(sf.coral3.r)}, g: ${f(sf.coral3.g)}, b: ${f(sf.coral3.b)} };`,
                ``,
                `// -- Kelps ---------------------------------------------------------------------`,
                `export const kelp1 = { x: ${f(sf.kelp1.x)}, y: ${f(sf.kelp1.y)}, z: ${f(sf.kelp1.z)}, scale: ${f(sf.kelp1.scale)}, rx: ${f(sf.kelp1.rx)}, ry: ${f(sf.kelp1.ry)}, rz: ${f(sf.kelp1.rz)} };`,
                `export const kelp2 = { x: ${f(sf.kelp2.x)}, y: ${f(sf.kelp2.y)}, z: ${f(sf.kelp2.z)}, scale: ${f(sf.kelp2.scale)}, rx: ${f(sf.kelp2.rx)}, ry: ${f(sf.kelp2.ry)}, rz: ${f(sf.kelp2.rz)} };`,
                `export const kelp3 = { x: ${f(sf.kelp3.x)}, y: ${f(sf.kelp3.y)}, z: ${f(sf.kelp3.z)}, scale: ${f(sf.kelp3.scale)}, rx: ${f(sf.kelp3.rx)}, ry: ${f(sf.kelp3.ry)}, rz: ${f(sf.kelp3.rz)} };`,
                ``,
                `// -- Kelp Sway (underwater current) -------------------------------------------`,
                `export const kelpTopY          = ${f(sf.kelpTopY)};`,
                `export const kelpSwayStrength  = ${f(sf.kelpSwayStrength)};`,
                `export const kelpSwaySpeed     = ${f(sf.kelpSwaySpeed)};`,
                `export const kelpSwayFrequency = ${f(sf.kelpSwayFrequency)};`,
                ``,
                `// -- Chest ---------------------------------------------------------------------`,
                `export const chest = { x: ${f(sf.chest.x)}, y: ${f(sf.chest.y)}, z: ${f(sf.chest.z)}, scale: ${f(sf.chest.scale)}, rx: ${f(sf.chest.rx)}, ry: ${f(sf.chest.ry)}, rz: ${f(sf.chest.rz)} };`,
                ``,
                `// -- Chest Zoom ----------------------------------------------------------------`,
                `export const chestZoomDist       = ${f(sf.chestZoomDist)};`,
                `export const chestZoomHeight     = ${f(sf.chestZoomHeight)};`,
                `export const chestZoomFov        = ${f(sf.chestZoomFov)};`,
                `export const chestZoomMobileFov  = ${f(sf.chestZoomMobileFov)};`,
                `export const chestZoomPitch      = ${f(sf.chestZoomPitch)};`,
                `// Camera pitch while zoomed (radians, negative = look down)`,
                ``,
                `// -- Chest Glow ---------------------------------------------------------------`,
                `export const chestGlowX         = ${f(sf.chestGlowX)};`,
                `export const chestGlowY         = ${f(sf.chestGlowY)};`,
                `export const chestGlowZ         = ${f(sf.chestGlowZ)};`,
                `export const chestGlowIntensity = ${f(sf.chestGlowIntensity)};`,
                `export const chestGlowDistance  = ${f(sf.chestGlowDistance)};`,
                ``,
                `// -- Chest Rays ---------------------------------------------------------------`,
                `export const chestRayRadius     = ${f(sf.chestRayRadius)};`,
                `export const chestRayMaxOpacity = ${f(sf.chestRayMaxOpacity)};`,
                ``,
                `// -- Chest Coins (placed inside chest, in chest-group local space) -------------`,
                `export const chestCoinRevealDelay = ${f(sf.chestCoinRevealDelay)};`,
                `export const chestCoinHideDelay   = ${f(sf.chestCoinHideDelay)};`,
                `export const chestCoin1 = { x: ${f(sf.chestCoin1.x)}, y: ${f(sf.chestCoin1.y)}, z: ${f(sf.chestCoin1.z)}, scale: ${f(sf.chestCoin1.scale)}, rx: ${f(sf.chestCoin1.rx)}, ry: ${f(sf.chestCoin1.ry)}, rz: ${f(sf.chestCoin1.rz)} };`,
                `export const chestCoin2 = { x: ${f(sf.chestCoin2.x)}, y: ${f(sf.chestCoin2.y)}, z: ${f(sf.chestCoin2.z)}, scale: ${f(sf.chestCoin2.scale)}, rx: ${f(sf.chestCoin2.rx)}, ry: ${f(sf.chestCoin2.ry)}, rz: ${f(sf.chestCoin2.rz)} };`,
                `export const chestCoin3 = { x: ${f(sf.chestCoin3.x)}, y: ${f(sf.chestCoin3.y)}, z: ${f(sf.chestCoin3.z)}, scale: ${f(sf.chestCoin3.scale)}, rx: ${f(sf.chestCoin3.rx)}, ry: ${f(sf.chestCoin3.ry)}, rz: ${f(sf.chestCoin3.rz)} };`,
                ``,
                `// -- Chest Coin Colors (bodyR/G/B = ring+star, circleR/G/B = inner disc) ------`,
                `export const chestCoin1Color = { bodyR: ${f(sf.chestCoin1Color.bodyR)}, bodyG: ${f(sf.chestCoin1Color.bodyG)}, bodyB: ${f(sf.chestCoin1Color.bodyB)}, circleR: ${f(sf.chestCoin1Color.circleR)}, circleG: ${f(sf.chestCoin1Color.circleG)}, circleB: ${f(sf.chestCoin1Color.circleB)} };`,
                `export const chestCoin2Color = { bodyR: ${f(sf.chestCoin2Color.bodyR)}, bodyG: ${f(sf.chestCoin2Color.bodyG)}, bodyB: ${f(sf.chestCoin2Color.bodyB)}, circleR: ${f(sf.chestCoin2Color.circleR)}, circleG: ${f(sf.chestCoin2Color.circleG)}, circleB: ${f(sf.chestCoin2Color.circleB)} };`,
                `export const chestCoin3Color = { bodyR: ${f(sf.chestCoin3Color.bodyR)}, bodyG: ${f(sf.chestCoin3Color.bodyG)}, bodyB: ${f(sf.chestCoin3Color.bodyB)}, circleR: ${f(sf.chestCoin3Color.circleR)}, circleG: ${f(sf.chestCoin3Color.circleG)}, circleB: ${f(sf.chestCoin3Color.circleB)} };`,
                ``,
                `// -- Extra corals scattered around the coral rocks ----------------------------`,
                `export const coral1Left  = { x: ${f(sf.coral1Left.x )}, y: ${f(sf.coral1Left.y )}, z: ${f(sf.coral1Left.z )}, scale: ${f(sf.coral1Left.scale )}, rx: ${f(sf.coral1Left.rx )}, ry: ${f(sf.coral1Left.ry )}, rz: ${f(sf.coral1Left.rz )}, r: ${f(sf.coral1Left.r )}, g: ${f(sf.coral1Left.g )}, b: ${f(sf.coral1Left.b )} };`,
                `export const coral1Right = { x: ${f(sf.coral1Right.x)}, y: ${f(sf.coral1Right.y)}, z: ${f(sf.coral1Right.z)}, scale: ${f(sf.coral1Right.scale)}, rx: ${f(sf.coral1Right.rx)}, ry: ${f(sf.coral1Right.ry)}, rz: ${f(sf.coral1Right.rz)}, r: ${f(sf.coral1Right.r)}, g: ${f(sf.coral1Right.g)}, b: ${f(sf.coral1Right.b)} };`,
                `export const coral2Left  = { x: ${f(sf.coral2Left.x )}, y: ${f(sf.coral2Left.y )}, z: ${f(sf.coral2Left.z )}, scale: ${f(sf.coral2Left.scale )}, rx: ${f(sf.coral2Left.rx )}, ry: ${f(sf.coral2Left.ry )}, rz: ${f(sf.coral2Left.rz )}, r: ${f(sf.coral2Left.r )}, g: ${f(sf.coral2Left.g )}, b: ${f(sf.coral2Left.b )} };`,
                `export const coral2Right = { x: ${f(sf.coral2Right.x)}, y: ${f(sf.coral2Right.y)}, z: ${f(sf.coral2Right.z)}, scale: ${f(sf.coral2Right.scale)}, rx: ${f(sf.coral2Right.rx)}, ry: ${f(sf.coral2Right.ry)}, rz: ${f(sf.coral2Right.rz)}, r: ${f(sf.coral2Right.r)}, g: ${f(sf.coral2Right.g)}, b: ${f(sf.coral2Right.b)} };`,
                ``,
                `// -- Anemone (left of the coral rocks) ----------------------------------------`,
                `export const anemone           = { x: ${f(sf.anemone.x)}, y: ${f(sf.anemone.y)}, z: ${f(sf.anemone.z)}, scale: ${f(sf.anemone.scale)}, rx: ${f(sf.anemone.rx)}, ry: ${f(sf.anemone.ry)}, rz: ${f(sf.anemone.rz)} };`,
                `export const anemoneTopY       = ${f(sf.anemoneTopY)};`,
                `export const anemoneSwayStrength  = ${f(sf.anemoneSwayStrength)};`,
                `export const anemoneSwaySpeed     = ${f(sf.anemoneSwaySpeed)};`,
                `export const anemoneSwayFrequency = ${f(sf.anemoneSwayFrequency)};`,
                ``,
                `// -- Mini clownfish swimming around the anemone -------------------------------`,
                `export const anemoneFish1 = { x: ${f(sf.anemoneFish1.x)}, y: ${f(sf.anemoneFish1.y)}, z: ${f(sf.anemoneFish1.z)}, scale: ${f(sf.anemoneFish1.scale)}, swimRadius: ${f(sf.anemoneFish1.swimRadius)}, period: ${f(sf.anemoneFish1.period)}, phase: ${f(sf.anemoneFish1.phase)} };`,
                `export const anemoneFish2 = { x: ${f(sf.anemoneFish2.x)}, y: ${f(sf.anemoneFish2.y)}, z: ${f(sf.anemoneFish2.z)}, scale: ${f(sf.anemoneFish2.scale)}, swimRadius: ${f(sf.anemoneFish2.swimRadius)}, period: ${f(sf.anemoneFish2.period)}, phase: ${f(sf.anemoneFish2.phase)} };`,
                ``,
                `// -- Starfish on the seafloor near the chest -----------------------------------`,
                `export const starfish = { x: ${f(sf.starfish.x)}, y: ${f(sf.starfish.y)}, z: ${f(sf.starfish.z)}, scale: ${f(sf.starfish.scale)}, rx: ${f(sf.starfish.rx)}, ry: ${f(sf.starfish.ry)}, rz: ${f(sf.starfish.rz)} };`,
                ``,
                `// -- Crab behind the chest, slightly to the right ------------------------------`,
                `export const crab = { x: ${f(sf.crab.x)}, y: ${f(sf.crab.y)}, z: ${f(sf.crab.z)}, scale: ${f(sf.crab.scale)}, rx: ${f(sf.crab.rx)}, ry: ${f(sf.crab.ry)}, rz: ${f(sf.crab.rz)} };`,
            ].join('\n');
            navigator.clipboard.writeText(content).then(() => {
                console.log('[Debug] SeaFloorConfig.ts content copied to clipboard!');
            });
        },
    };
    sfFolder.add(sfActions, 'copyConfig').name('Copy SeaFloorConfig.ts');

    // ── Seafloor subfolders — alphabetical order ──────────────────────────────
    const sfChestFolder  = sfFolder.addFolder('Chest');
    const sfRocksFolder  = sfFolder.addFolder('Coral Rocks');
    const sfCoralsFolder = sfFolder.addFolder('Corals');
    const sfKelpFolder   = sfFolder.addFolder('Kelps');

    // ── Helper: make per-model placement sub-folder ───────────────────────────
    function makePlacementFolder(
        parent: any,
        label: string,
        getCfg: () => { x: number; y: number; z: number; scale: number; rx: number; ry: number; rz: number },
        onTransform: () => void,
        yRange?: [number, number],
    ): void {
        const folder = parent.addFolder(label);
        const proxy = {
            get x()     { return getCfg().x;     }, set x(v)     { getCfg().x     = v; onTransform(); },
            get y()     { return getCfg().y;     }, set y(v)     { getCfg().y     = v; onTransform(); },
            get z()     { return getCfg().z;     }, set z(v)     { getCfg().z     = v; onTransform(); },
            get scale() { return getCfg().scale; }, set scale(v) { getCfg().scale = v; onTransform(); },
            get rx()    { return getCfg().rx;    }, set rx(v)    { getCfg().rx    = v; onTransform(); },
            get ry()    { return getCfg().ry;    }, set ry(v)    { getCfg().ry    = v; onTransform(); },
            get rz()    { return getCfg().rz;    }, set rz(v)    { getCfg().rz    = v; onTransform(); },
        };
        const yMin = yRange ? yRange[0] : -20;
        const yMax = yRange ? yRange[1] :   0;
        folder.add(proxy, 'x',     -30, 30,   0.05).name('X').listen();
        folder.add(proxy, 'y',  yMin, yMax,   0.05).name('Y').listen();
        folder.add(proxy, 'z',     -30, 30,   0.05).name('Z').listen();
        folder.add(proxy, 'scale',   0,  5,   0.01).name('Scale').listen();
        folder.add(proxy, 'rx', -3.14, 3.14,  0.01).name('Rot X').listen();
        folder.add(proxy, 'ry', -3.14, 3.14,  0.01).name('Rot Y').listen();
        folder.add(proxy, 'rz', -3.14, 3.14,  0.01).name('Rot Z').listen();
        folder.close();
    }

    // ── Coral Rocks ─────────────────────────────────────────────────────────
    makePlacementFolder(sfRocksFolder, 'Rock 1', () => sf.rock1,  () => SeaFloorDecor.updateRockTransform(0));
    makePlacementFolder(sfRocksFolder, 'Rock 2', () => sf.rock2,  () => SeaFloorDecor.updateRockTransform(1));
    makePlacementFolder(sfRocksFolder, 'Rock 3', () => sf.rock3,  () => SeaFloorDecor.updateRockTransform(2));
    sfRocksFolder.close();

    // ── Corals ───────────────────────────────────────────────────────────────
    ([0, 1, 2] as const).forEach((i) => {
        const key = (['coral1', 'coral2', 'coral3'] as const)[i];
        const num = i + 1;
        makePlacementFolder(sfCoralsFolder, `Coral ${num}`, () => sf[key], () => SeaFloorDecor.updateCoralTransform(i));
        // Color sub-folder inside each coral folder (last added child)
        const coralFolder = sfCoralsFolder.children[sfCoralsFolder.children.length - 1] as any;
        const colorProxy = {
            get r() { return sf[key].r; }, set r(v) { sf[key].r = v; SeaFloorDecor.updateCoralColor(i); },
            get g() { return sf[key].g; }, set g(v) { sf[key].g = v; SeaFloorDecor.updateCoralColor(i); },
            get b() { return sf[key].b; }, set b(v) { sf[key].b = v; SeaFloorDecor.updateCoralColor(i); },
        };
        coralFolder.add(colorProxy, 'r', 0, 1, 0.01).name('Color R').listen();
        coralFolder.add(colorProxy, 'g', 0, 1, 0.01).name('Color G').listen();
        coralFolder.add(colorProxy, 'b', 0, 1, 0.01).name('Color B').listen();
    });
    sfCoralsFolder.close();

    // ── Kelps ────────────────────────────────────────────────────────────────
    // Shared sway settings at top of kelp folder
    const swayProxy = {
        get kelpTopY()          { return sf.kelpTopY;          }, set kelpTopY(v)          { sf.kelpTopY          = v; },
        get kelpSwayStrength()  { return sf.kelpSwayStrength;  }, set kelpSwayStrength(v)  { sf.kelpSwayStrength  = v; },
        get kelpSwaySpeed()     { return sf.kelpSwaySpeed;     }, set kelpSwaySpeed(v)     { sf.kelpSwaySpeed     = v; },
        get kelpSwayFrequency() { return sf.kelpSwayFrequency; }, set kelpSwayFrequency(v) { sf.kelpSwayFrequency = v; },
    };
    const sfKelpSwayFolder = sfKelpFolder.addFolder('Sway (live)');
    sfKelpSwayFolder.add(swayProxy, 'kelpTopY',          0.5, 10,  0.1  ).name('Tip Y (local)').listen();
    sfKelpSwayFolder.add(swayProxy, 'kelpSwayStrength',    0,  1,  0.005).name('Strength').listen();
    sfKelpSwayFolder.add(swayProxy, 'kelpSwaySpeed',    0.05,  4,  0.01 ).name('Speed').listen();
    sfKelpSwayFolder.add(swayProxy, 'kelpSwayFrequency', 0.2,  8,  0.05 ).name('Frequency').listen();
    sfKelpSwayFolder.close();
    makePlacementFolder(sfKelpFolder, 'Kelp 1', () => sf.kelp1, () => SeaFloorDecor.updateKelpTransform(0));
    makePlacementFolder(sfKelpFolder, 'Kelp 2', () => sf.kelp2, () => SeaFloorDecor.updateKelpTransform(1));
    makePlacementFolder(sfKelpFolder, 'Kelp 3', () => sf.kelp3, () => SeaFloorDecor.updateKelpTransform(2));
    sfKelpFolder.close();

    // ── Extras (added with the new model batch) ──────────────────────────────
    const sfExtrasFolder = sfFolder.addFolder('Extras');
    // 4 extra corals — placement + colour
    const extraCoralKeys = ['coral1Left', 'coral1Right', 'coral2Left', 'coral2Right'] as const;
    const extraCoralLabels = ['Coral 1 Left', 'Coral 1 Right', 'Coral 2 Left', 'Coral 2 Right'];
    ([0, 1, 2, 3] as const).forEach((i) => {
        const key = extraCoralKeys[i];
        makePlacementFolder(sfExtrasFolder, extraCoralLabels[i], () => sf[key], () => SeaFloorDecor.updateExtraCoralTransform(i));
        const folder = sfExtrasFolder.children[sfExtrasFolder.children.length - 1] as any;
        const colorProxy = {
            get r() { return sf[key].r; }, set r(v: number) { sf[key].r = v; SeaFloorDecor.updateExtraCoralColor(i); },
            get g() { return sf[key].g; }, set g(v: number) { sf[key].g = v; SeaFloorDecor.updateExtraCoralColor(i); },
            get b() { return sf[key].b; }, set b(v: number) { sf[key].b = v; SeaFloorDecor.updateExtraCoralColor(i); },
        };
        folder.add(colorProxy, 'r', 0, 1, 0.01).name('Color R').listen();
        folder.add(colorProxy, 'g', 0, 1, 0.01).name('Color G').listen();
        folder.add(colorProxy, 'b', 0, 1, 0.01).name('Color B').listen();
    });
    // Anemone — placement + own sway settings
    makePlacementFolder(sfExtrasFolder, 'Anemone', () => sf.anemone as any, () => SeaFloorDecor.updateAnemoneTransform());
    const anemoneSwayFolder = sfExtrasFolder.addFolder('Anemone Sway (live)');
    const anemoneSwayProxy = {
        get topY()      { return sf.anemoneTopY;          }, set topY(v: number)      { sf.anemoneTopY          = v; },
        get strength()  { return sf.anemoneSwayStrength;  }, set strength(v: number)  { sf.anemoneSwayStrength  = v; },
        get speed()     { return sf.anemoneSwaySpeed;     }, set speed(v: number)     { sf.anemoneSwaySpeed     = v; },
        get frequency() { return sf.anemoneSwayFrequency; }, set frequency(v: number) { sf.anemoneSwayFrequency = v; },
    };
    anemoneSwayFolder.add(anemoneSwayProxy, 'topY',      0.05, 5,   0.01).name('Tip Y (local)').listen();
    anemoneSwayFolder.add(anemoneSwayProxy, 'strength',  0,    1,   0.005).name('Strength').listen();
    anemoneSwayFolder.add(anemoneSwayProxy, 'speed',     0.05, 5,   0.01).name('Speed').listen();
    anemoneSwayFolder.add(anemoneSwayProxy, 'frequency', 0.2,  15,  0.05).name('Frequency').listen();
    anemoneSwayFolder.close();
    // Two anemone clownfish — placement + swim params
    const fishKeys = ['anemoneFish1', 'anemoneFish2'] as const;
    fishKeys.forEach((key, i) => {
        const folder = sfExtrasFolder.addFolder(`Anemone Fish ${i + 1}`);
        const p = {
            get x()       { return sf[key].x;          }, set x(v: number)       { sf[key].x          = v; },
            get y()       { return sf[key].y;          }, set y(v: number)       { sf[key].y          = v; },
            get z()       { return sf[key].z;          }, set z(v: number)       { sf[key].z          = v; },
            get scale()   { return sf[key].scale;      }, set scale(v: number)   { sf[key].scale      = v; },
            get swimR()   { return sf[key].swimRadius; }, set swimR(v: number)   { sf[key].swimRadius = v; },
            get period()  { return sf[key].period;     }, set period(v: number)  { sf[key].period     = v; },
            get phase()   { return sf[key].phase;      }, set phase(v: number)   { sf[key].phase      = v; },
        };
        folder.add(p, 'x',      -30, 30, 0.05).name('X (base)').listen();
        folder.add(p, 'y',      -15, 5,  0.05).name('Y').listen();
        folder.add(p, 'z',      -30, 30, 0.05).name('Z (base)').listen();
        folder.add(p, 'scale',  0.001, 0.1, 0.0005).name('Scale').listen();
        folder.add(p, 'swimR',  0,    2,   0.01).name('Swim Radius').listen();
        folder.add(p, 'period', 0.5,  20,  0.05).name('Period (s)').listen();
        folder.add(p, 'phase',  0,    6.3, 0.01).name('Phase').listen();
        folder.close();
    });
    // Starfish + crab — straight placement
    makePlacementFolder(sfExtrasFolder, 'Starfish', () => sf.starfish, () => SeaFloorDecor.updateStarfishTransform());
    makePlacementFolder(sfExtrasFolder, 'Crab',     () => sf.crab,     () => SeaFloorDecor.updateCrabTransform());
    sfExtrasFolder.close();

    // ── Chest ────────────────────────────────────────────────────────────────────
    makePlacementFolder(sfChestFolder, 'Placement', () => sf.chest, () => Island.updateChestTransform());
    const chestZoomFolder = sfChestFolder.addFolder('Zoom');
    const chestZoomProxy = {
        get dist()       { return sf.chestZoomDist;       }, set dist(v: number)       { sf.chestZoomDist       = v; },
        get height()     { return sf.chestZoomHeight;     }, set height(v: number)     { sf.chestZoomHeight     = v; },
        get fov()        { return sf.chestZoomFov;        }, set fov(v: number)        { sf.chestZoomFov        = v; },
        get mobileFov()  { return sf.chestZoomMobileFov;  }, set mobileFov(v: number)  { sf.chestZoomMobileFov  = v; },
        get pitch()      { return sf.chestZoomPitch;      }, set pitch(v: number)      { sf.chestZoomPitch      = v; },
    };
    chestZoomFolder.add(chestZoomProxy, 'dist',       0.5,  10,  0.05).name('Zoom Dist').listen();
    chestZoomFolder.add(chestZoomProxy, 'height',    -2.0,   5,  0.05).name('Zoom Height').listen();
    chestZoomFolder.add(chestZoomProxy, 'fov',         5,   80,  0.5 ).name('Zoom FOV (desktop)').listen();
    chestZoomFolder.add(chestZoomProxy, 'mobileFov',   5,   80,  0.5 ).name('Zoom FOV (mobile)').listen();
    chestZoomFolder.add(chestZoomProxy, 'pitch', -Math.PI / 2, Math.PI / 2, 0.01).name('Zoom Pitch').listen();
    chestZoomFolder.close();
    // Glow light: position + intensity + distance
    const chestGlowFolder = sfChestFolder.addFolder('Glow Light');
    const chestGlowProxy = {
        get x()         { return sf.chestGlowX;         }, set x(v: number)         { sf.chestGlowX         = v; Island.updateChestGlowTransform(); },
        get y()         { return sf.chestGlowY;         }, set y(v: number)         { sf.chestGlowY         = v; Island.updateChestGlowTransform(); },
        get z()         { return sf.chestGlowZ;         }, set z(v: number)         { sf.chestGlowZ         = v; Island.updateChestGlowTransform(); },
        get intensity() { return sf.chestGlowIntensity; }, set intensity(v: number) { sf.chestGlowIntensity = v; },
        get distance()  { return sf.chestGlowDistance;  }, set distance(v: number)  { sf.chestGlowDistance  = v; Island.updateChestGlowTransform(); },
    };
    chestGlowFolder.add(chestGlowProxy, 'x',        -3,  3, 0.05).name('X').listen();
    chestGlowFolder.add(chestGlowProxy, 'y',        -1,  8, 0.05).name('Y').listen();
    chestGlowFolder.add(chestGlowProxy, 'z',        -3,  3, 0.05).name('Z').listen();
    chestGlowFolder.add(chestGlowProxy, 'intensity', 0, 20, 0.1 ).name('Intensity').listen();
    chestGlowFolder.add(chestGlowProxy, 'distance',  0, 10, 0.1 ).name('Distance').listen();
    chestGlowFolder.close();
    // Rays: ring radius + max opacity
    const chestRaysFolder = sfChestFolder.addFolder('Rays');
    const chestRaysProxy = {
        get radius()     { return sf.chestRayRadius;     }, set radius(v: number)     { sf.chestRayRadius     = v; Island.rebuildChestRays(); },
        get maxOpacity() { return sf.chestRayMaxOpacity; }, set maxOpacity(v: number) { sf.chestRayMaxOpacity = v; },
    };
    chestRaysFolder.add(chestRaysProxy, 'radius',     0, 2, 0.01).name('Ring Radius').listen();
    chestRaysFolder.add(chestRaysProxy, 'maxOpacity', 0, 1, 0.01).name('Max Opacity').listen();
    chestRaysFolder.close();
    // Coins
    const chestCoinsFolder = sfChestFolder.addFolder('Coins');
    const coinTimingProxy = {
        get revealDelay() { return sf.chestCoinRevealDelay; },
        set revealDelay(v: number) { sf.chestCoinRevealDelay = v; },
        get hideDelay() { return sf.chestCoinHideDelay; },
        set hideDelay(v: number) { sf.chestCoinHideDelay = v; },
    };
    const chestCoinTimingFolder = chestCoinsFolder.addFolder('Timing');
    chestCoinTimingFolder.add(coinTimingProxy, 'revealDelay', 0, 3, 0.05)
        .name('Reveal Delay (s)')
        .listen();
    chestCoinTimingFolder.add(coinTimingProxy, 'hideDelay', 0, 3, 0.05)
        .name('Hide Delay (s)')
        .listen();
    chestCoinTimingFolder.open();
    const coinDefs = [
        { label: 'Coin 1 (Blue)',  cfgKey: 'chestCoin1' as const, colorKey: 'chestCoin1Color' as const },
        { label: 'Coin 2 (Black)', cfgKey: 'chestCoin2' as const, colorKey: 'chestCoin2Color' as const },
        { label: 'Coin 3 (White)', cfgKey: 'chestCoin3' as const, colorKey: 'chestCoin3Color' as const },
    ];
    coinDefs.forEach((def, ci) => {
        const coinFolder = chestCoinsFolder.addFolder(def.label);
        // -- Placement --
        const placement = coinFolder.addFolder('Placement');
        const p = {
            get x()     { return sf[def.cfgKey].x;     }, set x(v)     { sf[def.cfgKey].x     = v; Island.updateChestCoinTransforms(); },
            get y()     { return sf[def.cfgKey].y;     }, set y(v)     { sf[def.cfgKey].y     = v; Island.updateChestCoinTransforms(); },
            get z()     { return sf[def.cfgKey].z;     }, set z(v)     { sf[def.cfgKey].z     = v; Island.updateChestCoinTransforms(); },
            get scale() { return sf[def.cfgKey].scale; }, set scale(v) { sf[def.cfgKey].scale = v; Island.updateChestCoinTransforms(); },
            get rx()    { return sf[def.cfgKey].rx;    }, set rx(v)    { sf[def.cfgKey].rx    = v; Island.updateChestCoinTransforms(); },
            get ry()    { return sf[def.cfgKey].ry;    }, set ry(v)    { sf[def.cfgKey].ry    = v; Island.updateChestCoinTransforms(); },
            get rz()    { return sf[def.cfgKey].rz;    }, set rz(v)    { sf[def.cfgKey].rz    = v; Island.updateChestCoinTransforms(); },
        };
        placement.add(p, 'x',     -30, 30,   0.05).name('X').listen();
        placement.add(p, 'y',      -3,  8,   0.05).name('Y').listen();
        placement.add(p, 'z',     -30, 30,   0.05).name('Z').listen();
        placement.add(p, 'scale',   0,  5,   0.01).name('Scale').listen();
        placement.add(p, 'rx', -3.14, 3.14,  0.01).name('Rot X').listen();
        placement.add(p, 'ry', -3.14, 3.14,  0.01).name('Rot Y').listen();
        placement.add(p, 'rz', -3.14, 3.14,  0.01).name('Rot Z').listen();
        placement.close();
        // -- Body color (ring + star) --
        const bodyFolder = coinFolder.addFolder('Body (ring + star)');
        const bc = {
            get r() { return sf[def.colorKey].bodyR; }, set r(v) { sf[def.colorKey].bodyR = v; Island.updateChestCoinColors(); },
            get g() { return sf[def.colorKey].bodyG; }, set g(v) { sf[def.colorKey].bodyG = v; Island.updateChestCoinColors(); },
            get b() { return sf[def.colorKey].bodyB; }, set b(v) { sf[def.colorKey].bodyB = v; Island.updateChestCoinColors(); },
        };
        bodyFolder.add(bc, 'r', 0, 1, 0.01).name('R').listen();
        bodyFolder.add(bc, 'g', 0, 1, 0.01).name('G').listen();
        bodyFolder.add(bc, 'b', 0, 1, 0.01).name('B').listen();
        bodyFolder.close();
        // -- Circle color (inner disc) --
        const circleFolder = coinFolder.addFolder('Circle (inner disc)');
        const cc = {
            get r() { return sf[def.colorKey].circleR; }, set r(v) { sf[def.colorKey].circleR = v; Island.updateChestCoinColors(); },
            get g() { return sf[def.colorKey].circleG; }, set g(v) { sf[def.colorKey].circleG = v; Island.updateChestCoinColors(); },
            get b() { return sf[def.colorKey].circleB; }, set b(v) { sf[def.colorKey].circleB = v; Island.updateChestCoinColors(); },
        };
        circleFolder.add(cc, 'r', 0, 1, 0.01).name('R').listen();
        circleFolder.add(cc, 'g', 0, 1, 0.01).name('G').listen();
        circleFolder.add(cc, 'b', 0, 1, 0.01).name('B').listen();
        circleFolder.close();
        coinFolder.close();
    });
    chestCoinsFolder.close();
    sfChestFolder.close();

    sfFolder.close();

    // ── Camera: Copy CameraConfig.ts ────────────────────────────────────────────
    const cameraConfigActions = {
        copyConfig: () => {
            const f = (n: number) => n.toFixed(4);
            const fi = (n: number) => String(n);  // integer values (no decimal)
            const mcc = mainCameraConfig;
            const content = [
                `// src/scene/CameraConfig.ts`,
                `// Camera configuration — generated by Debug.`,
                `// Paste this entire file to replace src/scene/CameraConfig.ts`,
                ``,
                `// ── Main Camera ─────────────────────────────────────────────────────────────────`,
                `export const defaultCameraX        = ${f(mcc.x)};   // World-space X offset of the camera at rest`,
                `export const defaultCameraZ        = ${f(mcc.z)};   // World-space Z position of the camera at rest`,
                `export const defaultFov            = ${fi(mcc.desktopFov)};     // Default camera Field-of-View in degrees (desktop)`,
                `export const mobileFov             = ${fi(mcc.mobileFov)};       // FOV used when viewport width ≤ mobileBreakpointWidth`,
                `export const mobileBreakpointWidth = ${fi(mobileBreakpointWidth)};      // px — widths at or below this are treated as mobile`,
                ``,
                `// ── Scroll Y Limits ───────────────────────────────────────────────────────────`,
                `// Higher FOV on mobile means the camera sees more vertically, so the dead-zone`,
                `// limits must be pushed further from the surface to avoid seeing through it.`,
                `export const aboveWaterBottomY       = ${f(CFG_ABOVE_BOTTOM)};  // Desktop: lowest Y above water before dead-zone snaps`,
                `export const aboveWaterBottomYMobile = ${f(CFG_ABOVE_BOTTOM_MOBILE)};  // Mobile: raised because wider FOV reveals surface sooner`,
                `export const underwaterTopY          = ${f(CFG_UNDER_TOP)}; // Desktop: highest Y underwater before dead-zone snaps`,
                `export const underwaterTopYMobile    = ${f(CFG_UNDER_TOP_MOBILE)}; // Mobile: lowered for the same reason`,
            ].join('\n');
            navigator.clipboard.writeText(content).then(() => {
                console.log('[Debug] CameraConfig.ts content copied to clipboard!');
            });
        },
    };
    cameraFolder.add(cameraConfigActions, 'copyConfig').name('Copy CameraConfig.ts');

    // ── Camera: Free Roam toggle ──────────────────────────────────────────────
    const freeRoamProxy = {
        get freeRoam() { return !isWebPageMode(); },
        set freeRoam(v: boolean) { if (v !== !isWebPageMode()) toggleCameraMode(); },
    };
    cameraFolder.add(freeRoamProxy, 'freeRoam').name('Free Roam');

    // ── Camera: Main Camera live tweaks ────────────────────────────────────────
    const mainCamFolder = cameraFolder.addFolder('Main Camera');
    const mainCamProxy = {
        get x()          { return mainCameraConfig.x; },
        set x(v)         { mainCameraConfig.x = v; },
        get z()          { return mainCameraConfig.z; },
        set z(v)         { mainCameraConfig.z = v; },
        get desktopFov() { return mainCameraConfig.desktopFov; },
        set desktopFov(v) {
            mainCameraConfig.desktopFov = v;
            mainCameraConfig.fov = window.innerWidth > mobileBreakpointWidth ? v : mainCameraConfig.mobileFov;
            SetFOV(mainCameraConfig.fov);
        },
        get mobileFov()  { return mainCameraConfig.mobileFov; },
        set mobileFov(v) {
            mainCameraConfig.mobileFov = v;
            mainCameraConfig.fov = window.innerWidth <= mobileBreakpointWidth ? v : mainCameraConfig.desktopFov;
            SetFOV(mainCameraConfig.fov);
        },
    };
    mainCamFolder.add(mainCamProxy, 'x',          -10, 10,  0.05).name('Camera X (offset)').listen();
    mainCamFolder.add(mainCamProxy, 'z',           0.1, 5.0, 0.01).name('Camera Z (depth)').listen();
    mainCamFolder.add(mainCamProxy, 'desktopFov',  10,  120, 0.5 ).name('FOV (desktop)').listen();
    mainCamFolder.add(mainCamProxy, 'mobileFov',   10,  120, 0.5 ).name('FOV (mobile)').listen();
    mainCamFolder.close();

    // ── Camera: Cabana (tent interior) zoom + entrance shade ───────────────────
    // Camera-pose sliders edit whichever device variant is currently active
    // (desktop vs mobile, by viewport width) — resize the window to tune the
    // other one. Control reads the active pose live each frame. Copy emits BOTH.
    const cabanaFolder = cameraFolder.addFolder('Cabana');
    const onMobileVp = () => window.innerWidth <= mobileBreakpointWidth;
    const cabanaCamProxy = {
        get camX()  { return onMobileVp() ? cabanaZoomConfig.camXMobile  : cabanaZoomConfig.camX;  },
        set camX(v) { if (onMobileVp()) cabanaZoomConfig.camXMobile = v;  else cabanaZoomConfig.camX = v;  },
        get camY()  { return onMobileVp() ? cabanaZoomConfig.camYMobile  : cabanaZoomConfig.camY;  },
        set camY(v) { if (onMobileVp()) cabanaZoomConfig.camYMobile = v;  else cabanaZoomConfig.camY = v;  },
        get camZ()  { return onMobileVp() ? cabanaZoomConfig.camZMobile  : cabanaZoomConfig.camZ;  },
        set camZ(v) { if (onMobileVp()) cabanaZoomConfig.camZMobile = v;  else cabanaZoomConfig.camZ = v;  },
        get phi()   { return onMobileVp() ? cabanaZoomConfig.phiMobile   : cabanaZoomConfig.phi;   },
        set phi(v)  { if (onMobileVp()) cabanaZoomConfig.phiMobile = v;   else cabanaZoomConfig.phi = v;   },
        get pitch() { return onMobileVp() ? cabanaZoomConfig.pitchMobile : cabanaZoomConfig.pitch; },
        set pitch(v){ if (onMobileVp()) cabanaZoomConfig.pitchMobile = v; else cabanaZoomConfig.pitch = v; },
        get fov()   { return onMobileVp() ? cabanaZoomConfig.fovMobile   : cabanaZoomConfig.fov;   },
        set fov(v)  { if (onMobileVp()) cabanaZoomConfig.fovMobile = v;   else cabanaZoomConfig.fov = v;   },
    };
    cabanaFolder.add(cabanaCamProxy, 'camX',  -3,  3,         0.01).name('Cam X').listen();
    cabanaFolder.add(cabanaCamProxy, 'camY',  -2,  3,         0.01).name('Cam Y').listen();
    cabanaFolder.add(cabanaCamProxy, 'camZ',  -6,  0,         0.01).name('Cam Z').listen();
    cabanaFolder.add(cabanaCamProxy, 'phi',    0,  Math.PI*4, 0.01).name('Yaw (phi)').listen();
    cabanaFolder.add(cabanaCamProxy, 'pitch', -1.5, 1.5,      0.01).name('Pitch').listen();
    cabanaFolder.add(cabanaCamProxy, 'fov',    1,  120,       0.5 ).name('FOV').listen();

    // Interior-shade ellipsoid — darkens the tent fabric + props from outside.
    // Center sliders edit the OFFSET from islandPosition (config convention); the
    // setter applies islandPosition + offset to the live world-space uniform.
    const shadeFolder = cabanaFolder.addFolder('Interior Shade');
    const cabanaShadeProxy = {
        get centerX()  { return Island.cabanaShadeCenterUniform.value.x - island.position.x; },
        set centerX(v) { Island.cabanaShadeCenterUniform.value.x = island.position.x + v; },
        get centerY()  { return Island.cabanaShadeCenterUniform.value.y - island.position.y; },
        set centerY(v) { Island.cabanaShadeCenterUniform.value.y = island.position.y + v; },
        get centerZ()  { return Island.cabanaShadeCenterUniform.value.z - island.position.z; },
        set centerZ(v) { Island.cabanaShadeCenterUniform.value.z = island.position.z + v; },
        get radiusX()  { return Island.cabanaShadeRadiiUniform.value.x; },
        set radiusX(v) { Island.cabanaShadeRadiiUniform.value.x = v; },
        get radiusY()  { return Island.cabanaShadeRadiiUniform.value.y; },
        set radiusY(v) { Island.cabanaShadeRadiiUniform.value.y = v; },
        get radiusZ()  { return Island.cabanaShadeRadiiUniform.value.z; },
        set radiusZ(v) { Island.cabanaShadeRadiiUniform.value.z = v; },
        get edge()     { return Island.cabanaShadeEdgeUniform.value; },
        set edge(v)    { Island.cabanaShadeEdgeUniform.value = v; },
        get strength()  { return Island.cabanaShadeStrengthUniform.value; },
        set strength(v) { Island.cabanaShadeStrengthUniform.value = v; },
        get color()    { return Island.cabanaShadeColorUniform.value.getHex(); },
        set color(v)   { Island.cabanaShadeColorUniform.value.setHex(v); },
    };
    shadeFolder.add(cabanaShadeProxy, 'centerX',  -3, 3, 0.01).name('Center X (offset)').listen();
    shadeFolder.add(cabanaShadeProxy, 'centerY',  -2, 3, 0.01).name('Center Y (offset)').listen();
    shadeFolder.add(cabanaShadeProxy, 'centerZ',  -6, 0, 0.01).name('Center Z (offset)').listen();
    shadeFolder.add(cabanaShadeProxy, 'radiusX',  0.05, 3, 0.01).name('Radius X').listen();
    shadeFolder.add(cabanaShadeProxy, 'radiusY',  0.05, 3, 0.01).name('Radius Y').listen();
    shadeFolder.add(cabanaShadeProxy, 'radiusZ',  0.05, 3, 0.01).name('Radius Z').listen();
    shadeFolder.add(cabanaShadeProxy, 'edge',     0, 1, 0.01).name('Edge softness').listen();
    shadeFolder.add(cabanaShadeProxy, 'strength', 0, 1, 0.01).name('Strength').listen();
    shadeFolder.addColor(cabanaShadeProxy, 'color').name('Shade color');
    shadeFolder.add(Island.cabanaShadeFade, 'revealSpeed', 0.2, 20, 0.1).name('Reveal speed (in)').listen();
    shadeFolder.add(Island.cabanaShadeFade, 'coverSpeed',  0.2, 20, 0.1).name('Cover speed (out)').listen();
    shadeFolder.close();

    // Reveal trigger — how close the camera must get before the interior reveals.
    cabanaFolder.add(cabanaRevealConfig, 'arriveDist', 0.02, 1.0, 0.01).name('Arrive dist').listen();

    // Reverse dome — dark backdrop that seals the outside while inside. Center is
    // edited as an OFFSET from islandPosition; radius scales the base sphere.
    const domeFolder = cabanaFolder.addFolder('Reverse Dome');
    const cabanaDomeProxy = {
        get centerX()  { return Island.cabanaDome ? Island.cabanaDome.position.x - island.position.x : 0; },
        set centerX(v) { if (Island.cabanaDome) Island.cabanaDome.position.x = island.position.x + v; },
        get centerY()  { return Island.cabanaDome ? Island.cabanaDome.position.y - island.position.y : 0; },
        set centerY(v) { if (Island.cabanaDome) Island.cabanaDome.position.y = island.position.y + v; },
        get centerZ()  { return Island.cabanaDome ? Island.cabanaDome.position.z - island.position.z : 0; },
        set centerZ(v) { if (Island.cabanaDome) Island.cabanaDome.position.z = island.position.z + v; },
        get radius()   { return (Island.cabanaDome ? Island.cabanaDome.scale.x : 1) * cabanaDomeRadius; },
        set radius(v)  { if (Island.cabanaDome) Island.cabanaDome.scale.setScalar(v / cabanaDomeRadius); },
        get opacity()  { return Island.cabanaDomeConfig.opacity; },
        set opacity(v) { Island.cabanaDomeConfig.opacity = v; },
        get color()    { return Island.cabanaDome ? (Island.cabanaDome.material as any).color.getHex() : 0; },
        set color(v)   { if (Island.cabanaDome) (Island.cabanaDome.material as any).color.setHex(v); },
    };
    domeFolder.add(cabanaDomeProxy, 'centerX', -3, 3, 0.01).name('Center X (offset)').listen();
    domeFolder.add(cabanaDomeProxy, 'centerY', -3, 3, 0.01).name('Center Y (offset)').listen();
    domeFolder.add(cabanaDomeProxy, 'centerZ', -6, 0, 0.01).name('Center Z (offset)').listen();
    domeFolder.add(cabanaDomeProxy, 'radius',  1, 12, 0.1).name('Radius').listen();
    domeFolder.add(cabanaDomeProxy, 'opacity', 0, 1, 0.01).name('Opacity').listen();
    domeFolder.addColor(cabanaDomeProxy, 'color').name('Dome color');
    domeFolder.close();

    // ── Copy CabanaConfig.ts ──────────────────────────────────────────────────
    const cabanaConfigActions = {
        copyConfig: () => {
            const f = (n: number) => n.toFixed(4);
            const c = cabanaZoomConfig;
            const center = Island.cabanaShadeCenterUniform.value;
            const radii = Island.cabanaShadeRadiiUniform.value;
            const ip = island.position;
            const hex = '0x' + Island.cabanaShadeColorUniform.value.getHexString();
            const content = [
                `// src/scene/config/CabanaConfig.ts`,
                `// Cabana (tent) interior zoom + interior shade — generated by Debug.`,
                `// Paste this entire file to replace src/scene/config/CabanaConfig.ts`,
                ``,
                `// ── Cabana zoom ───────────────────────────────────────────────────────────────`,
                `// Desktop (used when viewport width > mobileBreakpointWidth).`,
                `export const cabanaCamX   = ${f(c.camX)};`,
                `export const cabanaCamY   = ${f(c.camY)};`,
                `export const cabanaCamZ   = ${f(c.camZ)};`,
                `export const cabanaPhi    = ${f(c.phi)};`,
                `export const cabanaPitch  = ${f(c.pitch)};`,
                `export const cabanaFov    = ${f(c.fov)};`,
                `// Mobile (used when viewport width ≤ mobileBreakpointWidth).`,
                `export const cabanaCamXMobile   = ${f(c.camXMobile)};`,
                `export const cabanaCamYMobile   = ${f(c.camYMobile)};`,
                `export const cabanaCamZMobile   = ${f(c.camZMobile)};`,
                `export const cabanaPhiMobile    = ${f(c.phiMobile)};`,
                `export const cabanaPitchMobile  = ${f(c.pitchMobile)};`,
                `export const cabanaFovMobile    = ${f(c.fovMobile)};`,
                ``,
                `// ── Interior shade (world-space volume) ───────────────────────────────────────`,
                `// Center is an OFFSET added to islandPosition (same convention as tentOffset).`,
                `export const cabanaShadeX       = ${f(center.x - ip.x)};`,
                `export const cabanaShadeY       = ${f(center.y - ip.y)};`,
                `export const cabanaShadeZ       = ${f(center.z - ip.z)};`,
                `export const cabanaShadeRadiusX = ${f(radii.x)};`,
                `export const cabanaShadeRadiusY = ${f(radii.y)};`,
                `export const cabanaShadeRadiusZ = ${f(radii.z)};`,
                `export const cabanaShadeEdge    = ${f(Island.cabanaShadeEdgeUniform.value)};`,
                `export const cabanaShadeColor   = ${hex};`,
                `export const cabanaShadeStrength = ${f(Island.cabanaShadeStrengthUniform.value)};`,
                ``,
                `// ── Fade speeds (damp lambda) ─────────────────────────────────────────────────`,
                `export const cabanaShadeRevealSpeed = ${f(Island.cabanaShadeFade.revealSpeed)};`,
                `export const cabanaShadeCoverSpeed  = ${f(Island.cabanaShadeFade.coverSpeed)};`,
                ``,
                `// ── Reveal trigger ────────────────────────────────────────────────────────────`,
                `export const cabanaArriveDist = ${f(cabanaRevealConfig.arriveDist)};`,
                ``,
                `// ── Reverse dome ──────────────────────────────────────────────────────────────`,
                `// Center is an OFFSET added to islandPosition (same convention as tentOffset).`,
                `export const cabanaDomeX       = ${f(Island.cabanaDome ? Island.cabanaDome.position.x - ip.x : 0)};`,
                `export const cabanaDomeY       = ${f(Island.cabanaDome ? Island.cabanaDome.position.y - ip.y : 0)};`,
                `export const cabanaDomeZ       = ${f(Island.cabanaDome ? Island.cabanaDome.position.z - ip.z : 0)};`,
                `export const cabanaDomeRadius  = ${f((Island.cabanaDome ? Island.cabanaDome.scale.x : 1) * cabanaDomeRadius)};`,
                `export const cabanaDomeColor   = ${Island.cabanaDome ? '0x' + (Island.cabanaDome.material as any).color.getHexString() : '0x05060a'};`,
                `export const cabanaDomeOpacity = ${f(Island.cabanaDomeConfig.opacity)};`,
            ].join('\n');
            navigator.clipboard.writeText(content).then(() => {
                console.log('[Debug] CabanaConfig.ts content copied to clipboard!');
            });
        },
    };
    cabanaFolder.add(cabanaConfigActions, 'copyConfig').name('Copy CabanaConfig.ts');
    cabanaFolder.close();

    // ── Close all top-level groups by default ───────────────────────────────
    surfaceFolder.close();
    oceanFolder.close();
    skyFolder.close();
    cameraFolder.close();
    // seafloorFolder ≡ sfFolder, already closed above

    gui.hide();
    visible = false;
}

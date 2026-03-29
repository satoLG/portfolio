/**
 * IslandDebug — press H to toggle
 *
 * lil-gui panel with position, scale, and rotation sliders for every
 * island object, plus per-cluster foliage controls.
 *
 * Every change prints a copy-paste-ready line to the console so values
 * can be pasted straight back into Island.ts constants.
 */

import GUI from 'lil-gui';
import {
    island,
    firecamp,
    palmtree,
    radio,
    sword,
    pug,
    tent,
    dogBed,
    littleRocks,
    CLUSTER_MAIN,
    CLUSTER_PALM,
    clusterMainPatches,
    clusterPalmPatches,
    respawnFoliage,
    setGrassCount,
    setGrassPalmCount,
    setCloverCount,
    type FoliageCluster,
} from '../scene/Island';
import * as Island from '../scene/Island';
import { SURFACE_EDGE_PADDING } from '../scene/IslandConfig';
import {
    oceanAbsorptionUniform,
    normalMapScaleUniform,
    normalMapStrengthUniform,
    waveVelocity1Uniform,
    waveVelocity2Uniform,
    edgeFadeDistanceUniform,
    surfaceColorUniform,
    surfaceOpacityUniform,
    reflectionStrengthUniform,
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
    underwaterFogDistUniform,
} from '../materials/OceanMaterial';
import * as OceanReflection from '../effects/OceanReflection';
import * as WindLines from '../effects/WindLines';
import * as Clouds from '../effects/Clouds';
import * as SeaFloorDecor from '../scene/SeaFloorDecor';
import {
    setDistortion as setUnderwaterDistortion,
    setDistortionSpeed as setUnderwaterSpeed,
    setDistortionScale as setUnderwaterScale,
} from '../effects/PostProcess';
import {
    distortionStrength as DISTORTION_STRENGTH,
    distortionSpeed as DISTORTION_SPEED,
    distortionScale as DISTORTION_SCALE,
} from '../scene/OceanConfig';
import { Object3D } from 'three';
import { phoneZoomConfig, mainCameraConfig } from '../scripts/Control';
import { SetFOV } from '../scripts/Scene';
import { phoneScreenConfig, updateOverlayStyle } from './PhoneScreen';

let gui: GUI | null = null;
let visible = false;

// ─── helpers ────────────────────────────────────────────────────────────────

/** Round to 4 decimal places — enough precision for copy-paste */
const r = (n: number) => Math.round(n * 10000) / 10000;

function debounce(fn: () => void, ms: number): () => void {
    let timer: ReturnType<typeof setTimeout>;
    return () => { clearTimeout(timer); timer = setTimeout(fn, ms); };
}

// ─── object folder ──────────────────────────────────────────────────────────

interface ObjOpts {
    /** Half-width of the position sliders (default 1.5) */
    posRange?: number;
    /** [min, max] for the uniform scale slider. Omit to hide scale. */
    scaleRange?: [number, number];
    /** Which rotation axes to expose. Omit to hide rotation. */
    rotAxes?: Array<'x' | 'y' | 'z'>;
}

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
    const { posRange = 1.5, scaleRange, rotAxes } = opts;
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
        console.log(`[IslandDebug] ${label}  ${pos}${sc}${rot}`);
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
 */
function addClusterFolder(
    gui: GUI,
    label: string,
    which: FoliageCluster,
    cluster: { wx: number; wz: number; minR: number; maxR: number },
    countKey: 'GRASS_COUNT' | 'GRASS_COUNT_PALM' | 'CLOVER_COUNT',
    setCount: (n: number) => void,
) {
    const folder = gui.addFolder(label);

    const logCluster = () => {
        const count = Island[countKey];
        console.log(
            `[IslandDebug] ${label}  wx=${r(cluster.wx)}  wz=${r(cluster.wz)}` +
            `  minR=${r(cluster.minR)}  maxR=${r(cluster.maxR)}  count=${count}`
        );
    };

    const doRespawn = debounce(() => {
        respawnFoliage(which);
        logCluster();
    }, 300);

    const proxy = {
        get wx()    { return r(cluster.wx); },
        set wx(v)   { cluster.wx   = v; doRespawn(); },
        get wz()    { return r(cluster.wz); },
        set wz(v)   { cluster.wz   = v; doRespawn(); },
        get minR()  { return r(cluster.minR); },
        set minR(v) { cluster.minR = Math.min(v, cluster.maxR - 0.01); doRespawn(); },
        get maxR()  { return r(cluster.maxR); },
        set maxR(v) { cluster.maxR = Math.max(v, cluster.minR + 0.01); doRespawn(); },
        get count() { return Island[countKey]; },
        set count(v) { setCount(v); doRespawn(); },
    };

    const cWx = r(cluster.wx);
    const cWz = r(cluster.wz);

    folder.add(proxy, 'wx',    cWx - 1.0, cWx + 1.0, 0.001).name('Center X').listen();
    folder.add(proxy, 'wz',    cWz - 1.0, cWz + 1.0, 0.001).name('Center Z').listen();
    folder.add(proxy, 'minR',  0.0,  1.5, 0.001).name('Min Radius').listen();
    folder.add(proxy, 'maxR',  0.05, 2.0, 0.001).name('Max Radius').listen();
    folder.add(proxy, 'count', 0, 300, 1).name('Count').listen();

    folder.close();
    return folder;
}

// ─── public API ─────────────────────────────────────────────────────────────

export function Start(): void {
    // Poll until foliage patches exist, then build the GUI
    const tryBuild = () => {
        if (clusterMainPatches.length === 0 && clusterPalmPatches.length === 0) {
            requestAnimationFrame(tryBuild);
            return;
        }
        buildGUI();
    };
    requestAnimationFrame(tryBuild);

    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'h' || e.key === 'H') {
            visible = !visible;
            visible ? gui?.show() : gui?.hide();
        }
    });
}

function buildGUI(): void {
    gui = new GUI({ title: 'Island Debug  [H]', width: 310 });
    gui.domElement.style.position = 'fixed';
    gui.domElement.style.top = '8px';
    gui.domElement.style.right = '8px';
    gui.domElement.style.zIndex = '9999';

    // ── Top-level group folders ────────────────────────────────────────
    const surfaceFolder  = gui.addFolder('Surface');
    const oceanFolder    = gui.addFolder('Ocean');
    const skyFolder      = gui.addFolder('Sky');
    const seafloorFolder = gui.addFolder('Seafloor');
    const cameraFolder   = gui.addFolder('Camera');

    // Fog distortion state — must be declared before copy actions
    const _fogState = {
        distortion: DISTORTION_STRENGTH,
        speed:      DISTORTION_SPEED,
        scale:      DISTORTION_SCALE,
    };

    // ── Copy Config ───────────────────────────────────────────────────────────
    const actions = {
        copyConfig: () => {
            const f = (n: number) => n.toFixed(4);
            const ip = island.position;
            const content = [
                `// src/scene/IslandConfig.ts`,
                `// Island placement configuration — generated by IslandDebug.`,
                `// Paste this entire file to replace src/scene/IslandConfig.ts`,
                ``,
                `// ── Positions ─────────────────────────────────────────────────────────────────`,
                `export const islandPosition = { x: ${f(ip.x)}, y: ${f(ip.y)}, z: ${f(ip.z)} };`,
                `export const firecampOffset = { x: ${f(firecamp.position.x - ip.x)}, y: ${f(firecamp.position.y - ip.y)}, z: ${f(firecamp.position.z - ip.z)} };`,
                `export const palmtreeOffset = { x: ${f(palmtree.position.x - ip.x)}, y: ${f(palmtree.position.y - ip.y)}, z: ${f(palmtree.position.z - ip.z)} };`,
                `export const radioOffset    = { x: ${f(radio.position.x - ip.x)}, y: ${f(radio.position.y - ip.y)}, z: ${f(radio.position.z - ip.z)} };`,
                `export const swordOffset    = { x: ${f(sword.position.x - ip.x)}, y: ${f(sword.position.y - ip.y)}, z: ${f(sword.position.z - ip.z)} };`,
                `export const pugOffset      = { x: ${f(pug.position.x - ip.x)}, y: ${f(pug.position.y - ip.y)}, z: ${f(pug.position.z - ip.z)} };`,
                `export const tentOffset     = { x: ${f(tent.position.x - ip.x)}, y: ${f(tent.position.y - ip.y)}, z: ${f(tent.position.z - ip.z)} };`,
                `export const dogBedOffset      = { x: ${f(dogBed.position.x - ip.x)}, y: ${f(dogBed.position.y - ip.y)}, z: ${f(dogBed.position.z - ip.z)} };`,
                `export const littleRocksOffset = { x: ${f(littleRocks.position.x - ip.x)}, y: ${f(littleRocks.position.y - ip.y)}, z: ${f(littleRocks.position.z - ip.z)} };`,
                `export const phoneOffset       = { x: ${f(Island.phone.position.x - ip.x)}, y: ${f(Island.phone.position.y - ip.y)}, z: ${f(Island.phone.position.z - ip.z)} };`,
                ``,
                `// ── Scales ────────────────────────────────────────────────────────────────────`,
                `export const islandScale      = ${f(island.scale.x)};`,
                `export const firecampScale    = ${f(firecamp.scale.x)};`,
                `export const palmtreeScale    = ${f(palmtree.scale.x)};`,
                `export const radioScale       = ${f(radio.scale.x)};`,
                `export const swordScale       = ${f(sword.scale.x)};`,
                `export const pugScale         = ${f(pug.scale.x)};`,
                `export const tentScale        = ${f(tent.scale.x)};`,
                `export const dogBedScale      = ${f(dogBed.scale.x)};`,
                `export const littleRocksScale = ${f(littleRocks.scale.x)};`,
                `export const phoneScale       = ${f(Island.phone.scale.x)};`,
                ``,
                `// ── Rotations ─────────────────────────────────────────────────────────────────`,
                `export const palmtreeRotY   = ${f(palmtree.rotation.y)};`,
                `export const radioRotY      = ${f(radio.rotation.y)};`,
                `export const swordRot       = { x: ${f(sword.rotation.x)}, y: ${f(sword.rotation.y)}, z: ${f(sword.rotation.z)} };`,
                `export const pugRotY        = ${f(pug.rotation.y)};`,
                `export const tentRotY       = ${f(tent.rotation.y)};`,
                `export const dogBedRotY     = ${f(dogBed.rotation.y)};`,
                `export const littleRocksRot = { x: ${f(littleRocks.rotation.x)}, y: ${f(littleRocks.rotation.y)}, z: ${f(littleRocks.rotation.z)} };`,
                `export const phoneRot       = { x: ${f(Island.phone.rotation.x)}, y: ${f(Island.phone.rotation.y)}, z: ${f(Island.phone.rotation.z)} };`,
                ``,
                `// ── Foliage clusters ──────────────────────────────────────────────────────────`,
                `export const CLUSTER_MAIN = { wx: ${f(CLUSTER_MAIN.wx)}, wz: ${f(CLUSTER_MAIN.wz)}, minR: ${f(CLUSTER_MAIN.minR)}, maxR: ${f(CLUSTER_MAIN.maxR)} };`,
                `export const CLUSTER_PALM = { wx: ${f(CLUSTER_PALM.wx)}, wz: ${f(CLUSTER_PALM.wz)}, minR: ${f(CLUSTER_PALM.minR)}, maxR: ${f(CLUSTER_PALM.maxR)} };`,
                ``,
                `// ── Foliage counts ────────────────────────────────────────────────────────────`,
                `export const GRASS_COUNT      = ${Island.GRASS_COUNT};`,
                `export const GRASS_COUNT_PALM = ${Island.GRASS_COUNT_PALM};`,
                `export const CLOVER_COUNT     = ${Island.CLOVER_COUNT};`,
                ``,
                `// ── Spawn edge padding ────────────────────────────────────────────────────────`,
                `export const SURFACE_EDGE_PADDING = ${SURFACE_EDGE_PADDING};`,
            ].join('\n');
            navigator.clipboard.writeText(content).then(() => {
                console.log('[IslandDebug] IslandConfig.ts content copied to clipboard!');
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
            const content = [
                `// src/scene/OceanConfig.ts`,
                `// Ocean visual configuration — generated by IslandDebug.`,
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
                ``,
                `// ── Ocean Waves (normal-map scroll) ──────────────────────────────────────────`,
                `export const normalMapScale    = ${f(normalMapScaleUniform.value as number)};`,
                `export const normalMapStrength = ${f(normalMapStrengthUniform.value as number)};`,
                `export const waveVelocity1     = { x: ${f(vel1.x)}, y: ${f(vel1.y)} };`,
                `export const waveVelocity2     = { x: ${f(vel2.x)}, y: ${f(vel2.y)} };`,
                `export const edgeFadeDistance  = ${f(edgeFadeDistanceUniform.value as number)};`,
                ``,
                `// ── Ocean Surface ─────────────────────────────────────────────────────────────`,
                `export const surfaceColor   = { r: ${f(sc.x)}, g: ${f(sc.y)}, b: ${f(sc.z)} }; // RGB tint (1,1,1 = no tint)`,
                `export const surfaceOpacity = ${f(surfaceOpacityUniform.value as number)};`,
                ``,
                `// ── Reflection ────────────────────────────────────────────────────────────────`,
                `export const reflectionStrength     = ${f(reflectionStrengthUniform.value as number)}; // 0 = skybox only, 1 = RT only`,
                `export const reflectionFresnelPower = ${f(reflectionFresnelPowerUniform.value as number)}; // lower = visible at more angles`,
                `export const reflectionFloor        = ${f(reflectionFloorUniform.value as number)}; // minimum reflectivity at any angle`,
                `export const skyReflectionBrightness = ${f(skyReflectionBrightnessUniform.value as number)}; // scales the analytical skybox reflection (0 = none, 1 = full)`,
                `export const skyReflFalloff         = ${f(skyReflFalloffUniform.value as number)}; // sharpens near→far gradient: 1 = linear, 2 = squared, 4 = very steep`,
                `export const reflectionRTSize       = ${OceanReflection.currentResolution} as 256 | 512; // render target resolution`,
                ``,
                `// ── Underwater ────────────────────────────────────────────────────────────────`,
                `export const oceanAbsorption    = { r: ${f(abs.x)}, g: ${f(abs.y)}, b: ${f(abs.z)} }; // per-channel fog depth`,
                `export const distortionStrength = ${f(_fogState.distortion)};`,
                `export const distortionSpeed    = ${f(_fogState.speed)};`,
                `export const distortionScale    = ${f(_fogState.scale)};`,
            ].join('\n');
            navigator.clipboard.writeText(content).then(() => {
                console.log('[IslandDebug] OceanConfig.ts content copied to clipboard!');
            });
        },
    };
    oceanFolder.add(oceanActions, 'copyOceanConfig').name('Copy OceanConfig.ts');

    const windLinesActions = {
        copyWindLinesConfig: () => {
            const f  = (n: number) => n.toFixed(4);
            const fi = (n: number) => String(Math.round(n));
            const c  = WindLines.config;
            const content = [
                `// src/scene/WindLinesConfig.ts`,
                `// Wind lines visual configuration — generated by IslandDebug.`,
                `// Paste this entire file to replace src/scene/WindLinesConfig.ts`,
                ``,
                `// ── Spawning ──────────────────────────────────────────────────────────────────`,
                `export const maxLines  = ${fi(c.maxLines)};`,
                `export const spawnRate = ${f(c.spawnRate)};       // lines spawned per second at full breeze intensity`,
                `export const rampUp    = ${f(c.rampUp)};     // seconds to reach full intensity (breeze start)`,
                `export const rampDown  = ${f(c.rampDown)};     // seconds to fade out (breeze end)`,
                ``,
                `// ── Line shape ────────────────────────────────────────────────────────────────`,
                `export const minLength = ${fi(c.minLength)};      // px`,
                `export const maxLength = ${fi(c.maxLength)};     // px`,
                `export const tiltY     = ${f(c.tiltY)};    // downward drift — px per px traveled left (0 = horizontal)`,
                ``,
                `// ── Vertical spread ───────────────────────────────────────────────────────────`,
                `export const minWorldY = ${f(c.minWorldY)};   // lowest spawn Y in Three.js world units`,
                `export const maxWorldY =  ${f(c.maxWorldY)};   // highest spawn Y in Three.js world units`,
                ``,
                `// ── Width ─────────────────────────────────────────────────────────────────────`,
                `export const minWidth  = ${f(c.minWidth)};     // px`,
                `export const maxWidth  = ${f(c.maxWidth)};     // px`,
                ``,
                `// ── Speed ─────────────────────────────────────────────────────────────────────`,
                `export const minSpeed  = ${fi(c.minSpeed)};     // px/s`,
                `export const maxSpeed  = ${fi(c.maxSpeed)};     // px/s`,
                ``,
                `// ── Appearance ────────────────────────────────────────────────────────────────`,
                `export const lineOpacity = ${f(c.lineOpacity)};  // peak opacity per line (0–1)`,
                `export const colorR      = ${fi(c.colorR)};   // RGB 0–255`,
                `export const colorG      = ${fi(c.colorG)};`,
                `export const colorB      = ${fi(c.colorB)};`,
                ``,
                `// ── Wave / wobble ─────────────────────────────────────────────────────────────`,
                `export const waveAmplitude = ${f(c.waveAmplitude)};   // max vertical displacement (px); 0 = straight lines`,
                `export const waveFrequency = ${f(c.waveFrequency)}; // full sine cycles per line (1 = one wave, 2 = two waves)`,
                `export const waveSpeed     = ${f(c.waveSpeed)};// animation speed — radians per second phase shift`,
                `export const waveSegments  = ${fi(c.waveSegments)};  // sub-divisions per line (higher = smoother, min 4)`,
                ``,
                `// ── 3D World-Space Depth ──────────────────────────────────────────────────────`,
                `export const minZOffset = ${f(c.minZOffset)};  // Z offset relative to island Z (negative = further from camera)`,
                `export const maxZOffset =  ${f(c.maxZOffset)};  // Z offset relative to island Z (positive = closer to camera)`,
                ``,
                `// ── Island Proximity Fade ─────────────────────────────────────────────────────`,
                `export const islandDisappearDist = ${f(c.islandDisappearDist)};  // dist where lines START fading out (moving away from island)`,
                `export const islandAppearDist    = ${f(c.islandAppearDist)};  // dist where lines START appearing (approaching island)`,
            ].join('\n');
            navigator.clipboard.writeText(content).then(() => {
                console.log('[IslandDebug] WindLinesConfig.ts content copied to clipboard!');
            });
        },
    };
    skyFolder.add(windLinesActions, 'copyWindLinesConfig').name('Copy WindLinesConfig.ts');

    // ── Objects ──────────────────────────────────────────────────────────────
    //   scaleRange: [min, max]   rotAxes: axes where rotation is meaningful
    // ─────────────────────────────────────────────────────────────────────────
    addObjectFolder(surfaceFolder, 'Island',    island,    { scaleRange: [0.01, 1.0]                           });
    addObjectFolder(surfaceFolder, 'Firecamp',  firecamp,  { scaleRange: [0.1,  5.0]                           });
    addObjectFolder(surfaceFolder, 'Palm Tree', palmtree,  { scaleRange: [0.1,  2.0], rotAxes: ['y']           });
    addObjectFolder(surfaceFolder, 'Radio',     radio,     { scaleRange: [0.01, 1.0], rotAxes: ['y']           });
    addObjectFolder(surfaceFolder, 'Sword',     sword,     { scaleRange: [0.01, 1.0], rotAxes: ['x', 'y', 'z'] });

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

    addObjectFolder(surfaceFolder, 'Tent',    tent,         { scaleRange: [0.1,  5.0], rotAxes: ['y']           });
    addObjectFolder(surfaceFolder, 'Dog Bed', dogBed,       { scaleRange: [0.01, 1.5], rotAxes: ['y']           });
    addObjectFolder(surfaceFolder, 'Little Rocks', littleRocks, { scaleRange: [0.01, 1.0], rotAxes: ['x', 'y', 'z'] });
    addObjectFolder(surfaceFolder, 'Phone',   Island.phone, { scaleRange: [0.01, 1.0], rotAxes: ['x', 'y', 'z'] });

    // ── Foliage clusters ──
    addClusterFolder(surfaceFolder, 'Grass – Main Cluster', 'grass-main', CLUSTER_MAIN, 'GRASS_COUNT',      setGrassCount);
    addClusterFolder(surfaceFolder, 'Grass – Palm Cluster', 'grass-palm', CLUSTER_PALM, 'GRASS_COUNT_PALM', setGrassPalmCount);
    addClusterFolder(surfaceFolder, 'Clover',               'clover',     CLUSTER_MAIN, 'CLOVER_COUNT',     setCloverCount);

    // ── Ocean Reflection ──────────────────────────────────────────
    const reflFolder = oceanFolder.addFolder('Reflection');

    const reflProxy = {
        get strength()     { return reflectionStrengthUniform.value as number; },
        set strength(v)    { reflectionStrengthUniform.value = v; },
        get fresnelPower() { return reflectionFresnelPowerUniform.value as number; },
        set fresnelPower(v){ reflectionFresnelPowerUniform.value = v; },
        get floor()        { return reflectionFloorUniform.value as number; },
        set floor(v)       { reflectionFloorUniform.value = v; },
        get skyBrightness(){ return skyReflectionBrightnessUniform.value as number; },
        set skyBrightness(v){ skyReflectionBrightnessUniform.value = v; },
        get skyFalloff()   { return skyReflFalloffUniform.value as number; },
        set skyFalloff(v)  { skyReflFalloffUniform.value = v; },
        get resolution()   { return OceanReflection.currentResolution; },
        set resolution(v)  { OceanReflection.setResolution(v as 256 | 512); },
    };

    reflFolder.add(reflProxy, 'strength', 0, 1, 0.01)
        .name('RT vs Skybox  (0–100%)')
        .listen()
        .onChange((v: number) => { reflectionStrengthUniform.value = v; });

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

    reflFolder.add(reflProxy, 'resolution', { '256 (quarter-res)': 256, '512 (half-res)': 512 })
        .name('RT Resolution')
        .listen()
        .onChange((v: number) => { OceanReflection.setResolution(v as 256 | 512); });

    reflFolder.close();

    // ── Ocean Waves ──────────────────────────────────────────────────────────
    const wavesFolder = oceanFolder.addFolder('Waves');

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
    };

    wavesFolder.add(wavesProxy, 'nmScale',    0, 1,    0.001).name('NormalMap Scale').listen();
    wavesFolder.add(wavesProxy, 'nmStrength', 0, 3,    0.01 ).name('NormalMap Strength').listen();
    wavesFolder.add(wavesProxy, 'vel1x',   -0.5, 0.5,  0.001).name('Wave1 Vel X').listen();
    wavesFolder.add(wavesProxy, 'vel1y',   -0.5, 0.5,  0.001).name('Wave1 Vel Y').listen();
    wavesFolder.add(wavesProxy, 'vel2x',   -0.5, 0.5,  0.001).name('Wave2 Vel X').listen();
    wavesFolder.add(wavesProxy, 'vel2y',   -0.5, 0.5,  0.001).name('Wave2 Vel Y').listen();
    wavesFolder.add(wavesProxy, 'edgeFade', 0,   5,    0.01 ).name('Edge Fade Distance').listen();

    wavesFolder.close();

    // ── Ocean Surface ────────────────────────────────────────────────────────
    const surfFolder = oceanFolder.addFolder('Surface Color');

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
    const foamFolder = oceanFolder.addFolder('Foam');

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

    foamFolder.close();

    // ── Wind Lines ────────────────────────────────────────────────────────────
    const windFolder = skyFolder.addFolder('Wind Lines');

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
    // ── Volumetric Clouds ────────────────────────────────────────────────
    const cloudFolder = skyFolder.addFolder('Clouds');

    const cloudsActions = {
        copyCloudsConfig: () => {
            const f  = (n: number) => n.toFixed(4);
            const fi = (n: number) => String(Math.round(n));
            const c  = Clouds.config;
            const content = [
                `// src/scene/CloudsConfig.ts`,
                `// Volumetric clouds configuration -- generated by IslandDebug.`,
                `// Paste this entire file to replace src/scene/CloudsConfig.ts`,
                ``,
                `// -- Mesh placement (world-space centre + scale) ---`,
                `export const posX   = ${f(c.posX)};`,
                `export const posY   = ${f(c.posY)};`,
                `export const posZ   = ${f(c.posZ)};`,
                `export const scaleX = ${f(c.scaleX)};`,
                `export const scaleY = ${f(c.scaleY)};`,
                `export const scaleZ = ${f(c.scaleZ)};`,
                ``,
                `// -- Wind (right -> left) ---`,
                `export const windSpeed = ${f(c.windSpeed)};`,
                ``,
                `// -- Noise ---`,
                `export const noiseScale = ${f(c.noiseScale)};`,
                ``,
                `// -- Turbulence (domain warp) ---`,
                `export const turbulenceStrength = ${f(c.turbulenceStrength)};`,
                `export const turbulenceSpeed    = ${f(c.turbulenceSpeed)};`,
                ``,
                `// -- Shape ---`,
                `export const threshold = ${f(c.threshold)};`,
                `export const range     = ${f(c.range)};`,
                `export const opacity   = ${f(c.opacity)};`,
                `export const edgeFade  = ${f(c.edgeFade)};`,
                ``,
                `// -- Quality ---`,
                `export const marchSteps = ${fi(c.marchSteps)};`,
                ``,
                `// -- Day colors ---`,
                `export const dayR = ${f(c.dayR)};`,
                `export const dayG = ${f(c.dayG)};`,
                `export const dayB = ${f(c.dayB)};`,
                ``,
                `// -- Night colors ---`,
                `export const nightR = ${f(c.nightR)};`,
                `export const nightG = ${f(c.nightG)};`,
                `export const nightB = ${f(c.nightB)};`,
            ].join('\n');
            navigator.clipboard.writeText(content).then(() => {
                console.log('[IslandDebug] CloudsConfig.ts content copied to clipboard!');
            });
        },
    };
    cloudFolder.add(cloudsActions, 'copyCloudsConfig').name('Copy CloudsConfig.ts');

    const cc = Clouds.config;

    const cloudProxy = {
        // shape
        get threshold()  { return cc.threshold; },  set threshold(v)  { cc.threshold  = v; },
        get range()      { return cc.range; },       set range(v)      { cc.range      = v; },
        get opacity()    { return cc.opacity; },     set opacity(v)    { cc.opacity    = v; },
        get edgeFade()   { return cc.edgeFade; },   set edgeFade(v)   { cc.edgeFade   = v; },
        get noiseScale()         { return cc.noiseScale; },         set noiseScale(v)         { cc.noiseScale          = v; },
        get turbulenceStrength() { return cc.turbulenceStrength; }, set turbulenceStrength(v) { cc.turbulenceStrength = v; },
        get turbulenceSpeed()    { return cc.turbulenceSpeed; },    set turbulenceSpeed(v)    { cc.turbulenceSpeed    = v; },
        get windSpeed()          { return cc.windSpeed; },          set windSpeed(v)          { cc.windSpeed          = v; },
        // quality
        get marchSteps() { return cc.marchSteps; }, set marchSteps(v) { cc.marchSteps = Math.round(v); },
        // day colors
        get dayR() { return cc.dayR; }, set dayR(v) { cc.dayR = v; },
        get dayG() { return cc.dayG; }, set dayG(v) { cc.dayG = v; },
        get dayB() { return cc.dayB; }, set dayB(v) { cc.dayB = v; },
        // night colors
        get nightR() { return cc.nightR; }, set nightR(v) { cc.nightR = v; },
        get nightG() { return cc.nightG; }, set nightG(v) { cc.nightG = v; },
        get nightB() { return cc.nightB; }, set nightB(v) { cc.nightB = v; },
        // placement
        get posX()   { return cc.posX; },   set posX(v)   { cc.posX   = v; },
        get posY()   { return cc.posY; },   set posY(v)   { cc.posY   = v; },
        get posZ()   { return cc.posZ; },   set posZ(v)   { cc.posZ   = v; },
        get scaleX() { return cc.scaleX; }, set scaleX(v) { cc.scaleX = v; },
        get scaleY() { return cc.scaleY; }, set scaleY(v) { cc.scaleY = v; },
        get scaleZ() { return cc.scaleZ; }, set scaleZ(v) { cc.scaleZ = v; },
    };

    const cloudShapeFolder = cloudFolder.addFolder('Shape');
    cloudShapeFolder.add(cloudProxy, 'threshold',  0,    1,    0.01 ).name('Threshold (density)').listen();
    cloudShapeFolder.add(cloudProxy, 'range',      0.01, 0.5,  0.005).name('Range (softness)').listen();
    cloudShapeFolder.add(cloudProxy, 'opacity',    0,    1,    0.005).name('Opacity per step').listen();
    cloudShapeFolder.add(cloudProxy, 'edgeFade',   0,    0.5,  0.01 ).name('Edge Fade (top/bot)').listen();
    cloudShapeFolder.add(cloudProxy, 'noiseScale',         0.1, 2.0,  0.01 ).name('Noise Scale').listen();
    cloudShapeFolder.add(cloudProxy, 'turbulenceStrength', 0,   0.5,  0.005).name('Turbulence Strength').listen();
    cloudShapeFolder.add(cloudProxy, 'turbulenceSpeed',    0,   0.25, 0.002).name('Turbulence Speed').listen();
    cloudShapeFolder.add(cloudProxy, 'windSpeed',          0,   0.1,  0.001).name('Wind Speed').listen();
    cloudShapeFolder.close();

    const cloudQualityFolder = cloudFolder.addFolder('Quality');
    cloudQualityFolder.add(cloudProxy, 'marchSteps', 16, 200, 1).name('March Steps').listen();
    cloudQualityFolder.close();

    const cloudDayFolder = cloudFolder.addFolder('Day Colors');
    cloudDayFolder.add(cloudProxy, 'dayR', 0, 1, 0.01).name('R').listen();
    cloudDayFolder.add(cloudProxy, 'dayG', 0, 1, 0.01).name('G').listen();
    cloudDayFolder.add(cloudProxy, 'dayB', 0, 1, 0.01).name('B').listen();
    cloudDayFolder.close();

    const cloudNightFolder = cloudFolder.addFolder('Night Colors');
    cloudNightFolder.add(cloudProxy, 'nightR', 0, 1, 0.01).name('R').listen();
    cloudNightFolder.add(cloudProxy, 'nightG', 0, 1, 0.01).name('G').listen();
    cloudNightFolder.add(cloudProxy, 'nightB', 0, 1, 0.01).name('B').listen();
    cloudNightFolder.close();

    const cloudPlaceFolder = cloudFolder.addFolder('Placement');
    cloudPlaceFolder.add(cloudProxy, 'posX',   -500, 500,  1.0).name('Centre X').listen();
    cloudPlaceFolder.add(cloudProxy, 'posY',      0, 500,  1.0).name('Centre Y').listen();
    cloudPlaceFolder.add(cloudProxy, 'posZ',   -800,   0,  1.0).name('Centre Z').listen();
    cloudPlaceFolder.add(cloudProxy, 'scaleX',   10,2000,  5.0).name('Width').listen();
    cloudPlaceFolder.add(cloudProxy, 'scaleY',    1, 300,  1.0).name('Height').listen();
    cloudPlaceFolder.add(cloudProxy, 'scaleZ',   10,1000,  5.0).name('Depth').listen();
    cloudPlaceFolder.close();

    cloudFolder.close();
    // ── Underwater Fog ───────────────────────────────────────────────────────
    const fogFolder = oceanFolder.addFolder('Underwater');

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
    };

    fogFolder.add(fogProxy, 'absR',  0, 1,    0.001 ).name('Absorption R').listen();
    fogFolder.add(fogProxy, 'absG',  0, 1,    0.001 ).name('Absorption G').listen();
    fogFolder.add(fogProxy, 'absB',  0, 1,    0.001 ).name('Absorption B').listen();
    fogFolder.add(fogProxy, 'fogDist', 1, 400, 1    ).name('Fog Far Distance').listen();
    fogFolder.add(fogProxy, 'distortion', 0, 0.05,  0.0001).name('Distortion Strength').listen();
    fogFolder.add(fogProxy, 'speed',      0, 5,     0.01  ).name('Distortion Speed').listen();
    fogFolder.add(fogProxy, 'scale',      0, 30,    0.1   ).name('Distortion Scale').listen();

    fogFolder.close();

    // ── Seafloor Decorations ──────────────────────────────────────────────────
    const sfFolder = seafloorFolder;
    const sf = SeaFloorDecor.config;

    // ── Copy config action ────────────────────────────────────────────────────
    const sfActions = {
        copyConfig: () => {
            const f = (n: number) => n.toFixed(4);
            const content = [
                `// src/scene/SeaFloorConfig.ts`,
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
            ].join('\n');
            navigator.clipboard.writeText(content).then(() => {
                console.log('[IslandDebug] SeaFloorConfig.ts content copied to clipboard!');
            });
        },
    };
    sfFolder.add(sfActions, 'copyConfig').name('Copy SeaFloorConfig.ts');

    // ── Helper: make per-model placement sub-folder ───────────────────────────
    function makePlacementFolder(
        parent: any,
        label: string,
        getCfg: () => { x: number; y: number; z: number; scale: number; rx: number; ry: number; rz: number },
        onTransform: () => void,
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
        folder.add(proxy, 'x',     -30, 30,   0.05).name('X').listen();
        folder.add(proxy, 'y',     -20,  0,   0.05).name('Y').listen();
        folder.add(proxy, 'z',     -30, 30,   0.05).name('Z').listen();
        folder.add(proxy, 'scale',   0,  5,   0.01).name('Scale').listen();
        folder.add(proxy, 'rx', -3.14, 3.14,  0.01).name('Rot X').listen();
        folder.add(proxy, 'ry', -3.14, 3.14,  0.01).name('Rot Y').listen();
        folder.add(proxy, 'rz', -3.14, 3.14,  0.01).name('Rot Z').listen();
        folder.close();
    }

    // ── Coral Rocks ─────────────────────────────────────────────────────────
    const sfRocksFolder = sfFolder.addFolder('Coral Rocks');
    makePlacementFolder(sfRocksFolder, 'Rock 1', () => sf.rock1,  () => SeaFloorDecor.updateRockTransform(0));
    makePlacementFolder(sfRocksFolder, 'Rock 2', () => sf.rock2,  () => SeaFloorDecor.updateRockTransform(1));
    makePlacementFolder(sfRocksFolder, 'Rock 3', () => sf.rock3,  () => SeaFloorDecor.updateRockTransform(2));
    sfRocksFolder.close();

    // ── Corals ───────────────────────────────────────────────────────────────
    const sfCoralsFolder = sfFolder.addFolder('Corals');
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
    const sfKelpFolder = sfFolder.addFolder('Kelps');
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

    sfFolder.close();

    // ── Camera: Main Camera live tweaks ────────────────────────────────────────
    const mainCamFolder = cameraFolder.addFolder('Main Camera');
    const mainCamProxy = {
        get z()   { return mainCameraConfig.z; },
        set z(v)  { mainCameraConfig.z = v; },
        get fov() { return mainCameraConfig.fov; },
        set fov(v) {
            mainCameraConfig.fov = v;
            SetFOV(v);  // apply immediately to base camera
        },
    };
    mainCamFolder.add(mainCamProxy, 'z',   0.1, 5.0, 0.01).name('Camera Z (depth)').listen();
    mainCamFolder.add(mainCamProxy, 'fov', 10,  120, 0.5 ).name('Field of View (°)').listen();
    mainCamFolder.close();

    // ── Camera: Copy CameraConfig.ts ────────────────────────────────────────────
    const cameraConfigActions = {
        copyConfig: () => {
            const f = (n: number) => n.toFixed(4);
            const fi = (n: number) => String(n);  // integer values (no decimal)
            const pzc = phoneZoomConfig;
            const psc = phoneScreenConfig;
            const mcc = mainCameraConfig;
            const content = [
                `// src/scene/CameraConfig.ts`,
                `// Camera configuration — generated by IslandDebug.`,
                `// Paste this entire file to replace src/scene/CameraConfig.ts`,
                ``,
                `// ── Main Camera ─────────────────────────────────────────────────────────────────`,
                `export const defaultCameraZ = ${f(mcc.z)};   // World-space Z position of the camera at rest`,
                `export const defaultFov     = ${fi(mcc.fov)};    // Default camera Field-of-View in degrees`,
                ``,
                `// ── Phone Zoom ────────────────────────────────────────────────────────────────`,
                `export const phoneZoomHeight = ${f(pzc.height)};    // World-units above phone surface`,
                `export const phoneZoomTilt   = ${f(pzc.tilt)};    // Z forward offset for slight viewing angle`,
                `export const phoneZoomPitch  = ${f(pzc.pitch)};   // Camera pitch in radians (~-83° = nearly straight down)`,
                `export const phoneZoomFov    = ${fi(pzc.fov)};      // Camera FOV during phone zoom (telephoto)`,
                ``,
                `// ── Phone Screen ──────────────────────────────────────────────────────────────`,
                `export const phoneScreenWidth   = ${f(psc.screenWidth)};              // world units`,
                `export const phoneScreenHeight  = ${f(psc.screenHeight)};              // world units`,
                `export const phoneScreenOffsetX = ${f(psc.offsetX)};`,
                `export const phoneScreenOffsetY = ${f(psc.offsetY)};`,
                `export const phoneScreenOffsetZ = ${f(psc.offsetZ)};`,
                ``,
                `// ── Phone Screen Overlay ──────────────────────────────────────────────────────`,
                `export const phoneOverlayOpacity      = ${f(psc.overlayOpacity)};`,
                `export const phoneOverlayTintR        = ${fi(psc.overlayTintR)};`,
                `export const phoneOverlayTintG        = ${fi(psc.overlayTintG)};`,
                `export const phoneOverlayTintB        = ${fi(psc.overlayTintB)};`,
                `export const phoneOverlayGlareOpacity = ${f(psc.overlayGlareOpacity)};`,
                `export const phoneOverlayGlareAngle   = ${fi(psc.overlayGlareAngle)};`,
            ].join('\n');
            navigator.clipboard.writeText(content).then(() => {
                console.log('[IslandDebug] CameraConfig.ts content copied to clipboard!');
            });
        },
    };
    cameraFolder.add(cameraConfigActions, 'copyConfig').name('Copy CameraConfig.ts');

    // ── Camera: Phone Zoom ──────────────────────────────────────────
    //   Active only while phone zoom is active, but sliders affect it instantly.
    const phoneZoomFolder = cameraFolder.addFolder('Phone Zoom');
    phoneZoomFolder.add(phoneZoomConfig, 'height', 0.05, 1.0,  0.005).name('Height above phone').listen();
    phoneZoomFolder.add(phoneZoomConfig, 'tilt',  -0.5,  0.5,  0.01 ).name('Tilt (Z offset)').listen();
    phoneZoomFolder.add(phoneZoomConfig, 'pitch', -1.57, -0.1,  0.01 ).name('Pitch (radians)').listen();
    phoneZoomFolder.add(phoneZoomConfig, 'fov',   5,     70,   0.5  ).name('FOV (telephoto)').listen();

    // ── Camera: Phone Screen placement & overlay ────────────────────────────
    const screenFolder = cameraFolder.addFolder('Phone Screen');
    screenFolder.add(phoneScreenConfig, 'screenWidth',  0.01, 0.5, 0.001).name('Screen Width (wu)').listen();
    screenFolder.add(phoneScreenConfig, 'screenHeight', 0.01, 0.8, 0.001).name('Screen Height (wu)').listen();
    screenFolder.add(phoneScreenConfig, 'offsetX', -0.2, 0.2, 0.001).name('Offset X').listen();
    screenFolder.add(phoneScreenConfig, 'offsetY', -0.1, 0.2, 0.001).name('Offset Y (above surf)').listen();
    screenFolder.add(phoneScreenConfig, 'offsetZ', -0.2, 0.2, 0.001).name('Offset Z').listen();
    screenFolder.close();

    const overlayFolder = cameraFolder.addFolder('Phone Screen — Overlay');
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

    // ── Close all top-level groups by default ───────────────────────────────
    surfaceFolder.close();
    oceanFolder.close();
    skyFolder.close();
    cameraFolder.close();
    // seafloorFolder ≡ sfFolder, already closed above

    gui.hide();
    visible = false;
}

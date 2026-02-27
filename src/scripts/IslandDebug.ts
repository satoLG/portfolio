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
import { Object3D } from 'three';

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
                `export const dogBedOffset   = { x: ${f(dogBed.position.x - ip.x)}, y: ${f(dogBed.position.y - ip.y)}, z: ${f(dogBed.position.z - ip.z)} };`,
                ``,
                `// ── Scales ────────────────────────────────────────────────────────────────────`,
                `export const islandScale   = ${f(island.scale.x)};`,
                `export const firecampScale = ${f(firecamp.scale.x)};`,
                `export const palmtreeScale = ${f(palmtree.scale.x)};`,
                `export const radioScale    = ${f(radio.scale.x)};`,
                `export const swordScale    = ${f(sword.scale.x)};`,
                `export const pugScale      = ${f(pug.scale.x)};`,
                `export const tentScale     = ${f(tent.scale.x)};`,
                `export const dogBedScale   = ${f(dogBed.scale.x)};`,
                ``,
                `// ── Rotations ─────────────────────────────────────────────────────────────────`,
                `export const palmtreeRotY = ${f(palmtree.rotation.y)};`,
                `export const radioRotY    = ${f(radio.rotation.y)};`,
                `export const swordRot     = { x: ${f(sword.rotation.x)}, y: ${f(sword.rotation.y)}, z: ${f(sword.rotation.z)} };`,
                `export const pugRotY      = ${f(pug.rotation.y)};`,
                `export const tentRotY     = ${f(tent.rotation.y)};`,
                `export const dogBedRotY   = ${f(dogBed.rotation.y)};`,
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
    gui.add(actions, 'copyConfig').name('📋 Copy IslandConfig.ts');

    // ── Objects ──────────────────────────────────────────────────────────────
    //   scaleRange: [min, max]   rotAxes: axes where rotation is meaningful
    // ─────────────────────────────────────────────────────────────────────────
    addObjectFolder(gui, 'Island',    island,    { scaleRange: [0.01, 1.0]                          });
    addObjectFolder(gui, 'Firecamp',  firecamp,  { scaleRange: [0.1,  5.0]                          });
    addObjectFolder(gui, 'Palm Tree', palmtree,  { scaleRange: [0.1,  2.0], rotAxes: ['y']          });
    addObjectFolder(gui, 'Radio',     radio,     { scaleRange: [0.01, 1.0], rotAxes: ['y']          });
    addObjectFolder(gui, 'Sword',     sword,     { scaleRange: [0.01, 1.0], rotAxes: ['x', 'y', 'z'] });

    const pugFolder = addObjectFolder(gui, 'Pug', pug, { scaleRange: [0.01, 2.0], rotAxes: ['y'] });

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
        pugFolder.add(proxy, 'anim', options).name('🎬 Animation').listen();
    })();

    addObjectFolder(gui, 'Tent',      tent,      { scaleRange: [0.1,  5.0], rotAxes: ['y']          });
    addObjectFolder(gui, 'Dog Bed',   dogBed,    { scaleRange: [0.01, 1.5], rotAxes: ['y']          });

    // ── Foliage clusters ──
    addClusterFolder(gui, 'Grass – Main Cluster', 'grass-main', CLUSTER_MAIN, 'GRASS_COUNT',      setGrassCount);
    addClusterFolder(gui, 'Grass – Palm Cluster', 'grass-palm', CLUSTER_PALM, 'GRASS_COUNT_PALM', setGrassPalmCount);
    addClusterFolder(gui, 'Clover',               'clover',     CLUSTER_MAIN, 'CLOVER_COUNT',     setCloverCount);

    gui.hide();
    visible = false;
}

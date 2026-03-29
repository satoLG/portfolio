/**
 * test-main.ts — Isolated CSS3D monitor screen test
 *
 * A minimal Three.js scene containing only the monitor screen implementation:
 *   - WebGL scene with occluder + texture layers (single-pass render)
 *   - CSS3DRenderer with iframe centred in the viewport
 *   - MeshBasicMaterial NoBlending occluder (ignores lights, outputs (0,0,0,0))
 *   - Full texture layers (smudge, shadow, video static)
 *
 * No dependency on Scene.ts, Control.ts, or any other main-app module.
 */

import {
    PerspectiveCamera,
    Scene,
    WebGLRenderer,
    Mesh,
    PlaneGeometry,
    MeshBasicMaterial,
    NoBlending,
    DoubleSide,
    AdditiveBlending,
    NormalBlending,
    TextureLoader,
    VideoTexture,
    Vector3,
    Euler,
    Blending,
    Texture,
} from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer';

// ── Monitor constants (identical to MonitorScreen.ts) ─────────────────────────
const IFRAME_WIDTH   = 1280;
const IFRAME_HEIGHT  = 1024;
const IFRAME_PADDING = 32;

// World-unit size of the screen — 1.0 wide fills ~85% of viewport at z=1.5
const SCREEN_WIDTH  = 1.0;
const SCREEN_HEIGHT = SCREEN_WIDTH * (IFRAME_HEIGHT / IFRAME_WIDTH);

// Scale: world units per CSS pixel
const SCALE_X = SCREEN_WIDTH  / IFRAME_WIDTH;
const SCALE_Y = SCREEN_HEIGHT / IFRAME_HEIGHT;

const IFRAME_SRC = 'https://projects-hub-one.vercel.app/';

// Monitor sits at world origin
const POS = new Vector3(0, 0, 0);
const ROT = new Euler(0, 0, 0);

// ── Viewport helpers (matches henryjeff Sizes.ts) ────────────────────────────
function vpW(): number { return window.innerWidth;  }
function vpH(): number { return window.innerHeight; }

// ── DOM containers ────────────────────────────────────────────────────────────
const cssContainer   = document.querySelector('#css')   as HTMLDivElement;
const webglContainer = document.querySelector('#webgl') as HTMLDivElement;

// ── WebGL renderer ────────────────────────────────────────────────────────────
const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,                  // transparent canvas — body bg shows through
    powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(vpW(), vpH());
renderer.setClearColor(0x000000, 0.0);  // fully transparent — body #1a1a2e shows through

renderer.domElement.style.position    = 'absolute';
renderer.domElement.style.top         = '0px';
renderer.domElement.style.zIndex      = '1';
renderer.domElement.style.pointerEvents = 'auto';
webglContainer.appendChild(renderer.domElement);

// ── CSS3D renderer ────────────────────────────────────────────────────────────
const cssRenderer = new CSS3DRenderer();
cssRenderer.setSize(vpW(), vpH());
cssRenderer.domElement.style.position = 'absolute';
cssRenderer.domElement.style.top      = '0px';
// Keep CSS3DRenderer's default overflow:hidden — henryjeff works with it.
cssContainer.appendChild(cssRenderer.domElement);

// ── Scenes ────────────────────────────────────────────────────────────────────
const scene    = new Scene();   // main scene — occluder + texture layers live here
const cssScene = new Scene();   // CSS3D layer

// ── Camera ────────────────────────────────────────────────────────────────────
// FOV=50.5 matches the main scene (CameraConfig.ts defaultFov).
// The CSS3D perspective value is derived from projectionMatrix.elements[5] * heightHalf,
// so this must match the real scene or the test won't be representative.
const camera = new PerspectiveCamera(50.5, vpW() / vpH(), 0.1, 1000);
camera.position.set(POS.x, POS.y, POS.z + 1.5);
camera.lookAt(POS.x, POS.y, POS.z);

// ── iframe container ──────────────────────────────────────────────────────────
const containerEl = document.createElement('div');
containerEl.style.width      = IFRAME_WIDTH  + 'px';
containerEl.style.height     = IFRAME_HEIGHT + 'px';
containerEl.style.opacity    = '1';
containerEl.style.background = '#1d2e2f';

const iframeEl = document.createElement('iframe');
iframeEl.src             = IFRAME_SRC;
iframeEl.style.width     = IFRAME_WIDTH  + 'px';
iframeEl.style.height    = IFRAME_HEIGHT + 'px';
iframeEl.style.padding   = IFRAME_PADDING + 'px';
iframeEl.style.boxSizing = 'border-box';
iframeEl.style.opacity   = '1';
iframeEl.className       = 'jitter';
iframeEl.frameBorder     = '0';
containerEl.appendChild(iframeEl);

// ── CSS3D object ──────────────────────────────────────────────────────────────
const cssObject = new CSS3DObject(containerEl);
cssObject.position.copy(POS);
cssObject.rotation.copy(ROT);
cssObject.scale.set(SCALE_X, SCALE_Y, 1);
cssScene.add(cssObject);

// ── Occluder plane ────────────────────────────────────────────────────────────
const occMat = new MeshBasicMaterial({
    color: 0x000000,
    side: DoubleSide,
    opacity: 0,
    transparent: true,
    blending: NoBlending,
});

const occluder = new Mesh(new PlaneGeometry(IFRAME_WIDTH, IFRAME_HEIGHT), occMat);
occluder.position.copy(POS);
occluder.rotation.copy(ROT);
occluder.scale.set(SCALE_X, SCALE_Y, 1);
scene.add(occluder);

// ── Texture layers (same as MonitorScreen._addTextureLayer) ───────────────────
function addTextureLayer(texture: Texture, blending: Blending, opacity: number, offsetZ: number): void {
    const mat = new MeshBasicMaterial({ map: texture, blending, side: DoubleSide, opacity, transparent: true });
    const mesh = new Mesh(new PlaneGeometry(IFRAME_WIDTH, IFRAME_HEIGHT), mat);
    mesh.position.set(POS.x, POS.y, POS.z + offsetZ * SCALE_X);
    mesh.rotation.copy(ROT);
    mesh.scale.set(SCALE_X, SCALE_Y, 1);
    scene.add(mesh);
}

const loader = new TextureLoader();
addTextureLayer(loader.load('/textures/monitor/layers/shadow.png'),  NormalBlending,   1.0,  5 * 4);
addTextureLayer(loader.load('/textures/monitor/layers/smudges.jpg'), AdditiveBlending, 0.12, 24 * 4);

function addVideoLayer(videoId: string, blending: Blending, opacity: number, offsetZ: number): void {
    const el = document.getElementById(videoId);
    if (!el) { setTimeout(() => addVideoLayer(videoId, blending, opacity, offsetZ), 100); return; }
    addTextureLayer(new VideoTexture(el as HTMLVideoElement), blending, opacity, offsetZ);
}
addVideoLayer('video-1', AdditiveBlending, 0.5, 10 * 4);
addVideoLayer('video-2', AdditiveBlending, 0.1, 15 * 4);

// ── Resize ────────────────────────────────────────────────────────────────────
function onResize(): void {
    const w = vpW();
    const h = vpH();
    renderer.setSize(w, h);
    cssRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.onresize = onResize;

// ── Render loop ───────────────────────────────────────────────────────────────
function animate(): void {
    requestAnimationFrame(animate);
    camera.updateProjectionMatrix();

    // Single-pass: scene contains occluder + texture layers
    renderer.render(scene, camera);

    // CSS3D — iframe shows through the transparent hole
    cssRenderer.render(cssScene, camera);
}
animate();

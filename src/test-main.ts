/**
 * test-main.ts — Isolated CSS3D monitor screen test
 *
 * A minimal Three.js scene containing only the monitor screen implementation:
 *   - Empty WebGL scene (solid body background)
 *   - CSS3DRenderer with iframe centred in the viewport
 *   - NoBlending occluder in a light-free scene (valid premultiplied alpha)
 *   - Full texture layers (smudge, shadow, video static)
 *   - visualViewport resize handling for iOS Safari
 *
 * No dependency on Scene.ts, Control.ts, or any other main-app module.
 */

import {
    PerspectiveCamera,
    Scene,
    WebGLRenderer,
    Mesh,
    PlaneGeometry,
    MeshLambertMaterial,
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

// ── iOS-safe viewport helpers ─────────────────────────────────────────────────
// window.innerHeight lags on iOS when the URL bar shows/hides.
// window.visualViewport gives the real current dimensions.
function vpW(): number { return window.visualViewport?.width  ?? window.innerWidth;  }
function vpH(): number { return window.visualViewport?.height ?? window.innerHeight; }

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
// iOS Safari fix: stock CSS3DRenderer sets overflow:hidden on its domElement.
// On WebKit, overflow:hidden on a preserve-3d ancestor flattens 3D rendering to
// a 2D layer while hit-testing still uses the real 3D transform → visual offset.
cssRenderer.domElement.style.overflow = 'visible';
cssContainer.appendChild(cssRenderer.domElement);

// ── Scenes ────────────────────────────────────────────────────────────────────
const scene        = new Scene();   // empty main scene — only used for clear pass
const cssScene     = new Scene();   // CSS3D layer
// CRITICAL: occluderScene has NO lights.
// MeshLambertMaterial with no lights computes outgoingLight=(0,0,0).
// With opacity:0 + NoBlending the fragment writes (0,0,0,0) — valid
// premultiplied-alpha transparent.  Adding lights would give (r,g,b,0)
// which iOS Safari treats as opaque and Chrome bleeds as white.
const occluderScene = new Scene();

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
iframeEl.frameBorder     = '0';
containerEl.appendChild(iframeEl);

// ── CSS3D object ──────────────────────────────────────────────────────────────
const cssObject = new CSS3DObject(containerEl);
cssObject.position.copy(POS);
cssObject.rotation.copy(ROT);
cssObject.scale.set(SCALE_X, SCALE_Y, 1);
cssScene.add(cssObject);

// ── Occluder plane ────────────────────────────────────────────────────────────
const occMat = new MeshLambertMaterial();
occMat.side        = DoubleSide;
occMat.opacity     = 0;
occMat.transparent = true;
occMat.blending    = NoBlending;

const occluder = new Mesh(new PlaneGeometry(IFRAME_WIDTH, IFRAME_HEIGHT), occMat);
occluder.position.copy(POS);
occluder.rotation.copy(ROT);
occluder.scale.set(SCALE_X, SCALE_Y, 1);
occluderScene.add(occluder);

// ── Texture layers (same as MonitorScreen._addTextureLayer) ───────────────────
function addTextureLayer(texture: Texture, blending: Blending, opacity: number, offsetZ: number): void {
    const mat = new MeshBasicMaterial({ map: texture, blending, side: DoubleSide, opacity, transparent: true });
    const mesh = new Mesh(new PlaneGeometry(IFRAME_WIDTH, IFRAME_HEIGHT), mat);
    mesh.position.set(POS.x, POS.y, POS.z + offsetZ * SCALE_X);
    mesh.rotation.copy(ROT);
    mesh.scale.set(SCALE_X, SCALE_Y, 1);
    occluderScene.add(mesh);
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
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize);
}

// ── Render loop ───────────────────────────────────────────────────────────────
function animate(): void {
    requestAnimationFrame(animate);
    camera.updateProjectionMatrix();

    // 1. Clear + empty main scene
    renderer.render(scene, camera);

    // 2. Occluder pass — punch (0,0,0,0) hole without clearing what's already drawn
    renderer.autoClearColor = false;
    renderer.autoClearDepth = false;
    renderer.render(occluderScene, camera);
    renderer.autoClearColor = true;
    renderer.autoClearDepth = true;

    // 3. CSS3D — iframe shows through the transparent hole
    cssRenderer.render(cssScene, camera);
}
animate();

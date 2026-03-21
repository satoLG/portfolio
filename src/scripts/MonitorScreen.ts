/**
 * MonitorScreen.ts — CSS3D iframe floating monitor screen in the scene
 *
 * Implements the same "CSS3D-behind-alpha-canvas" pattern as PhoneScreen.ts
 * but for a static world-space monitor (not attached to any 3D model).
 *
 * Ref: https://github.com/henryjeff/portfolio-website/blob/master/src/Application/World/MonitorScreen.ts
 *
 * Layer stack (bottom → top):
 *   [CSS3DRenderer div]  ← iframe lives here (behind WebGL canvas)
 *   [WebGL canvas]       ← alpha:true + NoBlending occluder punches hole (iOS-safe)
 *
 * Pointer events:
 *   Raycasting detects when the cursor hovers the monitor plane.
 *   Hovering  → canvas.pointerEvents='none', CSS layer captures events → iframe interactive.
 *   Otherwise → canvas is interactive (orbit / camera controls work).
 */

import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer';
import {
    Scene as ThreeScene,
    PerspectiveCamera,
    WebGLRenderer,
    Mesh,
    PlaneGeometry,
    MeshBasicMaterial,
    NoBlending,
    DoubleSide,
    Raycaster,
    Vector2,
} from 'three';
import { zoomToMonitor, zoomOutFromMonitor, isPhoneZoomActive } from './Control';

// ── Screen constants ───────────────────────────────────────────────────────────
// Iframe CSS pixel resolution — matches henryjeff MonitorScreen reference
const IFRAME_WIDTH  = 1280;
const IFRAME_HEIGHT = 1024;

// World-unit dimensions of the visible screen rectangle
// Tweak SCREEN_WIDTH to resize the monitor in your scene
const SCREEN_WIDTH  = 0.25;
const SCREEN_HEIGHT = SCREEN_WIDTH * (IFRAME_HEIGHT / IFRAME_WIDTH); // preserves aspect

// World-space position of the monitor centre (static, not attached to a model)
// Floating above sea level, in front of the island — tweak to taste
const POS_X = 0;
const POS_Y = 0.45;
const POS_Z = -2.0;

// Scale: world units / CSS pixel
const SCALE_X = SCREEN_WIDTH  / IFRAME_WIDTH;
const SCALE_Y = SCREEN_HEIGHT / IFRAME_HEIGHT;

// URL loaded into the monitor iframe
const IFRAME_SRC = 'https://os.henryheffernan.com/';

// ── Module state ───────────────────────────────────────────────────────────────
let cssRenderer:    CSS3DRenderer      | null = null;
let cssScene:       ThreeScene         | null = null;
let cssObject:      CSS3DObject        | null = null;
let occluderScene:  ThreeScene         | null = null;
let occludingPlane: Mesh               | null = null;
/** Invisible plane used only for mouse-hover raycasting */
let hoverPlane:     Mesh               | null = null;
let containerEl:    HTMLDivElement     | null = null;
let iframeEl:       HTMLIFrameElement  | null = null;

let _canvasEl:      HTMLCanvasElement  | null = null;
let _initialized   = false;

let _isHovered     = false;  // cursor is over the monitor plane on the WebGL canvas
let _isZoomed      = false;  // monitor is click-locked; iframe is interactive

/** Camera stored each frame so the mousemove handler can raycast */
let _currentCamera: PerspectiveCamera | null = null;

const _raycaster = new Raycaster();
const _mouse     = new Vector2();

// ── Zoom helpers ──────────────────────────────────────────────────────────────
function _enterZoom(): void {
    _isZoomed  = true;
    _isHovered = false;
    if (_canvasEl) { _canvasEl.style.cursor = ''; _canvasEl.style.pointerEvents = 'none'; }
    if (cssRenderer) cssRenderer.domElement.style.pointerEvents = 'auto';
    zoomToMonitor();
}

function _exitZoom(): void {
    _isZoomed = false;
    if (_canvasEl) _canvasEl.style.pointerEvents = '';
    if (cssRenderer) cssRenderer.domElement.style.pointerEvents = 'none';
    zoomOutFromMonitor();
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create the CSS3DRenderer and insert its div BEHIND the WebGL canvas.
 * Call once from Scene.Start() right after creating the canvas.
 */
export function initRenderer(parentEl: HTMLElement, canvasEl: HTMLCanvasElement): void {
    _canvasEl = canvasEl;

    cssRenderer = new CSS3DRenderer();
    cssRenderer.setSize(window.innerWidth, window.innerHeight);

    const el = cssRenderer.domElement;
    el.style.position      = 'absolute';
    el.style.top           = '0';
    el.style.left          = '0';
    el.style.width         = '100%';
    el.style.height        = '100%';
    el.style.background    = 'transparent';
    el.style.pointerEvents = 'none';   // only the iframe area will be interactive
    // WebKit fix: r137 CSS3DRenderer sets overflow:hidden on its domElement.
    // overflow!=visible on any ancestor forces preserve-3d to flatten in WebKit.
    el.style.overflow      = 'visible';
    // Also patch cameraElement (firstChild) with -webkit-transform-style for
    // older Safari versions that require the vendor prefix.
    const cameraEl = el.firstElementChild as HTMLElement | null;
    if (cameraEl) {
        (cameraEl.style as any).webkitTransformStyle = 'preserve-3d';
    }

    // Insert just before the canvas → behind it in stacking order
    parentEl.insertBefore(el, canvasEl);

    // Ensure canvas is positioned so z-index stacking works
    canvasEl.style.position = 'absolute';
    canvasEl.style.zIndex   = '1';

    cssScene = new ThreeScene();

    // ── Hover: cursor pointer when over the monitor (WebGL canvas events) ────
    canvasEl.addEventListener('mousemove', (e: MouseEvent) => {
        if (_isZoomed || !hoverPlane || !_currentCamera) return;
        _mouse.set(
            (e.clientX / window.innerWidth)  *  2 - 1,
            (e.clientY / window.innerHeight) * -2 + 1,
        );
        _raycaster.setFromCamera(_mouse, _currentCamera);
        const hit = _raycaster.intersectObject(hoverPlane).length > 0;
        if (hit !== _isHovered) {
            _isHovered = hit;
            canvasEl.style.cursor = hit ? 'pointer' : '';
        }
    }, false);

    // ── Click to zoom in ──────────────────────────────────────────────────────
    // Raycast directly in the click handler — do NOT rely on _isHovered flag.
    // If the user clicks without having moved the mouse first, or _isHovered was
    // cleared by a previous _enterZoom call, the flag-based guard would silently
    // block the click. Doing the raycast here is the same pattern the phone uses.
    canvasEl.addEventListener('click', (e: MouseEvent) => {
        if (_isZoomed || !hoverPlane || !_currentCamera) return;
        _mouse.set(
            (e.clientX / window.innerWidth)  *  2 - 1,
            (e.clientY / window.innerHeight) * -2 + 1,
        );
        _raycaster.setFromCamera(_mouse, _currentCamera);
        if (_raycaster.intersectObject(hoverPlane).length > 0) {
            _enterZoom();
        }
    }, false);

    // ── Clear hover when mouse leaves the canvas ──────────────────────────────
    canvasEl.addEventListener('mouseleave', () => {
        if (_isHovered) { _isHovered = false; canvasEl.style.cursor = ''; }
    }, false);

    // ── Click on CSS3D background (outside iframe container) → zoom out ───────
    // containerEl.stopPropagation() prevents clicks on the iframe from reaching here.
    el.addEventListener('click', () => {
        if (_isZoomed) _exitZoom();
    }, false);

    // ── ESC → zoom out ────────────────────────────────────────────────────────
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape' && _isZoomed) _exitZoom();
    }, false);
}

/**
 * Build the iframe container, CSS3DObject, and occluding plane.
 * Call once from Scene.Start() after initRenderer().
 */
export function init(): void {
    if (!cssRenderer || !cssScene) {
        console.warn('[MonitorScreen] initRenderer() must be called first');
        return;
    }
    if (_initialized) return;
    _initialized = true;

    // ── Container div ─────────────────────────────────────────────────────────
    containerEl = document.createElement('div');
    containerEl.style.width      = `${IFRAME_WIDTH}px`;
    containerEl.style.height     = `${IFRAME_HEIGHT}px`;
    containerEl.style.position   = 'relative';
    containerEl.style.background = '#1d2e2f';
    // Prevent clicks on the monitor area from bubbling to the CSS3D background
    containerEl.addEventListener('click', (e) => e.stopPropagation());

    // ── Iframe ────────────────────────────────────────────────────────────────
    iframeEl = document.createElement('iframe');
    // src is intentionally NOT set here — same deferred pattern as PhoneScreen.
    // Setting src on a detached DOM node causes ERR_CONNECTION_RESET in Chromium.
    // The real src is injected after the first render() call (see render()).
    iframeEl.style.width   = '100%';
    iframeEl.style.height  = '100%';
    iframeEl.style.border  = 'none';
    iframeEl.style.display = 'block';
    iframeEl.frameBorder   = '0';
    iframeEl.id            = 'monitor-screen';
    iframeEl.title         = 'Monitor';
    // Bubble mouse/keyboard events from inside the iframe back to the parent document
    // so screen-enter/leave detection works when the cursor is inside the iframe.
    // Exact port of henryjeff MonitorScreen.createIframe() onload handler.
    iframeEl.onload = () => {
        if (iframeEl!.contentWindow) {
            window.addEventListener('message', (event) => {
                if (!event.data?.type) return;
                const evt = new CustomEvent(event.data.type, {
                    bubbles: true,
                    cancelable: false,
                }) as any;
                evt.inComputer = true;
                if (event.data.type === 'mousemove') {
                    const clRect = iframeEl!.getBoundingClientRect();
                    const { top, left, width, height } = clRect;
                    const widthRatio  = width  / IFRAME_WIDTH;
                    const heightRatio = height / IFRAME_HEIGHT;
                    evt.clientX = Math.round(event.data.clientX * widthRatio + left);
                    evt.clientY = Math.round(event.data.clientY * heightRatio + top);
                } else if (event.data.type === 'keydown') {
                    evt.key = event.data.key;
                } else if (event.data.type === 'keyup') {
                    evt.key = event.data.key;
                }
                iframeEl!.dispatchEvent(evt);
            });
        }
    };
    // iOS/WebKit fix: running CSS transform forces compositing inside preserve-3d
    iframeEl.className     = 'monitor-screen-jitter';
    iframeEl.setAttribute('sandbox',
        'allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock'
    );
    // Set src immediately — matches Henry Jeff's createIframe() pattern.
    // Setting src before DOM attachment works fine in all browsers.
    iframeEl.src = IFRAME_SRC;
    containerEl.appendChild(iframeEl);

    // ── CSS3DObject ───────────────────────────────────────────────────────────
    cssObject = new CSS3DObject(containerEl);
    cssObject.position.set(POS_X, POS_Y, POS_Z);
    cssObject.scale.set(SCALE_X, SCALE_Y, 1);
    cssScene.add(cssObject);

    // ── Occluding plane ───────────────────────────────────────────────────────
    // NoBlending: disables GL blending entirely so the fragment output (rgba 0,0,0,0
    // from opacity:0) is written directly to the framebuffer, punching a fully-zero
    // transparent hole.  CustomBlending preserved RGB + zeroed only alpha, producing
    // invalid premultiplied-alpha values (non-zero RGB, alpha=0) that iOS WebKit's
    // GPU compositor treats as opaque.  NoBlending matches Henry Jeff's exact approach.
    const occMat = new MeshBasicMaterial({
        color:      0x000000,
        transparent: true,
        opacity:     0,
        depthTest:   true,
        depthWrite:  false,
        blending:    NoBlending,
    });
    const occGeo = new PlaneGeometry(IFRAME_WIDTH, IFRAME_HEIGHT);
    occludingPlane = new Mesh(occGeo, occMat);
    occludingPlane.position.set(POS_X, POS_Y, POS_Z);
    occludingPlane.scale.set(SCALE_X, SCALE_Y, 1);
    occluderScene = new ThreeScene();
    occluderScene.add(occludingPlane);
    occludingPlane.visible = false;  // only shown during renderOccluder pass

    // ── Hover hit-test plane ─────────────────────────────────────────────────
    // Invisible plane in world units — used only for pointer-events raycasting.
    // Geometry is already in world units, so no scale transform needed.
    const hitMat = new MeshBasicMaterial({ visible: false, side: DoubleSide });
    const hitGeo = new PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT);
    hoverPlane = new Mesh(hitGeo, hitMat);
    hoverPlane.position.set(POS_X, POS_Y, POS_Z);
    // hoverPlane is NOT added to any scene (raycasting only).
    // updateMatrixWorld() must be called once here so the first mousemove event
    // raycasts against the correct world position (0, 0.45, -2.0) rather than
    // the identity matrix. preRender() then keeps it in sync every frame.
    hoverPlane.updateMatrixWorld(true);
}

/**
 * Called each frame BEFORE the WebGL scene render.
 * Keeps the occluding plane in sync with the CSS3DObject and stores the camera
 * reference used by the mousemove hover-detection handler.
 */
export function preRender(cam: PerspectiveCamera): void {
    _currentCamera = cam;
    if (!_initialized || !cssObject || !occludingPlane) return;

    // Sync occluding plane transform with the CSS3DObject every frame
    occludingPlane.position.copy(cssObject.position);
    occludingPlane.quaternion.copy(cssObject.quaternion);
    occludingPlane.scale.copy(cssObject.scale);

    // Sync hover plane position/rotation (geometry is in world units; no scale copy)
    if (hoverPlane) {
        hoverPlane.position.copy(cssObject.position);
        hoverPlane.quaternion.copy(cssObject.quaternion);
        // CRITICAL: hoverPlane is not in any scene so Three.js never auto-updates its
        // matrixWorld. Without this call, Raycaster always tests against the identity
        // matrix (origin) instead of the actual world position (POS_X, POS_Y, POS_Z).
        hoverPlane.updateMatrixWorld(true);
    }
}

/**
 * Render the occluding plane that punches an alpha=0 hole through the canvas.
 *
 * MUST be called AFTER all WebGL post-processing passes (Underwater, etc.)
 * and preceded by a depth prepass so the occluder's depthTest correctly hides
 * the hole when scene geometry is closer to the camera than the monitor plane.
 */
export function renderOccluder(wr: WebGLRenderer, cam: PerspectiveCamera): void {
    if (!occluderScene || !occludingPlane || !_initialized) return;
    occludingPlane.visible = true;
    wr.render(occluderScene, cam);
}

/**
 * Render the CSS3D scene.
 * Call AFTER the WebGL render (and after renderOccluder).
 */
export function render(cam: PerspectiveCamera): void {
    if (!cssRenderer || !cssScene || !_initialized) return;

    // Drive pointer events every frame — exact same pattern as PhoneScreen.render().
    // This runs AFTER PhoneScreen.render() so it has the final say on canvas state.
    if (_isZoomed) {
        if (_canvasEl) _canvasEl.style.pointerEvents = 'none';
        cssRenderer.domElement.style.pointerEvents = 'auto';
    } else {
        // Don't release canvas if phone has locked it.
        if (_canvasEl && !isPhoneZoomActive()) _canvasEl.style.pointerEvents = '';
        cssRenderer.domElement.style.pointerEvents = 'none';
    }

    _currentCamera = cam;
    cssRenderer.render(cssScene, cam);
}

/**
 * Call from Scene's onresize handler.
 */
export function onResize(w: number, h: number): void {
    if (cssRenderer) cssRenderer.setSize(w, h);
}

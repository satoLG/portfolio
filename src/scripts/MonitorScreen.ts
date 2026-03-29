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
    AdditiveBlending,
    NormalBlending,
    Raycaster,
    Vector2,
    Vector3,
    Euler,
    TextureLoader,
    VideoTexture,
    Blending,
    Texture,
} from 'three';
import { zoomToMonitor, zoomOutFromMonitor, isPhoneZoomActive } from './Control';

// ── Screen constants ───────────────────────────────────────────────────────────
// Iframe CSS pixel resolution — matches henryjeff MonitorScreen reference
const IFRAME_WIDTH  = 1280;
const IFRAME_HEIGHT = 1024;
const IFRAME_PADDING = 32;

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
const IFRAME_SRC = 'https://projects-hub-one.vercel.app/';

// ── Module state ───────────────────────────────────────────────────────────────
let cssRenderer:    CSS3DRenderer      | null = null;   // shared — set by initRenderer()
let cssScene:       ThreeScene         | null = null;   // shared — set by initRenderer()
let cssObject:      CSS3DObject        | null = null;
let _glScene:       ThreeScene         | null = null;   // main WebGL scene — occluder + layers live here
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

/** Perspective dimmer plane — darkens screen at oblique angles / distances */
let _dimmingPlane: Mesh | null = null;
/** Video textures created from hidden <video> elements */
const _videoTextures: { [key: string]: VideoTexture } = {};

/** Monitor position in CSS-pixel space — used for layer offsets */
const _monitorPos = new Vector3(POS_X, POS_Y, POS_Z);
const _monitorRot = new Euler(0, 0, 0);  // no rotation (faces camera)

const _raycaster = new Raycaster();
const _mouse     = new Vector2();

// ── Zoom helpers ──────────────────────────────────────────────────────────────
function _enterZoom(): void {
    _isZoomed  = true;
    _isHovered = false;
    if (_canvasEl) { _canvasEl.style.cursor = ''; _canvasEl.style.pointerEvents = 'none'; }
    zoomToMonitor();
}

function _exitZoom(): void {
    _isZoomed = false;
    if (_canvasEl) _canvasEl.style.pointerEvents = 'auto';
    zoomOutFromMonitor();
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create the CSS3DRenderer and insert its div BEHIND the WebGL canvas.
 * Call once from Scene.Start() right after creating the canvas.
 */
export function initRenderer(canvasEl: HTMLCanvasElement, sharedRenderer: CSS3DRenderer, sharedScene: ThreeScene): void {
    _canvasEl = canvasEl;
    cssRenderer = sharedRenderer;
    cssScene    = sharedScene;

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
    sharedRenderer.domElement.addEventListener('click', () => {
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
export function init(glScene: ThreeScene): void {
    if (!cssRenderer || !cssScene) {
        console.warn('[MonitorScreen] initRenderer() must be called first');
        return;
    }
    if (_initialized) return;
    _initialized = true;

    // Store reference to the main WebGL scene — occluder + texture layers
    // live here (single-pass render, matching henryjeff's architecture).
    _glScene = glScene;

    // ── Container div ─────────────────────────────────────────────────────────
    containerEl = document.createElement('div');
    containerEl.style.width      = IFRAME_WIDTH + 'px';
    containerEl.style.height     = IFRAME_HEIGHT + 'px';
    containerEl.style.opacity    = '1';
    containerEl.style.background = '#1d2e2f';
    // Prevent clicks on the monitor area from bubbling to the CSS3D background
    containerEl.addEventListener('click', (e) => e.stopPropagation());

    // ── Iframe ────────────────────────────────────────────────────────────────
    iframeEl = document.createElement('iframe');
    iframeEl.src           = IFRAME_SRC;
    iframeEl.style.width   = IFRAME_WIDTH + 'px';
    iframeEl.style.height  = IFRAME_HEIGHT + 'px';
    iframeEl.style.padding = IFRAME_PADDING + 'px';
    iframeEl.style.boxSizing = 'border-box';
    iframeEl.style.opacity = '1';
    iframeEl.className     = 'jitter';
    iframeEl.id            = 'computer-screen';
    iframeEl.frameBorder   = '0';
    iframeEl.title         = 'HeffernanOS';
    // Bubble mouse/keyboard events from inside the iframe back to the parent document
    // so screen-enter/leave detection works when the cursor is inside the iframe.
    // Exact port of henryjeff MonitorScreen.createIframe() onload handler.
    iframeEl.onload = () => {
        if (iframeEl!.contentWindow) {
            window.addEventListener('message', (event) => {
                var evt = new CustomEvent(event.data.type, {
                    bubbles: true,
                    cancelable: false,
                }) as any;
                evt.inComputer = true;
                if (event.data.type === 'mousemove') {
                    var clRect = iframeEl!.getBoundingClientRect();
                    const { top, left, width, height } = clRect;
                    const widthRatio  = width  / (IFRAME_WIDTH - IFRAME_PADDING);
                    const heightRatio = height / (IFRAME_HEIGHT - IFRAME_PADDING);
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
    containerEl.appendChild(iframeEl);

    // ── CSS3DObject ───────────────────────────────────────────────────────────
    cssObject = new CSS3DObject(containerEl);
    cssObject.position.set(POS_X, POS_Y, POS_Z);
    cssObject.scale.set(SCALE_X, SCALE_Y, 1);
    cssScene.add(cssObject);

    // ── Occluding plane ───────────────────────────────────────────────────────
    // MeshBasicMaterial ignores scene lights — always outputs (0,0,0,0) with
    // opacity:0 + NoBlending, punching a valid premultiplied-alpha transparent hole.
    // This lets the occluder live in the main scene (matching henryjeff's architecture)
    // instead of a separate light-free scene with multi-pass rendering.
    const occMat = new MeshBasicMaterial({
        color: 0x000000,
        side: DoubleSide,
        opacity: 0,
        transparent: true,
        blending: NoBlending,
    });
    const occGeo = new PlaneGeometry(IFRAME_WIDTH, IFRAME_HEIGHT);
    occludingPlane = new Mesh(occGeo, occMat);
    occludingPlane.position.set(POS_X, POS_Y, POS_Z);
    occludingPlane.scale.set(SCALE_X, SCALE_Y, 1);
    _glScene.add(occludingPlane);

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

    // ── Texture layers — CRT/monitor effect (from Henry Jeff's repo) ─────────
    const maxOffset = _createTextureLayers();
    _createEnclosingPlanes(maxOffset);
    _createPerspectiveDimmer(maxOffset);
}

// ── Texture Layer Helpers (ported from Henry Jeff's MonitorScreen) ─────────────

function _getVideoTexture(videoId: string): void {
    const video = document.getElementById(videoId);
    if (!video) {
        setTimeout(() => _getVideoTexture(videoId), 100);
    } else {
        _videoTextures[videoId] = new VideoTexture(video as HTMLVideoElement);
    }
}

function _offsetPosition(position: Vector3, offset: Vector3): Vector3 {
    const p = new Vector3();
    p.copy(position);
    // Offset is in CSS-pixel space — scale to world units
    p.x += offset.x * SCALE_X;
    p.y += offset.y * SCALE_Y;
    p.z += offset.z * SCALE_X;  // Z uses same scale as X for uniform depth
    return p;
}

function _addTextureLayer(
    texture: Texture,
    blendingMode: Blending,
    opacity: number,
    offset: number,
): void {
    if (!_glScene) return;
    const material = new MeshBasicMaterial({
        map: texture,
        blending: blendingMode,
        side: DoubleSide,
        opacity,
        transparent: true,
    });
    const geometry = new PlaneGeometry(IFRAME_WIDTH, IFRAME_HEIGHT);
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(
        _offsetPosition(_monitorPos, new Vector3(0, 0, offset))
    );
    mesh.rotation.copy(_monitorRot);
    mesh.scale.set(SCALE_X, SCALE_Y, 1);
    _glScene.add(mesh);
}

function _createTextureLayers(): number {
    const loader = new TextureLoader();
    const smudgeTexture = loader.load('/textures/monitor/layers/smudges.jpg');
    const shadowTexture = loader.load('/textures/monitor/layers/shadow.png');

    _getVideoTexture('video-1');
    _getVideoTexture('video-2');

    const scaleFactor = 4;
    const layers: { texture: Texture; blending: Blending; opacity: number; offset: number }[] = [
        { texture: shadowTexture,   blending: NormalBlending,   opacity: 1,    offset: 5 },
        { texture: smudgeTexture,   blending: AdditiveBlending, opacity: 0.12, offset: 24 },
    ];

    // Video layers — added once the VideoTexture is ready (may be async via retry)
    setTimeout(() => {
        if (_videoTextures['video-1']) {
            _addTextureLayer(_videoTextures['video-1'], AdditiveBlending, 0.5, 10 * scaleFactor);
        }
        if (_videoTextures['video-2']) {
            _addTextureLayer(_videoTextures['video-2'], AdditiveBlending, 0.1, 15 * scaleFactor);
        }
    }, 500);

    let maxOffset = -1;
    for (const layer of layers) {
        const offset = layer.offset * scaleFactor;
        _addTextureLayer(layer.texture, layer.blending, layer.opacity, offset);
        if (offset > maxOffset) maxOffset = offset;
    }

    return maxOffset;
}

type EnclosingPlane = {
    size: Vector2;
    position: Vector3;
    rotation: Euler;
};

function _createEnclosingPlane(plane: EnclosingPlane): void {
    if (!_glScene) return;
    const material = new MeshBasicMaterial({
        side: DoubleSide,
        color: 0x48493f,
    });
    const geometry = new PlaneGeometry(plane.size.x, plane.size.y);
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(plane.position);
    mesh.rotation.copy(plane.rotation);
    mesh.scale.set(SCALE_X, SCALE_Y, 1);
    _glScene.add(mesh);
}

function _createEnclosingPlanes(maxOffset: number): void {
    const sw = IFRAME_WIDTH;
    const sh = IFRAME_HEIGHT;
    const DEG = Math.PI / 180;

    const planes: EnclosingPlane[] = [
        { // left
            size: new Vector2(maxOffset, sh),
            position: _offsetPosition(_monitorPos, new Vector3(-sw / 2, 0, maxOffset / 2)),
            rotation: new Euler(0, 90 * DEG, 0),
        },
        { // right
            size: new Vector2(maxOffset, sh),
            position: _offsetPosition(_monitorPos, new Vector3(sw / 2, 0, maxOffset / 2)),
            rotation: new Euler(0, 90 * DEG, 0),
        },
        { // top
            size: new Vector2(sw, maxOffset),
            position: _offsetPosition(_monitorPos, new Vector3(0, sh / 2, maxOffset / 2)),
            rotation: new Euler(90 * DEG, 0, 0),
        },
        { // bottom
            size: new Vector2(sw, maxOffset),
            position: _offsetPosition(_monitorPos, new Vector3(0, -sh / 2, maxOffset / 2)),
            rotation: new Euler(90 * DEG, 0, 0),
        },
    ];

    for (const plane of planes) {
        _createEnclosingPlane(plane);
    }
}

function _createPerspectiveDimmer(maxOffset: number): void {
    if (!_glScene) return;
    const material = new MeshBasicMaterial({
        side: DoubleSide,
        color: 0x000000,
        transparent: true,
        blending: AdditiveBlending,
    });
    const geometry = new PlaneGeometry(IFRAME_WIDTH, IFRAME_HEIGHT);
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(
        _offsetPosition(_monitorPos, new Vector3(0, 0, maxOffset - 5))
    );
    mesh.rotation.copy(_monitorRot);
    mesh.scale.set(SCALE_X, SCALE_Y, 1);
    _dimmingPlane = mesh;
    _glScene.add(mesh);
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

    // ── Perspective dimmer update (from Henry's MonitorScreen.update()) ───────
    if (_dimmingPlane && cam) {
        const planeNormal = new Vector3(0, 0, 1);
        const viewVector = new Vector3();
        viewVector.copy(cam.position);
        viewVector.sub(_monitorPos);
        viewVector.normalize();
        const dot = viewVector.dot(planeNormal);
        const dimPos = _dimmingPlane.position;
        const camPos = cam.position;
        const distance = Math.sqrt(
            (camPos.x - dimPos.x) ** 2 +
            (camPos.y - dimPos.y) ** 2 +
            (camPos.z - dimPos.z) ** 2
        );
        const opacity = 1 / (distance / 10000);
        const DIM_FACTOR = 0.7;
        (_dimmingPlane.material as MeshBasicMaterial).opacity =
            (1 - opacity) * DIM_FACTOR + (1 - dot) * DIM_FACTOR;
    }
}

/**
 * renderOccluder is no longer needed — occluder lives in the main scene and
 * is rendered as part of the single renderer.render(scene, camera) call.
 * Kept as a no-op for API compatibility.
 */
export function renderOccluder(_wr: WebGLRenderer, _cam: PerspectiveCamera): void {
    // no-op — occluder is in the main scene now
}

/**
 * Render the CSS3D scene.
 * Call AFTER the WebGL render and renderOccluder.
 */
export function render(cam: PerspectiveCamera): void {
    if (!cssRenderer || !cssScene || !_initialized) return;

    // Drive pointer events every frame — exact same pattern as PhoneScreen.render().
    // This runs AFTER PhoneScreen.render() so it has the final say on canvas state.
    if (_isZoomed) {
        if (_canvasEl) _canvasEl.style.pointerEvents = 'none';
    } else {
        // Don't release canvas if phone has locked it.
        if (_canvasEl && !isPhoneZoomActive()) _canvasEl.style.pointerEvents = 'auto';
    }

    _currentCamera = cam;
}

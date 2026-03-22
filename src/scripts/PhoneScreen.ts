/**
 * PhoneScreen.ts — CSS3D iframe on the phone screen
 *
 * Uses the proven "CSS3D-behind-alpha-canvas" technique (henryjeff pattern):
 *
 *   1. CSS3DRenderer div sits BEHIND the WebGL canvas (lower z-index)
 *   2. WebGL canvas has alpha:true → transparent where no geometry
 *   3. A NoBlending plane in the WebGL scene at the screen position
 *      "punches" a transparent hole through the canvas
 *   4. The CSS3D iframe shows through the hole
 *   5. When zoomed: canvas pointer-events:none → clicks reach the iframe
 *
 * Debug: export `phoneScreenConfig` and `updateOverlayStyle` so IslandDebug
 *   can attach live-tweak sliders.
 */

import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer';
import {
    Scene as ThreeScene,
    PerspectiveCamera,
    WebGLRenderer,
    Group,
    Vector3,
    Quaternion,
    Mesh,
    PlaneGeometry,
    MeshLambertMaterial,
    NoBlending,
    DoubleSide,
    Raycaster,
    Vector2,
} from 'three';
import { isPhoneZoomActive, zoomOutFromPhone, isMonitorZoomActive } from './Control';
import {
    phoneScreenWidth, phoneScreenHeight,
    phoneScreenOffsetX, phoneScreenOffsetY, phoneScreenOffsetZ,
    phoneOverlayOpacity, phoneOverlayTintR, phoneOverlayTintG, phoneOverlayTintB,
    phoneOverlayGlareOpacity, phoneOverlayGlareAngle,
} from '../scene/CameraConfig';

// ─── CONFIG — all tweakable from the debug GUI (Camera → Phone Screen) ────────
export const phoneScreenConfig = {
    // World-unit dimensions of the visible screen rectangle on the phone model
    screenWidth:  phoneScreenWidth,    // world units — tweak live with debug GUI
    screenHeight: phoneScreenHeight,   // world units

    // Fine-tune placement relative to the phone Group's world origin
    offsetX:  phoneScreenOffsetX,
    offsetY:  phoneScreenOffsetY,      // slightly above phone surface
    offsetZ:  phoneScreenOffsetZ,

    // Iframe base resolution (px) — aspect kept 9:16 to match a phone screen
    iframeWidth:  550,
    iframeHeight: 1100,

    // Glass overlay
    overlayOpacity:      phoneOverlayOpacity,
    overlayTintR:        phoneOverlayTintR,
    overlayTintG:        phoneOverlayTintG,
    overlayTintB:        phoneOverlayTintB,
    overlayGlareOpacity: phoneOverlayGlareOpacity,
    overlayGlareAngle:   phoneOverlayGlareAngle,
};

// ─── INTERNALS ────────────────────────────────────────────────────────────────
let cssRenderer: CSS3DRenderer | null = null;   // shared — set by initRenderer()
let cssScene: ThreeScene | null = null;               // shared — set by initRenderer()
let cssObject: CSS3DObject | null = null;
let occluderScene: ThreeScene | null = null;   // separate light-free scene — Lambert outputs (0,0,0,0)
let occludingPlane: Mesh | null = null;
let containerEl: HTMLDivElement | null = null;
let overlayEl: HTMLDivElement | null = null;
let iframeEl: HTMLIFrameElement | null = null;

let _canvasEl: HTMLCanvasElement | null = null;
let _initialized = false;
let _visible = false;

// Effect state
let _pendingColorFilter = '';
let _pixelActive = false;   // true when pixelation is active

// Stored each frame for use in the CSS3D click handler
let _phoneGroup: Group | null = null;
let _camera: PerspectiveCamera | null = null;

const _worldPos  = new Vector3();
const _worldQuat = new Quaternion();
const _raycaster = new Raycaster();
const _mouse     = new Vector2();

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Create the CSS3DRenderer and insert its div BEHIND the WebGL canvas.
 * The canvas must have alpha:true so the CSS3D layer shows through the
 * NoBlending hole.
 *
 * Call once from Scene.Start() right after appending renderer.domElement.
 */
export function initRenderer(canvasEl: HTMLCanvasElement, sharedRenderer: CSS3DRenderer, sharedScene: ThreeScene): void {
    _canvasEl = canvasEl;
    cssRenderer = sharedRenderer;
    cssScene    = sharedScene;

    // Any click on the CSS3D background zooms out — ONLY if the click doesn't
    // land on the phone model itself (raycasted against phone children).
    sharedRenderer.domElement.addEventListener('click', (e: MouseEvent) => {
        if (!isPhoneZoomActive()) return;
        if (_camera && _phoneGroup && _phoneGroup.children.length > 0) {
            _mouse.set(
                (e.clientX / window.innerWidth)  *  2 - 1,
                (e.clientY / window.innerHeight) * -2 + 1,
            );
            _raycaster.setFromCamera(_mouse, _camera);
            const hits = _raycaster.intersectObjects(_phoneGroup.children, true);
            if (hits.length > 0) return;  // clicked on phone model — do nothing
        }
        zoomOutFromPhone();
    });
}

/**
 * Build the iframe + overlay CSS3DObject AND the NoBlending occluding plane.
 * The occluding plane is added to the WebGL scene to punch a transparent hole
 * in the canvas so the CSS3D iframe behind is visible.
 *
 * @param glScene  The main WebGL scene (for the occluding plane).
 */
export function init(): void {
    if (!cssRenderer || !cssScene) {
        console.warn('[PhoneScreen] initRenderer() must be called first');
        return;
    }
    if (_initialized) return;
    _initialized = true;

    const cfg = phoneScreenConfig;

    // ── Container (CSS px resolution) ────────────────────────────────────────
    containerEl = document.createElement('div');
    containerEl.style.width        = `${cfg.iframeWidth}px`;
    containerEl.style.height       = `${cfg.iframeHeight}px`;
    // containerEl.style.overflow     = 'hidden';
    containerEl.style.borderRadius = '14px';
    containerEl.style.background   = '#000';

    // Stop clicks on the phone screen area from bubbling to the CSS3D div's
    // zoom-out handler — only clicks OUTSIDE this container should zoom out.
    containerEl.addEventListener('click', (e) => e.stopPropagation());

    // ── Iframe ───────────────────────────────────────────────────────────────
    iframeEl = document.createElement('iframe');
    iframeEl.src = 'https://projects-hub-one.vercel.app/';
    iframeEl.style.width   = cfg.iframeWidth + 'px';
    iframeEl.style.height  = cfg.iframeHeight + 'px';
    iframeEl.style.padding = '32px';
    iframeEl.style.boxSizing = 'border-box';
    iframeEl.style.opacity = '1';
    iframeEl.className = 'jitter';
    iframeEl.frameBorder = '0';
    containerEl.appendChild(iframeEl);

    // ── Glass overlay ────────────────────────────────────────────────────────
    overlayEl = document.createElement('div');
    overlayEl.style.position      = 'absolute';
    overlayEl.style.inset         = '0';
    overlayEl.style.pointerEvents = 'none';
    overlayEl.style.borderRadius  = '14px';
    updateOverlayStyle();
    containerEl.appendChild(overlayEl);

    // ── CSS3DObject ──────────────────────────────────────────────────────────
    cssObject = new CSS3DObject(containerEl);
    // Scale: world-unit size  /  CSS-pixel size
    cssObject.scale.set(
        cfg.screenWidth  / cfg.iframeWidth,
        cfg.screenHeight / cfg.iframeHeight,
        1,
    );
    cssObject.visible = true;   // always visible once phone is spawned — browser loads iframe immediately
    cssScene.add(cssObject);

    // ── Occluding plane (NoBlending — valid premultiplied alpha) ─────────────────────
    // Lives in its own scene so it can be rendered AFTER Underwater post-
    // processing (which would otherwise overwrite the transparent pixels).
    //
    // NoBlending disables GL blending; fragment rgba(0,0,0,0) from opacity:0
    // is written directly — valid premultiplied transparent, which iOS WebKit
    // composites correctly.  CustomBlending preserved RGB+zeroed alpha, producing
    // invalid premultiplied values that WebKit treats as opaque.
    const occMat = new MeshLambertMaterial();
    occMat.side = DoubleSide;
    occMat.opacity = 0;
    occMat.transparent = true;
    occMat.blending = NoBlending;
    const occGeo = new PlaneGeometry(cfg.iframeWidth, cfg.iframeHeight);
    occludingPlane = new Mesh(occGeo, occMat);
    occludingPlane.visible = false;
    occluderScene = new ThreeScene();
    occluderScene.add(occludingPlane);

    // Apply any effects that were requested before init() ran
    applyPhoneColorFilter(_pendingColorFilter);
}

/**
 * Called from SetPixelSize in Scene.ts. When pixelation is active and the
 * phone is zoomed out, the CSS3D plane fades out (blurry scaled content
 * misaligns with the pixelated model). Fades back in on zoom-in.
 */
export function applyPhonePixelSize(value: number): void {
    _pixelActive = value > 0;
}

/**
 * Apply a CSS filter string (e.g. 'grayscale(1)', 'sepia(1)', '') to the
 * CSS3D renderer layer so color filters match the WebGL canvas.
 */
export function applyPhoneColorFilter(filter: string): void {
    _pendingColorFilter = filter;
    if (containerEl) {
        containerEl.style.filter = filter;
    }
}

/**
 * Regenerate the glass gradient on `overlayEl` from the current config.
 * Call from debug GUI onChange handlers.
 */
export function updateOverlayStyle(): void {
    if (!overlayEl) return;
    const { overlayTintR: r, overlayTintG: g, overlayTintB: b,
            overlayGlareOpacity: glo, overlayGlareAngle: ang,
            overlayOpacity: opa } = phoneScreenConfig;

    overlayEl.style.background = [
        `linear-gradient(${ang}deg,`,
        `  rgba(${r},${g},${b},${glo.toFixed(3)}) 0%,`,
        `  transparent 45%,`,
        `  rgba(0,0,10,${opa.toFixed(3)}) 100%`,
        `)`,
    ].join(' ');
}

/**
 * Returns true when the phone screen is currently active (visible flag set).
 * Used by Scene.ts to skip the depth prepass when the phone isn't shown.
 */
export function isVisible(): boolean {
    return _visible;
}

/**
 * Show or hide the phone screen (matches phone.visible in Island.ts).
 */
export function setVisible(v: boolean): void {
    _visible = v;
}

/**
 * Per-frame update — PART 1.
 *
 * Must be called BEFORE the WebGL scene render (before Underwater.renderScene).
 * Sets occluding plane + CSS3DObject visibility and syncs their world
 * transforms so the NoBlending hole is present when the scene is drawn.
 */
export function preRender(phoneGroup: Group): void {
    if (!_initialized || !_visible) {
        if (occludingPlane) occludingPlane.visible = false;
        if (cssObject) cssObject.visible = false;
        if (_canvasEl) _canvasEl.style.pointerEvents = 'auto';
        return;
    }

    // CSS3D is always visible while phone is spawned — keeps the iframe alive
    // and shows the screen content at all distances, not just when zoomed.
    if (cssObject) cssObject.visible = true;

    // ── Store refs for click-handler raycasting ───────────────────────────────
    _phoneGroup = phoneGroup;

    // ── Sync world transform every frame (not only when zoomed) ──────────────
    phoneGroup.getWorldPosition(_worldPos);
    phoneGroup.getWorldQuaternion(_worldQuat);

    const cfg = phoneScreenConfig;

    cssObject!.position.set(
        _worldPos.x + cfg.offsetX,
        _worldPos.y + cfg.offsetY,
        _worldPos.z + cfg.offsetZ,
    );
    cssObject!.quaternion.copy(_worldQuat);

    // Live-update scale in case config changed via debug GUI
    cssObject!.scale.set(
        cfg.screenWidth  / cfg.iframeWidth,
        cfg.screenHeight / cfg.iframeHeight,
        1,
    );

    // ── Hide CSS3D plane when pixelated + zoomed out ─────────────────────
    const zoomed = isPhoneZoomActive();
    const visible = !_pixelActive || zoomed;
    if (containerEl) containerEl.style.opacity = visible ? '1' : '0';

    // Occluding plane — mirror the CSS3DObject's full transform every frame
    if (occludingPlane) {
        occludingPlane.position.copy(cssObject!.position);
        occludingPlane.quaternion.copy(cssObject!.quaternion);
        occludingPlane.scale.copy(cssObject!.scale);
        occludingPlane.visible = true;
    }
}

/**
 * Render the occluder scene that punches an alpha=0 hole through the canvas.
 * The occluderScene has NO lights — Lambert computes outgoingLight=(0,0,0),
 * so with opacity:0 the fragment outputs (0,0,0,0): valid premultiplied
 * transparent on iOS Safari and all browsers.
 *
 * Call AFTER renderer.render(scene, camera) with autoClearColor=false and
 * autoClearDepth=false so main scene color and depth are preserved.
 */
export function renderOccluder(wr: WebGLRenderer, cam: PerspectiveCamera): void {
    if (!occluderScene || !occludingPlane || !_initialized || !_visible) return;
    // Suppress the alpha hole when the CSS3D plane is invisible.
    if (_pixelActive && !isPhoneZoomActive()) return;
    occludingPlane.visible = true;
    wr.render(occluderScene, cam);
}

/**
 * Per-frame update — PART 2.
 *
 * Called AFTER the WebGL render.
 * Toggles pointer-events on the canvas / CSS3D layer and renders the CSS3D scene.
 */
export function render(cam: PerspectiveCamera): void {
    if (!cssRenderer || !cssScene || !_initialized || !_visible) return;

    const zoomed = isPhoneZoomActive();

    // ── Pointer events ───────────────────────────────────────────────────────
    if (zoomed) {
        if (_canvasEl) _canvasEl.style.pointerEvents = 'none';
    } else {
        // Don't release canvas if another screen (monitor) has locked it.
        if (_canvasEl && !isMonitorZoomActive()) _canvasEl.style.pointerEvents = 'auto';
    }

    _camera = cam;  // store for click-handler raycasting
}

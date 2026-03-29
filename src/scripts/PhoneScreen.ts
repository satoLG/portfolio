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
    Euler,
    Quaternion,
    Mesh,
    PlaneGeometry,
    MeshBasicMaterial,
    NoBlending,
    DoubleSide,
    AdditiveBlending,
    NormalBlending,
    Raycaster,
    Vector2,
    TextureLoader,
    VideoTexture,
    Blending,
    Texture,
} from 'three';
import { isPhoneZoomActive, zoomOutFromPhone } from './Control';
import { CSS_SCALE } from './Scene';
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
let _glScene: ThreeScene | null = null;   // main WebGL scene — occluder lives here
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

/** Meshes created by the texture-layer system — repositioned every frame */
const _layerMeshes: Mesh[] = [];
/** Perspective dimmer plane */
let _dimmingPlane: Mesh | null = null;
/** Video textures created from hidden <video> elements */
const _videoTextures: { [key: string]: VideoTexture } = {};

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
export function init(glScene: ThreeScene): void {
    if (!cssRenderer || !cssScene) {
        console.warn('[PhoneScreen] initRenderer() must be called first');
        return;
    }
    if (_initialized) return;
    _initialized = true;

    // Store reference to the main WebGL scene — occluder lives here
    // (single-pass render, matching henryjeff's architecture).
    _glScene = glScene;

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
    // Scale uses CSS_SCALE to keep values large enough for iOS WebKit.
    // screenWidth * CSS_SCALE / iframeWidth ≈ 0.512 (vs original ~0.0001)
    cssObject.scale.set(
        cfg.screenWidth  * CSS_SCALE / cfg.iframeWidth,
        cfg.screenHeight * CSS_SCALE / cfg.iframeHeight,
        1,
    );
    cssObject.visible = true;
    cssScene.add(cssObject);

    // ── Occluding plane (NoBlending — valid premultiplied alpha) ─────────────────────
    // MeshBasicMaterial ignores scene lights — always outputs (0,0,0,0) with
    // opacity:0 + NoBlending, punching a valid premultiplied-alpha transparent hole.
    // Lives in the main scene (matching henryjeff's single-pass architecture).
    const occMat = new MeshBasicMaterial({
        color: 0x000000,
        side: DoubleSide,
        opacity: 0,
        transparent: true,
        blending: NoBlending,
    });
    const occGeo = new PlaneGeometry(cfg.iframeWidth, cfg.iframeHeight);
    occludingPlane = new Mesh(occGeo, occMat);
    occludingPlane.visible = false;
    _glScene.add(occludingPlane);

    // ── Texture layers — smudge / shadow / dimmer ─────────────────────────────
    // Phone uses scaleFactor=1 (flat glass, not a deep CRT) and no enclosing planes.
    const maxOffset = _createTextureLayers();
    _createPerspectiveDimmer(maxOffset);

    // Apply any effects that were requested before init() ran
    applyPhoneColorFilter(_pendingColorFilter);
}

// ── Texture Layer Helpers ─────────────────────────────────────────────────────

function _getVideoTexture(videoId: string): void {
    const video = document.getElementById(videoId);
    if (!video) {
        setTimeout(() => _getVideoTexture(videoId), 100);
    } else {
        _videoTextures[videoId] = new VideoTexture(video as HTMLVideoElement);
    }
}

function _addTextureLayer(
    texture: Texture,
    blendingMode: Blending,
    opacity: number,
    offset: number,
): void {
    if (!_glScene) return;
    const cfg = phoneScreenConfig;
    const scaleX = cfg.screenWidth  / cfg.iframeWidth;
    const scaleY = cfg.screenHeight / cfg.iframeHeight;

    const material = new MeshBasicMaterial({
        map: texture,
        blending: blendingMode,
        side: DoubleSide,
        opacity,
        transparent: true,
    });
    const geometry = new PlaneGeometry(cfg.iframeWidth, cfg.iframeHeight);
    const mesh = new Mesh(geometry, material);
    // Position is set each frame in _syncLayerTransforms()
    mesh.scale.set(scaleX, scaleY, 1);
    mesh.visible = false;
    _glScene.add(mesh);
    _layerMeshes.push(mesh);
    // Store the local Z offset (world units) as userData for preRender sync
    mesh.userData.localOffsetZ = offset * scaleX;
}

function _createTextureLayers(): number {
    const cfg = phoneScreenConfig;
    const scaleX = cfg.screenWidth / cfg.iframeWidth;
    const loader = new TextureLoader();
    const smudgeTexture = loader.load('/textures/monitor/layers/smudges.jpg');
    const shadowTexture = loader.load('/textures/monitor/layers/shadow.png');

    _getVideoTexture('video-1');
    _getVideoTexture('video-2');

    // scaleFactor=1 keeps layers skin-tight to the flat phone glass
    const scaleFactor = 1;
    const layers: { texture: Texture; blending: Blending; opacity: number; offset: number }[] = [
        { texture: shadowTexture,   blending: NormalBlending,   opacity: 0.3,  offset: 2 },
        { texture: smudgeTexture,   blending: AdditiveBlending, opacity: 0.12, offset: 6 },
    ];

    // Video layers — added once the VideoTexture is ready (may be async via retry)
    setTimeout(() => {
        if (_videoTextures['video-1']) {
            _addTextureLayer(_videoTextures['video-1'], AdditiveBlending, 0.5, 3 * scaleFactor);
        }
        if (_videoTextures['video-2']) {
            _addTextureLayer(_videoTextures['video-2'], AdditiveBlending, 0.1, 5 * scaleFactor);
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

function _createPerspectiveDimmer(maxOffset: number): void {
    if (!_glScene) return;
    const cfg = phoneScreenConfig;
    const scaleX = cfg.screenWidth  / cfg.iframeWidth;
    const scaleY = cfg.screenHeight / cfg.iframeHeight;

    const material = new MeshBasicMaterial({
        side: DoubleSide,
        color: 0x000000,
        transparent: true,
        blending: AdditiveBlending,
    });
    const geometry = new PlaneGeometry(cfg.iframeWidth, cfg.iframeHeight);
    const mesh = new Mesh(geometry, material);
    mesh.scale.set(scaleX, scaleY, 1);
    mesh.visible = false;
    mesh.userData.localOffsetZ = (maxOffset - 5) * scaleX;
    _glScene.add(mesh);
    _dimmingPlane = mesh;
}

/**
 * Reposition all texture-layer, enclosing, and dimmer meshes to follow the phone.
 * Called from preRender() every frame.
 */
function _syncLayerTransforms(basePos: Vector3, baseQuat: Quaternion, visible: boolean): void {
    const cfg = phoneScreenConfig;
    const _offsetVec = new Vector3();

    // Texture layers — offset along local Z only
    for (const mesh of _layerMeshes) {
        mesh.visible = visible;
        if (!visible) continue;
        _offsetVec.set(0, 0, mesh.userData.localOffsetZ);
        _offsetVec.applyQuaternion(baseQuat);
        mesh.position.copy(basePos).add(_offsetVec);
        mesh.quaternion.copy(baseQuat);
    }

    // Dimmer
    if (_dimmingPlane) {
        _dimmingPlane.visible = visible;
        if (visible) {
            _offsetVec.set(0, 0, _dimmingPlane.userData.localOffsetZ);
            _offsetVec.applyQuaternion(baseQuat);
            _dimmingPlane.position.copy(basePos).add(_offsetVec);
            _dimmingPlane.quaternion.copy(baseQuat);
        }
    }
}

/**
 * Called from SetPixelSize in Scene.ts. When pixelation is active and the
 * phone is zoomed out, the CSS3D plane fades out (blurry scaled content
 * misaligns with the pixelated model). Fades back in on zoom-in.
 */
export function applyPhonePixelSize(value: number): void {
    _pixelActive = value > 0;
    // If pixelation just activated while zoomed into the phone, zoom out immediately
    if (_pixelActive && isPhoneZoomActive()) {
        zoomOutFromPhone();
    }
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
 * Must be called BEFORE the WebGL scene render (before PostProcess.renderScene).
 * Sets occluding plane + CSS3DObject visibility and syncs their world
 * transforms so the NoBlending hole is present when the scene is drawn.
 */
export function preRender(phoneGroup: Group, cam?: PerspectiveCamera): void {
    if (!_initialized || !_visible) {
        if (occludingPlane) occludingPlane.visible = false;
        if (cssObject) cssObject.visible = false;
        if (_canvasEl) _canvasEl.style.pointerEvents = 'auto';
        _syncLayerTransforms(_worldPos, _worldQuat, false);
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

    // CSS3DObject positioned in CSS-pixel coordinate space (scaled up)
    cssObject!.position.set(
        (_worldPos.x + cfg.offsetX) * CSS_SCALE,
        (_worldPos.y + cfg.offsetY) * CSS_SCALE,
        (_worldPos.z + cfg.offsetZ) * CSS_SCALE,
    );
    cssObject!.quaternion.copy(_worldQuat);

    // Live-update scale in case config changed via debug GUI
    cssObject!.scale.set(
        cfg.screenWidth  * CSS_SCALE / cfg.iframeWidth,
        cfg.screenHeight * CSS_SCALE / cfg.iframeHeight,
        1,
    );

    // ── Hide CSS3D planes entirely when pixelation is active ─────────
    const zoomed = isPhoneZoomActive();
    const visible = !_pixelActive;
    if (containerEl) containerEl.style.opacity = visible ? '1' : '0';

    // Occluding plane stays at WebGL world coordinates (decoupled from CSS_SCALE).
    if (occludingPlane) {
        occludingPlane.position.set(
            _worldPos.x + cfg.offsetX,
            _worldPos.y + cfg.offsetY,
            _worldPos.z + cfg.offsetZ,
        );
        occludingPlane.quaternion.copy(_worldQuat);
        occludingPlane.scale.set(
            cfg.screenWidth  / cfg.iframeWidth,
            cfg.screenHeight / cfg.iframeHeight,
            1,
        );
        occludingPlane.visible = visible;
    }

    // ── Sync texture layers / enclosing planes / dimmer with phone position ──
    const layerBase = new Vector3(
        _worldPos.x + cfg.offsetX,
        _worldPos.y + cfg.offsetY,
        _worldPos.z + cfg.offsetZ,
    );
    _syncLayerTransforms(layerBase, _worldQuat, visible);

    // ── Perspective dimmer update ────────────────────────────────────────
    if (_dimmingPlane && _dimmingPlane.visible && cam) {
        const planeNormal = new Vector3(0, 0, 1).applyQuaternion(_worldQuat);
        const viewVector = new Vector3().copy(cam.position).sub(layerBase).normalize();
        const dot = viewVector.dot(planeNormal);
        const distance = cam.position.distanceTo(_dimmingPlane.position);
        const opacity = 1 / (distance / 10000);
        const DIM_FACTOR = 0.7;
        (_dimmingPlane.material as MeshBasicMaterial).opacity =
            (1 - opacity) * DIM_FACTOR + (1 - dot) * DIM_FACTOR;
    }
}

/**
 * renderOccluder is no longer needed — occluder lives in the main scene and
 * is rendered as part of the single renderer.render(scene, camera) call.
 * Visibility is managed in preRender().
 */
export function renderOccluder(_wr: WebGLRenderer, _cam: PerspectiveCamera): void {
    // no-op — occluder is in the main scene now
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
        if (_canvasEl) _canvasEl.style.pointerEvents = 'auto';
    }

    _camera = cam;  // store for click-handler raycasting
}

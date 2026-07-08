/**
 * CSS3DPanel.ts — interactive HTML panels that live INSIDE the 3D scene.
 *
 * Same "CSS3D-behind-alpha-canvas + NoBlending punch" technique as PhoneScreen
 * and CardCarousel, generalised into a reusable panel that keeps its DOM fully
 * interactive (buttons run their JS, links open, waveforms seek, etc.):
 *
 *   1. The panel DOM lives in the shared CSS3D scene, rendered BEHIND the WebGL
 *      canvas. It is anchored to a WORLD position and billboards to face the
 *      camera, so it reads as a flat panel floating in the scene.
 *   2. A WebGL "punch" plane with a rounded-rect alpha mask writes (0,0,0,0) +
 *      depth with NoBlending exactly over the panel, so the canvas becomes
 *      transparent there and the crisp DOM shows through. Because the punch
 *      writes depth, scene geometry BEHIND the panel is occluded while anything
 *      IN FRONT (fish closer to the camera than the plane) draws over it — the
 *      panel truly sits at its depth in the scene.
 *   3. Interactivity: the canvas normally sits on top and owns pointer events.
 *      A panel that needs clicks flags itself (wantsPointer); the manager then
 *      sets the canvas to pointer-events:none so events reach the DOM behind it.
 *      This runs AFTER PhoneScreen.render each frame (which is the other writer
 *      of the canvas pointer-events), so the two never fight: PhoneScreen resets
 *      it to 'auto' every frame when its phone screen isn't zoomed, and we only
 *      override to 'none' while a panel actually wants the pointer.
 *   4. Open/close is a single eased scalar driving BOTH the DOM (CSS scale +
 *      opacity on an inner wrapper) and the punch mesh scale, so the hole always
 *      stays registered with the visible panel through the pop animation.
 *
 * Consumers (MediaPlayer, CoinTooltip) create a CSS3DPanel, drop their existing
 * DOM into `panel.content`, set its world anchor each frame, and call
 * open()/close(). The manager (Start/preRender/syncCanvasPointer) is driven by
 * Scene.ts.
 */

import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer';
import {
    CanvasTexture,
    DoubleSide,
    Group,
    LinearFilter,
    MathUtils,
    Mesh,
    NoBlending,
    PerspectiveCamera,
    PlaneGeometry,
    Raycaster,
    Scene as ThreeScene,
    ShaderMaterial,
    Vector2,
} from 'three';
// Runtime-only access inside functions — same import-cycle pattern as
// CardCarousel/PhoneScreen (see the alias note in Fish.ts).
import { CSS_SCALE, camera as sceneCamera, cssRenderer, renderer } from '../core/Scene';
import { deltaTime } from '../core/Time';

// ─── Manager state ─────────────────────────────────────────────────────────────

const _occluderGroup = new Group();
const _panels: CSS3DPanel[] = [];
let _glScene: ThreeScene | null = null;
let _cssScene: ThreeScene | null = null;
let _initialized = false;

const _raycaster = new Raycaster();
const _ndc = new Vector2();

/** The WebGL punch group — Scene.ts excludes it from the foam depth pre-pass. */
export function getOccluderGroup(): Group {
    return _occluderGroup;
}

/** Called once from Scene.Start, right after the CSS renderer + scene exist and
 *  BEFORE Fish.genericFishContainer is added (sortObjects is false, so add-order
 *  decides the transparent-pass draw order — the depthWrite:false jellyfish must
 *  draw AFTER these punch planes to blend over the holes instead of being erased). */
export function Start(glScene: ThreeScene, cssScene: ThreeScene): void {
    if (_initialized) return;
    _initialized = true;
    _glScene = glScene;
    _cssScene = cssScene;
    _occluderGroup.visible = true;
    glScene.add(_occluderGroup);

    // Outside-click dismissal. When a modal panel is open the canvas is set to
    // pointer-events:none, so clicks that miss the panel land on the CSS3D
    // layer instead. Panels stopPropagation on their own content, so a bubbled
    // click here means "clicked outside the panel".
    cssRenderer.domElement.addEventListener('pointerdown', (e: PointerEvent) => {
        for (const p of _panels) {
            if (p.isVisible() && p.dismissOnOutsideClick) p.fireOutsideClick(e);
        }
    });
}

/** Per-frame, at PRE-RENDER time (before the WebGL scene is drawn, so the punch
 *  holes are in place). Billboards every panel, advances its open animation and
 *  syncs the DOM + occluder transforms. */
export function preRender(cam: PerspectiveCamera): void {
    for (const p of _panels) p._frame(cam);
}

/** Per-frame, AFTER PhoneScreen.render (the other writer of canvas
 *  pointer-events). Overrides to 'none' only while a panel wants the pointer;
 *  PhoneScreen restores 'auto' on its own every frame otherwise. */
export function syncCanvasPointer(): void {
    let want = false;
    for (const p of _panels) {
        if (p.isVisible() && p.wantsPointer()) { want = true; break; }
    }
    if (want) renderer.domElement.style.pointerEvents = 'none';
}

// ─── Panel ─────────────────────────────────────────────────────────────────────

export interface PanelOptions {
    /** CSS px per world unit — bigger = smaller panel in the scene. */
    pxPerUnit?: number;
    /** Corner radius (CSS px) of the punched hole — match the DOM border-radius. */
    radiusPx?: number;
    /** Modal panels grab the pointer whenever visible and dismiss on outside
     *  click. Non-modal panels (e.g. a desktop hover tooltip) don't. */
    modal?: boolean;
    /** Extra mask dilation (px) around the rounded rect — covers soft edges. */
    maskPad?: number;
}

// easeOutBack — the subtle overshoot that gives the open/close a "pop".
function easeOutBack(t: number): number {
    const c1 = 1.70158, c3 = c1 + 1;
    const x = t - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
}

export class CSS3DPanel {
    /** Drop your interactive DOM in here. */
    readonly content: HTMLDivElement;

    private wrapper: HTMLDivElement;   // CSS3DObject.element — sizing box (owned transform)
    private inner: HTMLDivElement;     // gets the open-scale + opacity
    private cssObject: CSS3DObject;
    private occluder: Mesh;
    private maskCanvas: HTMLCanvasElement;
    private maskTexture: CanvasTexture;

    private pxPerUnit: number;
    private radiusPx: number;
    private maskPad: number;
    readonly dismissOnOutsideClick: boolean;
    private _modal: boolean;

    private _wx = 0; private _wy = 0; private _wz = 0;
    private _visible = false;
    private _openTarget = 0;   // 0 closed, 1 open
    private _openT = 0;        // eased 0..1
    private _lastW = 0; private _lastH = 0;
    private _onOutsideClick: ((e: PointerEvent) => void) | null = null;
    private _onClosed: (() => void) | null = null;

    constructor(opts: PanelOptions = {}) {
        if (!_cssScene) throw new Error('[CSS3DPanel] Start() must be called before creating a panel');
        this.pxPerUnit = opts.pxPerUnit ?? 340;
        this.radiusPx = opts.radiusPx ?? 14;
        this.maskPad = opts.maskPad ?? 6;
        this._modal = opts.modal ?? false;
        this.dismissOnOutsideClick = this._modal;

        // wrapper (transform owned by CSS3DRenderer) → inner (open-scale) → content
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'css3d-panel';
        this.wrapper.style.pointerEvents = 'none';

        this.inner = document.createElement('div');
        this.inner.className = 'css3d-panel-inner';
        this.inner.style.transformOrigin = 'center center';
        this.inner.style.pointerEvents = 'none';

        this.content = document.createElement('div');
        this.content.className = 'css3d-panel-content';
        this.content.style.pointerEvents = 'auto';

        this.inner.appendChild(this.content);
        this.wrapper.appendChild(this.inner);

        // Clicks inside the panel must not bubble to the CSS-layer outside-click
        // dismissal (they still reach the panel's own buttons first).
        const swallow = (e: Event) => e.stopPropagation();
        this.content.addEventListener('pointerdown', swallow);
        this.content.addEventListener('click', swallow);

        this.cssObject = new CSS3DObject(this.wrapper);
        // CSS3DObject forces pointerEvents:'auto' on the element; keep the
        // wrapper transparent to events so only .content is interactive.
        this.wrapper.style.pointerEvents = 'none';
        this.cssObject.visible = false;
        this.cssObject.scale.set(CSS_SCALE / this.pxPerUnit, CSS_SCALE / this.pxPerUnit, 1);
        _cssScene.add(this.cssObject);

        // Occluder plane + rounded-rect mask
        this.maskCanvas = document.createElement('canvas');
        this.maskCanvas.width = 4;
        this.maskCanvas.height = 4;
        this.maskTexture = new CanvasTexture(this.maskCanvas);
        this.maskTexture.minFilter = LinearFilter;
        this.maskTexture.magFilter = LinearFilter;
        this.maskTexture.generateMipmaps = false;

        const mat = new ShaderMaterial({
            uniforms: { uMask: { value: this.maskTexture } },
            vertexShader: /* glsl */`
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D uMask;
                varying vec2 vUv;
                void main() {
                    if (texture2D(uMask, vUv).a < 0.5) discard;
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
                }
            `,
            blending: NoBlending,
            transparent: true,
            depthWrite: true,
            depthTest: true,
            side: DoubleSide,
        });
        this.occluder = new Mesh(new PlaneGeometry(1, 1), mat);
        this.occluder.visible = false;
        _occluderGroup.add(this.occluder);

        _panels.push(this);
    }

    // ── Public API ──────────────────────────────────────────────────────────

    setWorldPosition(x: number, y: number, z: number): void {
        this._wx = x; this._wy = y; this._wz = z;
    }

    open(): void {
        this._visible = true;
        this._openTarget = 1;
        this.cssObject.visible = true;
        this.occluder.visible = true;
        // Bridge the frame gap so offsetWidth/Height measure correctly this frame
        // (CSS3DRenderer only flips display on its own render, which is later).
        this.wrapper.style.display = '';
    }

    close(onClosed?: () => void): void {
        this._openTarget = 0;
        this._onClosed = onClosed ?? null;
    }

    /** Instantly hide with no animation (e.g. on a hard context change). */
    hideImmediate(): void {
        this._openTarget = 0;
        this._openT = 0;
        this._applyHidden();
    }

    isVisible(): boolean { return this._visible; }
    isOpen(): boolean { return this._openTarget === 1; }
    wantsPointer(): boolean { return this._modal && this._visible; }

    setOnOutsideClick(cb: ((e: PointerEvent) => void) | null): void { this._onOutsideClick = cb; }
    fireOutsideClick(e: PointerEvent): void { this._onOutsideClick?.(e); }

    dispose(): void {
        const i = _panels.indexOf(this);
        if (i >= 0) _panels.splice(i, 1);
        if (_cssScene) _cssScene.remove(this.cssObject);
        _occluderGroup.remove(this.occluder);
        (this.occluder.material as ShaderMaterial).dispose();
        this.occluder.geometry.dispose();
        this.maskTexture.dispose();
        this.wrapper.remove();
    }

    /** The occluder mesh — used by the manager's pointer raycast. */
    getOccluder(): Mesh { return this.occluder; }

    // ── Per-frame ────────────────────────────────────────────────────────────

    _frame(cam: PerspectiveCamera): void {
        // Advance the open animation.
        const speed = 14;
        this._openT = MathUtils.damp(this._openT, this._openTarget, speed, deltaTime);
        if (this._openTarget === 1 && this._openT > 0.999) this._openT = 1;
        if (this._openTarget === 0 && this._openT < 0.001) {
            if (this._visible) {
                this._applyHidden();
                const cb = this._onClosed; this._onClosed = null;
                cb?.();
            }
            return;
        }
        if (!this._visible) return;

        // Measure content each frame (playlist expand, i18n, day/night can resize).
        const w = this.content.offsetWidth;
        const h = this.content.offsetHeight;
        if (w > 0 && h > 0 && (Math.abs(w - this._lastW) > 0.5 || Math.abs(h - this._lastH) > 0.5)) {
            this._lastW = w; this._lastH = h;
            this.wrapper.style.width = `${w}px`;
            this.wrapper.style.height = `${h}px`;
            this._bakeMask(w, h);
        }
        const w2 = this._lastW || w, h2 = this._lastH || h;
        if (w2 <= 0 || h2 <= 0) return;

        // Eased visual scale (with a little pop) drives BOTH DOM and occluder.
        const s = this._openTarget === 1 ? easeOutBack(this._openT) : this._openT;
        this.inner.style.transform = `scale(${s})`;
        this.inner.style.opacity = `${MathUtils.clamp(this._openT * 1.4, 0, 1)}`;

        // Billboard both layers to face the camera.
        this.cssObject.position.set(this._wx * CSS_SCALE, this._wy * CSS_SCALE, this._wz * CSS_SCALE);
        this.cssObject.quaternion.copy(cam.quaternion);
        this.cssObject.scale.set(CSS_SCALE / this.pxPerUnit, CSS_SCALE / this.pxPerUnit, 1);

        const pad = this.maskPad;
        const worldW = ((w2 + 2 * pad) / this.pxPerUnit) * s;
        const worldH = ((h2 + 2 * pad) / this.pxPerUnit) * s;
        this.occluder.position.set(this._wx, this._wy, this._wz);
        this.occluder.quaternion.copy(cam.quaternion);
        this.occluder.scale.set(worldW, worldH, 1);
        this.occluder.visible = true;
        this.cssObject.visible = true;
    }

    private _applyHidden(): void {
        this._visible = false;
        this.cssObject.visible = false;
        this.occluder.visible = false;
        this.wrapper.style.display = 'none';
    }

    private _bakeMask(w: number, h: number): void {
        const pad = this.maskPad;
        const cw = Math.ceil(w + 2 * pad);
        const ch = Math.ceil(h + 2 * pad);
        this.maskCanvas.width = cw;
        this.maskCanvas.height = ch;
        const ctx = this.maskCanvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#fff';
        const r = Math.min(this.radiusPx, w / 2, h / 2);
        // Filled rounded rect inset by `pad` — the punched hole is exactly the
        // panel's rounded silhouette (the pad is only a filtering margin).
        roundRectPath(ctx, pad, pad, w, h, r);
        ctx.fill();
        this.maskTexture.needsUpdate = true;
        try { renderer.initTexture(this.maskTexture); } catch { /* pre-GL */ }
    }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

// Kept for potential future hover-arbitration (unused today — modal panels grab
// the pointer wholesale, desktop tooltips leave the canvas interactive).
export function pointerOverAnyPanel(clientX: number, clientY: number): boolean {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    _raycaster.setFromCamera(_ndc, sceneCamera);
    for (const p of _panels) {
        if (!p.isVisible()) continue;
        if (_raycaster.intersectObject(p.getOccluder(), false).length > 0) return true;
    }
    return false;
}

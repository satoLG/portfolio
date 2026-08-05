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
    BufferGeometry,
    CanvasTexture,
    Color,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    Line,
    LineBasicMaterial,
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
    Vector3,
} from 'three';
// Runtime-only access inside functions — same import-cycle pattern as
// CardCarousel/PhoneScreen (see the alias note in Fish.ts).
import { CSS_SCALE, camera as sceneCamera, cssRenderer, renderer } from '../core/Scene';
import { deltaTime } from '../core/Time';
import { setDistortionQuietRect } from './PostProcess';

// ─── Manager state ─────────────────────────────────────────────────────────────

const _occluderGroup = new Group();
const _panels: CSS3DPanel[] = [];
let _glScene: ThreeScene | null = null;
let _cssScene: ThreeScene | null = null;
let _initialized = false;

const _raycaster = new Raycaster();
const _ndc = new Vector2();
const _cornerA = new Vector3();
const _cornerB = new Vector3();

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
 *  holes are in place). Billboards every panel, advances its open animation,
 *  syncs the DOM + occluder transforms and claims the distortion quiet-rect
 *  slots (1..2 — slot 0 is the carousel's) so the underwater wave displacement
 *  never shears a punched hole off its static DOM. */
export function preRender(cam: PerspectiveCamera): void {
    let quietSlot = 1;
    for (const p of _panels) {
        p._frame(cam);
        if (quietSlot <= 2 && p.isVisible() && p._writeQuietRect(cam, quietSlot)) {
            quietSlot++;
        }
    }
    // Clear any slots not claimed this frame.
    for (let s = quietSlot; s <= 2; s++) setDistortionQuietRect(s, 0, 0, 0, 0, false);
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
    /** Known CSS-px size of the hosted content. Seeds the punch mask/occluder so
     *  the panel is CORRECT FROM FRAME 1 without depending on DOM measurement
     *  (which is fragile inside the CSS3D subtree — the element only enters the
     *  document on the CSS renderer's first visible render). Live measurement
     *  still refines it afterwards, but can never zero it out. */
    initialSize?: { w: number; h: number };
    /** Transparent ("ink") mode — like the carousel cards: punch ONLY the panel
     *  outline + the given content elements, leaving the interior UNPUNCHED so
     *  the live 3D scene shows through the gaps (the canvas stays opaque there).
     *  Without this the whole rounded rect is punched (opaque panel over the
     *  page background). */
    transparent?: boolean;
    /** In transparent mode: CSS selectors (queried on the hosted element) whose
     *  boxes are punched so their DOM shows. Gaps between them show the scene. */
    inkSelectors?: string[];
    /** In transparent mode: px padding + corner radius of each punched ink box. */
    inkPad?: number;
    inkRadius?: number;
    /** In transparent mode: also punch the panel's rounded-rect outline as a
     *  stroke (reveals the DOM border). Width is the stroke band in px. */
    inkBorderBand?: number;
    /** In transparent mode: punch ONE rounded rect that is the union bounding
     *  box of all ink elements (a single region wrapping everything) instead of
     *  a separate box per element. The DOM fill shows inside it; the scene shows
     *  around it. */
    inkBounds?: boolean;
    /** Vertical anchoring of setWorldPosition's point: 'center' (default) or
     *  'top' — the anchor is the panel's TOP edge and any height growth
     *  (playlist expanding, etc.) extends DOWNWARD, keeping the top fixed. */
    anchor?: 'center' | 'top';
    /** Draw a thin 3D line in the WebGL scene from the panel's bottom-centre to
     *  a target (its linked model), same colour as the ink. */
    connector?: boolean;
}

// easeOutBack — the subtle overshoot that gives the open/close a "pop".
function easeOutBack(t: number): number {
    const c1 = 1.70158, c3 = c1 + 1;
    const x = t - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
}
function smoothstep(a: number, b: number, x: number): number {
    const t = MathUtils.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
}

// Two-phase open/close timeline (the whole sequence runs over SEQ_DURATION
// seconds). Open: the connector LINE rises over [0, LINE_END], then the panel
// bounces in over [PANEL_START, 1]. Close plays it in reverse (panel out first,
// then the line retracts). Sequential — line fully up before the panel appears.
const SEQ_DURATION = 0.7;
const LINE_END = 0.5;
const PANEL_START = 0.5;

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
    private _transparent: boolean;
    private _inkSelectors: string[];
    private _inkPad: number;
    private _inkRadius: number;
    private _inkBorderBand: number;
    private _inkBounds: boolean;
    private _anchor: 'center' | 'top';
    private _inkBakedBoxes = 0;       // ink boxes punched on the last bake
    private _inkMaxB = 0;             // ink bbox bottom (design px) — connector attach point
    private _zeroInkWarnCountdown = 60;
    // Connector line (bottom-centre of the panel → linked model)
    private _connectorLine: Line | null = null;
    private _connectorGeom: BufferGeometry | null = null;
    private _connectorMat: LineBasicMaterial | null = null;
    private _hasConnectorTarget = false;
    private _ctx = 0; private _cty = 0; private _ctz = 0;   // target world pos
    readonly dismissOnOutsideClick: boolean;
    private _modal: boolean;

    private _wx = 0; private _wy = 0; private _wz = 0;
    private _visible = false;
    private _openTarget = 0;   // 0 closed, 1 open
    private _openT = 0;        // eased 0..1
    private _lastW = 0; private _lastH = 0;
    private _lastInkSig = -1;          // transparent mode: re-bake when ink layout shifts
    private _rasterFlushed = false;    // hard re-raster already done for this open
    private _zeroMeasureFrames = 0;   // diagnostic — warn if DOM never measures
    private _warnedZero = false;
    private _onOutsideClick: ((e: PointerEvent) => void) | null = null;
    private _onClosed: (() => void) | null = null;

    constructor(opts: PanelOptions = {}) {
        if (!_cssScene) throw new Error('[CSS3DPanel] Start() must be called before creating a panel');
        this.pxPerUnit = opts.pxPerUnit ?? 340;
        this.radiusPx = opts.radiusPx ?? 14;
        this.maskPad = opts.maskPad ?? 6;
        this._transparent = opts.transparent ?? false;
        this._inkSelectors = opts.inkSelectors ?? [];
        this._inkPad = opts.inkPad ?? 6;
        this._inkRadius = opts.inkRadius ?? 10;
        this._inkBorderBand = opts.inkBorderBand ?? 3;
        this._inkBounds = opts.inkBounds ?? false;
        this._anchor = opts.anchor ?? 'center';
        this._modal = opts.modal ?? false;
        this.dismissOnOutsideClick = this._modal;
        if (opts.initialSize) {
            this._lastW = opts.initialSize.w;
            this._lastH = opts.initialSize.h;
        }

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

        // Connector line — 2 points, updated per frame; lives in the WebGL scene
        // so it's part of the 3D world (occluded by geometry between it and the
        // camera, like any line).
        if (opts.connector) {
            this._connectorGeom = new BufferGeometry();
            this._connectorGeom.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
            this._connectorMat = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
            this._connectorLine = new Line(this._connectorGeom, this._connectorMat);
            this._connectorLine.frustumCulled = false;
            this._connectorLine.visible = false;
            this._connectorLine.renderOrder = 3;
            // Into the occluder group: it's excluded from the foam depth pre-pass,
            // so the line never paints a stray foam streak underwater.
            _occluderGroup.add(this._connectorLine);
        }

        _panels.push(this);
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /** World point the connector line runs down to (its linked model). */
    setConnectorTarget(x: number, y: number, z: number): void {
        this._ctx = x; this._cty = y; this._ctz = z;
        this._hasConnectorTarget = true;
    }

    /** Connector line colour (match the ink fill). Accepts a THREE color hex. */
    setConnectorColor(hex: number): void {
        if (this._connectorMat) (this._connectorMat.color as Color).setHex(hex);
    }

    setWorldPosition(x: number, y: number, z: number): void {
        this._wx = x; this._wy = y; this._wz = z;
    }

    /** Force the hosted DOM to re-rasterise NOW. This subtree is composited
     *  behind the canvas, so a change that Chrome decides it can serve from the
     *  existing tiles (or a raster that went stale mid-animation) leaves the
     *  panel showing yesterday's pixels while the camera is static. Hiding the
     *  content and reading a layout property back is a paint invalidation the
     *  compositor cannot batch away; no frame is rendered between the two
     *  writes, so there is no flash. Cheap enough for content swaps (a track
     *  change, moving between coins) — do NOT call it per frame. */
    requestRepaint(): void {
        if (!this._visible) return;   // hidden panel — the next open() flushes it
        const el = this.content;
        const prev = el.style.display;
        el.style.display = 'none';
        void el.offsetHeight;      // flush layout so the toggle counts as a repaint
        el.style.display = prev;
        // The swap may also have reflowed the interior — re-bake the mask.
        this._lastInkSig = -1;
    }

    open(): void {
        this._visible = true;
        this._openTarget = 1;
        this._rasterFlushed = false;
        this.cssObject.visible = true;
        this.occluder.visible = true;
        // Bridge the frame gap so offsetWidth/Height measure correctly this frame
        // (CSS3DRenderer only flips display on its own render, which is later).
        this.wrapper.style.display = '';
        // Seeded/known size → punch mask + wrapper are valid from frame 1, with
        // no dependence on DOM measurement (see PanelOptions.initialSize).
        if (this._lastW > 0 && this._lastH > 0) {
            this._applySize(this._lastW, this._lastH);
        }
        this._zeroMeasureFrames = 0;
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
        if (this._connectorLine) {
            _occluderGroup.remove(this._connectorLine);
            this._connectorGeom?.dispose();
            this._connectorMat?.dispose();
        }
        this.wrapper.remove();
    }

    /** The occluder mesh — used by the manager's pointer raycast. */
    getOccluder(): Mesh { return this.occluder; }

    // ── Per-frame ────────────────────────────────────────────────────────────

    _frame(cam: PerspectiveCamera): void {
        // Advance the two-phase timeline (time-based, so the line and panel keep
        // their sequential timing regardless of frame rate).
        const dir = this._openTarget === 1 ? 1 : -1;
        this._openT = MathUtils.clamp(this._openT + dir * deltaTime / SEQ_DURATION, 0, 1);
        if (this._openTarget === 0 && this._openT <= 0) {
            if (this._visible) {
                this._applyHidden();
                const cb = this._onClosed; this._onClosed = null;
                cb?.();
            }
            return;
        }
        if (!this._visible) return;

        // Measure the hosted panel element each frame (playlist expand, i18n,
        // day/night can resize). We measure the FIRST CHILD — the real panel —
        // not `.content`: a hosted panel with position:fixed/absolute (the media
        // player's base style) is out of `.content`'s flow, collapsing it to
        // 0×0. A zero measurement NEVER shrinks the panel — the seeded
        // initialSize (or last good measurement) keeps it visible; measurement
        // only refines. If the DOM measures 0 for a sustained stretch, something
        // upstream is hiding it — say so in the console instead of failing mute.
        // offsetWidth/Height are LAYOUT px — immune to the CSS3D 3D transform
        // (unlike getBoundingClientRect, which is unreliable inside a preserve-3d
        // subtree: some ancestors' transforms are applied, some aren't). This is
        // the DOM equivalent of the carousel's "known layout" that never measures
        // the rendered box.
        const measured = (this.content.firstElementChild as HTMLElement) ?? this.content;
        const w = measured.offsetWidth;
        const h = measured.offsetHeight;
        if (w > 0 && h > 0) {
            this._zeroMeasureFrames = 0;
            if (Math.abs(w - this._lastW) > 0.5 || Math.abs(h - this._lastH) > 0.5) {
                this._applySize(w, h);
            }
        } else if (++this._zeroMeasureFrames === 60 && !this._warnedZero) {
            this._warnedZero = true;
            let blocker = measured.isConnected ? '' : 'element is not attached to the document';
            if (!blocker) {
                for (let el: HTMLElement | null = measured; el; el = el.parentElement) {
                    if (getComputedStyle(el).display === 'none') {
                        blocker = `display:none on <${el.tagName.toLowerCase()} class="${el.className}">`;
                        break;
                    }
                }
            }
            console.warn(
                `[CSS3DPanel] hosted DOM measures 0x0 after 60 visible frames` +
                (blocker ? ` — cause: ${blocker}` : ' — no display:none found; check layout'),
                measured,
            );
        }

        // Transparent mode: keep the ink mask in sync with the interior layout
        // (image load, playlist toggle, i18n) and RETRY while no ink box has
        // landed yet — the DOM only attaches on the CSS renderer's first
        // render, so the open()-time bake is always ring-only. Deliberately
        // OUTSIDE the measurement branch above: it must run off the seeded
        // size even when offset* measurement fails (the rect-ratio bake in
        // _bakeInkMask works on the rendered element regardless).
        if (this._transparent && this._lastW > 0 && this._lastH > 0) {
            const sig = this._inkSignature();
            if (sig !== this._lastInkSig || this._inkBakedBoxes === 0) {
                this._bakeMask(this._lastW, this._lastH);
            }
            if (this._inkBakedBoxes === 0 && this._zeroInkWarnCountdown-- === 0) {
                const host = this.content.firstElementChild as HTMLElement | null;
                const hr = host?.getBoundingClientRect();
                console.warn(
                    '[CSS3DPanel] transparent mode: no ink boxes punched after 60 ' +
                    `visible frames — content will be invisible. hostRect=` +
                    `${hr ? `${hr.width.toFixed(1)}x${hr.height.toFixed(1)}` : 'none'} ` +
                    `offset=${measured.offsetWidth}x${measured.offsetHeight}. Selector hits: ` +
                    this._inkSelectors.map(sel =>
                        `${sel}: ${host ? host.querySelectorAll(sel).length : 'no host'}`,
                    ).join(', '),
                );
            }
        }
        const w2 = this._lastW, h2 = this._lastH;
        if (w2 <= 0 || h2 <= 0) return;

        // Two phases: line rises [0, LINE_END], panel bounces in [PANEL_START, 1].
        const lineProgress = smoothstep(0, LINE_END, this._openT);
        const panelProgress = MathUtils.clamp((this._openT - PANEL_START) / (1 - PANEL_START), 0, 1);
        const s = Math.max(0, easeOutBack(panelProgress));   // 0 during the line phase

        this.inner.style.transform = `scale(${s})`;
        this.inner.style.opacity = `${MathUtils.clamp(panelProgress * 1.6, 0, 1)}`;

        // The frame the pop lands: force the hosted DOM to re-rasterise once.
        // The panel is composited behind the canvas and animates in with
        // transform+opacity, which the compositor serves from already-rastered
        // tiles; parts of the content that were not in that raster (the control
        // buttons' inline SVG icons) then never appear, because once the
        // animation stops nothing invalidates paint again. That is the "icons
        // only show up after toggling day/night" bug — the class swap repaints
        // the panel's background and drags the icons in with it. One explicit
        // invalidation here, at the moment the panel settles, does the same
        // thing deterministically.
        if (!this._rasterFlushed && this._openTarget === 1 && this._openT >= 1) {
            this._rasterFlushed = true;
            this.requestRepaint();
        }

        // 'top' anchor: the anchor point is the panel's TOP edge — the centre
        // sits half the (unscaled) height below it, so height growth extends
        // downward and the top edge stays put.
        const cy = this._anchor === 'top'
            ? this._wy - (h2 / 2) / this.pxPerUnit
            : this._wy;

        // Billboard the DOM (kept visible at scale 0 through the line phase so it
        // stays measurable and the mask is baked before the panel pops in).
        this.cssObject.position.set(this._wx * CSS_SCALE, cy * CSS_SCALE, this._wz * CSS_SCALE);
        this.cssObject.quaternion.copy(cam.quaternion);
        this.cssObject.scale.set(CSS_SCALE / this.pxPerUnit, CSS_SCALE / this.pxPerUnit, 1);
        this.cssObject.visible = true;

        const pad = this.maskPad;
        const worldW = ((w2 + 2 * pad) / this.pxPerUnit) * s;
        const worldH = ((h2 + 2 * pad) / this.pxPerUnit) * s;
        this.occluder.position.set(this._wx, cy, this._wz);
        this.occluder.quaternion.copy(cam.quaternion);
        this.occluder.scale.set(worldW, worldH, 1);
        this.occluder.visible = s > 0.001;   // no punch while the line is still rising

        // Connector line: grows UP from the model to the panel's ink bottom.
        if (this._connectorLine && this._connectorGeom && this._connectorMat && this._hasConnectorTarget) {
            // Ink bottom at FULL scale (fixed) — where the line lands and the
            // panel then bounces in. _inkMaxB is the punched region's bottom in
            // design px; fall back to the full height.
            const maxB = this._inkMaxB > 0 ? this._inkMaxB : h2;
            const inkBottomY = cy + (h2 / 2 - maxB) / this.pxPerUnit;
            const tx = MathUtils.lerp(this._ctx, this._wx, lineProgress);
            const ty = MathUtils.lerp(this._cty, inkBottomY, lineProgress);
            const tz = MathUtils.lerp(this._ctz, this._wz, lineProgress);
            const posAttr = this._connectorGeom.getAttribute('position') as Float32BufferAttribute;
            posAttr.setXYZ(0, this._ctx, this._cty, this._ctz);   // fixed at the model
            posAttr.setXYZ(1, tx, ty, tz);                        // rising/retracting top
            posAttr.needsUpdate = true;
            this._connectorMat.opacity = Math.min(1, lineProgress * 6) * 0.85;
            this._connectorLine.visible = lineProgress > 0.001;
        }
    }

    private _applyHidden(): void {
        this._visible = false;
        this.cssObject.visible = false;
        this.occluder.visible = false;
        this.wrapper.style.display = 'none';
        if (this._connectorLine) this._connectorLine.visible = false;
    }

    /** Commit a content size: wrapper box + punch mask. */
    private _applySize(w: number, h: number): void {
        this._lastW = w;
        this._lastH = h;
        this.wrapper.style.width = `${w}px`;
        this.wrapper.style.height = `${h}px`;
        this._bakeMask(w, h);
    }

    /** Project this panel's screen rect into a distortion quiet-rect slot.
     *  The plane is billboarded (screen-parallel), so the rect is just the
     *  projected centre ± the projected half-extents along the camera axes.
     *  Returns false (slot not consumed) when off-screen. */
    _writeQuietRect(cam: PerspectiveCamera, slot: number): boolean {
        const halfW = ((this._lastW / 2 + this.maskPad) / this.pxPerUnit);
        const halfH = ((this._lastH / 2 + this.maskPad) / this.pxPerUnit);
        if (halfW <= 0 || halfH <= 0) return false;
        // Same anchor-adjusted centre the occluder uses (see _frame).
        const cy = this._anchor === 'top' ? this._wy - (this._lastH / 2) / this.pxPerUnit : this._wy;

        const e = cam.matrixWorld.elements;
        // camera right = (e0,e1,e2), camera up = (e4,e5,e6)
        _cornerA.set(
            this._wx - e[0] * halfW - e[4] * halfH,
            cy - e[1] * halfW - e[5] * halfH,
            this._wz - e[2] * halfW - e[6] * halfH,
        ).project(cam);
        const zNdc = _cornerA.z;
        _cornerB.set(
            this._wx + e[0] * halfW + e[4] * halfH,
            cy + e[1] * halfW + e[5] * halfH,
            this._wz + e[2] * halfW + e[6] * halfH,
        ).project(cam);

        if (zNdc >= 1 ||
            Math.max(_cornerA.y, _cornerB.y) < -1.05 || Math.min(_cornerA.y, _cornerB.y) > 1.05 ||
            Math.max(_cornerA.x, _cornerB.x) < -1.05 || Math.min(_cornerA.x, _cornerB.x) > 1.05) {
            return false;
        }

        const minU = MathUtils.clamp((Math.min(_cornerA.x, _cornerB.x) + 1) / 2, 0, 1);
        const maxU = MathUtils.clamp((Math.max(_cornerA.x, _cornerB.x) + 1) / 2, 0, 1);
        const minV = MathUtils.clamp((Math.min(_cornerA.y, _cornerB.y) + 1) / 2, 0, 1);
        const maxV = MathUtils.clamp((Math.max(_cornerA.y, _cornerB.y) + 1) / 2, 0, 1);
        if (maxU <= minU || maxV <= minV) return false;
        setDistortionQuietRect(slot, minU, minV, maxU, maxV, true);
        return true;
    }

    private _bakeMask(w: number, h: number): void {
        const pad = this.maskPad;
        const cw = Math.ceil(w + 2 * pad);
        const ch = Math.ceil(h + 2 * pad);

        // CRITICAL: only resize the canvas when the dimensions actually change,
        // and when they do, DISPOSE the texture so three re-allocates the GPU
        // texture at the new size on next upload. Re-uploading a grown canvas
        // into a smaller already-allocated texture is what throws
        // "glCopySubTextureCHROMIUM: Offset overflows texture dimensions" and
        // leaves the punch broken (content stays covered). The carousel never
        // hits this because its mask canvas is a fixed size, allocated once.
        if (this.maskCanvas.width !== cw || this.maskCanvas.height !== ch) {
            this.maskCanvas.width = cw;
            this.maskCanvas.height = ch;
            this.maskTexture.dispose();
        }
        const ctx = this.maskCanvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#fff';

        if (this._transparent) {
            this._bakeInkMask(ctx, w, h);
        } else {
            // Filled rounded rect inset by `pad` — the punched hole is exactly the
            // panel's rounded silhouette (the pad is only a filtering margin).
            const r = Math.min(this.radiusPx, w / 2, h / 2);
            roundRectPath(ctx, pad, pad, w, h, r);
            ctx.fill();
        }
        // Let the render loop upload it (full texImage2D at the current canvas
        // size). Do NOT call renderer.initTexture here — that eagerly re-uploads
        // and, right after a canvas grow, is the exact call that overflows.
        this.maskTexture.needsUpdate = true;
    }

    /** Transparent mode: punch ONLY the panel outline + the ink-selector boxes,
     *  leaving the interior unpunched so the live scene shows through.
     *
     *  Element boxes come from LAYOUT coords (offsetLeft/Top up the offsetParent
     *  chain + offsetWidth/Height) — the same "design px" space as the mask (w×h
     *  = the hosted element's own offsetWidth/Height). These are immune to the
     *  CSS3D 3D transform, whereas getBoundingClientRect is unreliable inside a
     *  preserve-3d subtree (it applies some ancestor transforms and not others,
     *  so the boxes landed in the wrong place — the empty-outline bug). This is
     *  the DOM equivalent of the carousel's known-layout mask. */
    private _bakeInkMask(ctx: CanvasRenderingContext2D, w: number, h: number): void {
        const pad = this.maskPad;
        const panelEl = this.content.firstElementChild as HTMLElement | null;
        this._inkBakedBoxes = 0;

        // Border ring — a stroke over the panel's rounded outline reveals the DOM
        // border + a little glow margin on each side.
        if (this._inkBorderBand > 0) {
            const r = Math.min(this.radiusPx, w / 2, h / 2);
            roundRectPath(ctx, pad, pad, w, h, r);
            ctx.lineWidth = this._inkBorderBand * 2;
            ctx.lineJoin = 'round';
            ctx.stroke();
        }

        if (!panelEl) return;
        const ip = this._inkPad;

        if (this._inkBounds) {
            // ONE rounded rect = union bounding box of every ink element.
            let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
            for (const sel of this._inkSelectors) {
                const els = panelEl.querySelectorAll<HTMLElement>(sel);
                for (let i = 0; i < els.length; i++) {
                    const el = els[i];
                    if (el.offsetWidth < 0.5 || el.offsetHeight < 0.5) continue;
                    const box = layoutRectWithin(el, panelEl);
                    minL = Math.min(minL, box.left);
                    minT = Math.min(minT, box.top);
                    maxR = Math.max(maxR, box.left + box.width);
                    maxB = Math.max(maxB, box.top + box.height);
                }
            }
            if (maxR > minL && maxB > minT) {
                const bw = (maxR - minL) + 2 * ip;
                const bh = (maxB - minT) + 2 * ip;
                roundRectPath(
                    ctx,
                    pad + minL - ip, pad + minT - ip, bw, bh,
                    Math.min(this._inkRadius, bw / 2, bh / 2),
                );
                ctx.fill();
                this._inkBakedBoxes++;
                this._inkMaxB = maxB + ip;   // ink bottom (design px) for the connector
            }
        } else {
            let maxB = 0;
            for (const sel of this._inkSelectors) {
                const els = panelEl.querySelectorAll<HTMLElement>(sel);
                for (let i = 0; i < els.length; i++) {
                    const el = els[i];
                    if (el.offsetWidth < 0.5 || el.offsetHeight < 0.5) continue;
                    const box = layoutRectWithin(el, panelEl);
                    const bw = box.width + 2 * ip;
                    const bh = box.height + 2 * ip;
                    roundRectPath(
                        ctx,
                        pad + box.left - ip, pad + box.top - ip, bw, bh,
                        Math.min(this._inkRadius, bh / 2),
                    );
                    ctx.fill();
                    this._inkBakedBoxes++;
                    maxB = Math.max(maxB, box.top + box.height);
                }
            }
            if (maxB > 0) this._inkMaxB = maxB + ip;
        }
        this._lastInkSig = this._inkSignature();
    }

    /** Cheap hash of the ink elements' layout boxes — changes when the interior
     *  reflows (image load, playlist, i18n), triggering a re-bake. */
    private _inkSignature(): number {
        const panelEl = this.content.firstElementChild as HTMLElement | null;
        if (!panelEl) return 0;
        let sig = 0;
        for (const sel of this._inkSelectors) {
            const els = panelEl.querySelectorAll<HTMLElement>(sel);
            for (let i = 0; i < els.length; i++) {
                const el = els[i];
                const box = layoutRectWithin(el, panelEl);
                sig = (sig * 31 + box.left + box.top * 7 + box.width * 13 + box.height * 17) | 0;
            }
        }
        return sig;
    }
}

/** Sum offsetLeft/offsetTop up the offsetParent chain to get an element's box in
 *  `ancestor`'s LAYOUT space (transform-independent — the whole point). The
 *  hosted panel is forced position:relative, so it's in the chain. Punched
 *  elements aren't inside scrolled sub-regions, so scroll is ignored. */
function layoutRectWithin(el: HTMLElement, ancestor: HTMLElement): { left: number; top: number; width: number; height: number } {
    let left = 0, top = 0;
    let node: HTMLElement | null = el;
    let guard = 0;
    while (node && node !== ancestor && guard++ < 32) {
        left += node.offsetLeft;
        top += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
    }
    return { left, top, width: el.offsetWidth, height: el.offsetHeight };
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

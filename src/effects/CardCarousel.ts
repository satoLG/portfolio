/**
 * CardCarousel.ts — CSS3D card carousel floating in the middle of the fish band.
 *
 * An interactive HTML "screen" placed INSIDE the 3D scene at the generic-fish /
 * jellyfish depth (y ≈ -6, z ≈ -2, fish swim y ∈ [-7,-5], z ∈ [-4,0]), so fish
 * and jellies pass both IN FRONT of and BEHIND the cards.
 *
 * How it works (extends the PhoneScreen "CSS3D-behind-alpha-canvas" pattern):
 *
 *   1. The card DOM lives in the shared CSS3D scene, rendered BEHIND the WebGL
 *      canvas (Scene.ts adds #css before #webgl).
 *   2. For each card, a WebGL "punch" plane with a per-pixel alpha MASK writes
 *      (0,0,0,0) with NoBlending ONLY where the card has ink (border strokes +
 *      text pills), slightly dilated. The canvas becomes transparent at those
 *      pixels and the crisp DOM ink shows through.
 *   3. Card interiors are NOT punched, so the live 3D scene (water, fish behind
 *      the plane) stays visible through the cards — they read as border-only
 *      floating glass frames.
 *   4. The punch planes write depth: WebGL objects BEHIND the plane are occluded
 *      at ink pixels (fish swim behind the borders), while objects IN FRONT are
 *      drawn over the holes (fish swim over the cards). NOTE: the punch group
 *      must be added to the scene BEFORE genericFishContainer — sortObjects is
 *      false, so add-order decides draw order and the depthWrite:false jellies
 *      must blend over the holes, not be erased by a later punch.
 *   5. The underwater post-process distortion would displace the punched holes
 *      while the DOM behind stays still, shearing the ink. PostProcess exposes a
 *      "quiet rect" (setDistortionQuietRect) that damps distortion over the
 *      carousel strip; the residual wobble stays inside the mask dilation.
 *
 * Interaction is raycast-driven (the canvas sits on top and owns pointer
 * events): drag horizontally to spin the infinite track (with momentum),
 * hover to highlight. DOM transform and punch-mesh transform are driven by the
 * SAME scalar values every frame, so registration is preserved under bob /
 * tilt / hover-scale animation.
 *
 * Placeholder content only — swap CARD_CONTENTS when the real content lands.
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
    PlaneGeometry,
    Scene as ThreeScene,
    ShaderMaterial,
    Vector3,
} from 'three';
// Runtime-only access (function bodies) — Scene/Control/Fish all sit on the same
// import cycle this project already uses (see the alias note in Fish.ts).
import { CSS_SCALE, camera, renderer } from '../core/Scene';
import { getIsUnderwater, isChestZoomActive } from '../core/Control';
import { deltaTime, time } from '../core/Time';
import { setDistortionQuietRect } from './PostProcess';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

// World placement — centre of the generic fish / jellyfish volume.
const PLANE_X = -0.1;   // matches defaultCameraX so the strip is centred on screen
const PLANE_Y = -6.0;   // fish band is y ∈ [-7, -5]
const PLANE_Z = -2.0;   // fish/jelly z band is [-4, 0] → half pass in front, half behind

// CSS px per world unit. 320 → card DOM px ≈ device px at the strip's depth on
// a desktop viewport (crisp text without giant raster layers).
const PX_PER_UNIT = 320;

// DOM supersample factor — the DOM is authored DOM_SS× larger and the CSS3D
// object scale drops from 16 to 16/DOM_SS. iOS WebKit (Safari AND Chrome —
// same engine) positions/rasterises content on the layout-px grid, so a
// CSS3DObject scale of 16 turned 1px layout snapping into ~16px on-screen
// displacement of the card text (the skewed-content bug). At scale 4 the snap
// error is ≤4px, hidden inside the mask dilation. Same class of iOS precision
// fix as PhoneScreen's CSS_SCALE (which targets scale ≈ 1 at phone distance).
// NOTE: only DOM px are multiplied — the punch masks, world sizes and all
// interaction math stay in "design px" (PX_PER_UNIT space).
const DOM_SS = 4;

// Card geometry (CSS px). Card world height 500/320 ≈ 1.56 — fits inside the
// 2-unit fish band with room for the bob.
const CARD_W = 384;
const CARD_H = 500;
const CARD_RADIUS = 26;
const BORDER_PX = 2;

// Punch dilation: how far (px) the alpha hole extends past the ink. Must cover
// (a) the DOM glow (box-shadow / text-shadow) so it isn't hard-clipped and
// (b) the residual post-process distortion inside the quiet rect.
const BAND = 12;             // border punch band on each side of the stroke
const PILL_PAD_X = 18;       // text pill horizontal padding (also .oc-blk::before)
const PILL_PAD_Y = 12;       // text pill vertical padding   (also .oc-blk::before)
const LINE_PAD = 8;          // divider-line punch pad
const MASK_MARGIN = BAND + 4; // canvas margin around the card box

// Track
const CARD_COUNT = 7;
const CARD_SPACING = 512;          // px between card centres
const TRACK_LEN = CARD_COUNT * CARD_SPACING;
const AUTO_DRIFT_PX = -14;         // idle px/s — slow drift with the fish (-X)
const MOMENTUM_DECAY = 2.6;        // 1/s exponential decay of fling velocity
const MAX_FLING = 2600;            // px/s cap
const DRAG_CLICK_SLOP = 7;         // px — pointer travel below this counts as a click

// Idle float animation (kept subtle — this is water, not a fairground)
const BOB_AMP_PX = 7;
const BOB_FREQ = 0.45;             // Hz-ish (rad/s applied to `time`)
const ROT_AMP_DEG = 1.1;
const ROT_FREQ = 0.32;
const VEL_TILT_DEG_PER_PXS = 0.004; // cards lean into a swipe
const VEL_TILT_MAX_DEG = 5;
const HOVER_SCALE = 1.045;
const SCALE_SMOOTH = 10;           // damp speed for hover scale

// Grab band: vertical world-strip (in card px) around the row where a drag may start
const GRAB_BAND_PX = CARD_H / 2 + 36;

// ─── PLACEHOLDER CONTENT (random filler — replace freely) ────────────────────

interface CardContent { meta: string; title: string; body: string[]; footer: string; }

const CARD_CONTENTS: CardContent[] = [
    { meta: 'PROJETO — 01',     title: 'Recife Digital',  body: ['Visualização interativa de', 'dados do oceano em tempo real.'], footer: 'EXPLORAR →' },
    { meta: 'PROJETO — 02',     title: 'Maré Sonora',     body: ['Player de música com ondas', 'sincronizadas ao áudio.'],        footer: 'EXPLORAR →' },
    { meta: 'PROJETO — 03',     title: 'Cartografia Azul', body: ['Mapas batimétricos gerados', 'proceduralmente na GPU.'],       footer: 'EXPLORAR →' },
    { meta: 'EXPERIMENTO — 04', title: 'Plâncton',        body: ['Sistema de partículas com', 'comportamento emergente.'],        footer: 'EXPLORAR →' },
    { meta: 'PROJETO — 05',     title: 'Farol',           body: ['Dashboard de monitoramento', 'com alertas em tempo real.'],      footer: 'EXPLORAR →' },
    { meta: 'ESTUDO — 06',      title: 'Corrente',        body: ['Simulação de fluidos 2D', 'interativa em WebGL.'],              footer: 'EXPLORAR →' },
    { meta: 'PROJETO — 07',     title: 'Abissal',         body: ['Jornada 3D pelas zonas de', 'profundidade do oceano.'],          footer: 'EXPLORAR →' },
];

// ─── SHARED LAYOUT (single source of truth for DOM *and* punch mask) ─────────

const FONT_STACK = "'Wotfard', ui-sans-serif, system-ui, sans-serif";

interface BlockSpec {
    kind: 'text' | 'line';
    text: string;
    x: number;              // px from card-box left (block top-left)
    y: number;              // px from card-box top
    w: number;              // line only — text blocks measure their own width
    size: number;
    weight: number;
    letterSpacing: number;  // px per glyph — applied manually (measure + DOM)
    lineH: number;
    alpha: number;
}

function buildBlocks(c: CardContent): BlockSpec[] {
    const blk = (b: Partial<BlockSpec>): BlockSpec => ({
        kind: 'text', text: '', x: 34, y: 0, w: 0,
        size: 15, weight: 400, letterSpacing: 0, lineH: 20, alpha: 0.85,
        ...b,
    });
    const blocks: BlockSpec[] = [
        blk({ text: c.meta,  y: 42,  size: 13,   weight: 500, letterSpacing: 3,   lineH: 18, alpha: 0.72 }),
        blk({ text: c.title, y: 70,  size: 29,   weight: 600, letterSpacing: 0.2, lineH: 38, alpha: 0.97 }),
        blk({ kind: 'line',  y: 128, w: 72 }),
    ];
    c.body.forEach((line, i) => blocks.push(
        blk({ text: line, y: 156 + i * 27, size: 15.5, weight: 400, letterSpacing: 0.2, lineH: 21, alpha: 0.82 }),
    ));
    blocks.push(blk({ text: c.footer, y: CARD_H - 66, size: 13.5, weight: 500, letterSpacing: 2.5, lineH: 18, alpha: 0.9 }));
    return blocks;
}

/** Font shorthand. `ss` = px multiplier: DOM_SS for DOM styles, 1 for mask
 *  measurement (font metrics scale linearly, so pills stay registered). */
function blockFont(b: BlockSpec, ss = 1): string {
    return `${b.weight} ${b.size * ss}px ${FONT_STACK}`;
}

// ─── INTERNALS ────────────────────────────────────────────────────────────────

interface CardState {
    el: HTMLDivElement;
    mesh: Mesh;
    maskCanvas: HTMLCanvasElement;
    maskTexture: CanvasTexture;
    blocks: BlockSpec[];
    bobPhase: number;
    rotPhase: number;
    scale: number;          // current smoothed scale
    clickPulse: number;     // 1 → 0 flash on click
}

let _initialized = false;
let cssObject: CSS3DObject | null = null;
let screenEl: HTMLDivElement | null = null;
const occluderGroup = new Group();
const cards: CardState[] = [];

let _active = false;            // current shown/hidden state (applied)
let _pixelHidden = false;       // hidden because pixelation is on (like PhoneScreen)

// Track state
let trackOffset = 0;
let momentum = 0;               // px/s after release

// Drag state
let dragging = false;
let dragPointerId = -1;
let dragLastX = 0;              // plane-local px
let dragLastTime = 0;
let dragTravel = 0;             // accumulated |dx| for click detection
let dragVel = 0;                // smoothed px/s during drag
let hoverIndex = -1;
let _cursor = '';

const _rayOrigin = new Vector3();
const _rayDir = new Vector3();
const _proj = new Vector3();

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

export function isCarouselDragging(): boolean {
    return dragging;
}

/** The WebGL punch group — Scene.ts excludes it from the foam depth pre-pass. */
export function getOccluderGroup(): Group {
    return occluderGroup;
}

/** Mirror of PhoneScreen.applyPhonePixelSize — pixelated punch holes misalign
 *  with the crisp DOM behind them, so hide the whole thing under pixelation. */
export function applyPixelSize(value: number): void {
    _pixelHidden = value > 0;
}

/** Keep the DOM in sync with the WebGL canvas colour filter (bw / sepia). */
export function applyColorFilter(filter: string): void {
    if (screenEl) screenEl.style.filter = filter;
}

/**
 * Build the DOM (into the shared CSS3D scene) and the punch meshes (into the
 * WebGL scene). MUST be called before Fish.genericFishContainer is added to the
 * scene — see draw-order note in the header.
 */
export function Start(glScene: ThreeScene, cssScene: ThreeScene): void {
    if (_initialized) return;
    _initialized = true;

    // ── DOM screen (0×0 anchor — cards centre themselves around it) ──────────
    screenEl = document.createElement('div');
    screenEl.className = 'ocean-carousel';
    screenEl.style.width = '0px';
    screenEl.style.height = '0px';
    screenEl.style.setProperty('--oc-pill-x', `${PILL_PAD_X * DOM_SS}px`);
    screenEl.style.setProperty('--oc-pill-y', `${PILL_PAD_Y * DOM_SS}px`);

    cssObject = new CSS3DObject(screenEl);
    // The CSS3DObject constructor forces pointerEvents:'auto' on the element;
    // all interaction here is raycast-driven through the canvas, so undo it.
    screenEl.style.pointerEvents = 'none';
    cssObject.position.set(PLANE_X * CSS_SCALE, PLANE_Y * CSS_SCALE, PLANE_Z * CSS_SCALE);
    // DOM is authored DOM_SS× larger → object scale is DOM_SS× smaller (iOS
    // WebKit layout-grid snapping fix — see the DOM_SS docs).
    cssObject.scale.set(CSS_SCALE / (PX_PER_UNIT * DOM_SS), CSS_SCALE / (PX_PER_UNIT * DOM_SS), 1);
    cssObject.visible = false;
    cssScene.add(cssObject);

    // ── WebGL punch group ─────────────────────────────────────────────────────
    occluderGroup.position.set(PLANE_X, PLANE_Y, PLANE_Z);
    occluderGroup.visible = false;
    glScene.add(occluderGroup);

    const planeGeo = new PlaneGeometry(1, 1);
    const maskW = CARD_W + 2 * MASK_MARGIN;
    const maskH = CARD_H + 2 * MASK_MARGIN;

    for (let i = 0; i < CARD_COUNT; i++) {
        const content = CARD_CONTENTS[i % CARD_CONTENTS.length];
        const blocks = buildBlocks(content);

        // DOM card — every px is authored at DOM_SS× (see the DOM_SS docs); the
        // smaller object scale brings it back to the same world/screen size.
        const el = document.createElement('div');
        el.className = 'ocean-card';
        el.style.width = `${CARD_W * DOM_SS}px`;
        el.style.height = `${CARD_H * DOM_SS}px`;
        el.style.borderWidth = `${BORDER_PX * DOM_SS}px`;
        el.style.borderRadius = `${CARD_RADIUS * DOM_SS}px`;
        for (const b of blocks) {
            const bl = document.createElement('div');
            bl.className = b.kind === 'line' ? 'oc-line' : 'oc-blk';
            bl.style.left = `${b.x * DOM_SS}px`;
            bl.style.top = `${b.y * DOM_SS}px`;
            if (b.kind === 'line') {
                bl.style.width = `${b.w * DOM_SS}px`;
                bl.style.height = `${2 * DOM_SS}px`;
            } else {
                bl.textContent = b.text;
                bl.style.font = blockFont(b, DOM_SS);
                bl.style.lineHeight = `${b.lineH * DOM_SS}px`;
                bl.style.height = `${b.lineH * DOM_SS}px`;
                bl.style.letterSpacing = `${b.letterSpacing * DOM_SS}px`;
                bl.style.opacity = `${b.alpha}`;
            }
            el.appendChild(bl);
        }
        screenEl.appendChild(el);

        // Punch mask + mesh
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = maskW;
        maskCanvas.height = maskH;
        const maskTexture = new CanvasTexture(maskCanvas);
        maskTexture.minFilter = LinearFilter;
        maskTexture.magFilter = LinearFilter;
        maskTexture.generateMipmaps = false;

        // NoBlending + hard alpha-test discard: fragments on card ink write
        // (0,0,0,0) + depth (the punch), everything else leaves the scene
        // untouched (the see-through card interior).
        const mat = new ShaderMaterial({
            uniforms: { uMask: { value: maskTexture } },
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
            transparent: true,   // → transparent render list (after opaque fish)
            depthWrite: true,
            depthTest: true,
            side: DoubleSide,
        });

        const mesh = new Mesh(planeGeo, mat);
        mesh.scale.set(maskW / PX_PER_UNIT, maskH / PX_PER_UNIT, 1);
        occluderGroup.add(mesh);

        cards.push({
            el, mesh, maskCanvas, maskTexture, blocks,
            bobPhase: Math.random() * Math.PI * 2,
            rotPhase: Math.random() * Math.PI * 2,
            scale: 1,
            clickPulse: 0,
        });
    }

    bakeAllMasks();
    // The Wotfard webfont usually isn't ready at Start — text pills are measured
    // with the fallback font until it lands. Rebake once fonts settle so the
    // punch pills match the real glyph widths.
    if (document.fonts?.ready) {
        document.fonts.ready.then(() => bakeAllMasks()).catch(() => { /* non-fatal */ });
    }

    // ── Interaction ──────────────────────────────────────────────────────────
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', cancelDrag);
}

/**
 * Per-frame update. Call BEFORE the WebGL render (occluder transforms must be
 * in place when the scene is drawn) — Scene.Update calls it right next to
 * PhoneScreen.preRender.
 */
export function Update(): void {
    if (!_initialized || !cssObject) return;

    const shouldShow = getIsUnderwater() && !_pixelHidden;
    if (shouldShow !== _active) {
        _active = shouldShow;
        cssObject.visible = _active;
        occluderGroup.visible = _active;
        if (!_active) {
            cancelDrag();
            setCursor('');
            setDistortionQuietRect(0, 0, 0, 0, 0, false);
        }
    }
    if (!_active) return;

    // ── Track motion ─────────────────────────────────────────────────────────
    if (!dragging) {
        momentum *= Math.exp(-MOMENTUM_DECAY * deltaTime);
        if (Math.abs(momentum) < 12) momentum = 0;
        trackOffset += (AUTO_DRIFT_PX + momentum) * deltaTime;
    }

    // ── Per-card transforms (same scalars drive DOM and punch mesh) ──────────
    const cullPx = getFrustumHalfWidthPx() + CARD_W;
    const velTilt = MathUtils.clamp(
        (dragging ? dragVel : momentum) * VEL_TILT_DEG_PER_PXS,
        -VEL_TILT_MAX_DEG, VEL_TILT_MAX_DEG,
    );

    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const xPx = wrapPx(i * CARD_SPACING + trackOffset);

        const onScreen = Math.abs(xPx) < cullPx;
        card.mesh.visible = onScreen;
        if (!onScreen) {
            // Park far off-screen so the browser skips compositing work too.
            card.el.style.transform =
                `translate3d(${(xPx - CARD_W / 2) * DOM_SS}px, ${(-CARD_H / 2) * DOM_SS}px, 0px)`;
            continue;
        }

        const bobY = Math.sin(time * BOB_FREQ + card.bobPhase) * BOB_AMP_PX;
        const rotDeg = Math.sin(time * ROT_FREQ + card.rotPhase) * ROT_AMP_DEG + velTilt;

        card.clickPulse = Math.max(0, card.clickPulse - deltaTime * 3);
        const targetScale = (i === hoverIndex ? HOVER_SCALE : 1) + card.clickPulse * 0.05;
        card.scale = MathUtils.damp(card.scale, targetScale, SCALE_SMOOTH, deltaTime);

        // DOM (CSS px ×DOM_SS, y-down, rotate() is clockwise on screen)
        card.el.style.transform =
            `translate3d(${(xPx - CARD_W / 2) * DOM_SS}px, ${(bobY - CARD_H / 2) * DOM_SS}px, 0px) ` +
            `rotate(${rotDeg}deg) scale(${card.scale})`;

        // Punch mesh (world units, y-up → flip Y and rotation direction)
        card.mesh.position.set(xPx / PX_PER_UNIT, -bobY / PX_PER_UNIT, 0);
        card.mesh.rotation.z = -rotDeg * MathUtils.DEG2RAD;
        const sw = (CARD_W + 2 * MASK_MARGIN) / PX_PER_UNIT;
        const sh = (CARD_H + 2 * MASK_MARGIN) / PX_PER_UNIT;
        card.mesh.scale.set(sw * card.scale, sh * card.scale, 1);
    }

    updateQuietRect();
}

// ─── Distortion quiet rect ────────────────────────────────────────────────────

function updateQuietRect(): void {
    // Project the strip's vertical extent (full track width — cards span past
    // the frustum edges whenever visible) into UV space for the post shader.
    const halfH = (CARD_H / 2 + MASK_MARGIN + BOB_AMP_PX + 6) / PX_PER_UNIT;
    const halfW = TRACK_LEN / 2 / PX_PER_UNIT;

    _proj.set(PLANE_X - halfW, PLANE_Y - halfH, PLANE_Z).project(camera);
    const x0 = _proj.x, y0 = _proj.y, zNdc = _proj.z;
    _proj.set(PLANE_X + halfW, PLANE_Y + halfH, PLANE_Z).project(camera);
    const x1 = _proj.x, y1 = _proj.y;

    // Behind the camera or fully off-screen → no quiet zone.
    if (zNdc >= 1 || Math.max(y0, y1) < -1.05 || Math.min(y0, y1) > 1.05) {
        setDistortionQuietRect(0, 0, 0, 0, 0, false);
        return;
    }

    const minU = MathUtils.clamp((Math.min(x0, x1) + 1) / 2, 0, 1);
    const maxU = MathUtils.clamp((Math.max(x0, x1) + 1) / 2, 0, 1);
    const minV = MathUtils.clamp((Math.min(y0, y1) + 1) / 2, 0, 1);
    const maxV = MathUtils.clamp((Math.max(y0, y1) + 1) / 2, 0, 1);
    setDistortionQuietRect(0, minU, minV, maxU, maxV, maxU > minU && maxV > minV);
}

// ─── Interaction ──────────────────────────────────────────────────────────────

/** Intersect the pointer ray with the carousel plane; returns plane-local CSS px
 *  (x right, y down, origin at strip centre) or null. */
function pointerToPlanePx(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

    _rayOrigin.setFromMatrixPosition(camera.matrixWorld);
    _rayDir.set(ndcX, ndcY, 0.5).unproject(camera).sub(_rayOrigin).normalize();
    if (Math.abs(_rayDir.z) < 1e-6) return null;
    const t = (PLANE_Z - _rayOrigin.z) / _rayDir.z;
    if (!Number.isFinite(t) || t <= 0) return null;

    return {
        x: (_rayOrigin.x + _rayDir.x * t - PLANE_X) * PX_PER_UNIT,
        y: -(_rayOrigin.y + _rayDir.y * t - PLANE_Y) * PX_PER_UNIT,
    };
}

function cardIndexAt(local: { x: number; y: number }): number {
    for (let i = 0; i < cards.length; i++) {
        const xPx = wrapPx(i * CARD_SPACING + trackOffset);
        if (Math.abs(local.x - xPx) <= CARD_W / 2 && Math.abs(local.y) <= CARD_H / 2 + BOB_AMP_PX) {
            return i;
        }
    }
    return -1;
}

function onPointerDown(e: PointerEvent): void {
    if (!_active || isChestZoomActive()) return;
    const local = pointerToPlanePx(e.clientX, e.clientY);
    if (!local || Math.abs(local.y) > GRAB_BAND_PX) return;

    dragging = true;
    dragPointerId = e.pointerId;
    dragLastX = local.x;
    dragLastTime = performance.now();
    dragTravel = 0;
    dragVel = 0;
    momentum = 0;
    setCursor('grabbing');
}

function onPointerMove(e: PointerEvent): void {
    if (dragging && e.pointerId === dragPointerId) {
        const local = pointerToPlanePx(e.clientX, e.clientY);
        if (!local) return;
        const now = performance.now();
        const dt = Math.max((now - dragLastTime) / 1000, 1e-3);
        const dx = local.x - dragLastX;
        dragLastX = local.x;
        dragLastTime = now;
        dragTravel += Math.abs(dx);
        trackOffset += dx;
        dragVel = MathUtils.lerp(dragVel, dx / dt, 0.35);
        return;
    }

    // Hover feedback (desktop) — cheap analytic test, no raycaster.
    if (!_active || e.pointerType === 'touch') return;
    const local = pointerToPlanePx(e.clientX, e.clientY);
    hoverIndex = local ? cardIndexAt(local) : -1;
    setCursor(hoverIndex >= 0 ? 'grab'
        : (local && Math.abs(local.y) <= GRAB_BAND_PX ? 'grab' : ''));
}

function onPointerUp(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = -1;

    if (dragTravel < DRAG_CLICK_SLOP) {
        // Treated as a click — placeholder feedback until cards get real actions.
        const local = pointerToPlanePx(e.clientX, e.clientY);
        const idx = local ? cardIndexAt(local) : -1;
        if (idx >= 0) cards[idx].clickPulse = 1;
        momentum = 0;
    } else {
        momentum = MathUtils.clamp(dragVel, -MAX_FLING, MAX_FLING);
    }
    setCursor(hoverIndex >= 0 ? 'grab' : '');
}

function cancelDrag(): void {
    dragging = false;
    dragPointerId = -1;
    momentum = 0;
}

function setCursor(c: string): void {
    if (c === _cursor) return;
    _cursor = c;
    renderer.domElement.style.cursor = c;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrapPx(x: number): number {
    return ((x % TRACK_LEN) + TRACK_LEN * 1.5) % TRACK_LEN - TRACK_LEN / 2;
}

function getFrustumHalfWidthPx(): number {
    const dist = Math.abs(camera.position.z - PLANE_Z);
    const halfH = Math.tan(MathUtils.degToRad(camera.fov) / 2) * dist;
    return halfH * camera.aspect * PX_PER_UNIT;
}

// ─── Punch mask baking ────────────────────────────────────────────────────────

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** Measured text width including the manual letter-spacing model shared with
 *  the DOM (letter-spacing adds after EVERY glyph, including the last). */
function measureBlockWidth(ctx: CanvasRenderingContext2D, b: BlockSpec): number {
    ctx.font = blockFont(b);
    return ctx.measureText(b.text).width + b.letterSpacing * b.text.length;
}

function bakeMask(card: CardState): void {
    const ctx = card.maskCanvas.getContext('2d');
    if (!ctx) return;
    const M = MASK_MARGIN;
    ctx.clearRect(0, 0, card.maskCanvas.width, card.maskCanvas.height);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';

    // Border band — stroke centred on the card border line, fat enough to
    // reveal the DOM box-shadow glow on both sides.
    roundRectPath(ctx, M + 1, M + 1, CARD_W - 2, CARD_H - 2, CARD_RADIUS - 1);
    ctx.lineWidth = BORDER_PX + 2 * BAND;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Text pills / divider line
    for (const b of card.blocks) {
        if (b.kind === 'line') {
            roundRectPath(
                ctx,
                M + b.x - LINE_PAD, M + b.y - LINE_PAD,
                b.w + 2 * LINE_PAD, 2 + 2 * LINE_PAD,
                LINE_PAD + 1,
            );
            ctx.fill();
            continue;
        }
        const w = measureBlockWidth(ctx, b);
        const ph = b.lineH + 2 * PILL_PAD_Y;
        roundRectPath(
            ctx,
            M + b.x - PILL_PAD_X, M + b.y - PILL_PAD_Y,
            w + 2 * PILL_PAD_X, ph,
            ph / 2,
        );
        ctx.fill();
    }

    card.maskTexture.needsUpdate = true;
}

function bakeAllMasks(): void {
    for (const card of cards) {
        bakeMask(card);
        // Pre-upload so the first underwater frame doesn't pay the texImage cost.
        try { renderer.initTexture(card.maskTexture); } catch { /* pre-GL init */ }
    }
}

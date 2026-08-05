/**
 * CardCarousel.ts — CSS3D tab carousel floating in the middle of the fish band.
 *
 * An interactive HTML "screen" placed INSIDE the 3D scene at the generic-fish /
 * jellyfish depth (y ≈ -6, z ≈ -2, fish swim y ∈ [-7,-5], z ∈ [-4,0]), so fish
 * and jellies pass both IN FRONT of and BEHIND the content.
 *
 * SHAPE OF THE UI
 *
 *   Collapsed (the state the scene starts in): three bare titles — Experiência,
 *   Projetos, Estudos — scattered asymmetrically across the strip, each drifting
 *   on its own bob and tilt, in the same type style the card headings use.
 *   Nothing else: no frame, no backdrop.
 *
 *   Expanded: picking a title gathers all three into an aligned row ABOVE the
 *   strip centre and unfolds that tab's cards below it, scaling out from
 *   directly under the row (transform-origin: top centre) with a per-card
 *   stagger. Switching tabs collapses the current cards, swaps the content and
 *   unfolds the new ones — the row stays gathered across the swap. Clicking the
 *   ACTIVE title releases everything back to the scattered titles.
 *
 * HOW IT RENDERS (extends the PhoneScreen "CSS3D-behind-alpha-canvas" pattern):
 *
 *   1. The DOM lives in the shared CSS3D scene, rendered BEHIND the WebGL canvas
 *      (Scene.ts adds #css before #webgl).
 *   2. For each title and each card, a WebGL "punch" plane with a per-pixel
 *      alpha MASK writes (0,0,0,0) with NoBlending ONLY where there is ink
 *      (border strokes, glyphs, image boxes), slightly dilated. The canvas
 *      becomes transparent at those pixels and the crisp DOM shows through.
 *   3. Card interiors are NOT punched, so the live 3D scene (water, fish behind
 *      the plane) stays visible through the cards — they read as border-only
 *      floating glass frames. Image boxes ARE punched solid, because their DOM
 *      is the thing you're meant to see.
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
 * REGISTRATION RULE: every transform is a scalar computed once per frame and
 * applied to BOTH the DOM element and its punch mesh. Cards scale/rotate about
 * their TOP CENTRE (so they unfold from under the titles), which the mesh
 * reproduces by placing its centre at the pivot plus the rotated, scaled
 * half-height — see updateCards().
 *
 * Interaction is raycast-driven (the canvas sits on top and owns pointer
 * events): tap a title to switch tabs, drag horizontally to pan a tab whose
 * cards overflow the viewport, tap a card's link to open it.
 *
 * Content lives in CarouselContent.ts.
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
import {
    CardData,
    EntryCard,
    MAX_CARDS,
    PROJECTS,
    ProjectCard,
    TABS,
    TAB_CARDS,
} from './CarouselContent';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

// World placement — centre of the generic fish / jellyfish volume.
const PLANE_X = -0.1;   // matches defaultCameraX so the strip is centred on screen
const PLANE_Y = -6.0;   // fish band is y ∈ [-7, -5]
const PLANE_Z = -2.0;   // fish/jelly z band is [-4, 0] → half pass in front, half behind

// CSS px per world unit. 320 → card DOM px ≈ device px at the strip's depth on
// a desktop viewport (crisp text without giant raster layers).
const PX_PER_UNIT = 320;

// DOM supersample factor — the DOM is authored DOM_SS× larger and the CSS3D
// object scale drops accordingly. iOS WebKit (Safari AND Chrome — same engine)
// positions/rasterises content on the layout-px grid, so a large CSS3DObject
// scale turns 1px layout snapping into many px of on-screen displacement (the
// skewed-content bug). At scale 4 the snap error is ≤4px, hidden inside the mask
// dilation. NOTE: only DOM px are multiplied — the punch masks, world sizes and
// all interaction math stay in "design px" (PX_PER_UNIT space).
const DOM_SS = 4;

// ── Card geometry (design px) ────────────────────────────────────────────────
// EVERY card is exactly this size, on every tab. The project card — icon, name,
// description, screenshot, link — is the tallest thing the carousel has to show,
// so it sets the height and the shorter entry cards distribute into it: header
// pinned to the top, description pinned to the bottom, water in between.
const CARD_W = 384;
const CARD_H = 500;
const CARD_RADIUS = 26;
const BORDER_PX = 2;
const CARD_PAD = 32;                 // card box inset for all content

// Punch dilation: how far (px) the alpha hole extends past the ink. Must cover
// (a) the DOM glow so it isn't hard-clipped and (b) the residual post-process
// distortion inside the quiet rect (damped to 12% there, so a few px covers it).
//
// These are DELIBERATELY MODE-INDEPENDENT. An earlier version widened them at
// night to give the neon more room, but the hole shows the page background
// (black — index.html sets it inline), so growing it made a visibly fatter dark
// outline appear around every letter the moment night fell. The geometry has to
// hold still; only the DOM glow changes between day and night.
const BAND = 6;              // punch band each side of a stroke (card border)
const LINE_PAD = 3;          // divider-line punch pad
const RECT_PAD = 3;          // filled-box (image) punch pad

// Text is punched as GLYPH SHAPES, never as a pill box. A rounded-rect hole
// around a line of text shows the page background in every gap between the
// letters and the box edge, which reads as a dark chip behind the line —
// unmissable on the bare floating titles, where there is no card frame to
// explain it. Stroking + filling the glyphs keeps the hole letter-shaped.
//
// The dilation scales with FONT SIZE and is capped tight: a flat pad cannot
// serve both a 12.5px period line and a 34px title (whatever carries the
// title's halo is wider than the gaps between small glyphs, so body text fuses
// back into the slab this exists to avoid), and blur only holds useful opacity
// out to about a third of its radius, so a wider hole is simply black.
const TEXT_PAD_RATIO = 0.13, TEXT_PAD_MIN = 2, TEXT_PAD_MAX = 4.5;

// Hit targets do NOT follow the punch: a tap area stays forgiving regardless.
const HIT_PAD_X = 18;
const HIT_PAD_Y = 12;

const MASK_MARGIN = BAND + 4;   // canvas margin around the card box

function textPadFor(size: number): number {
    return MathUtils.clamp(size * TEXT_PAD_RATIO, TEXT_PAD_MIN, TEXT_PAD_MAX);
}

// ── Titles (design px) ───────────────────────────────────────────────────────
const TAB_SIZE = 34;
const TAB_WEIGHT = 600;
const TAB_LS = 1.6;
const TAB_LINE_H = 46;
const TAB_GAP = 84;                  // px between titles once gathered
const TAB_RISE_PX = 248;             // gathered row's height above the strip centre
const TAB_UNDERLINE_DY = 40;         // px below the title centre
const TAB_UNDERLINE_H = 2;
const TAB_HOVER_SCALE = 1.06;
const TAB_ACTIVE_SCALE = 1.03;
const TAB_ROW_FILL = 0.9;            // max share of the viewport width the titles may use

// Where each title drifts while nothing is selected. Hand-placed rather than
// randomised: they have to read as three things that happen to be floating near
// each other, without ever overlapping, and a seeded random never quite lands
// that composition. Order matches TABS.
const TAB_SCATTER = [
    { x: -268, y: -84, rot: -2.6 },
    { x: 40, y: 76, rot: 1.9 },
    { x: 292, y: -30, rot: -1.3 },
];
const TAB_DRIFT_AMP = 11;            // scattered bob amplitude (px)
const TAB_DRIFT_TILT = 1.6;          // scattered extra sway (deg)
const TAB_GATHERED_AMP = 3;          // bob amplitude once gathered

// ── Card strip (design px) ───────────────────────────────────────────────────
const CARDS_TOP_Y = -180;            // top edge of every card, relative to PLANE_Y
const CARD_SPACING = 448;            // px between card centres
const EDGE_PAD = 40;                 // px of breathing room at the pan limits
const MOMENTUM_DECAY = 2.6;          // 1/s exponential decay of fling velocity
const MAX_FLING = 2600;              // px/s cap
const DRAG_CLICK_SLOP = 7;           // px — pointer travel below this counts as a click
const RUBBER = 0.42;                 // drag resistance past the pan limits
const SPRING_BACK = 9;               // 1/s damp speed back inside the limits

// ── Animation ────────────────────────────────────────────────────────────────
const REVEAL_SEC = 0.42;             // card unfold duration (before stagger)
const GATHER_SEC = 0.6;              // scatter → aligned row duration
const CARD_STAGGER = 0.1;            // per-card delay, in reveal-units
const UNDERLINE_SMOOTH = 12;

// Idle float animation (kept subtle — this is water, not a fairground)
const BOB_AMP_PX = 7;
const BOB_FREQ = 0.45;               // Hz-ish (rad/s applied to `time`)
const ROT_AMP_DEG = 1.1;
const ROT_FREQ = 0.32;
const VEL_TILT_DEG_PER_PXS = 0.004;  // cards lean into a swipe
const VEL_TILT_MAX_DEG = 5;
const HOVER_SCALE = 1.03;
const SCALE_SMOOTH = 10;             // damp speed for hover scale

const FONT_STACK = "'Wotfard', ui-sans-serif, system-ui, sans-serif";

// ─── SHARED LAYOUT (single source of truth for DOM *and* punch mask) ─────────

type BlockKind = 'text' | 'line' | 'rect';

interface Block {
    kind: BlockKind;
    x: number; y: number;            // px from card-box top-left
    w: number; h: number;
    // text
    text: string;
    size: number; weight: number; ls: number; lineH: number; alpha: number;
    padMul: number;                  // multiplier on the glyph dilation
    // rect
    radius: number;
    img: string;                     // '' → no image element
    stroke: number;                  // 0 → filled punch; >0 → punch the ring only
    cls: string;                     // extra DOM class
    href: string;                    // '' → not clickable
}

function block(b: Partial<Block> & { kind: BlockKind }): Block {
    return {
        x: CARD_PAD, y: 0, w: 0, h: 0,
        text: '', size: 15, weight: 400, ls: 0, lineH: 20, alpha: 0.85,
        padMul: 1,
        radius: 0, img: '', stroke: 0, cls: '', href: '',
        ...b,
    };
}

/** Font shorthand. `ss` = px multiplier: DOM_SS for DOM styles, 1 for mask
 *  measurement and baking (font metrics scale linearly, so the two stay
 *  registered). */
function blockFont(size: number, weight: number, ss = 1): string {
    return `${weight} ${size * ss}px ${FONT_STACK}`;
}

// ── Text measurement / wrapping / punching ───────────────────────────────────
// Content is authored as plain sentences; the card width is fixed, so lines are
// measured and wrapped here. Measurement, DOM and mask must agree on glyph
// advance to the pixel, so all three go through configureText(): canvas
// letterSpacing applies exactly the CSS model (spacing after EVERY glyph,
// kerning intact). Where the browser lacks it, we fall back to per-character
// placement and the manual width model — that loses kerning, but the drift
// stays inside the dilation band.

let _measureCtx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D {
    if (!_measureCtx) {
        _measureCtx = document.createElement('canvas').getContext('2d');
    }
    return _measureCtx as CanvasRenderingContext2D;
}

/** Set font + tracking on a context. Returns true when the browser applied the
 *  tracking itself (so measureText already includes it). */
function configureText(ctx: CanvasRenderingContext2D, size: number, weight: number, ls: number): boolean {
    ctx.font = blockFont(size, weight);
    if ('letterSpacing' in ctx) {
        (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${ls}px`;
        return true;
    }
    return false;
}

function textWidth(text: string, size: number, weight: number, ls: number): number {
    const ctx = measureCtx();
    if (!ctx) return text.length * size * 0.5;
    const native = configureText(ctx, size, weight, ls);
    const w = ctx.measureText(text).width;
    return native ? w : w + ls * text.length;
}

/** CSS half-leading: the font's content box is centred in the line box, so the
 *  baseline sits this far below the block's top edge. Mirrors how .oc-blk is
 *  laid out (fixed height equal to line-height). */
function baselineOffset(ctx: CanvasRenderingContext2D, lineH: number): number {
    const m = ctx.measureText('Hxpg');
    const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
    if (typeof asc === 'number' && typeof desc === 'number' && asc + desc > 0) {
        return (lineH - (asc + desc)) / 2 + asc;
    }
    return lineH * 0.74;   // no font metrics — close enough inside the dilation
}

/** Punch one line of text as dilated glyph outlines (see the TEXT_PAD docs for
 *  why this is not a pill). `top` is the block's top edge in canvas px. */
function punchText(
    ctx: CanvasRenderingContext2D, text: string,
    x: number, top: number, lineH: number,
    size: number, weight: number, ls: number, pad: number,
): void {
    const native = configureText(ctx, size, weight, ls);
    const baseline = top + baselineOffset(ctx, lineH);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = pad * 2;
    if (native) {
        ctx.strokeText(text, x, baseline);
        ctx.fillText(text, x, baseline);
        return;
    }
    let cx = x;
    for (const ch of text) {
        ctx.strokeText(ch, cx, baseline);
        ctx.fillText(ch, cx, baseline);
        cx += ctx.measureText(ch).width + ls;
    }
}

function wrapText(text: string, size: number, weight: number, ls: number, maxW: number): string[] {
    if (!text) return [];
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (line && textWidth(next, size, weight, ls) > maxW) {
            lines.push(line);
            line = word;
        } else {
            line = next;
        }
    }
    if (line) lines.push(line);
    return lines;
}

// ── Card layouts ─────────────────────────────────────────────────────────────

const ICON_BOX = 52;                 // icon / monogram square, shared by both layouts
const ICON_GAP = 18;
const HEAD_Y = 34;

/** Icon slot: the real logo when there is one, otherwise a monogram in an
 *  outlined square — same ink language as the card frame, so a missing asset
 *  degrades to something deliberate rather than a hole.
 *  `cls` picks the fit: 'oc-logo' for full-bleed brand tiles (company and school
 *  marks, which carry their own background), 'oc-icon' for loose marks on
 *  transparency, which need padding and letterboxing instead. */
function pushIconBlocks(blocks: Block[], icon: string, mono: string, cls: string): void {
    if (icon) {
        blocks.push(block({
            kind: 'rect', x: CARD_PAD, y: HEAD_Y, w: ICON_BOX, h: ICON_BOX,
            radius: 14, img: icon, cls,
        }));
        return;
    }
    if (!mono) return;
    blocks.push(block({
        kind: 'rect', x: CARD_PAD, y: HEAD_Y, w: ICON_BOX, h: ICON_BOX,
        radius: 14, stroke: BORDER_PX, cls: 'oc-mono',
    }));
    const size = mono.length > 1 ? 18 : 22;
    const w = textWidth(mono, size, 600, 1);
    blocks.push(block({
        kind: 'text', text: mono,
        x: CARD_PAD + (ICON_BOX - w) / 2,
        y: HEAD_Y + (ICON_BOX - 26) / 2,
        size, weight: 600, ls: 1, lineH: 26, alpha: 0.95, padMul: 0.8,
    }));
}

/** Chronological entry — Experiência and Estudos. Header (icon + company, role,
 *  period, divider) pinned to the top, description pinned to the BOTTOM so every
 *  card ends on the same line regardless of how much text it carries. */
function buildEntryLayout(e: EntryCard): Block[] {
    const blocks: Block[] = [];
    const innerW = CARD_W - 2 * CARD_PAD;

    pushIconBlocks(blocks, e.icon ?? '', e.mono ?? e.heading.slice(0, 1).toUpperCase(), 'oc-logo');

    const headX = CARD_PAD + ICON_BOX + ICON_GAP;
    const headLines = wrapText(e.heading, 25, 600, 0.2, CARD_W - CARD_PAD - headX);
    let hy = Math.max(HEAD_Y - 6, HEAD_Y + (ICON_BOX - headLines.length * 32) / 2);
    for (const line of headLines) {
        blocks.push(block({ kind: 'text', text: line, x: headX, y: hy, size: 25, weight: 600, ls: 0.2, lineH: 32, alpha: 0.98 }));
        hy += 32;
    }

    let y = Math.max(HEAD_Y + ICON_BOX, hy) + 22;

    for (const line of wrapText(e.subheading, 15.5, 500, 0.3, innerW)) {
        blocks.push(block({ kind: 'text', text: line, y, size: 15.5, weight: 500, ls: 0.3, lineH: 22, alpha: 0.88 }));
        y += 22;
    }
    y += 4;

    if (e.period) {
        blocks.push(block({ kind: 'text', text: e.period, y, size: 12.5, weight: 500, ls: 2.6, lineH: 17, alpha: 0.68 }));
        y += 17;
    }
    y += 20;

    blocks.push(block({ kind: 'line', y, w: 64, h: 2 }));

    // Bottom-anchored description — the "no fim do card" of the original brief,
    // and what keeps every entry card ending on the same line.
    const bodyLines = wrapText(e.body, 14.5, 400, 0.2, innerW);
    let by = CARD_H - 46 - bodyLines.length * 21;
    for (const line of bodyLines) {
        blocks.push(block({ kind: 'text', text: line, y: by, size: 14.5, weight: 400, ls: 0.2, lineH: 21, alpha: 0.82 }));
        by += 21;
    }

    return blocks;
}

/** Project: icon + name, description, then a divided image section and the link
 *  — the last three pinned to the bottom so they line up across every project. */
function buildProjectLayout(p: ProjectCard): Block[] {
    const blocks: Block[] = [];
    const innerW = CARD_W - 2 * CARD_PAD;

    pushIconBlocks(blocks, p.icon, '', 'oc-icon');

    const nameX = CARD_PAD + ICON_BOX + ICON_GAP;
    const nameLines = wrapText(p.name, 23, 600, 0.2, CARD_W - CARD_PAD - nameX);
    let ny = Math.max(HEAD_Y - 4, HEAD_Y + (ICON_BOX - nameLines.length * 30) / 2);
    for (const line of nameLines) {
        blocks.push(block({ kind: 'text', text: line, x: nameX, y: ny, size: 23, weight: 600, ls: 0.2, lineH: 30, alpha: 0.98 }));
        ny += 30;
    }

    // Bottom-up: link label, screenshot above it, divider above that.
    const LABEL_H = 18, SHOT_H = 168;
    const labelY = CARD_H - 34 - LABEL_H;
    const shotY = labelY - 26 - SHOT_H;
    const dividerY = shotY - 22;

    let y = Math.max(HEAD_Y + ICON_BOX, ny) + 24;
    for (const line of wrapText(p.body, 14.5, 400, 0.2, innerW)) {
        if (y + 21 > dividerY - 12) break;   // never collide with the image section
        blocks.push(block({ kind: 'text', text: line, y, size: 14.5, weight: 400, ls: 0.2, lineH: 21, alpha: 0.82 }));
        y += 21;
    }

    blocks.push(block({ kind: 'line', y: dividerY, w: innerW, h: 2 }));
    blocks.push(block({
        kind: 'rect', x: CARD_PAD, y: shotY, w: innerW, h: SHOT_H,
        radius: 16, img: p.shot, cls: 'oc-shot',
    }));

    // The link is TEXT ONLY — no button chrome. Its tap area comes from HIT_PAD.
    const label = `${p.cta}  →`;
    const labelW = textWidth(label, 13, 600, 2.4);
    blocks.push(block({
        kind: 'text', text: label, x: (CARD_W - labelW) / 2, y: labelY,
        size: 13, weight: 600, ls: 2.4, lineH: LABEL_H, alpha: 0.95,
        href: p.url,
    }));

    return blocks;
}

function buildLayout(c: CardData): Block[] {
    return c.kind === 'project' ? buildProjectLayout(c) : buildEntryLayout(c);
}

// ─── INTERNALS ────────────────────────────────────────────────────────────────

interface CardSlot {
    el: HTMLDivElement;
    mesh: Mesh;
    maskCanvas: HTMLCanvasElement;
    maskTexture: CanvasTexture;
    blocks: Block[] | null;         // null → slot unused by the active tab
    bobPhase: number;
    rotPhase: number;
    scale: number;                  // smoothed hover scale
    clickPulse: number;             // 1 → 0 flash on click
    // live transform, mirrored by the punch mesh — also the hit-test basis
    xPx: number;
    topY: number;
    rotDeg: number;
    revealScale: number;
}

interface TabSlot {
    el: HTMLDivElement;
    mesh: Mesh;
    maskCanvas: HTMLCanvasElement;
    maskTexture: CanvasTexture;
    textW: number;                  // measured label width (design px)
    rowX: number;                   // x once gathered into the row (design px)
    bobPhase: number;
    rotPhase: number;
    scale: number;                  // smoothed hover/active scale
    // live transform, mirrored by the punch mesh — also the hit-test basis
    cx: number;
    cy: number;
    rotDeg: number;
}

let _initialized = false;
let cssObject: CSS3DObject | null = null;
let screenEl: HTMLDivElement | null = null;
const occluderGroup = new Group();
const cards: CardSlot[] = [];
const tabs: TabSlot[] = [];

let underlineEl: HTMLDivElement | null = null;
let underlineMesh: Mesh | null = null;
let underlineMaskW = 0;             // baked underline width (design px)

let _active = false;                // current shown/hidden state (applied)
let _pixelHidden = false;           // hidden because pixelation is on (like PhoneScreen)

// Tab state
let activeTab = -1;                 // tab whose cards are currently BUILT (-1 none)
let requestedTab = -1;              // tab the user last picked (-1 none)
let reveal = 0;                     // 0..1 cards unfolded
let gather = 0;                     // 0..1 titles scattered → aligned row
let underlineX = 0;                 // smoothed underline centre
let underlineW = 0;                 // smoothed underline width
let cardCount = 0;                  // slots in use by the active tab
let stripHalfW = 0;                 // half-extent of the built strip (design px)
let _revealFlushed = false;         // raster flush already done for this unfold

// Track state
let trackOffset = 0;
let momentum = 0;                   // px/s after release
let panLimit = 0;                   // |trackOffset| bound (0 → content fits)

// Drag state
let dragging = false;
let dragPointerId = -1;
let dragLastX = 0;                  // plane-local px
let dragLastTime = 0;
let dragTravel = 0;                 // accumulated |dx| for click detection
let dragVel = 0;                    // smoothed px/s during drag
let hoverCard = -1;
let hoverTab = -1;
let hoverLink = false;
let _cursor = '';

// Live vertical extent of everything drawn, for the distortion quiet rect.
let extentTopPx = 0;
let extentBottomPx = 0;

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

    // ── DOM screen (0×0 anchor — everything centres itself around it) ────────
    screenEl = document.createElement('div');
    screenEl.className = 'ocean-carousel';
    screenEl.style.width = '0px';
    screenEl.style.height = '0px';

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

    buildTabs();
    buildCardSlots();
    buildUnderline();
    layoutTabs();

    // Project imagery is punched solid, so a late-decoding image shows a hole
    // full of page background. Warm the cache before any tab can open.
    for (const p of PROJECTS) {
        for (const src of [p.icon, p.shot]) {
            const img = new Image();
            img.src = src;
        }
    }

    // The Wotfard webfont usually isn't ready at Start — every layout above was
    // measured with the fallback font. Re-measure once fonts settle so wrapping
    // and the punched glyphs match the real shapes.
    if (document.fonts?.ready) {
        document.fonts.ready.then(() => {
            layoutTabs();
            if (activeTab >= 0) buildActiveTabCards();
        }).catch(() => { /* non-fatal */ });
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
            // Surfacing resets the panel: the scene always comes back to the
            // three scattered titles.
            requestedTab = -1;
            activeTab = -1;
            reveal = 0;
            gather = 0;
            hoverCard = hoverTab = -1;
            hoverLink = false;
            releaseCardSlots();
        }
    }
    if (!_active) return;

    advanceAnimation();
    updateTabs();
    updateTrack();
    updateCards();
    updateQuietRect();
}

// ─── Build ────────────────────────────────────────────────────────────────────

function makePunchMaterial(texture: CanvasTexture): ShaderMaterial {
    // NoBlending + hard alpha-test discard: fragments on ink write (0,0,0,0) +
    // depth (the punch), everything else leaves the scene untouched (the
    // see-through interior).
    return new ShaderMaterial({
        uniforms: { uMask: { value: texture } },
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
}

function makeMaskCanvas(w: number, h: number): { canvas: HTMLCanvasElement; texture: CanvasTexture } {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(4, Math.ceil(w));
    canvas.height = Math.max(4, Math.ceil(h));
    const texture = new CanvasTexture(canvas);
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    return { canvas, texture };
}

function buildTabs(): void {
    for (let i = 0; i < TABS.length; i++) {
        const el = document.createElement('div');
        el.className = 'ocean-tab';
        el.textContent = TABS[i].label;
        el.style.font = blockFont(TAB_SIZE, TAB_WEIGHT, DOM_SS);
        el.style.lineHeight = `${TAB_LINE_H * DOM_SS}px`;
        el.style.height = `${TAB_LINE_H * DOM_SS}px`;
        el.style.letterSpacing = `${TAB_LS * DOM_SS}px`;
        screenEl!.appendChild(el);

        // Sized for real in layoutTabs() once the label has been measured.
        const { canvas, texture } = makeMaskCanvas(4, 4);
        const mesh = new Mesh(new PlaneGeometry(1, 1), makePunchMaterial(texture));
        occluderGroup.add(mesh);

        tabs.push({
            el, mesh, maskCanvas: canvas, maskTexture: texture,
            textW: 0, rowX: 0,
            bobPhase: i * 2.1, rotPhase: i * 1.7 + 0.6,
            scale: 1, cx: 0, cy: 0, rotDeg: 0,
        });
    }
}

function buildCardSlots(): void {
    const maskW = CARD_W + 2 * MASK_MARGIN;
    const maskH = CARD_H + 2 * MASK_MARGIN;
    const planeGeo = new PlaneGeometry(1, 1);

    for (let i = 0; i < MAX_CARDS; i++) {
        const el = document.createElement('div');
        el.className = 'ocean-card';
        el.style.width = `${CARD_W * DOM_SS}px`;
        el.style.height = `${CARD_H * DOM_SS}px`;
        el.style.borderWidth = `${BORDER_PX * DOM_SS}px`;
        el.style.borderRadius = `${CARD_RADIUS * DOM_SS}px`;
        el.style.display = 'none';
        screenEl!.appendChild(el);

        const { canvas, texture } = makeMaskCanvas(maskW, maskH);
        const mesh = new Mesh(planeGeo, makePunchMaterial(texture));
        mesh.visible = false;
        occluderGroup.add(mesh);

        cards.push({
            el, mesh, maskCanvas: canvas, maskTexture: texture, blocks: null,
            bobPhase: Math.random() * Math.PI * 2,
            rotPhase: Math.random() * Math.PI * 2,
            scale: 1, clickPulse: 0,
            xPx: 0, topY: CARDS_TOP_Y, rotDeg: 0, revealScale: 0,
        });
    }
}

function buildUnderline(): void {
    underlineEl = document.createElement('div');
    underlineEl.className = 'ocean-tab-underline';
    underlineEl.style.height = `${TAB_UNDERLINE_H * DOM_SS}px`;
    underlineEl.style.borderRadius = `${TAB_UNDERLINE_H * DOM_SS}px`;
    underlineEl.style.display = 'none';
    screenEl!.appendChild(underlineEl);

    const { canvas, texture } = makeMaskCanvas(4, 4);
    underlineMesh = new Mesh(new PlaneGeometry(1, 1), makePunchMaterial(texture));
    underlineMesh.visible = false;
    underlineMesh.userData.maskCanvas = canvas;
    underlineMesh.userData.maskTexture = texture;
    occluderGroup.add(underlineMesh);
}

/** Measure the labels, place the gathered row and bake the title masks. */
function layoutTabs(): void {
    let rowW = 0;
    for (let i = 0; i < tabs.length; i++) {
        tabs[i].textW = textWidth(TABS[i].label, TAB_SIZE, TAB_WEIGHT, TAB_LS);
        tabs[i].el.style.width = `${tabs[i].textW * DOM_SS}px`;
        rowW += tabs[i].textW;
    }
    rowW += TAB_GAP * (tabs.length - 1);

    let x = -rowW / 2;
    for (const tab of tabs) {
        tab.rowX = x + tab.textW / 2;
        x += tab.textW + TAB_GAP;
    }

    // Underline is baked once at the widest label and scaled down per tab.
    underlineMaskW = Math.max(...tabs.map(t => t.textW));
    if (underlineEl) underlineEl.style.width = `${underlineMaskW * DOM_SS}px`;

    bakeTabMasks();
    bakeUnderlineMask();
}

/** Horizontal squeeze so neither layout runs off a narrow viewport — the
 *  scattered titles are WIDER than the gathered row, so both are measured.
 *  Recomputed per frame; the aspect ratio can change at any time. */
function rowFit(): number {
    let rowW = TAB_GAP * (tabs.length - 1);
    let scatterHalf = 0;
    for (let i = 0; i < tabs.length; i++) {
        rowW += tabs[i].textW;
        scatterHalf = Math.max(scatterHalf, Math.abs(TAB_SCATTER[i].x) + tabs[i].textW / 2);
    }
    const need = Math.max(rowW, scatterHalf * 2);
    const avail = getFrustumHalfWidthPx() * 2 * TAB_ROW_FILL;
    return need > 0 ? Math.min(1, avail / need) : 1;
}

// ─── Tab switching ────────────────────────────────────────────────────────────

function selectTab(index: number): void {
    const next = index === requestedTab ? -1 : index;
    if (next === requestedTab) return;
    requestedTab = next;
    trackOffset = 0;
    momentum = 0;
    hoverCard = -1;
}

/** Swap the DOM + masks over to `activeTab`'s content. Only ever called while
 *  the cards are fully collapsed, so nothing pops. */
function buildActiveTabCards(): void {
    releaseCardSlots();
    if (activeTab < 0) return;

    const data = TAB_CARDS[TABS[activeTab].id];
    cardCount = Math.min(data.length, cards.length);
    if (data.length > cards.length) {
        console.warn(`[CardCarousel] tab "${TABS[activeTab].id}" has ${data.length} cards but only ${cards.length} slots exist`);
    }

    for (let i = 0; i < cardCount; i++) {
        const slot = cards[i];
        slot.blocks = buildLayout(data[i]);
        slot.scale = 1;
        slot.clickPulse = 0;
        renderCardDom(slot);
        bakeCardMask(slot);
        try { renderer.initTexture(slot.maskTexture); } catch { /* pre-GL init */ }
    }

    stripHalfW = ((cardCount - 1) * CARD_SPACING + CARD_W) / 2;
    flushCardRaster();
}

function releaseCardSlots(): void {
    for (const slot of cards) {
        slot.blocks = null;
        slot.el.style.display = 'none';
        slot.el.replaceChildren();
        slot.mesh.visible = false;
        slot.revealScale = 0;
    }
    cardCount = 0;
    stripHalfW = 0;
}

function renderCardDom(slot: CardSlot): void {
    if (!slot.blocks) return;
    slot.el.replaceChildren();
    slot.el.style.display = '';

    for (const b of slot.blocks) {
        if (b.kind === 'line') {
            const bl = document.createElement('div');
            bl.className = 'oc-line';
            bl.style.left = `${b.x * DOM_SS}px`;
            bl.style.top = `${b.y * DOM_SS}px`;
            bl.style.width = `${b.w * DOM_SS}px`;
            bl.style.height = `${b.h * DOM_SS}px`;
            slot.el.appendChild(bl);
            continue;
        }

        if (b.kind === 'rect') {
            const bl = document.createElement('div');
            bl.className = `oc-rect${b.cls ? ` ${b.cls}` : ''}`;
            bl.style.left = `${b.x * DOM_SS}px`;
            bl.style.top = `${b.y * DOM_SS}px`;
            bl.style.width = `${b.w * DOM_SS}px`;
            bl.style.height = `${b.h * DOM_SS}px`;
            bl.style.borderRadius = `${b.radius * DOM_SS}px`;
            if (b.stroke > 0) bl.style.borderWidth = `${b.stroke * DOM_SS}px`;
            if (b.img) {
                const img = document.createElement('img');
                img.src = b.img;
                img.alt = '';
                img.draggable = false;
                bl.appendChild(img);
            }
            slot.el.appendChild(bl);
            continue;
        }

        const bl = document.createElement('div');
        bl.className = `oc-blk${b.cls ? ` ${b.cls}` : ''}`;
        bl.style.left = `${b.x * DOM_SS}px`;
        bl.style.top = `${b.y * DOM_SS}px`;
        bl.textContent = b.text;
        bl.style.font = blockFont(b.size, b.weight, DOM_SS);
        bl.style.lineHeight = `${b.lineH * DOM_SS}px`;
        bl.style.height = `${b.lineH * DOM_SS}px`;
        bl.style.letterSpacing = `${b.ls * DOM_SS}px`;
        bl.style.opacity = `${b.alpha}`;
        slot.el.appendChild(bl);
    }
}

// ─── Animation ────────────────────────────────────────────────────────────────

// easeOutBack — the subtle overshoot that gives the unfold a "pop".
function easeOutBack(t: number): number {
    const c1 = 1.70158, c3 = c1 + 1;
    const x = t - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
}

function smootherstep(t: number): number {
    const x = MathUtils.clamp(t, 0, 1);
    return x * x * x * (x * (x * 6 - 15) + 10);
}

function advanceAnimation(): void {
    // While the user is switching tabs the cards must reach 0 before the DOM is
    // swapped — otherwise the new content pops in at the old content's scale.
    const revealTarget = (requestedTab === activeTab && activeTab >= 0) ? 1 : 0;
    const step = deltaTime / REVEAL_SEC;
    reveal = revealTarget > reveal
        ? Math.min(revealTarget, reveal + step)
        : Math.max(revealTarget, reveal - step);

    if (reveal <= 0 && requestedTab !== activeTab) {
        activeTab = requestedTab;
        buildActiveTabCards();
    }

    // The cards are composited BEHIND the canvas and unfold with transform +
    // opacity alone, which Chrome happily serves from tiles it rastered while
    // they were still scaled down — so the later, more-delayed cards settle at
    // full size showing a blurry small-scale raster. Nothing invalidates paint
    // once the animation stops, so force it once, the frame the unfold lands.
    // (Same failure and same fix as CSS3DPanel.requestRepaint.)
    if (reveal >= 1 && !_revealFlushed) {
        _revealFlushed = true;
        flushCardRaster();
    } else if (reveal < 1) {
        _revealFlushed = false;
    }

    // The titles stay gathered across a tab swap — they only scatter again when
    // everything collapses, so switching tabs never scrambles the row.
    const gatherTarget = requestedTab >= 0 ? 1 : 0;
    const gatherStep = deltaTime / GATHER_SEC;
    gather = gatherTarget > gather
        ? Math.min(gatherTarget, gather + gatherStep)
        : Math.max(gatherTarget, gather - gatherStep);
}

/** Hiding an element and reading a layout property back is a paint
 *  invalidation the compositor cannot batch away; no frame renders between the
 *  two writes, so there is no flash. One-shot only — never per frame. */
function flushCardRaster(): void {
    for (let i = 0; i < cardCount; i++) {
        const el = cards[i].el;
        const prev = el.style.display;
        el.style.display = 'none';
        void el.offsetHeight;
        el.style.display = prev;
    }
}

/** Per-card unfold amount: a staggered slice of the global reveal. */
function cardReveal(i: number): number {
    const span = 1 + CARD_STAGGER * Math.max(0, cardCount - 1);
    return MathUtils.clamp(reveal * span - CARD_STAGGER * i, 0, 1);
}

// ─── Per-frame transforms ─────────────────────────────────────────────────────

function updateTabs(): void {
    const fit = rowFit();
    const align = smootherstep(gather);
    const driftAmp = MathUtils.lerp(TAB_DRIFT_AMP, TAB_GATHERED_AMP, align);

    extentTopPx = Infinity;
    extentBottomPx = -Infinity;

    for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const scatter = TAB_SCATTER[i];
        const isActive = i === requestedTab;

        const bobY = Math.sin(time * BOB_FREQ + tab.bobPhase) * driftAmp;
        // Scattered titles carry their own resting tilt plus a slow sway; both
        // ease out to a level row as they gather.
        const rotDeg = MathUtils.lerp(
            scatter.rot + Math.sin(time * ROT_FREQ + tab.rotPhase) * TAB_DRIFT_TILT,
            Math.sin(time * ROT_FREQ + tab.rotPhase) * ROT_AMP_DEG * 0.5,
            align,
        );

        const cx = MathUtils.lerp(scatter.x, tab.rowX, align) * fit;
        const cy = MathUtils.lerp(scatter.y, -TAB_RISE_PX, align) * fit + bobY;

        const target = (i === hoverTab ? TAB_HOVER_SCALE : (isActive ? TAB_ACTIVE_SCALE : 1)) * fit;
        tab.scale = MathUtils.damp(tab.scale, target, SCALE_SMOOTH, deltaTime);

        tab.cx = cx; tab.cy = cy; tab.rotDeg = rotDeg;

        tab.el.classList.toggle('is-active', isActive);
        tab.el.classList.toggle('is-dimmed', requestedTab >= 0 && !isActive);
        tab.el.style.transform =
            `translate3d(${(cx - tab.textW / 2) * DOM_SS}px, ${(cy - TAB_LINE_H / 2) * DOM_SS}px, 0px) ` +
            `rotate(${rotDeg}deg) scale(${tab.scale})`;

        tab.mesh.position.set(cx / PX_PER_UNIT, -cy / PX_PER_UNIT, 0);
        tab.mesh.rotation.z = -rotDeg * MathUtils.DEG2RAD;
        tab.mesh.scale.set(
            (tab.maskCanvas.width / PX_PER_UNIT) * tab.scale,
            (tab.maskCanvas.height / PX_PER_UNIT) * tab.scale,
            1,
        );
        tab.mesh.visible = true;

        const halfH = (TAB_LINE_H / 2 + TEXT_PAD_MAX + BAND) * fit;
        extentTopPx = Math.min(extentTopPx, cy - halfH);
        extentBottomPx = Math.max(extentBottomPx, cy + halfH + TAB_UNDERLINE_DY * fit * align);
    }

    updateUnderline(fit);
}

function updateUnderline(fit: number): void {
    if (!underlineEl || !underlineMesh) return;

    // The underline rides the ACTIVE title wherever it currently is, so it
    // arrives with the row instead of waiting at the gathered position.
    const active = requestedTab >= 0 ? tabs[requestedTab] : null;
    const targetW = active ? active.textW * 0.72 * smootherstep(gather) : 0;
    underlineW = MathUtils.damp(underlineW, targetW, UNDERLINE_SMOOTH, deltaTime);
    if (active) underlineX = active.cx;

    const sx = underlineMaskW > 0 ? underlineW / underlineMaskW : 0;
    if (sx < 0.01 || !active) {
        underlineEl.style.display = 'none';
        underlineMesh.visible = false;
        return;
    }
    underlineEl.style.display = '';
    underlineMesh.visible = true;

    const cx = underlineX;
    const cy = active.cy + TAB_UNDERLINE_DY * fit;
    underlineEl.style.transform =
        `translate3d(${(cx - underlineMaskW / 2) * DOM_SS}px, ${(cy - TAB_UNDERLINE_H / 2) * DOM_SS}px, 0px) ` +
        `scale(${sx * fit}, ${fit})`;

    const canvas = underlineMesh.userData.maskCanvas as HTMLCanvasElement;
    underlineMesh.position.set(cx / PX_PER_UNIT, -cy / PX_PER_UNIT, 0);
    underlineMesh.scale.set(
        (canvas.width / PX_PER_UNIT) * sx * fit,
        (canvas.height / PX_PER_UNIT) * fit,
        1,
    );
}

function updateTrack(): void {
    const fit = rowFit();
    const halfView = getFrustumHalfWidthPx();
    panLimit = Math.max(0, stripHalfW * fit - halfView + EDGE_PAD);

    if (!dragging) {
        momentum *= Math.exp(-MOMENTUM_DECAY * deltaTime);
        if (Math.abs(momentum) < 12) momentum = 0;
        trackOffset += momentum * deltaTime;

        // Spring back inside the pan limits.
        const clamped = MathUtils.clamp(trackOffset, -panLimit, panLimit);
        if (clamped !== trackOffset) {
            trackOffset = MathUtils.damp(trackOffset, clamped, SPRING_BACK, deltaTime);
            momentum *= 0.5;
        }
    }
}

function updateCards(): void {
    const fit = rowFit();
    const cullPx = getFrustumHalfWidthPx() + CARD_W;
    const velTilt = MathUtils.clamp(
        (dragging ? dragVel : momentum) * VEL_TILT_DEG_PER_PXS,
        -VEL_TILT_MAX_DEG, VEL_TILT_MAX_DEG,
    );
    const centreOffset = (cardCount - 1) * CARD_SPACING / 2;

    for (let i = 0; i < cards.length; i++) {
        const slot = cards[i];
        if (!slot.blocks || i >= cardCount) {
            slot.mesh.visible = false;
            slot.revealScale = 0;
            continue;
        }

        const t = cardReveal(i);
        const revealScale = Math.max(0, easeOutBack(t)) * fit;
        slot.revealScale = revealScale;
        if (revealScale <= 0.004) {
            slot.mesh.visible = false;
            slot.el.style.opacity = '0';
            continue;
        }

        const xPx = (i * CARD_SPACING - centreOffset + trackOffset) * fit;
        slot.xPx = xPx;
        const onScreen = Math.abs(xPx) < cullPx;
        slot.mesh.visible = onScreen;
        if (!onScreen) {
            slot.el.style.opacity = '0';
            continue;
        }

        const bobY = Math.sin(time * BOB_FREQ + slot.bobPhase) * BOB_AMP_PX;
        const rotDeg = Math.sin(time * ROT_FREQ + slot.rotPhase) * ROT_AMP_DEG + velTilt;

        slot.clickPulse = Math.max(0, slot.clickPulse - deltaTime * 3);
        const targetScale = (i === hoverCard ? HOVER_SCALE : 1) + slot.clickPulse * 0.04;
        slot.scale = MathUtils.damp(slot.scale, targetScale, SCALE_SMOOTH, deltaTime);

        const s = revealScale * slot.scale;
        const topY = CARDS_TOP_Y * fit + bobY;

        slot.topY = topY;
        slot.rotDeg = rotDeg;

        // DOM: y-down, rotate() is clockwise on screen, origin at the TOP centre
        // so the card unfolds downward from under the title row.
        slot.el.style.opacity = `${MathUtils.clamp(t * 2.2, 0, 1)}`;
        slot.el.style.transform =
            `translate3d(${(xPx - CARD_W / 2) * DOM_SS}px, ${topY * DOM_SS}px, 0px) ` +
            `rotate(${rotDeg}deg) scale(${s})`;

        // Punch mesh: the DOM pivots about its top centre, so the mesh centre is
        // the pivot plus the scaled half-height rotated by the same angle.
        const rad = rotDeg * MathUtils.DEG2RAD;
        const half = (CARD_H * s) / 2;
        const cx = xPx - half * Math.sin(rad);
        const cy = topY + half * Math.cos(rad);
        slot.mesh.position.set(cx / PX_PER_UNIT, -cy / PX_PER_UNIT, 0);
        slot.mesh.rotation.z = -rad;
        slot.mesh.scale.set(
            (slot.maskCanvas.width / PX_PER_UNIT) * s,
            (slot.maskCanvas.height / PX_PER_UNIT) * s,
            1,
        );

        extentBottomPx = Math.max(extentBottomPx, topY + CARD_H * s + BAND);
        extentTopPx = Math.min(extentTopPx, topY - BAND);
    }
}

// ─── Distortion quiet rect ────────────────────────────────────────────────────

function updateQuietRect(): void {
    // Project the live extent of everything drawn into UV space for the post
    // shader. Keep the rect tight: it damps the underwater distortion to 12%,
    // and any water it covers beyond the ink reads as an unnaturally calm box.
    const fit = rowFit();
    let tabHalfW = 0;
    for (const tab of tabs) tabHalfW = Math.max(tabHalfW, Math.abs(tab.cx) + (tab.textW / 2) * fit);
    const halfW = (Math.max(stripHalfW * fit, tabHalfW + TEXT_PAD_MAX) + MASK_MARGIN) / PX_PER_UNIT;
    const topWorld = -(extentTopPx - 6) / PX_PER_UNIT;
    const botWorld = -(extentBottomPx + 6) / PX_PER_UNIT;

    _proj.set(PLANE_X - halfW, PLANE_Y + botWorld, PLANE_Z).project(camera);
    const x0 = _proj.x, y0 = _proj.y, zNdc = _proj.z;
    _proj.set(PLANE_X + halfW, PLANE_Y + topWorld, PLANE_Z).project(camera);
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

/** Undo a rotate-about-centre transform, giving the point in the box's own
 *  space (origin at that centre). */
function unrotate(dx: number, dy: number, rotDeg: number): { x: number; y: number } {
    const rad = -rotDeg * MathUtils.DEG2RAD;
    const c = Math.cos(rad), s = Math.sin(rad);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
}

function tabIndexAt(local: { x: number; y: number }): number {
    const fit = rowFit();
    for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const p = unrotate(local.x - tab.cx, local.y - tab.cy, tab.rotDeg);
        const halfW = (tab.textW / 2 + HIT_PAD_X) * fit;
        const halfH = (TAB_LINE_H / 2 + HIT_PAD_Y) * fit;
        if (Math.abs(p.x) <= halfW && Math.abs(p.y) <= halfH) return i;
    }
    return -1;
}

/** Plane px → card-box px (0..CARD_W, 0..CARD_H), undoing the card's live
 *  top-centre rotate+scale. Returns null when the point misses the card. */
function cardBoxLocal(slot: CardSlot, local: { x: number; y: number }): { x: number; y: number } | null {
    if (!slot.blocks || slot.revealScale <= 0.004) return null;
    const s = slot.revealScale * slot.scale;
    if (s <= 0.004) return null;

    const p = unrotate(local.x - slot.xPx, local.y - slot.topY, slot.rotDeg);
    const x = p.x / s + CARD_W / 2;
    const y = p.y / s;
    if (x < 0 || x > CARD_W || y < 0 || y > CARD_H) return null;
    return { x, y };
}

function cardIndexAt(local: { x: number; y: number }): number {
    for (let i = 0; i < cardCount; i++) {
        if (cardBoxLocal(cards[i], local)) return i;
    }
    return -1;
}

/** The link under the pointer, if any (a project card's visit label). */
function linkAt(local: { x: number; y: number }): string {
    for (let i = 0; i < cardCount; i++) {
        const slot = cards[i];
        const box = cardBoxLocal(slot, local);
        if (!box || !slot.blocks) continue;
        for (const b of slot.blocks) {
            if (!b.href) continue;
            const w = b.kind === 'text' ? textWidth(b.text, b.size, b.weight, b.ls) + 2 * HIT_PAD_X : b.w;
            const h = b.kind === 'text' ? b.lineH + 2 * HIT_PAD_Y : b.h;
            const bx = b.kind === 'text' ? b.x - HIT_PAD_X : b.x;
            const by = b.kind === 'text' ? b.y - HIT_PAD_Y : b.y;
            if (box.x >= bx && box.x <= bx + w && box.y >= by && box.y <= by + h) return b.href;
        }
    }
    return '';
}

/** Vertical band in which a pointer press may start a drag / hit something. */
function inGrabBand(local: { x: number; y: number }): boolean {
    return local.y >= extentTopPx - 40 && local.y <= extentBottomPx + 40;
}

function onPointerDown(e: PointerEvent): void {
    if (!_active || isChestZoomActive()) return;
    const local = pointerToPlanePx(e.clientX, e.clientY);
    if (!local || !inGrabBand(local)) return;

    dragging = true;
    dragPointerId = e.pointerId;
    dragLastX = local.x;
    dragLastTime = performance.now();
    dragTravel = 0;
    dragVel = 0;
    momentum = 0;
    setCursor(panLimit > 0 ? 'grabbing' : '');
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
        // Past the pan limits the strip resists instead of running away.
        const over = Math.abs(trackOffset) > panLimit
            && Math.sign(dx) === Math.sign(trackOffset);
        trackOffset += over ? dx * RUBBER : dx;
        dragVel = MathUtils.lerp(dragVel, dx / dt, 0.35);
        return;
    }

    // Hover feedback (desktop) — cheap analytic tests, no raycaster.
    if (!_active || e.pointerType === 'touch') return;
    const local = pointerToPlanePx(e.clientX, e.clientY);
    if (!local) {
        hoverTab = hoverCard = -1;
        hoverLink = false;
        setCursor('');
        return;
    }
    hoverTab = tabIndexAt(local);
    hoverCard = hoverTab >= 0 ? -1 : cardIndexAt(local);
    hoverLink = hoverCard >= 0 && !!linkAt(local);

    setCursor(
        hoverTab >= 0 || hoverLink ? 'pointer'
            : (panLimit > 0 && inGrabBand(local) ? 'grab' : ''),
    );
}

function onPointerUp(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = -1;

    if (dragTravel < DRAG_CLICK_SLOP) {
        momentum = 0;
        const local = pointerToPlanePx(e.clientX, e.clientY);
        if (local) {
            const tab = tabIndexAt(local);
            if (tab >= 0) {
                selectTab(tab);
            } else {
                const href = linkAt(local);
                if (href) {
                    window.open(href, '_blank', 'noopener,noreferrer');
                } else {
                    const idx = cardIndexAt(local);
                    if (idx >= 0) cards[idx].clickPulse = 1;
                }
            }
        }
    } else {
        momentum = MathUtils.clamp(dragVel, -MAX_FLING, MAX_FLING);
    }
    setCursor(hoverTab >= 0 || hoverLink ? 'pointer' : (panLimit > 0 ? 'grab' : ''));
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

function getFrustumHalfWidthPx(): number {
    const dist = Math.abs(camera.position.z - PLANE_Z);
    const halfH = Math.tan(MathUtils.degToRad(camera.fov) / 2) * dist;
    return halfH * camera.aspect * PX_PER_UNIT;
}

// ─── Punch mask baking ────────────────────────────────────────────────────────

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

function bakeCardMask(slot: CardSlot): void {
    const ctx = slot.maskCanvas.getContext('2d');
    if (!ctx || !slot.blocks) return;

    ctx.clearRect(0, 0, slot.maskCanvas.width, slot.maskCanvas.height);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineJoin = 'round';

    const off = MASK_MARGIN;

    // Border band — stroke centred on the card border line, fat enough to
    // reveal the DOM box-shadow glow on both sides.
    roundRectPath(ctx, off + 1, off + 1, CARD_W - 2, CARD_H - 2, CARD_RADIUS - 1);
    ctx.lineWidth = BORDER_PX + 2 * BAND;
    ctx.stroke();

    for (const b of slot.blocks) {
        if (b.kind === 'line') {
            roundRectPath(
                ctx,
                off + b.x - LINE_PAD, off + b.y - LINE_PAD,
                b.w + 2 * LINE_PAD, b.h + 2 * LINE_PAD,
                LINE_PAD + 1,
            );
            ctx.fill();
        } else if (b.kind === 'rect') {
            if (b.stroke > 0) {
                roundRectPath(ctx, off + b.x, off + b.y, b.w, b.h, b.radius);
                ctx.lineWidth = b.stroke + 2 * BAND;
                ctx.lineJoin = 'round';
                ctx.stroke();
            } else {
                roundRectPath(
                    ctx,
                    off + b.x - RECT_PAD, off + b.y - RECT_PAD,
                    b.w + 2 * RECT_PAD, b.h + 2 * RECT_PAD,
                    b.radius + RECT_PAD,
                );
                ctx.fill();
            }
        } else {
            punchText(
                ctx, b.text, off + b.x, off + b.y, b.lineH,
                b.size, b.weight, b.ls, textPadFor(b.size) * b.padMul,
            );
        }
    }

    slot.maskTexture.needsUpdate = true;
}

/** Title / underline canvases are sized once from the label metrics; only a
 *  re-measure (webfont load) may resize them, and that disposes properly.
 *  Growing a canvas forces a GPU texture re-allocation, and re-uploading a
 *  grown canvas into a smaller texture is the "glCopySubTextureCHROMIUM: Offset
 *  overflows texture dimensions" failure CSS3DPanel documents. */
function bakeTabMasks(): void {
    for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const cw = Math.ceil(tab.textW + 2 * TEXT_PAD_MAX + 2 * MASK_MARGIN);
        const ch = Math.ceil(TAB_LINE_H + 2 * TEXT_PAD_MAX + 2 * MASK_MARGIN);
        if (tab.maskCanvas.width !== cw || tab.maskCanvas.height !== ch) {
            tab.maskCanvas.width = cw;
            tab.maskCanvas.height = ch;
            tab.maskTexture.dispose();
        }
        const ctx = tab.maskCanvas.getContext('2d');
        if (!ctx) continue;
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#fff';
        punchText(
            ctx, TABS[i].label,
            (cw - tab.textW) / 2, (ch - TAB_LINE_H) / 2, TAB_LINE_H,
            TAB_SIZE, TAB_WEIGHT, TAB_LS, textPadFor(TAB_SIZE),
        );
        tab.maskTexture.needsUpdate = true;
    }
}

function bakeUnderlineMask(): void {
    if (!underlineMesh) return;
    const canvas = underlineMesh.userData.maskCanvas as HTMLCanvasElement;
    const texture = underlineMesh.userData.maskTexture as CanvasTexture;
    const cw = Math.ceil(underlineMaskW + 2 * LINE_PAD + 2 * MASK_MARGIN);
    const ch = Math.ceil(TAB_UNDERLINE_H + 2 * LINE_PAD + 2 * MASK_MARGIN);
    if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
        texture.dispose();
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#fff';
    const pw = underlineMaskW + 2 * LINE_PAD;
    const ph = TAB_UNDERLINE_H + 2 * LINE_PAD;
    roundRectPath(ctx, (cw - pw) / 2, (ch - ph) / 2, pw, ph, LINE_PAD + 1);
    ctx.fill();
    texture.needsUpdate = true;
}

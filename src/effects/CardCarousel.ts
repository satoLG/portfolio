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
 *      alpha MASK dissolves the canvas ONLY where there is ink (border strokes,
 *      glyphs, image boxes), slightly dilated. The canvas becomes transparent at
 *      those pixels and the crisp DOM shows through. The mask's alpha is the
 *      punch STRENGTH, not a binary stencil: 1 erases the canvas outright (the
 *      original all-or-nothing hole), anything less leaves that fraction of the
 *      rendered scene sitting on top of the DOM — see inkPunchText below.
 *   3. Card interiors are NOT punched, so the live 3D scene (water, fish behind
 *      the plane) stays visible through the cards — they read as border-only
 *      floating glass frames. Image boxes ARE punched solid, because their DOM
 *      is the thing you're meant to see.
 *   4. The punch planes write depth: WebGL objects BEHIND the plane are occluded
 *      at FULLY punched ink (the card's border, its images), while objects IN
 *      FRONT are drawn over the holes (fish swim over the cards). Where the ink
 *      is only partly punched the creatures behind survive, dimmed, inside it.
 *      NOTE: the punch group is added to the scene AFTER genericFishContainer
 *      and rides in the post-ocean transparents pass (Scene.ts,
 *      getUnderwaterTransparentTargets) — sortObjects is false, so add-order is
 *      draw order, and the punch has to come last or it dissolves a framebuffer
 *      the fish have not been drawn into yet.
 *   5. The underwater post-process distortion would displace the punched holes
 *      while the DOM behind stays still, shearing the ink. PostProcess exposes a
 *      "quiet rect" (setDistortionQuietRect) that damps distortion over the
 *      carousel strip; the residual wobble stays inside the mask dilation.
 *
 * SURFACE BUDGET — the reason cards come and go from the DOM. Everything in the
 * CSS3D scene sits under `transform-style: preserve-3d`, and a browser gives
 * every element in such a subtree its OWN composited render surface: the full
 * element, backed at device resolution, with none of the tiling or viewport
 * clipping that keeps ordinary page layers cheap. A card is CARD_W·DOM_SS ×
 * CARD_H·DOM_SS, so its surface costs that × devicePixelRatio² — tens to
 * hundreds of MB apiece on a phone. Two rules keep the total survivable:
 *
 *   • A card is in layout ONLY while it is on screen and revealed. Off-screen,
 *     collapsed and unused slots are display:none, not merely transparent —
 *     opacity 0 still owns the surface (see hideCardEl).
 *   • DOM_SS is smaller on phones, which is a QUADRATIC saving (see DOM_SS).
 *
 * The same budget is why the DOM and the punch mask are built per card, one card
 * per frame, as each reaches the viewport (materialiseCard) rather than for the
 * whole tab inside the frame that handled the tap.
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
    AddEquation,
    CanvasTexture,
    CustomBlending,
    DoubleSide,
    Group,
    LinearFilter,
    MathUtils,
    Mesh,
    OneMinusSrcAlphaFactor,
    PlaneGeometry,
    Scene as ThreeScene,
    ShaderMaterial,
    Uniform,
    Vector3,
    ZeroFactor,
} from 'three';
// Runtime-only access (function bodies) — Scene/Control/Fish all sit on the same
// import cycle this project already uses (see the alias note in Fish.ts).
import { CSS_SCALE, camera, renderer } from '../core/Scene';
import { getIsUnderwater, isChestZoomActive, scrollCameraToY } from '../core/Control';
import { getDeviceInfo } from '../core/DeviceCapability';
import { deltaTime, time } from '../core/Time';
import { setDistortionQuietRect } from './PostProcess';
import { onLanguageChange } from '../core/i18n';
import {
    CardData,
    DEFAULT_CERT_CTA,
    EntryCard,
    MAX_CARDS,
    PROJECTS,
    ProjectCard,
    TABS,
    TAB_CARDS,
    text,
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
//
// IT IS ALSO A QUADRATIC MEMORY TERM, which is why phones get a smaller one.
// The carousel DOM lives in a `transform-style: preserve-3d` subtree, so the
// browser hands EVERY card its own composited render surface — no tiling, no
// clipping to the viewport, the whole element is backed. One card costs
// (CARD_W·DOM_SS)×(CARD_H·DOM_SS)×devicePixelRatio² bytes: at DOM_SS 4 on a
// DPR-3 phone that is ~130MB per card, and a five-card tab (Experiência,
// Estudos) asks for ~650MB in one frame. iOS kills the tab — the "forced
// reload" and the browser's own "can't open this page".
//
// At DOM_SS 2 a card is 820 DOM px wide while it draws ~180 CSS px ≈ 540 device
// px on a phone, so the DOM is still supersampled and nothing softens, but the
// surfaces drop 4×. Desktop keeps 4: memory is not the constraint there and the
// cards are magnified far more.
const DOM_SS = getDeviceInfo().mobile ? 2 : 4;

// ── Card geometry (design px) ────────────────────────────────────────────────
// EVERY card is exactly this size, on every tab. The project card — icon, name,
// description, screenshot, link — is the tallest thing the carousel has to show,
// so it sets the height and the shorter entry cards distribute into it: header
// pinned to the top, description pinned to the bottom, water in between.
// CARD_PAD is the inset of the TEXT BOX, not of the ink: every line is punched
// as a pill that reaches PILL_PAD_X/Y further out, so the pad has to clear the
// pill AND the border's own punch band (BAND) or the two holes merge and the
// text appears to hang off the frame. Pad = PILL_PAD_X + BAND + a little air.
const CARD_W = 442;
const CARD_H = 600;
const CARD_RADIUS = 26;
const BORDER_PX = 2;
const CARD_PAD = 48;                 // card box inset for all content

// Punch dilation: how far (px) the alpha hole extends past the ink. Must cover
// (a) the DOM glow so it isn't hard-clipped and (b) the residual post-process
// distortion inside the quiet rect (damped to 12% there, so a few px covers it).
//
// These are DELIBERATELY MODE-INDEPENDENT. An earlier version widened them at
// night to give the neon more room, but the hole shows whatever is behind the
// canvas, so growing it made a visibly fatter dark outline appear around every
// letter the moment night fell. The geometry has to hold still; only the DOM
// glow changes between day and night.
const BAND = 12;             // punch band each side of a stroke (card border)
const LINE_PAD = 8;          // divider-line punch pad
const RECT_PAD = 6;          // filled-box (image) punch pad

// Text is punched as a generous rounded PILL around each line — the roomy halo
// the design wants. The pads are also written to --oc-pill-x/y on each element
// for anything that needs to line up with the punched rect.
const PILL_PAD_X = 20;
const PILL_PAD_Y = 14;

// ── Ink transparency (how hard each kind of ink dissolves the canvas) ─────────
// The mask's alpha IS the punch strength (see makePunchMaterial): the canvas is
// multiplied by (1 - alpha) there, so
//
//   1.0 → the canvas is erased outright. The pixel is 100% DOM, composited on
//         whatever paints behind the canvas (--ink-water, see style.css).
//   0.7 → 30% of the LIVE rendered scene stays on top of the DOM: the ink reads
//         as tinted glass you can actually see the water move through, instead
//         of a flat chip of page background.
//
// What is behind the plane is still occluded (the punch writes depth), so what
// shows through is the water/godrays/floor in FRONT of the panel's depth, plus
// anything nearer to the camera drawn after it. That is the honest limit of the
// technique: the canvas can only be dissolved, never re-ordered under the DOM.
//
// Text pills are the only ink that goes translucent by default. Structural ink
// stays at full punch: image boxes ARE the content (a photo at 60% over ink is
// mud), and the hairline border/divider strokes need every bit of contrast they
// have. Both are live-tunable (see setInkPunch) because the right amount is a
// legibility judgement that has to be made against the real water, on a real
// screen — the masks are re-baked on change.
let inkPunchText = 0.55;
let inkPunchSolid = 1.0;

/** Current ink punch strengths (text, solid) — 1 = opaque ink, 0 = no punch. */
export function getInkPunch(): { text: number; solid: number } {
    return { text: inkPunchText, solid: inkPunchSolid };
}

/** Set how hard each kind of ink dissolves the canvas and re-bake every live
 *  mask. Cheap enough to drive from a slider: a handful of 2D canvas fills plus
 *  a texture upload per card on screen. */
export function setInkPunch(text: number, solid: number): void {
    inkPunchText = MathUtils.clamp(text, 0, 1);
    inkPunchSolid = MathUtils.clamp(solid, 0, 1);
    bakeTabMasks();
    bakeUnderlineMask();
    for (const slot of cards) {
        if (slot.blocks && slot.built) bakeCardMask(slot);
    }
}

// Master multiplier over every mask, so the whole effect can be dialled from one
// place (1 = use the per-ink values above, 0 = no punch at all). Shared Uniform
// instance — every punch material references it, so a write is live everywhere
// with no re-bake at all.
const punchStrengthUniform = new Uniform(1.0);

/** Global ink-transparency scale (0..1) — multiplies every punch, including the
 *  solid ink. Instant (no re-bake), so it is the knob to sweep when you want to
 *  see the whole effect move at once. */
export function setInkPunchStrength(v: number): void {
    punchStrengthUniform.value = MathUtils.clamp(v, 0, 1);
}
const BTN_PILL_MUL = 0.78;   // tighter pill for a link label, so it reads as a
                             // lit word rather than a slab

// Hit targets do NOT follow the punch: a tap area stays forgiving regardless.
const HIT_PAD_X = 18;
const HIT_PAD_Y = 12;

const MASK_MARGIN = BAND + 4;   // canvas margin around the card box

// ── Titles (design px) ───────────────────────────────────────────────────────
const TAB_SIZE = 44;
const TAB_WEIGHT = 600;
const TAB_LS = 1.6;
const TAB_LINE_H = 58;
const TAB_GAP = 84;                  // px between titles once gathered
// Gathered row's height above the strip centre. Together with CARDS_TOP_Y this
// sets the clearance between the row and the cards below it: the title pill
// reaches ~43px under its centre and the underline another ~48, so the raw gap
// (TAB_RISE_PX + CARDS_TOP_Y) needs a comfortable margin on top of that before
// the card's own border band starts.
const TAB_RISE_PX = 300;
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
const CARDS_TOP_Y = -160;            // top edge of every card, relative to PLANE_Y
const CARD_SPACING = 522;            // px between card centres (CARD_W + 80 gap)
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

type BlockKind = 'text' | 'line' | 'rect' | 'icons';

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
    // icons — one ROW of technology glyphs, punched as a single pill so the row
    // reads as one bar of ink rather than a scatter of little holes.
    icons: string[];
}

function block(b: Partial<Block> & { kind: BlockKind }): Block {
    return {
        x: CARD_PAD, y: 0, w: 0, h: 0,
        text: '', size: 15, weight: 400, ls: 0, lineH: 20, alpha: 0.85,
        padMul: 1,
        radius: 0, img: '', stroke: 0, cls: '', href: '', icons: [],
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

/** Append one line of text's rounded pill to the CURRENT path (no beginPath, no
 *  fill). `top` is the block's top edge in canvas px.
 *
 *  Callers add every pill of a mask to one path and fill it ONCE at
 *  inkPunchText. Filling them individually at a partial alpha would compound
 *  where two pills overlap (0.72 over 0.72 → 0.92), printing a brighter, harder
 *  patch between two close lines; a single nonzero-winding fill covers the union
 *  exactly once. Solid ink already in the mask is safe either way — source-over
 *  with dst alpha 1 stays at 1. */
function addTextPillPath(
    ctx: CanvasRenderingContext2D, text: string,
    x: number, top: number, lineH: number,
    size: number, weight: number, ls: number, padX: number, padY: number,
): void {
    const w = textWidth(text, size, weight, ls);
    const ph = lineH + 2 * padY;
    roundRectSubPath(ctx, x - padX, top - padY, w + 2 * padX, ph, ph / 2);
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

const ICON_BOX = 56;                 // icon / monogram square, shared by both layouts
const ICON_GAP = 16;
const HEAD_Y = 50;

// Technology tags (Experiência). Glyph only, in the brand's own colour — see
// scripts/generate-tech-icons.cjs. Laid out in rows that each punch ONE pill, so
// a stack reads as a bar of ink rather than a row of separate little holes.
const TECH_BOX = 40;
const TECH_GAP = 14;
const TECH_ROW_GAP = 12;

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
    const size = mono.length > 1 ? 24 : 28;
    const w = textWidth(mono, size, 600, 1);
    blocks.push(block({
        kind: 'text', text: mono,
        x: CARD_PAD + (ICON_BOX - w) / 2,
        y: HEAD_Y + (ICON_BOX - 34) / 2,
        size, weight: 600, ls: 1, lineH: 34, alpha: 0.95, padMul: 0.7,
    }));
}

/** Split the stack into rows that fit `innerW`, and emit one 'icons' block per
 *  row. Rows are separate blocks (rather than one grid block) so a half-full
 *  last row punches a pill around ITS glyphs instead of leaving a slab of empty
 *  ink hanging off the end. Returns the total height consumed. */
function pushTechRows(blocks: Block[], tech: string[], innerW: number, top: number): number {
    if (!tech.length) return 0;
    const perRow = Math.max(1, Math.floor((innerW + TECH_GAP) / (TECH_BOX + TECH_GAP)));
    let y = top;
    for (let i = 0; i < tech.length; i += perRow) {
        const row = tech.slice(i, i + perRow);
        blocks.push(block({
            kind: 'icons', icons: row,
            x: CARD_PAD, y,
            w: row.length * TECH_BOX + (row.length - 1) * TECH_GAP,
            h: TECH_BOX,
            radius: TECH_BOX / 2,
        }));
        y += TECH_BOX + TECH_ROW_GAP;
    }
    return y - TECH_ROW_GAP - top;
}

/** Chronological entry — Experiência and Estudos. Header (icon + institution,
 *  credential, subject, period, divider) pinned to the top, description pinned
 *  to the BOTTOM so every card ends on the same line regardless of how much text
 *  it carries. The stack tags, when there are any, float in the band the two
 *  leave between them. */
function buildEntryLayout(e: EntryCard): Block[] {
    const blocks: Block[] = [];
    const innerW = CARD_W - 2 * CARD_PAD;

    pushIconBlocks(blocks, e.icon ?? '', e.mono ?? e.heading.slice(0, 1).toUpperCase(), 'oc-logo');

    const headX = CARD_PAD + ICON_BOX + ICON_GAP;
    const headLines = wrapText(e.heading, 33, 600, 0.2, CARD_W - CARD_PAD - headX);
    let hy = Math.max(HEAD_Y - 10, HEAD_Y + (ICON_BOX - headLines.length * 42) / 2);
    for (const line of headLines) {
        blocks.push(block({ kind: 'text', text: line, x: headX, y: hy, size: 33, weight: 600, ls: 0.2, lineH: 42, alpha: 0.98 }));
        hy += 42;
    }

    let y = Math.max(HEAD_Y + ICON_BOX, hy) + 22;

    // Estudos: what KIND of study this is, as its own tag and LOUDER than the
    // subject beneath it — uppercase, heavy, widely tracked. A course and a
    // degree look nothing alike at a glance, which is the whole point of it.
    if (e.credential) {
        const label = text(e.credential).toUpperCase();
        blocks.push(block({
            kind: 'text', text: label, y,
            size: 21, weight: 700, ls: 3.4, lineH: 29, alpha: 1, padMul: 0.86,
        }));
        y += 29 + 12;
    }

    for (const line of wrapText(text(e.subheading), 20, 500, 0.3, innerW)) {
        blocks.push(block({ kind: 'text', text: line, y, size: 20, weight: 500, ls: 0.3, lineH: 28, alpha: 0.88 }));
        y += 28;
    }
    y += 6;

    const period = text(e.period);
    if (period) {
        blocks.push(block({ kind: 'text', text: period, y, size: 16, weight: 500, ls: 2.2, lineH: 22, alpha: 0.68 }));
        y += 22;
    }
    y += 22;

    blocks.push(block({ kind: 'line', y, w: 64, h: 2 }));

    // Bottom-anchored description — the "no fim do card" of the original brief,
    // and what keeps every entry card ending on the same line. The header above
    // is variable (a long institution name can run to three lines), so the run
    // is clipped to the gap left under the divider rather than allowed to grow
    // up into it.
    const BODY_SIZE = 19, BODY_LINE_H = 27;
    // The credential link, when there is one, owns the bottom of the card and
    // the description stacks above it — same anchor either way, so every card
    // still ends on the same line.
    let bodyBottom = 62;
    if (e.url) {
        const label = `${text(e.cta ?? DEFAULT_CERT_CTA)}  →`;
        const labelW = textWidth(label, 17, 600, 2.2);
        blocks.push(block({
            kind: 'text', text: label, x: (CARD_W - labelW) / 2, y: CARD_H - 54 - 24,
            size: 17, weight: 600, ls: 2.2, lineH: 24, alpha: 0.95,
            padMul: BTN_PILL_MUL, href: e.url,
        }));
        bodyBottom = 54 + 24 + 26;
    }

    const bodyTopLimit = y + 28;
    const maxLines = Math.max(0, Math.floor((CARD_H - bodyBottom - bodyTopLimit) / BODY_LINE_H));
    const bodyLines = wrapText(text(e.body), BODY_SIZE, 400, 0.2, innerW).slice(0, maxLines);

    const bodyTop = CARD_H - bodyBottom - bodyLines.length * BODY_LINE_H;
    let by = bodyTop;
    for (const line of bodyLines) {
        blocks.push(block({ kind: 'text', text: line, y: by, size: BODY_SIZE, weight: 400, ls: 0.2, lineH: BODY_LINE_H, alpha: 0.82 }));
        by += BODY_LINE_H;
    }

    // The stack, centred in whatever band the header and the description leave
    // free. Measured first so it can be centred, then placed — an empty stack
    // (the IFSP monitoring role) simply leaves the band empty.
    const tech = e.tech ?? [];
    if (tech.length) {
        const probe: Block[] = [];
        const gridH = pushTechRows(probe, tech, innerW, 0);
        const bandTop = bodyTopLimit;
        const bandBottom = bodyTop - 16;
        if (bandBottom - bandTop >= gridH) {
            pushTechRows(blocks, tech, innerW, bandTop + (bandBottom - bandTop - gridH) / 2);
        }
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
    const nameLines = wrapText(text(p.name), 30, 600, 0.2, CARD_W - CARD_PAD - nameX);
    let ny = Math.max(HEAD_Y - 8, HEAD_Y + (ICON_BOX - nameLines.length * 39) / 2);
    for (const line of nameLines) {
        blocks.push(block({ kind: 'text', text: line, x: nameX, y: ny, size: 30, weight: 600, ls: 0.2, lineH: 39, alpha: 0.98 }));
        ny += 39;
    }

    // Bottom-up: link label, screenshot above it, divider above that. The shot
    // gives up height to the larger type — it is a crop either way, and losing
    // a slice of it costs less than truncating the description.
    const LABEL_H = 24, SHOT_H = 176;
    const labelY = CARD_H - 54 - LABEL_H;
    const shotY = labelY - 26 - SHOT_H;
    const dividerY = shotY - 22;

    let y = Math.max(HEAD_Y + ICON_BOX, ny) + 26;
    for (const line of wrapText(text(p.body), 19, 400, 0.2, innerW)) {
        if (y + 27 > dividerY - 14) break;   // never collide with the image section
        blocks.push(block({ kind: 'text', text: line, y, size: 19, weight: 400, ls: 0.2, lineH: 27, alpha: 0.82 }));
        y += 27;
    }

    blocks.push(block({ kind: 'line', y: dividerY, w: innerW, h: 2 }));
    blocks.push(block({
        kind: 'rect', x: CARD_PAD, y: shotY, w: innerW, h: SHOT_H,
        radius: 16, img: p.shot, cls: 'oc-shot',
    }));

    // The link is TEXT ONLY — no button chrome. Its tap area comes from HIT_PAD.
    const label = `${text(p.cta)}  →`;
    const labelW = textWidth(label, 17, 600, 2.2);
    blocks.push(block({
        kind: 'text', text: label, x: (CARD_W - labelW) / 2, y: labelY,
        size: 17, weight: 600, ls: 2.2, lineH: LABEL_H, alpha: 0.95,
        padMul: BTN_PILL_MUL, href: p.url,
    }));

    return blocks;
}

function buildLayout(c: CardData): Block[] {
    const blocks = c.kind === 'project' ? buildProjectLayout(c) : buildEntryLayout(c);
    warnIfOverflowing(blocks, c.kind === 'project' ? text(c.name) : c.heading);
    return blocks;
}

/** Every card is a fixed box, so content that outgrows it is silently clipped by
 *  the punch mask rather than pushing anything — which is exactly the kind of
 *  thing you only notice on a device you don't own. Say it out loud instead.
 *  Text is measured, not estimated, so this catches wrapping surprises too. */
function warnIfOverflowing(blocks: Block[], label: string): void {
    for (const b of blocks) {
        const bottom = b.y + (b.kind === 'text' ? b.lineH : b.h);
        const right = b.x + (b.kind === 'text' ? textWidth(b.text, b.size, b.weight, b.ls) : b.w);
        if (bottom > CARD_H - 2 || right > CARD_W - 2 || b.x < 2 || b.y < 2) {
            console.warn(
                `[CardCarousel] "${label}": block ${JSON.stringify(b.text || b.cls || b.kind)} ` +
                `spills the ${CARD_W}x${CARD_H} card (x ${b.x.toFixed(0)}..${right.toFixed(0)}, ` +
                `y ${b.y.toFixed(0)}..${bottom.toFixed(0)})`,
            );
        }
    }
}

// ─── INTERNALS ────────────────────────────────────────────────────────────────

interface CardSlot {
    el: HTMLDivElement;
    mesh: Mesh;
    maskCanvas: HTMLCanvasElement;
    maskTexture: CanvasTexture;
    blocks: Block[] | null;         // null → slot unused by the active tab
    built: boolean;                 // DOM + punch mask match `blocks` (see materialiseCard)
    shown: boolean;                 // element is in layout, i.e. holds a render surface
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
let snapTrackLeft = false;          // pending "park at the left end" (see updateTrack)

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
    screenEl.style.setProperty('--oc-pill-x', `${PILL_PAD_X * DOM_SS}px`);
    screenEl.style.setProperty('--oc-pill-y', `${PILL_PAD_Y * DOM_SS}px`);
    // Everything in the stylesheet that must hold a fixed DESIGN size — the glow
    // radii, the divider, the icon letterbox — is authored as design px × this.
    screenEl.style.setProperty('--oc-ss', `${DOM_SS}`);

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

    // Switching language rewrites every string on every card, so the copy has to
    // be re-wrapped and the punch masks re-baked against the new text — the DOM
    // and its holes are one measurement, and translated copy is a different
    // length. data-i18n can't do this: none of it is plain document text.
    // Titles are re-measured too, which is what re-centres the gathered row.
    onLanguageChange(() => {
        layoutTabs();
        // Re-measure without disturbing which tab is open or where it is panned.
        if (activeTab >= 0) {
            const keepOffset = trackOffset;
            buildActiveTabCards();
            snapTrackLeft = false;
            trackOffset = keepOffset;
        }
    });

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
    // The punch DISSOLVES the canvas by the mask's alpha instead of stencilling
    // it away. Blending is dst *= (1 - src.a) on colour AND alpha (Zero /
    // OneMinusSrcAlpha), which keeps the premultiplied-alpha canvas consistent:
    // at alpha 1 the destination becomes (0,0,0,0) — bit-for-bit the old
    // NoBlending hole — and at 0.72 it keeps 28% of the rendered scene, which
    // the browser then composites OVER the DOM. That residual is the whole
    // point: the ink stops being a flat chip of page background and becomes
    // glass with the water still moving inside it.
    //
    // Depth still writes, so the front/behind relationship with the fish is
    // exactly as before. Where two punch planes overlap, the nearer one wins the
    // depth test rather than both multiplying, so the effect never compounds.
    return new ShaderMaterial({
        uniforms: { uMask: { value: texture }, uPunch: punchStrengthUniform },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform sampler2D uMask;
            uniform float uPunch;
            varying vec2 vUv;
            void main() {
                float m = texture2D(uMask, vUv).a * uPunch;
                // Discard rather than write a no-op: a zero-alpha fragment would
                // still write DEPTH and occlude the scene for nothing.
                if (m < 0.004) discard;
                gl_FragColor = vec4(0.0, 0.0, 0.0, m);
            }
        `,
        blending: CustomBlending,
        blendEquation: AddEquation,
        blendSrc: ZeroFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendEquationAlpha: AddEquation,
        blendSrcAlpha: ZeroFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
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
        el.textContent = text(TABS[i].label);
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
            built: false, shown: false,
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
        tabs[i].el.textContent = text(TABS[i].label);
        tabs[i].textW = textWidth(text(TABS[i].label), TAB_SIZE, TAB_WEIGHT, TAB_LS);
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
    hoverCard = -1;
    // The strip is deliberately LEFT WHERE THE USER PUT IT — trackOffset and the
    // fling momentum are NOT reset here. Resetting them made the cards slide
    // back to the centred position before folding away, on every tab switch and
    // every collapse, which read as the carousel changing itself. The pan only
    // ever resets when a tab is (re)opened, and it does that in
    // buildActiveTabCards → snapTrackLeft: at reveal 0, with nothing on screen.

    // Opening a tab brings the row up under the page header, so the cards unfold
    // into the viewport instead of below it.
    if (next >= 0) scrollCameraToY(tabFocusCameraY());
}

// The gathered title row should come to rest just under the page header, so the
// cards below it get the rest of the viewport. Anything more than this and the
// row is off the top; anything less and the cards run off the bottom.
const TAB_FOCUS_GAP_PX = 16;      // CSS px of air between header and title row
const TAB_FOCUS_FALLBACK_HEADER = 64;

/** Camera Y that puts the TOP of the gathered title row `TAB_FOCUS_GAP_PX`
 *  below the site header. The camera is level in normal (web-page) mode, so a
 *  world point at the strip's depth maps to the viewport linearly: the row's top
 *  should land at the screen fraction the header occupies. */
function tabFocusCameraY(): number {
    const fit = rowFit();
    // Titles gather at -TAB_RISE_PX (y-down design px from the strip centre);
    // their punched pill reaches half a line plus the pill pad above that.
    const topPx = (TAB_RISE_PX + TAB_LINE_H / 2 + PILL_PAD_Y) * fit;
    const worldTop = PLANE_Y + topPx / PX_PER_UNIT;

    const viewH = renderer.domElement.getBoundingClientRect().height || window.innerHeight;
    const header = document.querySelector('.site-header') as HTMLElement | null;
    const headerH = header?.getBoundingClientRect().height || TAB_FOCUS_FALLBACK_HEADER;
    // Screen fraction from the top of the viewport, capped so a tall header (or a
    // short window) can never push the row past the middle of the screen.
    const f = MathUtils.clamp((headerH + TAB_FOCUS_GAP_PX) / viewH, 0, 0.4);

    const dist = Math.abs(camera.position.z - PLANE_Z);
    const halfH = Math.tan(MathUtils.degToRad(camera.fov) / 2) * dist;
    return worldTop - (1 - 2 * f) * halfH;
}

/** Swap the carousel over to `activeTab`'s content. Only ever called while the
 *  cards are fully collapsed, so nothing pops.
 *
 *  Only the LAYOUT is computed here — measuring and wrapping the text, which the
 *  hit tests and the strip width need for every card whether it is on screen or
 *  not. Building the DOM and baking the punch mask is deferred to
 *  materialiseCard(), one card per frame, as each card actually reaches the
 *  viewport. Doing all of it here is what made the tab tap block: it is a full
 *  DOM build plus a mask bake plus a texture upload for every card in the tab,
 *  inside one frame, at the exact moment the user is waiting for a response. */
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
        slot.built = false;
        slot.scale = 1;
        slot.clickPulse = 0;
    }

    stripHalfW = ((cardCount - 1) * CARD_SPACING + CARD_W) / 2;
    // Park at the left end once updateTrack knows the pan limit for this strip
    // (it needs stripHalfW, which only exists now).
    snapTrackLeft = true;
}

/** Give a slot its DOM and its punch mask. Costed at one card per frame by
 *  updateCards, so a five-card tab spreads over five frames instead of one. */
function materialiseCard(slot: CardSlot): void {
    if (slot.built || !slot.blocks) return;
    renderCardDom(slot);
    bakeCardMask(slot);
    try { renderer.initTexture(slot.maskTexture); } catch { /* pre-GL init */ }
    slot.built = true;
}

/** Take a card OUT OF LAYOUT (not merely transparent). Inside a preserve-3d
 *  subtree a laid-out card owns a full-size composited render surface even when
 *  its opacity is 0 and it sits far off screen — display:none is what actually
 *  hands that memory back. This is the difference between one open tab holding
 *  every card's surface at once and holding only the two or three the viewport
 *  can show. */
function hideCardEl(slot: CardSlot): void {
    if (!slot.shown) return;
    slot.shown = false;
    slot.el.style.display = 'none';
}

function showCardEl(slot: CardSlot): void {
    if (slot.shown) return;
    slot.shown = true;
    slot.el.style.display = '';
}

function releaseCardSlots(): void {
    for (const slot of cards) {
        slot.blocks = null;
        slot.built = false;
        hideCardEl(slot);
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

        if (b.kind === 'icons') {
            const row = document.createElement('div');
            row.className = 'oc-techs';
            row.style.left = `${b.x * DOM_SS}px`;
            row.style.top = `${b.y * DOM_SS}px`;
            row.style.height = `${b.h * DOM_SS}px`;
            row.style.gap = `${TECH_GAP * DOM_SS}px`;
            for (const slug of b.icons) {
                const img = document.createElement('img');
                img.className = 'oc-tech';
                img.src = `/images/tech/${slug}.svg`;
                img.alt = slug;
                img.draggable = false;
                img.style.width = `${TECH_BOX * DOM_SS}px`;
                img.style.height = `${TECH_BOX * DOM_SS}px`;
                row.appendChild(img);
            }
            slot.el.appendChild(row);
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
        // Single measurement: the pool the DOM paints is exactly the pill the
        // mask punched.
        bl.style.setProperty('--oc-pill-x', `${PILL_PAD_X * b.padMul * DOM_SS}px`);
        bl.style.setProperty('--oc-pill-y', `${PILL_PAD_Y * b.padMul * DOM_SS}px`);
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
    // The row and the cards are STRICTLY SEQUENTIAL, in both directions: the
    // titles finish rising into place before a single card unfolds, and every
    // card is collapsed before the row scatters again. Running the two at once
    // is what let a title sweep through a card that was already opening.
    // Gather is advanced FIRST so reveal reads this frame's value, not last
    // frame's — otherwise the unfold always starts one frame early.
    const gatherStep = deltaTime / GATHER_SEC;
    if (requestedTab >= 0) {
        gather = Math.min(1, gather + gatherStep);
    } else if (reveal <= 0) {
        // Cards are down; the row may drift back to its scattered layout.
        gather = Math.max(0, gather - gatherStep);
    }

    // While the user is switching tabs the cards must reach 0 before the DOM is
    // swapped — otherwise the new content pops in at the old content's scale.
    // The row stays gathered across that swap, so only `reveal` cycles.
    const revealTarget = (requestedTab === activeTab && activeTab >= 0 && gather >= 1) ? 1 : 0;
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
}

/** Hiding an element and reading a layout property back is a paint
 *  invalidation the compositor cannot batch away; no frame renders between the
 *  two writes, so there is no flash. One-shot only — never per frame.
 *
 *  Only cards that are actually IN LAYOUT are touched. A hidden card has no
 *  render surface to refresh, and toggling display on it would allocate one just
 *  to throw it away — which is what made this cost the whole tab's worth of
 *  surfaces instead of the visible cards'. */
function flushCardRaster(): void {
    for (let i = 0; i < cardCount; i++) {
        const slot = cards[i];
        if (!slot.shown) continue;
        const el = slot.el;
        el.style.display = 'none';
        void el.offsetHeight;
        el.style.display = '';
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

        const halfH = (TAB_LINE_H / 2 + PILL_PAD_Y + BAND) * fit;
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
    // trackOffset is applied BEFORE the `fit` squeeze (see updateCards: it is
    // inside the term that gets multiplied), so its bound has to live in the
    // same unsqueezed space — divide the viewport by fit instead of scaling the
    // strip by it. Scaling the strip made the limit `fit`× too small, which is
    // why the first and last cards could never be pulled fully into frame on a
    // phone: you hit the end of the track with the card still half off screen.
    panLimit = Math.max(0, stripHalfW - halfView / fit + EDGE_PAD);

    // A freshly opened tab starts at the LEFT end of the strip rather than
    // centred, so the first card — the most recent entry — is the one you land
    // on, and the timeline reads left to right from there.
    if (snapTrackLeft && cardCount > 0) {
        snapTrackLeft = false;
        trackOffset = panLimit;
        momentum = 0;
    }

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
    // Exact horizontal half-extent of a card, plus the rotation's overhang and
    // the mask margin. The old margin was a whole CARD_W of DESIGN px against a
    // viewport measured in the same units — on a phone that is wider than the
    // strip itself, so nothing was ever culled and every card in the tab stayed
    // in layout holding a render surface.
    const cullPx = getFrustumHalfWidthPx() + (CARD_W / 2 + CARD_H * 0.12) * fit + MASK_MARGIN;
    const velTilt = MathUtils.clamp(
        (dragging ? dragVel : momentum) * VEL_TILT_DEG_PER_PXS,
        -VEL_TILT_MAX_DEG, VEL_TILT_MAX_DEG,
    );
    const centreOffset = (cardCount - 1) * CARD_SPACING / 2;
    // At most one card is given its DOM + mask per frame (see materialiseCard).
    let buildBudget = 1;

    for (let i = 0; i < cards.length; i++) {
        const slot = cards[i];
        if (!slot.blocks || i >= cardCount) {
            slot.mesh.visible = false;
            slot.revealScale = 0;
            hideCardEl(slot);
            continue;
        }

        const t = cardReveal(i);
        const revealScale = Math.max(0, easeOutBack(t)) * fit;
        slot.revealScale = revealScale;
        if (revealScale <= 0.004) {
            slot.mesh.visible = false;
            hideCardEl(slot);
            continue;
        }

        const xPx = (i * CARD_SPACING - centreOffset + trackOffset) * fit;
        slot.xPx = xPx;
        const onScreen = Math.abs(xPx) < cullPx;
        if (!onScreen) {
            slot.mesh.visible = false;
            hideCardEl(slot);
            continue;
        }

        // On screen and wanted — build it if this frame still has the budget,
        // otherwise stay hidden and try again next frame. The unfold stagger
        // (CARD_STAGGER) gives each card a few frames of head start, so the
        // queue is never behind by the time a card is due on screen.
        if (!slot.built) {
            if (buildBudget <= 0) {
                slot.mesh.visible = false;
                hideCardEl(slot);
                continue;
            }
            buildBudget--;
            materialiseCard(slot);
        }
        showCardEl(slot);
        slot.mesh.visible = true;

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
    const halfW = (Math.max(stripHalfW * fit, tabHalfW + PILL_PAD_X) + MASK_MARGIN) / PX_PER_UNIT;
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
    ctx.beginPath();
    roundRectSubPath(ctx, x, y, w, h, r);
}

/** Same rounded rect, appended to whatever path is already open — lets several
 *  shapes share one fill (see addTextPillPath). */
function roundRectSubPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
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
    ctx.globalAlpha = inkPunchSolid;

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
        } else if (b.kind === 'icons') {
            // ONE pill for the whole row — the glyphs sit inside it, so the row
            // reads as a bar of ink instead of a string of separate holes.
            roundRectPath(
                ctx,
                off + b.x - RECT_PAD, off + b.y - RECT_PAD,
                b.w + 2 * RECT_PAD, b.h + 2 * RECT_PAD,
                (b.h + 2 * RECT_PAD) / 2,
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
        }
    }

    // Text pills last, as ONE path filled ONCE at the translucent ink strength
    // (see addTextPillPath for why they can't be filled one by one).
    ctx.beginPath();
    let hasPill = false;
    for (const b of slot.blocks) {
        if (b.kind !== 'text') continue;
        addTextPillPath(
            ctx, b.text, off + b.x, off + b.y, b.lineH,
            b.size, b.weight, b.ls,
            PILL_PAD_X * b.padMul, PILL_PAD_Y * b.padMul,
        );
        hasPill = true;
    }
    if (hasPill) {
        ctx.globalAlpha = inkPunchText;
        ctx.fill();
    }
    ctx.globalAlpha = 1;

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
        const cw = Math.ceil(tab.textW + 2 * PILL_PAD_X + 2 * MASK_MARGIN);
        const ch = Math.ceil(TAB_LINE_H + 2 * PILL_PAD_Y + 2 * MASK_MARGIN);
        if (tab.maskCanvas.width !== cw || tab.maskCanvas.height !== ch) {
            tab.maskCanvas.width = cw;
            tab.maskCanvas.height = ch;
            tab.maskTexture.dispose();
        }
        const ctx = tab.maskCanvas.getContext('2d');
        if (!ctx) continue;
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#fff';
        // One pill, so a plain alpha fill can't compound with anything.
        ctx.globalAlpha = inkPunchText;
        ctx.beginPath();
        addTextPillPath(
            ctx, text(TABS[i].label),
            (cw - tab.textW) / 2, (ch - TAB_LINE_H) / 2, TAB_LINE_H,
            TAB_SIZE, TAB_WEIGHT, TAB_LS, PILL_PAD_X, PILL_PAD_Y,
        );
        ctx.fill();
        ctx.globalAlpha = 1;
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
    ctx.globalAlpha = inkPunchSolid;
    const pw = underlineMaskW + 2 * LINE_PAD;
    const ph = TAB_UNDERLINE_H + 2 * LINE_PAD;
    roundRectPath(ctx, (cw - pw) / 2, (ch - ph) / 2, pw, ph, LINE_PAD + 1);
    ctx.fill();
    ctx.globalAlpha = 1;
    texture.needsUpdate = true;
}

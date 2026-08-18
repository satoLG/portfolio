// ============================================
// NOTICE BOARD — procedural low-poly board nailed to the tree
// ============================================
//
// Built from primitives rather than loaded from a GLB. The Sketchfab model the
// board was originally meant to come from cannot be fetched from this project's
// build environment (sketchfab.com is not reachable, and its downloads are
// behind an account login either way), so the geometry is authored here in the
// same chunky, flat-shaded style as the rest of the island props.
//
// Swapping in a real model later is a config change, not a code change: point
// `noticeBoardModelPath` in IslandConfig at a GLB under public/models/surface/
// and Island.ts loads that instead of calling createNoticeBoard(). See
// `_buildNoticeBoard` there.
//
// LOCAL SPACE CONTRACT (what Island.ts scales/positions):
//   • The plank panel is BOARD_W (= 1.0) wide and centred on the group origin,
//     so the group's scale IS the board's width in world units.
//   • It is TALLER than it is wide — see the region layout below.
//   • The front face points at +Z, so a group rotation.y of 0 faces the default
//     camera straight on.
//
// WHAT IS NOT IN HERE. The board carries three CSS3D panels — the achievements
// sheet, the notice carousel and the post-it wall — and none of their content
// is geometry. They punch through the canvas in front of these planks and show
// live DOM, so they can be paged, animated and typed into. This file owns the
// wood, the fixings, and the REGION RECTANGLES the three panels are anchored to;
// everything else is in AchievementsPanel / NoticeBoardPanel / PostItWall.

import {
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    Color,
    CylinderGeometry,
    Euler,
    Group,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    Quaternion,
    Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ── Palette ──────────────────────────────────────────────────────────────────
// Warm, desaturated woods that sit next to the Quaternius props without
// standing out as "the one procedural object".
const WOOD_PLANK   = '#8a5a34';
const WOOD_BATTEN  = '#684025';
const WOOD_ROOF    = '#7a4c2b';
const NAIL_METAL   = '#4c4a52';

// ── Board size ───────────────────────────────────────────────────────────────
export const BOARD_W = 1.0;     // the unit the group scale is expressed in
export const BOARD_H = 0.935;   // taller than wide — three regions stacked

// ── Planks ───────────────────────────────────────────────────────────────────
const PLANK_COUNT = 5;
const PLANK_DEPTH = 0.05;
const PLANK_GAP   = 0.012;

/**
 * Local Z of the CSS3D panel planes — just proud of the planks.
 *
 * This used to need a much bigger gap because the panels billboarded: they
 * copied the camera's orientation while the board kept its own, and at any
 * mismatch a corner swung back through the wood. They are pinned to the board's
 * yaw now (setFixedYaw), so everything is parallel and a hair of clearance is
 * enough — which also stops the paper reading as hovering off the board when
 * seen from the side.
 */
export const PANEL_LOCAL_Z = PLANK_DEPTH / 2 + 0.012;

// ── Region layout (local units, origin at the board's centre) ────────────────
// One source of truth for where the three panels go. The panels convert a region
// into world space through the board's live transform, so nudging the board from
// the debug GUI carries all three with it, and resizing it keeps their
// proportions.
export interface BoardRegion {
    /** Centre, in board-local units. */
    cx: number; cy: number;
    /** Size, in board-local units. */
    w: number; h: number;
    /** How far proud of the planks this region's panel sits. Regions do not all
     *  share one depth: a note may hang past the post-it region's edge, and if
     *  it reached a sheet at the SAME depth the two flat quads would z-fight.
     *  The wall is nudged forward so a note always wins that contest. */
    z: number;
}

const SIDE_MARGIN   = 0.04;
const TOP_MARGIN    = 0.05;
const BOTTOM_MARGIN = 0.05;
const COL_GAP       = 0.04;
const ROW_GAP       = 0.06;
/** Height of the two top panels. They match each other exactly — the pair reads
 *  as one row, and a row whose halves are different heights reads as a mistake. */
const TOP_ROW_H     = 0.345;

const COL_W  = (BOARD_W - 2 * SIDE_MARGIN - COL_GAP) / 2;
const TOP_CY = BOARD_H / 2 - TOP_MARGIN - TOP_ROW_H / 2;

/** Top-left: the achievements sheet. One static paper, no paging. */
export const REGION_ACHIEVEMENTS: BoardRegion = {
    cx: -(BOARD_W / 2) + SIDE_MARGIN + COL_W / 2,
    cy: TOP_CY,
    w: COL_W,
    h: TOP_ROW_H,
    z: PANEL_LOCAL_Z,
};

/** Top-right: the notice carousel. */
export const REGION_SLIDES: BoardRegion = {
    cx: (BOARD_W / 2) - SIDE_MARGIN - COL_W / 2,
    cy: TOP_CY,
    w: COL_W,
    h: TOP_ROW_H,
    z: PANEL_LOCAL_Z,
};

/** Everything below: bare planks that visitors stick post-its onto. Deliberately
 *  the largest region — it is the only part of the board that is theirs. */
const POSTIT_TOP    = BOARD_H / 2 - TOP_MARGIN - TOP_ROW_H - ROW_GAP;
const POSTIT_BOTTOM = -(BOARD_H / 2) + BOTTOM_MARGIN;
export const REGION_POSTITS: BoardRegion = {
    cx: 0,
    cy: (POSTIT_TOP + POSTIT_BOTTOM) / 2,
    w: BOARD_W - 2 * SIDE_MARGIN,
    h: POSTIT_TOP - POSTIT_BOTTOM,
    // In front of the sheets: paper stuck on the board sits ON everything else
    // pinned to it, and this is what settles the depth test if the two ever meet.
    z: PANEL_LOCAL_Z + 0.006,
};

/** Derived from BOARD_H so the plank run always fills the board exactly —
 *  changing the height above must not leave a strip of nothing at the bottom. */
const PLANK_HEIGHT = (BOARD_H - (PLANK_COUNT - 1) * PLANK_GAP) / PLANK_COUNT;
const PANEL_TOP = BOARD_H / 2;

// Per-plank shade + depth jitter. Hand-picked instead of Math.random() so the
// board looks identical every reload (and identical between two players'
// screenshots) while still reading as hand-nailed rather than extruded.
const PLANK_TWEAKS: Array<{ shade: number; dz: number; dy: number }> = [
    { shade:  0.06, dz:  0.004, dy:  0.000 },
    { shade: -0.04, dz: -0.003, dy:  0.002 },
    { shade:  0.02, dz:  0.005, dy: -0.001 },
    { shade: -0.07, dz: -0.002, dy:  0.001 },
    { shade:  0.04, dz:  0.003, dy: -0.002 },
    { shade: -0.03, dz: -0.004, dy:  0.001 },
];

/** Clone a base colour and lift/drop its lightness by `amount` (roughly ±0.1). */
function _shaded(base: string, amount: number): Color {
    const c = new Color(base);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amount)));
    return c;
}

// ── Batching ─────────────────────────────────────────────────────────────────
//
// The board is nineteen little boxes and cylinders, and drawn one mesh at a
// time that is nineteen draw calls — times two, because every one of them casts
// a shadow and so is drawn again into the shadow map. For an object the size of
// a poster on a tree, on a phone, that is a lot of per-object overhead for very
// little geometry.
//
// So the pieces are welded into two meshes before they ever reach the renderer:
// one for the wood, one for the metal. The wood pieces are not all the same
// colour — that is the whole point of the plank jitter — so their colours move
// out of the material and into a VERTEX COLOUR attribute, which a single white
// material then multiplies through. Every piece keeps the exact colour it had:
// material.color and a vertex colour are the same linear-space multiply in the
// shader, and the numbers written below are read straight off the same Color
// objects the per-piece materials used to be built from.
//
// Nothing about the look changes. Same geometry, same positions, same shading
// model, same shadows — the board simply arrives at the GPU in two pieces
// instead of nineteen.

/** Stamp one flat colour across every vertex of a geometry, so it survives
 *  being merged with differently-coloured neighbours. */
function _tint(geo: BufferGeometry, color: Color): BufferGeometry {
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        arr[i * 3]     = color.r;
        arr[i * 3 + 1] = color.g;
        arr[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new BufferAttribute(arr, 3));
    return geo;
}

const _mat4 = new Matrix4();
const _euler = new Euler();
const _quat = new Quaternion();
const _pos = new Vector3();
const _one = new Vector3(1, 1, 1);

/** Bake a piece's placement into its vertices — the merged mesh has no children
 *  to carry transforms for it. */
function _placed(geo: BufferGeometry, x: number, y: number, z: number, rotX = 0): BufferGeometry {
    _quat.setFromEuler(_euler.set(rotX, 0, 0));
    _mat4.compose(_pos.set(x, y, z), _quat, _one);
    return geo.applyMatrix4(_mat4);
}

/** Weld a list of pieces into one geometry, disposing the parts. */
function _weld(parts: BufferGeometry[], what: string): BufferGeometry {
    const merged = mergeGeometries(parts, false);
    if (!merged) throw new Error(`[NoticeBoard] could not merge ${what} — mismatched attributes`);
    for (const g of parts) g.dispose();
    return merged;
}

/** Name given to the invisible quad over the post-it region. PostItWall raycasts
 *  against it to turn a pointer position into a spot on the board. */
export const POSTIT_PICK_NAME = 'noticeBoardPostItPickPlane';

/**
 * Build the notice board. See the local-space contract at the top of the file
 * for what the caller is allowed to assume about the returned group's extents.
 */
export function createNoticeBoard(): Group {
    const group = new Group();
    group.name = 'noticeBoard';

    // Every wooden piece, in board-local space, each carrying its own colour.
    const wood: BufferGeometry[] = [];
    const addWood = (
        geo: BufferGeometry, color: Color | string,
        x: number, y: number, z: number, rotX = 0,
    ) => {
        wood.push(_placed(_tint(geo, color instanceof Color ? color : new Color(color)), x, y, z, rotX));
    };

    // ── Backing planks ───────────────────────────────────────────────────────
    for (let i = 0; i < PLANK_COUNT; i++) {
        const tweak = PLANK_TWEAKS[i % PLANK_TWEAKS.length];
        addWood(
            new BoxGeometry(BOARD_W, PLANK_HEIGHT, PLANK_DEPTH),
            _shaded(WOOD_PLANK, tweak.shade),
            0,
            PANEL_TOP - PLANK_HEIGHT / 2 - i * (PLANK_HEIGHT + PLANK_GAP) + tweak.dy,
            tweak.dz,
        );
    }

    // ── Battens across the back, holding the planks together ─────────────────
    for (const bx of [-0.34, 0.34]) {
        addWood(
            new BoxGeometry(0.09, BOARD_H + 0.06, 0.035), WOOD_BATTEN,
            bx, 0, -(PLANK_DEPTH / 2 + 0.015),
        );
    }
    // A third across the middle: at this height two would visibly sag.
    addWood(
        new BoxGeometry(BOARD_W + 0.02, 0.07, 0.03), WOOD_BATTEN,
        0,
        REGION_POSTITS.cy + REGION_POSTITS.h / 2 + ROW_GAP / 2,
        -(PLANK_DEPTH / 2 + 0.012),
    );

    // ── Little rain roof ─────────────────────────────────────────────────────
    // Pushed forward in Z rather than centred: the board is nailed flat against a
    // trunk, so a roof centred on the panel would bury half its depth in the bark.
    const ROOF_TILT = -0.30;
    addWood(
        new BoxGeometry(BOARD_W + 0.12, 0.04, 0.20), WOOD_ROOF,
        0, PANEL_TOP + 0.055, 0.085, ROOF_TILT,
    );

    // Two brackets bridging panel top → roof underside, so the roof reads as
    // fixed to the board rather than hovering over it.
    for (const bx of [-0.30, 0.30]) {
        addWood(
            new BoxGeometry(0.04, 0.09, 0.04), WOOD_BATTEN,
            bx, PANEL_TOP + 0.015, 0.055, ROOF_TILT,
        );
    }

    const woodMesh = new Mesh(_weld(wood, 'board woodwork'), new MeshStandardMaterial({
        // White, so the vertex colours pass through untouched — see _tint.
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.92,
        metalness: 0.0,
        flatShading: true,
    }));
    group.add(woodMesh);

    // ── Fixings ──────────────────────────────────────────────────────────────
    // One colour throughout, so no vertex colours are needed here.
    const metal: BufferGeometry[] = [];

    // Nails holding the board to the trunk — the four outer corners.
    for (const nx of [-0.34, 0.34]) {
        for (const ny of [PANEL_TOP - 0.05, -PANEL_TOP + 0.05]) {
            metal.push(_placed(
                new CylinderGeometry(0.022, 0.022, 0.035, 6),
                nx, ny, PLANK_DEPTH / 2 + 0.012, Math.PI / 2,
            ));
        }
    }

    // Tacks for the two paper panels. They sit slightly in FRONT of the panel
    // plane so they overlap the sheets' top corners and the paper reads as
    // pinned rather than floating.
    for (const region of [REGION_ACHIEVEMENTS, REGION_SLIDES]) {
        for (const side of [-1, 1]) {
            metal.push(_placed(
                new CylinderGeometry(0.013, 0.013, 0.02, 6),
                region.cx + side * (region.w / 2 - 0.045),
                region.cy + region.h / 2 - 0.03,
                PANEL_LOCAL_Z + 0.017,
                Math.PI / 2,
            ));
        }
    }

    group.add(new Mesh(_weld(metal, 'board fixings'), new MeshStandardMaterial({
        color: new Color(NAIL_METAL),
        roughness: 0.55,
        metalness: 0.65,
        flatShading: true,
    })));

    // ── Post-it pick plane ───────────────────────────────────────────────────
    // An invisible quad over the post-it region. PostItWall raycasts it to turn
    // a pointer into a spot on the board, which the planks alone cannot do —
    // they have gaps between them, and a drop aimed at a gap would miss.
    //
    // colorWrite:false rather than visible:false: an invisible object is skipped
    // by some traversals, and this one has to stay raycastable. Writing no
    // colour and no depth makes it free to draw and impossible to see.
    const pick = new Mesh(
        new PlaneGeometry(REGION_POSTITS.w, REGION_POSTITS.h),
        new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }),
    );
    pick.name = POSTIT_PICK_NAME;
    pick.position.set(REGION_POSTITS.cx, REGION_POSTITS.cy, PANEL_LOCAL_Z);
    pick.renderOrder = -1;
    group.add(pick);

    // Every piece casts and receives — the board hangs in the tree's shadow and
    // reads as flat cardboard without this.
    group.traverse((child) => {
        if ((child as Mesh).isMesh && child.name !== POSTIT_PICK_NAME) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    return group;
}

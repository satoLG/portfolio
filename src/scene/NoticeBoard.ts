// ============================================
// NOTICE BOARD — procedural low-poly warning board nailed to the tree
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
//   • The plank panel is 1.0 wide and centred on the group origin in X and Y.
//   • The front face — the side the notice is pinned to — points at +Z, so a
//     group rotation.y of 0 faces the default camera straight on.
//   • Everything lives within roughly x ∈ [-0.56, 0.56], y ∈ [-0.40, 0.62],
//     z ∈ [-0.07, 0.14], so the group scale is very close to "board width in
//     world units".
//
// The NOTICE ITSELF is not in here. It is a CSS3D panel (NoticeBoardPanel.ts)
// that punches through the canvas in front of these planks, so it can be live,
// styled DOM — a carousel the reader can page through — instead of a baked
// texture. What this file still owns is the two tacks that hold it: they sit
// slightly in FRONT of the panel plane, so they draw over its edge and the
// paper reads as pinned rather than floating.

import {
    BoxGeometry,
    Color,
    CylinderGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
} from 'three';

// ── Palette ──────────────────────────────────────────────────────────────────
// Warm, desaturated woods that sit next to the Quaternius props without
// standing out as "the one procedural object".
const WOOD_PLANK   = '#8a5a34';
const WOOD_BATTEN  = '#684025';
const WOOD_ROOF    = '#7a4c2b';
const NAIL_METAL   = '#4c4a52';

// ── Panel layout (local units) ───────────────────────────────────────────────
const PLANK_COUNT   = 4;
const PLANK_WIDTH   = 1.0;
const PLANK_HEIGHT  = 0.19;
const PLANK_DEPTH   = 0.05;
const PLANK_GAP     = 0.012;
const PANEL_HEIGHT  = PLANK_COUNT * PLANK_HEIGHT + (PLANK_COUNT - 1) * PLANK_GAP;
const PANEL_TOP     = PANEL_HEIGHT / 2;

// ── Notice footprint (local units) ───────────────────────────────────────────
// The notice is DOM sized in CSS px, so it cannot read these directly — but its
// world anchor and the tacks that pin it have to agree, so both derive from
// here. NoticeBoardPanel converts: it divides its design width by
// NOTICE_WIDTH × the board's live scale to get px-per-world-unit, which is what
// makes the panel follow a debug-GUI resize of the board instead of drifting
// off it.
export const NOTICE_HALF_W = 0.33;
export const NOTICE_WIDTH  = NOTICE_HALF_W * 2;
export const NOTICE_HALF_H = NOTICE_HALF_W * (282 / 360);   // matches the panel's design aspect
/**
 * Local Z of the notice plane — just proud of the planks.
 *
 * This used to need a much bigger gap because the panel billboarded: it copied
 * the camera's orientation while the board kept its own, and at any mismatch a
 * corner of the sheet swung back through the wood. The panel is pinned to the
 * board's yaw now (setFixedYaw), so the two are parallel and a hair of
 * clearance is enough — which also stops the notice reading as hovering off the
 * board when seen from the side.
 */
export const NOTICE_LOCAL_Z = PLANK_DEPTH / 2 + 0.012;
/** Local X/Y of the notice centre — pinned slightly off-centre, by hand. */
export const NOTICE_LOCAL_X = 0.01;
export const NOTICE_LOCAL_Y = 0.015;

// Per-plank shade + depth jitter. Hand-picked instead of Math.random() so the
// board looks identical every reload (and identical between two players'
// screenshots) while still reading as hand-nailed rather than extruded.
const PLANK_TWEAKS: Array<{ shade: number; dz: number; dy: number }> = [
    { shade:  0.06, dz:  0.004, dy:  0.000 },
    { shade: -0.04, dz: -0.003, dy:  0.002 },
    { shade:  0.02, dz:  0.005, dy: -0.001 },
    { shade: -0.07, dz: -0.002, dy:  0.001 },
];

/** Clone a base colour and lift/drop its lightness by `amount` (roughly ±0.1). */
function _shaded(base: string, amount: number): Color {
    const c = new Color(base);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amount)));
    return c;
}

function _woodMaterial(color: Color | string): MeshStandardMaterial {
    return new MeshStandardMaterial({
        color: color instanceof Color ? color : new Color(color),
        roughness: 0.92,
        metalness: 0.0,
        flatShading: true,
    });
}

/**
 * Build the notice board. See the local-space contract at the top of the file
 * for what the caller is allowed to assume about the returned group's extents.
 */
export function createNoticeBoard(): Group {
    const group = new Group();
    group.name = 'noticeBoard';

    // ── Backing planks ───────────────────────────────────────────────────────
    const plankGeo = new BoxGeometry(PLANK_WIDTH, PLANK_HEIGHT, PLANK_DEPTH);
    for (let i = 0; i < PLANK_COUNT; i++) {
        const tweak = PLANK_TWEAKS[i];
        const plank = new Mesh(plankGeo, _woodMaterial(_shaded(WOOD_PLANK, tweak.shade)));
        plank.position.set(
            0,
            PANEL_TOP - PLANK_HEIGHT / 2 - i * (PLANK_HEIGHT + PLANK_GAP) + tweak.dy,
            tweak.dz,
        );
        group.add(plank);
    }

    // ── Battens across the back, holding the planks together ─────────────────
    const battenGeo = new BoxGeometry(0.09, PANEL_HEIGHT + 0.06, 0.035);
    for (const bx of [-0.34, 0.34]) {
        const batten = new Mesh(battenGeo, _woodMaterial(WOOD_BATTEN));
        batten.position.set(bx, 0, -(PLANK_DEPTH / 2 + 0.015));
        group.add(batten);
    }

    // ── Little rain roof ─────────────────────────────────────────────────────
    // Pushed forward in Z rather than centred: the board is nailed flat against a
    // trunk, so a roof centred on the panel would bury half its depth in the bark.
    const ROOF_TILT = -0.30;
    const roof = new Mesh(new BoxGeometry(1.12, 0.04, 0.20), _woodMaterial(WOOD_ROOF));
    roof.position.set(0, PANEL_TOP + 0.055, 0.085);
    roof.rotation.x = ROOF_TILT;
    group.add(roof);

    // Two brackets bridging panel top → roof underside, so the roof reads as
    // fixed to the board rather than hovering over it.
    const bracketGeo = new BoxGeometry(0.04, 0.09, 0.04);
    for (const bx of [-0.30, 0.30]) {
        const bracket = new Mesh(bracketGeo, _woodMaterial(WOOD_BATTEN));
        bracket.position.set(bx, PANEL_TOP + 0.015, 0.055);
        bracket.rotation.x = ROOF_TILT;
        group.add(bracket);
    }

    // ── Nails at the four panel corners ──────────────────────────────────────
    // Cylinders laid along Z so the flat head faces the viewer.
    const nailGeo = new CylinderGeometry(0.022, 0.022, 0.035, 6);
    const nailMat = new MeshStandardMaterial({
        color: new Color(NAIL_METAL),
        roughness: 0.55,
        metalness: 0.65,
        flatShading: true,
    });
    const nailInsetX = 0.34;
    const nailInsetY = PANEL_TOP - 0.055;
    for (const nx of [-nailInsetX, nailInsetX]) {
        for (const ny of [nailInsetY, -nailInsetY]) {
            const nail = new Mesh(nailGeo, nailMat);
            nail.position.set(nx, ny, PLANK_DEPTH / 2 + 0.012);
            nail.rotation.x = Math.PI / 2;
            group.add(nail);
        }
    }

    // ── Tacks for the CSS3D notice ───────────────────────────────────────────
    // The notice is DOM (NoticeBoardPanel.ts); these two sit in front of its
    // plane so they overlap its top corners and it reads as pinned paper.
    const tackGeo = new CylinderGeometry(0.014, 0.014, 0.02, 6);
    for (const dx of [-NOTICE_HALF_W + 0.05, NOTICE_HALF_W - 0.03]) {
        const tack = new Mesh(tackGeo, nailMat);
        tack.position.set(
            NOTICE_LOCAL_X + dx,
            NOTICE_LOCAL_Y + NOTICE_HALF_H - 0.035,
            NOTICE_LOCAL_Z + 0.017,
        );
        tack.rotation.x = Math.PI / 2;
        group.add(tack);
    }

    // Every piece casts and receives — the board hangs in the tree's shadow and
    // reads as flat cardboard without this.
    group.traverse((child) => {
        if ((child as Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    return group;
}

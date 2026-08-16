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

import {
    BoxGeometry,
    CanvasTexture,
    Color,
    CylinderGeometry,
    Group,
    LinearFilter,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    SRGBColorSpace,
} from 'three';
import { t, onLanguageChange } from '../core/i18n';

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
const PANEL_BOTTOM  = -PANEL_HEIGHT / 2;

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

// ── Notice texture ───────────────────────────────────────────────────────────
// The pinned paper is a canvas texture so its wording follows the UI language.
// Drawn once per language change into the SAME canvas, so the CanvasTexture (and
// therefore the material and the GPU upload path) is created only once.
const NOTICE_TEX_W = 512;
const NOTICE_TEX_H = 420;

function _drawNotice(ctx: CanvasRenderingContext2D): void {
    const W = NOTICE_TEX_W;
    const H = NOTICE_TEX_H;
    ctx.clearRect(0, 0, W, H);

    // Aged paper
    ctx.fillStyle = '#f3e7c9';
    ctx.fillRect(0, 0, W, H);

    // Corner staining — four soft radial washes so the sheet doesn't read as a
    // flat rectangle of cream at zoom distance.
    const stains: Array<[number, number, number]> = [
        [0, 0, 210], [W, 0, 190], [0, H, 200], [W, H, 180],
    ];
    for (const [sx, sy, r] of stains) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        g.addColorStop(0, 'rgba(148, 108, 58, 0.28)');
        g.addColorStop(1, 'rgba(148, 108, 58, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }

    // Border rule
    ctx.strokeStyle = '#8d3a2c';
    ctx.lineWidth = 10;
    ctx.strokeRect(16, 16, W - 32, H - 32);
    ctx.strokeStyle = 'rgba(141, 58, 44, 0.45)';
    ctx.lineWidth = 3;
    ctx.strokeRect(30, 30, W - 60, H - 60);

    // Warning triangle
    const triCx = W / 2;
    const triTop = 58;
    const triH = 86;
    const triHalf = 50;
    ctx.beginPath();
    ctx.moveTo(triCx, triTop);
    ctx.lineTo(triCx + triHalf, triTop + triH);
    ctx.lineTo(triCx - triHalf, triTop + triH);
    ctx.closePath();
    ctx.fillStyle = '#c8562f';
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#7d2f1c';
    ctx.stroke();

    ctx.fillStyle = '#f8efd8';
    ctx.font = 'bold 52px "Pangolin", cursive, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', triCx, triTop + triH * 0.66);

    // Title
    ctx.fillStyle = '#7d2f1c';
    ctx.font = 'bold 46px "Pangolin", cursive, sans-serif';
    ctx.fillText(t('board.title'), W / 2, 196);

    // Body lines
    ctx.fillStyle = '#4a3520';
    ctx.font = '34px "Pangolin", cursive, sans-serif';
    ctx.fillText(t('board.line1'), W / 2, 268);
    ctx.fillText(t('board.line2'), W / 2, 318);

    // Signature
    ctx.fillStyle = 'rgba(74, 53, 32, 0.72)';
    ctx.font = 'italic 26px "Pangolin", cursive, sans-serif';
    ctx.fillText(t('board.sign'), W / 2, 366);
}

function _createNoticeTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = NOTICE_TEX_W;
    canvas.height = NOTICE_TEX_H;
    const ctx = canvas.getContext('2d')!;

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;

    const redraw = () => {
        _drawNotice(ctx);
        texture.needsUpdate = true;
    };

    redraw();
    // The notice uses a webfont (Pangolin). On a cold load that font is usually
    // still in flight when the board is built, so canvas silently falls back to
    // the generic cursive; redraw once the real face is available.
    if (typeof document !== 'undefined' && document.fonts?.ready) {
        document.fonts.ready.then(redraw).catch(() => { /* keep the fallback draw */ });
    }
    onLanguageChange(redraw);

    return texture;
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

    // ── Pinned notice ────────────────────────────────────────────────────────
    const noticeW = 0.60;
    const noticeH = noticeW * (NOTICE_TEX_H / NOTICE_TEX_W);
    const notice = new Mesh(
        new PlaneGeometry(noticeW, noticeH),
        new MeshStandardMaterial({
            map: _createNoticeTexture(),
            roughness: 0.95,
            metalness: 0.0,
        }),
    );
    // Pinned by hand: slightly off-centre and a couple of degrees askew.
    notice.position.set(0.01, 0.015, PLANK_DEPTH / 2 + 0.006);
    notice.rotation.z = -0.035;
    group.add(notice);

    // Two tacks holding the notice
    const tackGeo = new CylinderGeometry(0.014, 0.014, 0.02, 6);
    for (const tx of [-noticeW / 2 + 0.05, noticeW / 2 - 0.03]) {
        const tack = new Mesh(tackGeo, nailMat);
        tack.position.set(tx, noticeH / 2 - 0.04, PLANK_DEPTH / 2 + 0.016);
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

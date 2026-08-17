/**
 * render-achievement-badges.cjs
 *
 * Renders the achievement badges from the scene's OWN 3D models, so a badge is
 * a picture of the thing the visitor actually knocked out of the tree rather
 * than a separate drawing of it that will drift as the models change.
 *
 * Deliberately NOT part of the build. It is a manual, reviewable step that
 * writes committed PNGs — like downscale-model-textures.cjs. Re-run it when a
 * source model changes:
 *
 *     node scripts/render-achievement-badges.cjs
 *
 * Output: public/images/achievements/<id>.png, transparent, trimmed to content.
 *
 * THE CARTOON PASS is two things, both done in the render rather than as a
 * filter afterwards:
 *   • MeshToonMaterial with a 3-step gradient, so lighting lands in flat bands
 *     instead of a smooth ramp. The models keep their own textures.
 *   • An inverted-hull outline — the mesh again, scaled up a hair and drawn
 *     back-faces-only in near-black, so the silhouette gets an ink line.
 * A post-hoc edge filter would trace the texture's internal detail as well as
 * the silhouette, which reads as noise at 40px.
 *
 * Two badges have no model to render — the musical note and the speech bubble
 * are a canvas sprite and DOM respectively — so those stay as drawn SVG in
 * AchievementArt.ts.
 */

'use strict';

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'images', 'achievements');
const PORT = 3099;
const URL = `http://localhost:${PORT}`;
const RENDER_PX = 512;   // rendered square, trimmed and downscaled afterwards
const FINAL_PX = 192;    // shipped size — drawn at ~40px, so this covers 3x DPR

/** id → what to render. `tint` recolours every material's base colour, which is
 *  how the golden apple is made: it is the same mesh the scene tints at runtime
 *  (GOLDEN_APPLE_COLOR / _EMISSIVE in IslandConfig), not a second model. */
const BADGES = [
    { id: 'apple',       model: 'models/surface/apple.glb',       yaw: 0.5, pitch: 0.1 },
    { id: 'goldenApple', model: 'models/surface/apple.glb',       yaw: 0.5, pitch: 0.1,
      tint: '#c8a820', emissive: '#e2b512', emissiveIntensity: 0.45 },
    { id: 'coral',       model: 'models/underwater/coral.glb',    yaw: 0.6, pitch: 0.12 },
    // The bonfire's FIRE is not a model — it is a 9x6 sprite sheet the scene
    // scrolls through (see Fire.ts). An unlit pile of logs is the wrong picture
    // for "stayed until the campfire was lit", so one frame of that same sheet
    // is composited over the render rather than a flame being drawn from
    // scratch: the badge then shows the fire the visitor actually saw.
    { id: 'bonfire',     model: 'models/surface/bonfire.glb',     yaw: 0.7, pitch: 0.22,
      flame: { cols: 9, rows: 6, cell: 14, scale: 1.3, dx: 0.13, dy: -0.42 } },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Pull one cell out of the fire sprite sheet and trim it to the flame. */
async function extractFlame({ cols, rows, cell, scale }) {
    const sharp = require('sharp');
    const sheetPath = path.join(ROOT, 'public', 'images', 'fire_spritesheet.png');
    const meta = await sharp(sheetPath).metadata();
    const cw = Math.floor(meta.width / cols);
    const ch = Math.floor(meta.height / rows);
    const cx = (cell % cols) * cw;
    const cy = Math.floor(cell / cols) * ch;
    const w = Math.min(FINAL_PX, Math.round(FINAL_PX * 0.5 * scale));
    const buf = await sharp(sheetPath)
        .extract({ left: cx, top: cy, width: cw, height: ch })
        .trim()
        // Cap BOTH axes: the sheet's cells are taller than they are wide, so a
        // width-only resize can still come back taller than the badge and sharp
        // refuses a composite larger than its base.
        .resize({ width: w, height: FINAL_PX, fit: 'inside' })
        .png()
        .toBuffer();
    const m = await sharp(buf).metadata();
    return { buf, w: m.width, h: m.height };
}

function waitForServer(url, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const attempt = () => http.get(url, res => { res.resume(); resolve(); })
            .on('error', () => Date.now() > deadline ? reject(new Error('dev server timeout')) : setTimeout(attempt, 500));
        attempt();
    });
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>badges</title>
<style>html,body{margin:0;background:transparent}</style></head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const SIZE = ${RENDER_PX};
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(SIZE, SIZE);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// Three flat bands. A smooth ramp is what makes a render look like a render.
const grad = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 190, 190, 190, 255, 255, 255, 255, 255]), 3, 1);
grad.needsUpdate = true;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

window.__render = async (spec) => {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6a5a44, 1.5));
    const key = new THREE.DirectionalLight(0xfff2dc, 2.1);
    key.position.set(2.5, 3.5, 3);
    scene.add(key);

    const gltf = await loader.loadAsync('/' + spec.model);
    const root = gltf.scene;

    const outlines = [];
    root.traverse((o) => {
        if (!o.isMesh) return;
        const src = Array.isArray(o.material) ? o.material[0] : o.material;
        const toon = new THREE.MeshToonMaterial({
            map: src.map || null,
            color: spec.tint ? new THREE.Color(spec.tint) : (src.color ? src.color.clone() : new THREE.Color(0xffffff)),
            gradientMap: grad,
        });
        if (spec.emissive) {
            toon.emissive = new THREE.Color(spec.emissive);
            toon.emissiveIntensity = spec.emissiveIntensity ?? 0.4;
        }
        o.material = toon;

        // Inverted hull: the same geometry, a hair larger, back faces only.
        const outline = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({
            color: 0x241a12, side: THREE.BackSide,
        }));
        outline.scale.multiplyScalar(1.055);
        outlines.push({ outline, parent: o });
    });
    for (const { outline, parent } of outlines) parent.add(outline);

    scene.add(root);
    root.rotation.y = spec.yaw ?? 0;
    root.rotation.x = spec.pitch ?? 0;

    // Frame it: fit the bounding sphere, then back off a touch so the outline
    // and any overhang stay inside the square.
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const dist = (sphere.radius / Math.sin((30 * Math.PI / 180) / 2)) * 0.62;
    camera.position.set(sphere.center.x, sphere.center.y + sphere.radius * 0.12, sphere.center.z + dist);
    camera.lookAt(sphere.center);

    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
};
window.__ready = true;
</script></body></html>`;

(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const pagePath = path.join(ROOT, '.badge-render.html');
    fs.writeFileSync(pagePath, PAGE);

    const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    const cleanup = () => {
        try { server.kill('SIGKILL'); } catch { /* already gone */ }
        try { fs.unlinkSync(pagePath); } catch { /* already gone */ }
    };
    process.on('exit', cleanup);

    try {
        await waitForServer(`${URL}/`);
        const browser = await chromium.launch({
            executablePath: '/opt/pw-browsers/chromium',
            args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
        });
        const page = await browser.newPage({ viewport: { width: RENDER_PX + 40, height: RENDER_PX + 40 } });
        page.on('pageerror', e => console.error('  page error:', e.message));
        await page.goto(`${URL}/.badge-render.html`, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__ready === true, { timeout: 90000 });

        const sharp = require('sharp');
        for (const spec of BADGES) {
            process.stdout.write(`  ${spec.id} … `);
            const dataUrl = await page.evaluate(s => window.__render(s), spec);
            await sleep(120);
            let img = sharp(Buffer.from(dataUrl.split(',')[1], 'base64'))
                .trim()                                    // crop to the drawn pixels
                .resize(FINAL_PX, FINAL_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });

            if (spec.flame) {
                const flame = await extractFlame(spec.flame);
                // sharp refuses a composite that is larger than its base or lands
                // at a negative offset, so clamp both rather than trusting the
                // tuning numbers to stay inside the square.
                const left = Math.max(0, Math.min(FINAL_PX - flame.w,
                    Math.round((FINAL_PX - flame.w) / 2 + (spec.flame.dx ?? 0) * FINAL_PX)));
                const top = Math.max(0, Math.min(FINAL_PX - flame.h,
                    Math.round(FINAL_PX / 2 + spec.flame.dy * FINAL_PX)));
                img = sharp(await img.png().toBuffer()).composite([{ input: flame.buf, left, top }]);
            }

            const out = path.join(OUT_DIR, `${spec.id}.png`);
            await img.png({ compressionLevel: 9 }).toFile(out);
            console.log(`${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
        }

        await browser.close();
        console.log(`\nWrote ${BADGES.length} badges to public/images/achievements/`);
    } finally {
        cleanup();
    }
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

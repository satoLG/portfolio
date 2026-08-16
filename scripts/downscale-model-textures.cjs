/**
 * downscale-model-textures.cjs
 *
 * One-time, deliberate texture downscaler for specific GLB models whose embedded
 * textures are far larger than the prop ever needs on screen. The cost these
 * cause is GPU texture MEMORY + bandwidth (a 2048² RGBA texture is ~16 MB in
 * VRAM regardless of its compressed file size), which hurts low-end mobile GPUs
 * (Adreno 610) badly. The geometry of these models is already tiny — the weight
 * is purely the textures.
 *
 * This is intentionally NOT wired into the recurring prebuild: it is a manual,
 * reviewable operation that rewrites the committed .glb in place. It is
 * idempotent — a texture already at or below its cap is skipped, so re-running
 * never degrades quality (unlike a lossy geometry simplifier).
 *
 * Caps are power-of-two so Three.js can still mip-map (NPOT would disable mips
 * and look WORSE via aliasing). Conservative targets only — the tree and the
 * hero floating_island are left untouched.
 *
 * Usage:  node scripts/downscale-model-textures.cjs
 */

const fs   = require('fs');
const path = require('path');

const MODELS = path.resolve(__dirname, '..', 'public', 'models');

// file (relative to public/models) → max texture dimension (power of two)
const TARGETS = {
    'underwater/starfish.glb': 512,  // was 3× 2048² — absurd for a tiny prop (~48 MB VRAM)
    'surface/moss_rock1.glb':  512,  // was 1024²
    'surface/bush.glb':        512,  // was 1024² (cloned 4×, so the saving multiplies)
};

async function main() {
    const sharp = require('sharp');
    const { NodeIO } = await import('@gltf-transform/core');
    const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
    const { meshopt } = await import('@gltf-transform/functions');
    const { MeshoptEncoder, MeshoptDecoder } = await import('meshoptimizer');

    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;

    const io = new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({
            'meshopt.encoder': MeshoptEncoder,
            'meshopt.decoder': MeshoptDecoder,
        });

    let grandBefore = 0, grandAfter = 0;

    for (const [rel, cap] of Object.entries(TARGETS)) {
        const file = path.join(MODELS, rel);
        if (!fs.existsSync(file)) { console.log(`  SKIP (missing): ${rel}`); continue; }

        const before = fs.statSync(file).size;
        grandBefore += before;

        const doc = await io.read(file);
        let changed = false;
        const dimsLog = [];

        for (const tex of doc.getRoot().listTextures()) {
            const img = tex.getImage();
            if (!img) continue;
            const meta = await sharp(Buffer.from(img)).metadata();
            const maxDim = Math.max(meta.width || 0, meta.height || 0);
            if (maxDim <= cap) { dimsLog.push(`${meta.width}x${meta.height}(kept)`); continue; }

            // Scale the longest side to `cap`, preserving aspect ratio.
            const scale = cap / maxDim;
            const w = Math.max(1, Math.round((meta.width  || cap) * scale));
            const h = Math.max(1, Math.round((meta.height || cap) * scale));

            const mime = tex.getMimeType();
            let pipeline = sharp(Buffer.from(img)).resize(w, h, { fit: 'fill' });
            if (mime === 'image/png')       pipeline = pipeline.png();
            else if (mime === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 92 });
            else if (mime === 'image/webp') pipeline = pipeline.webp({ quality: 92 });
            const out = await pipeline.toBuffer();

            tex.setImage(new Uint8Array(out));
            changed = true;
            dimsLog.push(`${meta.width}x${meta.height}→${w}x${h}`);
        }

        if (!changed) {
            console.log(`  ${rel}  already within cap (${cap}) — skipped`);
            grandAfter += before;
            continue;
        }

        // Re-apply meshopt so the rewritten file keeps the same compression the
        // build pipeline expects (geometry only; textures are untouched by it).
        await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
        await io.write(file, doc);

        const after = fs.statSync(file).size;
        grandAfter += after;
        const saved = ((1 - after / before) * 100).toFixed(1);
        console.log(`  ${rel}  ${(before / 1024) | 0}KB → ${(after / 1024) | 0}KB  (${saved}% saved)   [${dimsLog.join(', ')}]`);
    }

    console.log(`\n  Total: ${(grandBefore / 1024) | 0}KB → ${(grandAfter / 1024) | 0}KB  (${((1 - grandAfter / grandBefore) * 100).toFixed(1)}% saved)\n`);
}

main().catch(err => { console.error(err); process.exit(1); });

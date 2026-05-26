/**
 * optimize-robin-bird.cjs — one-off shrinker for public/models/surface/robin_bird.glb
 *
 * The original is 26 MB. Only two of its 12 animation clips are actually used
 * (Robin_Bird_Idle = index 3, Robin_Bird_Call2 = index 10), and the two
 * 1024×1024 PNG textures are oversized for a small distant bird. This script:
 *
 *   1. Removes the 10 unused animation clips (~83% of skeleton anim data).
 *   2. Resizes both textures to 512×512 and re-encodes as WebP.
 *   3. Re-runs dedup + prune to drop the now-orphan accessors and samplers.
 *
 * Run: `node scripts/optimize-robin-bird.cjs`
 * Reads + writes public/models/surface/robin_bird.glb in place.
 */

const path = require('path');
const fs   = require('fs');
const sharp = require('sharp');
const { NodeIO } = require('@gltf-transform/core');
const { dedup, prune } = require('@gltf-transform/functions');

const KEEP_CLIPS = new Set(['Robin_Bird_Idle', 'Robin_Bird_Call2']);
const TARGET_TEX_SIZE = 512;

(async () => {
    const glbPath = path.resolve(__dirname, '..', 'public/models/surface/robin_bird.glb');
    const before = fs.statSync(glbPath).size;
    console.log(`Reading ${glbPath} (${(before / 1024 / 1024).toFixed(2)} MB)`);

    const io = new NodeIO();
    const doc = await io.read(glbPath);
    const root = doc.getRoot();

    // ── Animations ───────────────────────────────────────────────────────────
    // clip.dispose() alone does NOT cascade through channels/samplers/accessors,
    // and prune() doesn't reach them either because the channels are still alive
    // (orphaned). Explicit teardown is required to actually shrink the file.
    const allClips = root.listAnimations();
    let dropped = 0;
    for (const clip of allClips) {
        if (KEEP_CLIPS.has(clip.getName())) continue;
        for (const ch of clip.listChannels()) ch.dispose();
        for (const sm of clip.listSamplers()) {
            const inp = sm.getInput();
            const out = sm.getOutput();
            if (inp) inp.dispose();
            if (out) out.dispose();
            sm.dispose();
        }
        clip.dispose();
        dropped++;
    }
    console.log(`Animations: kept ${allClips.length - dropped}, dropped ${dropped}`);

    // ── Textures ─────────────────────────────────────────────────────────────
    for (const tex of root.listTextures()) {
        const img = tex.getImage();
        if (!img) continue;
        const resized = await sharp(Buffer.from(img))
            .resize(TARGET_TEX_SIZE, TARGET_TEX_SIZE, { fit: 'fill' })
            .webp({ quality: 85 })
            .toBuffer();
        tex.setImage(new Uint8Array(resized));
        tex.setMimeType('image/webp');
        console.log(`Texture "${tex.getName() || '<unnamed>'}" -> ${TARGET_TEX_SIZE}x${TARGET_TEX_SIZE} webp (${(resized.length / 1024).toFixed(0)} KB)`);
    }

    // ── Cleanup orphans + dedupe ─────────────────────────────────────────────
    await doc.transform(prune(), dedup());

    await io.write(glbPath, doc);
    const after = fs.statSync(glbPath).size;
    console.log(`Wrote ${glbPath} (${(after / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`Saved ${((before - after) / 1024 / 1024).toFixed(2)} MB (${((1 - after / before) * 100).toFixed(1)}%)`);
})();

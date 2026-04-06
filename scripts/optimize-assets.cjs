/**
 * optimize-assets.cjs
 * Optimizes GLB models (quantize, dedup, prune) and converts large PNG textures to WebP.
 *
 * Usage:  node scripts/optimize-assets.cjs
 *
 * What it does:
 *   1. Processes every .glb in public/models/ — applies vertex quantization,
 *      mesh deduplication, and unused-data pruning via @gltf-transform.
 *   2. Converts large PNG images in public/images/ to WebP using sharp.
 *
 * The originals are overwritten (GLBs) or kept alongside the WebP (PNGs).
 * Run this ONCE on initially-exported assets; re-run after adding new models.
 */

const fs   = require('fs');
const path = require('path');

const PUBLIC = path.resolve(__dirname, '..', 'public');

// ── GLB optimization ──────────────────────────────────────────────────────────
async function optimizeGLBs() {
    const { NodeIO }     = await import('@gltf-transform/core');
    const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
    const { dedup, prune, quantize, flatten, join } = await import('@gltf-transform/functions');

    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const modelsDir = path.join(PUBLIC, 'models');

    const glbFiles = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.glb')) glbFiles.push(full);
        }
    }
    walk(modelsDir);

    console.log(`\nFound ${glbFiles.length} GLB files.\n`);

    let totalBefore = 0;
    let totalAfter  = 0;

    for (const file of glbFiles) {
        const rel    = path.relative(PUBLIC, file);
        const before = fs.statSync(file).size;
        totalBefore += before;

        const doc = await io.read(file);

        // Apply optimizations — order matters
        // NOTE: quantize() is intentionally excluded — it reduces UV precision
        // enough to break colormap-based models (pug, gold_chest, etc.)
        await doc.transform(
            dedup(),                    // remove duplicate accessors/meshes/textures
            prune(),                    // remove unused nodes, materials, textures
        );

        await io.write(file, doc);

        const after = fs.statSync(file).size;
        totalAfter += after;

        const saved = ((1 - after / before) * 100).toFixed(1);
        console.log(`  ${rel}  ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB  (${saved}% saved)`);
    }

    console.log(`\n  GLB total: ${(totalBefore / 1024).toFixed(0)}KB → ${(totalAfter / 1024).toFixed(0)}KB  (${((1 - totalAfter / totalBefore) * 100).toFixed(1)}% saved)\n`);
}

// ── PNG → WebP conversion ─────────────────────────────────────────────────────
async function convertTextures() {
    const sharp = require('sharp');

    const imagesDir = path.join(PUBLIC, 'images');
    const MIN_SIZE  = 10 * 1024;  // only convert PNGs > 10KB

    const pngFiles = fs.readdirSync(imagesDir)
        .filter(f => f.endsWith('.png'))
        .map(f => path.join(imagesDir, f))
        .filter(f => fs.statSync(f).size > MIN_SIZE);

    if (pngFiles.length === 0) {
        console.log('No large PNG textures to convert.\n');
        return;
    }

    console.log(`Converting ${pngFiles.length} PNG textures to WebP...\n`);

    for (const file of pngFiles) {
        const before = fs.statSync(file).size;
        const webpPath = file.replace(/\.png$/, '.webp');

        await sharp(file).webp({ quality: 90 }).toFile(webpPath);

        const after = fs.statSync(webpPath).size;
        const saved = ((1 - after / before) * 100).toFixed(1);
        const rel   = path.relative(PUBLIC, file);
        console.log(`  ${rel} → .webp  ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB  (${saved}% saved)`);
    }
    console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('=== Asset Optimization ===\n');
    await optimizeGLBs();
    await convertTextures();
    console.log('Done! Review changes with `git diff --stat`.\n');
}

main().catch(err => { console.error(err); process.exit(1); });

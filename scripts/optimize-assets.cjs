/**
 * optimize-assets.cjs
 * Optimizes GLB models (dedup, prune, weld, meshopt) and converts large PNG
 * textures to WebP.
 *
 * Usage:
 *   node scripts/optimize-assets.cjs           — only re-optimize changed files (cached)
 *   node scripts/optimize-assets.cjs --force   — re-optimize everything
 *
 * Runs automatically as `prebuild` before `npm run build`. Originals are
 * overwritten in place. Cache lives at scripts/.optimize-cache.json (gitignored)
 * and tracks mtime+size per file — unchanged files are skipped, so the prebuild
 * stays fast on incremental builds.
 *
 * Because the cache is gitignored and mtime-based, it can't help on a fresh
 * clone (no cache, reset mtimes) — there the script would otherwise re-optimize
 * every GLB. Meshopt re-encoding is not byte-stable, so that would rewrite
 * already-optimized files with no visual change, churning git. To prevent it,
 * GLBs that already carry EXT_meshopt_compression are detected by content and
 * skipped (unless --force). Add a NEW raw GLB and it still gets optimized once.
 *
 * What it does:
 *   1. GLBs in public/models/: weld + dedup + prune via @gltf-transform.
 *      EXT_meshopt_compression encoding ('medium' level) is applied to files
 *      large enough to benefit and not in MESHOPT_EXCLUDE — the runtime
 *      GLTFLoaders are wired with MeshoptDecoder so the encoded files load
 *      transparently. (Pug + gold_chest are excluded because their colormap
 *      shading is sensitive to the UV quantization meshopt applies.)
 *   2. PNGs > 10KB in public/images/: converted to WebP alongside originals.
 */

const fs   = require('fs');
const path = require('path');

const PUBLIC = path.resolve(__dirname, '..', 'public');
const CACHE_PATH = path.join(__dirname, '.optimize-cache.json');
const FORCE = process.argv.includes('--force');

// ── Cache ────────────────────────────────────────────────────────────────────
// Maps relative file path → { mtimeMs, size } as it was AFTER the last optimization.
// A file is considered already-optimized if its current mtime+size match the cache.

function loadCache() {
    try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); }
    catch { return {}; }
}

function saveCache(cache) {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function isUpToDate(cache, file) {
    if (FORCE) return false;
    const rel = path.relative(PUBLIC, file);
    const entry = cache[rel];
    if (!entry) return false;
    const stat = fs.statSync(file);
    return stat.mtimeMs === entry.mtimeMs && stat.size === entry.size;
}

function recordOptimized(cache, file) {
    const rel = path.relative(PUBLIC, file);
    const stat = fs.statSync(file);
    cache[rel] = { mtimeMs: stat.mtimeMs, size: stat.size };
}

// Files whose geometry has vertices baked far from the local origin.
// Without centering, Three.js scales the offset along with the geometry,
// making the visible mesh translate when scaled instead of growing in place.
// See docs/SHADERS.md / SeaFloorDecor.ts pivot notes.
const CENTER_GEOMETRY_FILES = new Set([
    path.join('models', 'underwater', 'coral1.glb'),
    path.join('models', 'underwater', 'coral2.glb'),
]);

// Meshopt encoding quantizes vertex attributes (incl. UVs) — colormap-shaded
// models that read texels by exact UV can show banding/seams after compression.
// Skip those. Tiny GLBs are also skipped — the EXT_meshopt header overhead
// can outweigh the saving on a few-KB asset.
const MESHOPT_EXCLUDE = new Set([
    path.join('models', 'character', 'pug.glb'),
    path.join('models', 'overall', 'gold_chest.glb'),
]);
const MESHOPT_MIN_SIZE = 80 * 1024;

// Recenter every primitive in the doc so its bounding-box center is at (0,0,0).
// Idempotent — re-centering an already-centered mesh is a no-op.
async function centerGeometryInPlace(doc) {
    const root = doc.getRoot();
    for (const mesh of root.listMeshes()) {
        // Compute aggregate bbox across all primitives in this mesh so siblings
        // stay positioned relative to each other.
        let minX=Infinity, minY=Infinity, minZ=Infinity;
        let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
        for (const prim of mesh.listPrimitives()) {
            const pos = prim.getAttribute('POSITION');
            if (!pos) continue;
            const arr = pos.getArray();
            for (let i = 0; i < arr.length; i += 3) {
                if (arr[i]   < minX) minX = arr[i];   if (arr[i]   > maxX) maxX = arr[i];
                if (arr[i+1] < minY) minY = arr[i+1]; if (arr[i+1] > maxY) maxY = arr[i+1];
                if (arr[i+2] < minZ) minZ = arr[i+2]; if (arr[i+2] > maxZ) maxZ = arr[i+2];
            }
        }
        if (!isFinite(minX)) continue;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const cz = (minZ + maxZ) / 2;
        if (Math.abs(cx) < 1e-6 && Math.abs(cy) < 1e-6 && Math.abs(cz) < 1e-6) continue;

        for (const prim of mesh.listPrimitives()) {
            const pos = prim.getAttribute('POSITION');
            if (!pos) continue;
            const arr = pos.getArray();
            const out = new Float32Array(arr.length);
            for (let i = 0; i < arr.length; i += 3) {
                out[i]   = arr[i]   - cx;
                out[i+1] = arr[i+1] - cy;
                out[i+2] = arr[i+2] - cz;
            }
            pos.setArray(out);
        }
    }
}

// ── GLB optimization ──────────────────────────────────────────────────────────
async function optimizeGLBs(cache) {
    const { NodeIO }     = await import('@gltf-transform/core');
    const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
    const { dedup, prune, weld, meshopt } = await import('@gltf-transform/functions');
    const { MeshoptEncoder, MeshoptDecoder } = await import('meshoptimizer');

    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;

    const io = new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({
            'meshopt.encoder': MeshoptEncoder,
            'meshopt.decoder': MeshoptDecoder,
        });
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

    const toProcess = glbFiles.filter(f => !isUpToDate(cache, f));
    if (toProcess.length === 0) {
        console.log(`GLBs: ${glbFiles.length} files, all up to date.`);
        return;
    }

    console.log(`\nGLBs: ${toProcess.length} of ${glbFiles.length} need optimization.\n`);

    let totalBefore = 0;
    let totalAfter  = 0;
    let skipped     = 0;

    for (const file of toProcess) {
        const rel    = path.relative(PUBLIC, file);

        // Already-optimized guard — survives fresh clones, where the mtime+size
        // cache is gone and every file's mtime is reset to checkout time (so the
        // isUpToDate() fast-path above can't help). A GLB that already carries
        // EXT_meshopt_compression was encoded in a previous run or committed
        // pre-optimized. Re-encoding meshopt is NOT byte-stable — decode →
        // weld/dedup/prune → re-encode yields a slightly different binary with
        // no visual change — so reprocessing would only churn git with
        // meaningless diffs. Detect it from the file's own bytes and skip.
        // (--force still reprocesses everything by intent.)
        if (!FORCE && fs.readFileSync(file).includes('EXT_meshopt_compression')) {
            recordOptimized(cache, file);
            skipped++;
            continue;
        }

        const before = fs.statSync(file).size;
        totalBefore += before;

        const doc = await io.read(file);

        // Order matters: weld first (collapses duplicate verts), then dedup
        // (collapses duplicate accessors/meshes/textures), then prune (removes
        // anything now orphaned). Safe transforms — no lossy steps.
        await doc.transform(
            weld(),
            dedup(),
            prune(),
        );

        // Per-file fix: recenter geometry whose vertex offset was baked far
        // from the local origin. Without this, Three.js scaling sweeps the
        // mesh through space instead of growing it in place.
        if (CENTER_GEOMETRY_FILES.has(rel)) {
            await centerGeometryInPlace(doc);
        }

        // Apply Meshopt compression at the end so the EXT_meshopt header lives
        // on a fully-pruned doc. The runtime GLTFLoader is wired with
        // MeshoptDecoder, so .glb files with EXT_meshopt_compression load
        // transparently.
        const meshoptApplied = !MESHOPT_EXCLUDE.has(rel) && before >= MESHOPT_MIN_SIZE;
        if (meshoptApplied) {
            await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
        }

        await io.write(file, doc);

        const after = fs.statSync(file).size;
        totalAfter += after;

        const saved = ((1 - after / before) * 100).toFixed(1);
        const tag = meshoptApplied ? ' [meshopt]' : '';
        console.log(`  ${rel}  ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB  (${saved}% saved)${tag}`);

        recordOptimized(cache, file);
    }

    if (skipped > 0) {
        console.log(`  ${skipped} file(s) already meshopt-optimized — skipped (no churn).`);
    }
    if (totalBefore > 0) {
        console.log(`\n  GLB total: ${(totalBefore / 1024).toFixed(0)}KB → ${(totalAfter / 1024).toFixed(0)}KB  (${((1 - totalAfter / totalBefore) * 100).toFixed(1)}% saved)\n`);
    } else {
        console.log('');
    }
}

// ── PNG → WebP conversion ─────────────────────────────────────────────────────
async function convertTextures(cache) {
    const sharp = require('sharp');

    const imagesDir = path.join(PUBLIC, 'images');
    const MIN_SIZE  = 10 * 1024;  // only convert PNGs > 10KB

    // These textures are intentionally served as PNG (no WebP twin). The fire
    // spritesheet is loaded resolution-adaptively as PNG and the cloud sprite
    // reads best from PNG; converting them would recreate the orphaned .webp the
    // runtime no longer references. Keep them out of the conversion.
    const WEBP_EXCLUDE = new Set([
        'cloud10.png',
        'fire_spritesheet.png',
        'fire_spritesheet_mobile.png',
    ]);

    const pngFiles = fs.readdirSync(imagesDir)
        .filter(f => f.endsWith('.png') && !WEBP_EXCLUDE.has(f))
        .map(f => path.join(imagesDir, f))
        .filter(f => fs.statSync(f).size > MIN_SIZE);

    const toProcess = pngFiles.filter(f => !isUpToDate(cache, f));
    if (toProcess.length === 0) {
        if (pngFiles.length > 0) console.log(`PNGs: ${pngFiles.length} files, all up to date.`);
        return;
    }

    console.log(`Converting ${toProcess.length} PNG textures to WebP...\n`);

    for (const file of toProcess) {
        const before = fs.statSync(file).size;
        const webpPath = file.replace(/\.png$/, '.webp');

        await sharp(file).webp({ quality: 90 }).toFile(webpPath);

        const after = fs.statSync(webpPath).size;
        const saved = ((1 - after / before) * 100).toFixed(1);
        const rel   = path.relative(PUBLIC, file);
        console.log(`  ${rel} → .webp  ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB  (${saved}% saved)`);

        recordOptimized(cache, file);
    }
    console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(FORCE ? '=== Asset Optimization (forced) ===' : '=== Asset Optimization ===');
    const cache = loadCache();
    await optimizeGLBs(cache);
    await convertTextures(cache);
    saveCache(cache);
}

main().catch(err => { console.error(err); process.exit(1); });

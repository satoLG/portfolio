/**
 * render-paper-grain.cjs — bake the paper-grain noise tiles.
 *
 * The board's paper (the notice, the achievements sheet, every post-it) gets its
 * fibre grain from an feTurbulence tile carried inline in style.css as a data
 * URI. It looks right, but an SVG filter is not an image: the browser has to RUN
 * the filter to rasterize it, and it re-runs it whenever the tile is needed at a
 * new resolution — which, for DOM living inside a CSS3D transform that scales
 * with the camera, is every time the visitor zooms the board. Four octaves of
 * fractal noise, on up to two dozen post-its.
 *
 * So the filter is run ONCE, here, and the result committed as a plain image the
 * browser can simply decode and tile. stitchTiles='stitch' makes the output
 * seamlessly tileable, so a single tile is all that is needed.
 *
 * This is a MANUAL script — the tiles are committed. Re-run it only if the
 * turbulence parameters below change:
 *
 *   node scripts/render-paper-grain.cjs
 *
 * Chromium is used rather than a hand-rolled Perlin implementation because
 * feTurbulence is specified down to the reference code AND runs in linearRGB by
 * default; reproducing both faithfully by hand is a good way to ship grain that
 * is subtly wrong. Baking a browser render also makes the grain identical in
 * Safari and Firefox, which rasterize feTurbulence slightly differently.
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const sharp = require('sharp');

const OUT_DIR = path.resolve(__dirname, '..', 'public', 'images', 'paper');

// One entry per DISTINCT tile. The notice and the achievements sheet used
// identical turbulence (only their filter ids differed), so they share one.
const TILES = [
    { name: 'grain-sheet',  size: 140, baseFrequency: 0.85, numOctaves: 4, opacity: 0.42 },
    { name: 'grain-postit', size: 90,  baseFrequency: 0.9,  numOctaves: 3, opacity: 0.34 },
];

// SINGLE quotes inside, exactly as the CSS data URIs have them: the markup is
// about to be dropped into a double-quoted src attribute, and a double quote in
// here would close it early and leave a broken image (which renders as a sparse
// speckle rather than noise — very easy to mistake for grain).
function svgFor(t) {
    return `<svg xmlns='http://www.w3.org/2000/svg' width='${t.size}' height='${t.size}'>` +
        `<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='${t.baseFrequency}' ` +
        `numOctaves='${t.numOctaves}' stitchTiles='stitch'/>` +
        `<feColorMatrix type='saturate' values='0'/></filter>` +
        `<rect width='${t.size}' height='${t.size}' filter='url(%23g)' opacity='${t.opacity}'/></svg>`;
}

(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    // The pinned playwright build and the browser bundle in this environment
    // don't always agree on a revision number; point at the installed binary
    // directly when it is there rather than trying to download one.
    const bundled = '/opt/pw-browsers/chromium';
    const browser = await chromium.launch(
        fs.existsSync(bundled) ? { executablePath: bundled } : {},
    );
    const page = await browser.newPage();

    for (const t of TILES) {
        await page.setViewportSize({ width: t.size, height: t.size });
        // The page is nothing but the tile at 1:1, with no background of its
        // own — omitBackground then keeps the turbulence's own alpha, which the
        // multiply blend in style.css depends on.
        await page.setContent(
            `<style>html,body{margin:0;padding:0;background:transparent}` +
            `img{display:block;width:${t.size}px;height:${t.size}px}</style>` +
            `<img src="data:image/svg+xml;utf8,${svgFor(t)}">`,
        );
        await page.waitForTimeout(150);
        const png = await page.screenshot({ omitBackground: true });

        // Lossless: this is noise, and lossy compression would either smear it
        // into blotches or cost more than the noise itself.
        const webp = await sharp(png).webp({ lossless: true, effort: 6 }).toBuffer();
        const out = path.join(OUT_DIR, `${t.name}.webp`);
        fs.writeFileSync(out, webp);
        console.log(`${path.relative(process.cwd(), out)}  ${t.size}x${t.size}  ${(webp.length / 1024).toFixed(1)} KB`);
    }

    await browser.close();
})();

#!/usr/bin/env node
/**
 * generate-tech-icons.cjs — bakes the technology glyphs the Experiência cards
 * wear as tags into public/images/tech/<slug>.svg.
 *
 * Source is the `simple-icons` package (a devDependency): one path and one
 * official brand hex per technology. Two things are baked in here rather than
 * left to CSS:
 *
 *   1. THE FILL. The glyph is an <img>, not inline SVG, so `currentColor` and
 *      CSS filters are out of reach — the colour has to be in the file.
 *   2. THE CONTRAST LIFT. The tags sit on the card's punched ink, which shows
 *      the page background: black. Several official brand colours are nearly
 *      black themselves (Django #092E20, pandas #150458, Three.js #000000) and
 *      would vanish. Each colour is lifted in HSL — hue and saturation kept,
 *      lightness raised only as far as it takes to clear MIN_CONTRAST against
 *      black. Brands that already read (JavaScript, Docker, Redis) come through
 *      untouched, so what you see is still the brand's own colour.
 *
 * Run: npm run generate-tech-icons
 */

const fs = require('fs');
const path = require('path');
const si = require('simple-icons');

const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'tech');

// WCAG contrast ratio against pure black is (L + 0.05) / 0.05. 3.5 is the point
// where these small glyphs stop reading as "a dark smudge" on the ink.
const MIN_CONTRAST = 3.5;

/** Every technology the cards can tag, in the order they tend to be listed.
 *  Key = the slug used in CarouselContent.ts; value = the simple-icons export. */
const ICONS = {
    delphi: 'siDelphi',
    javascript: 'siJavascript',
    mysql: 'siMysql',
    python: 'siPython',
    flask: 'siFlask',
    mongodb: 'siMongodb',
    redis: 'siRedis',
    docker: 'siDocker',
    django: 'siDjango',
    fastapi: 'siFastapi',
    pandas: 'siPandas',
    html5: 'siHtml5',
    css: 'siCss',
};

// ── colour helpers ───────────────────────────────────────────────────────────

function hexToRgb(hex) {
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
    return [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** WCAG relative luminance. */
function luminance([r, g, b]) {
    const f = v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h, s, l];
}

function hslToRgb([h, s, l]) {
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = t => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

/** Raise lightness — hue and saturation untouched — until the colour clears
 *  MIN_CONTRAST on black. A pure-black brand has no hue to keep, so it lands on
 *  a neutral grey, which is the honest result. */
function liftForBlack(hex) {
    const rgb = hexToRgb(hex);
    if ((luminance(rgb) + 0.05) / 0.05 >= MIN_CONTRAST) return hex;
    const [h, s] = rgbToHsl(rgb);
    for (let l = 0.02; l <= 1.0001; l += 0.01) {
        const lifted = hslToRgb([h, s, l]);
        if ((luminance(lifted) + 0.05) / 0.05 >= MIN_CONTRAST) return rgbToHex(lifted);
    }
    return 'ffffff';
}

// ── generate ─────────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
const missing = [];
for (const [slug, exportName] of Object.entries(ICONS)) {
    const icon = si[exportName];
    if (!icon) { missing.push(`${slug} (${exportName})`); continue; }
    const fill = liftForBlack(icon.hex);
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="${icon.title}">` +
        `<title>${icon.title}</title>` +
        `<path fill="#${fill}" d="${icon.path}"/>` +
        `</svg>\n`;
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.svg`), svg);
    written++;
    const note = fill.toLowerCase() === icon.hex.toLowerCase() ? '' : `  (lifted from #${icon.hex})`;
    console.log(`  ${slug.padEnd(12)} #${fill}${note}`);
}

console.log(`\n${written} tech glyph(s) written to public/images/tech/`);
if (missing.length) {
    console.warn(`NOT IN simple-icons, skipped: ${missing.join(', ')}`);
    process.exitCode = 1;
}

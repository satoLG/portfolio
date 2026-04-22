/**
 * capture-demo.cjs
 *
 * 1. Starts the Vite dev server
 * 2. Clicks the Start button and waits for intro to settle
 * 3. Clicks the rightmost tree apple 3 times (triggers fall on 3rd click)
 * 4. Records from first click until the apple lands on the ground
 * 5. Converts WebM → GIF via ffmpeg (palette trick for quality)
 *
 * Usage:
 *   node scripts/capture-demo.cjs
 *
 * Output:
 *   docs/demo.gif
 */

const { chromium }    = require('playwright');
const { execSync, spawn } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const http  = require('http');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT        = 3001;
const URL         = `http://localhost:${PORT}`;
const FFMPEG      = 'C:/Users/leona/Downloads/ffmpeg-master-latest-win64-gpl-shared/ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe';
const ROOT        = path.join(__dirname, '..');
const DOCS_DIR    = path.join(ROOT, 'docs');
const WEBM_PATH   = path.join(DOCS_DIR, 'demo_raw.webm');
const GIF_PATH    = path.join(DOCS_DIR, 'demo.gif');
const PALETTE     = path.join(DOCS_DIR, 'palette.png');
const VIEWPORT    = { width: 1280, height: 720 };
const GIF_FPS     = 12;
const GIF_WIDTH   = 800;

// ── Apple click config ────────────────────────────────────────────────────────
// Screen coords of the rightmost tree apple (apple2) in 1280×720 viewport.
// If the clicks miss, adjust these — open the dev server and hover over the
// apple to find its approximate screen position.
const APPLE_X = 555;
const APPLE_Y = 258;

const INTRO_WAIT_MS    = 5500;   // wait after clicking Start for camera descent to finish
const CLICK_INTERVAL_MS = 2000;  // gap between each apple click (shows the swing)
const FALL_WAIT_MS     = 5000;   // wait after 3rd click for apple to land and settle
// Total recording time from first click:
const SCENE_MS = CLICK_INTERVAL_MS * 2 + FALL_WAIT_MS;  // = 9000 ms

// ── Helpers ───────────────────────────────────────────────────────────────────
function waitForServer(url, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const attempt = () => http.get(url, res => {
            if (res.statusCode < 500) return resolve();
            schedule();
        }).on('error', () => Date.now() > deadline ? reject(new Error('Timeout')) : schedule());
        const schedule = () => setTimeout(attempt, 600);
        attempt();
    });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
    if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

    // 1. Start dev server
    console.log(`[1/5] Starting Vite dev server on port ${PORT}...`);
    const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
        cwd: ROOT,
        shell: true,
        stdio: 'pipe',
    });
    server.stdout.on('data', d => process.stdout.write(d));
    server.stderr.on('data', d => process.stdout.write(d));

    await waitForServer(URL);
    console.log('\n[1/5] Server ready.\n');

    // 2. Launch Playwright with video recording
    console.log('[2/5] Launching browser with video recording...');
    const browser = await chromium.launch({
        headless: false,
        args: [
            '--disable-web-security',
            '--autoplay-policy=no-user-gesture-required',
        ],
    });

    const context = await browser.newContext({
        viewport: VIEWPORT,
        recordVideo: {
            dir: DOCS_DIR,
            size: VIEWPORT,
        },
    });

    const page = await context.newPage();

    // 3. Navigate and wait for Start button
    console.log('[3/5] Loading page and waiting for assets...');
    const pageStartedAt = Date.now();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(
        () => {
            const btn = document.getElementById('start-button');
            return btn && !btn.disabled;
        },
        { timeout: 90000 }
    );
    console.log('[3/5] Assets loaded — clicking Start...');
    await page.click('#start-button');

    // 4. Wait for intro camera descent to finish, then click the apple 3 times
    console.log(`[4/5] Waiting ${INTRO_WAIT_MS / 1000}s for intro to settle...`);
    await sleep(INTRO_WAIT_MS);

    console.log(`[4/5] Clicking apple at (${APPLE_X}, ${APPLE_Y}) — 3 times...`);
    const firstClickAt = Date.now();

    await page.mouse.click(APPLE_X, APPLE_Y);
    console.log('  click 1');
    await sleep(CLICK_INTERVAL_MS);

    await page.mouse.click(APPLE_X, APPLE_Y);
    console.log('  click 2');
    await sleep(CLICK_INTERVAL_MS);

    await page.mouse.click(APPLE_X, APPLE_Y);
    console.log('  click 3 — apple should detach and fall');

    console.log(`[4/5] Waiting ${FALL_WAIT_MS / 1000}s for apple to land...`);
    await sleep(FALL_WAIT_MS);

    const videoPath = await page.video().path();
    await context.close();
    await browser.close();
    server.kill();

    fs.renameSync(videoPath, WEBM_PATH);
    console.log(`[4/5] Video saved: ${WEBM_PATH}\n`);

    // 5. Convert WebM → GIF (trimmed to the apple interaction only)
    console.log('[5/5] Converting to GIF...');

    if (fs.existsSync(PALETTE)) fs.unlinkSync(PALETTE);
    if (fs.existsSync(GIF_PATH)) fs.unlinkSync(GIF_PATH);

    const sceneStartSec = ((firstClickAt - pageStartedAt) / 1000).toFixed(2);
    const TRIM   = `-ss ${sceneStartSec} -t ${SCENE_MS / 1000}`;
    const FILTER = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos`;

    execSync(
        `"${FFMPEG}" ${TRIM} -i "${WEBM_PATH}" -vf "${FILTER},palettegen=max_colors=128:stats_mode=diff" -update 1 "${PALETTE}"`,
        { stdio: 'inherit' }
    );

    execSync(
        `"${FFMPEG}" ${TRIM} -i "${WEBM_PATH}" -i "${PALETTE}" -lavfi "${FILTER} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5" "${GIF_PATH}"`,
        { stdio: 'inherit' }
    );

    fs.unlinkSync(PALETTE);
    fs.unlinkSync(WEBM_PATH);

    const size = (fs.statSync(GIF_PATH).size / 1024 / 1024).toFixed(1);
    console.log(`\n✓ Done → ${GIF_PATH}  (${size} MB)`);
})().catch(err => {
    console.error('\n✗ Error:', err.message);
    process.exit(1);
});

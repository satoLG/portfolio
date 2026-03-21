/**
 * webkit-browser.cjs
 *
 * Opens the dev server (http://localhost:3000) in a persistent Playwright
 * WebKit browser window — behaves like a real Safari/WebKit session.
 *
 * Usage:
 *   npm run webkit           → connects to the running dev server
 *   npm run webkit -- --url http://localhost:4173   → custom URL (e.g. preview)
 *   npm run webkit -- --headless  → headless mode (no visible window)
 *
 * The browser stays open until you press Ctrl+C in the terminal.
 */

'use strict';

const { webkit } = require('playwright');

// ── Parse CLI args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag, fallback) {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const url      = getArg('--url', 'http://localhost:3000');
const headless = args.includes('--headless');

// ── Wait for dev server ────────────────────────────────────────────────────────
const http  = require('http');
const https = require('https');

function waitForServer(targetUrl, timeoutMs = 60000) {
    const mod = targetUrl.startsWith('https') ? https : http;
    const start = Date.now();
    return new Promise((resolve, reject) => {
        function attempt() {
            mod.get(targetUrl, res => {
                res.resume(); // drain
                resolve();
            }).on('error', () => {
                if (Date.now() - start > timeoutMs) {
                    reject(new Error(`[webkit] Server not available at ${targetUrl} after ${timeoutMs / 1000}s.\nMake sure "npm run dev" is running first.`));
                    return;
                }
                setTimeout(attempt, 500);
            });
        }
        attempt();
    });
}

// ── Launch ─────────────────────────────────────────────────────────────────────
(async () => {
    console.log(`[webkit] Waiting for server at ${url} ...`);
    await waitForServer(url);
    console.log(`[webkit] Server ready.`);
    console.log(`[webkit] Launching WebKit browser${headless ? ' (headless)' : ''}`);
    console.log(`[webkit] Opening → ${url}`);
    console.log(`[webkit] Press Ctrl+C to close\n`);

    const browser = await webkit.launch({
        headless,
        // slowMo useful for visual debugging — remove or set to 0 for normal speed
        slowMo: 0,
    });

    const context = await browser.newContext({
        // Match a common Safari/iOS viewport for realistic WebKit testing
        viewport: { width: 1280, height: 800 },
        // Emulate Safari user agent so any UA-sniffing code in the site behaves correctly
        userAgent: [
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            'AppleWebKit/605.1.15 (KHTML, like Gecko)',
            'Version/17.4 Safari/605.1.15',
        ].join(' '),
        // Allow autoplay — important for audio/video on the site
        permissions: [],
        // bypass CSP so that cross-origin iframes (e.g. os.henryheffernan.com)
        // are not blocked by X-Frame-Options / frame-ancestors headers.
        bypassCSP: true,
        ignoreHTTPSErrors: true,  // dev server uses http; avoids cert warnings
    });

    const page = await context.newPage();

    // Forward browser console messages to the terminal so you see JS errors
    page.on('console', msg => {
        const type = msg.type();
        const text = msg.text();
        const prefix = type === 'error' ? '[webkit:error]' :
                       type === 'warning' ? '[webkit:warn]' : '[webkit:log]';
        console.log(`${prefix} ${text}`);
    });

    page.on('pageerror', err => {
        console.error('[webkit:pageerror]', err.message);
    });

    // Strip X-Frame-Options and CSP frame-ancestors from cross-origin iframe responses.
    // bypassCSP:true is a Chromium-only CDP command; WebKit needs route interception.
    await page.route('**/*', async route => {
        const reqUrl = route.request().url();
        // blob:, data:, etc. cannot be fetched via route.fetch() — pass through unchanged
        if (!reqUrl.startsWith('http://') && !reqUrl.startsWith('https://')) {
            return route.continue();
        }
        // localhost requests don't need header stripping — skip to avoid overhead
        if (reqUrl.includes('localhost') || reqUrl.includes('127.0.0.1')) {
            return route.continue();
        }
        let response;
        try {
            response = await route.fetch();
        } catch (_) {
            // Server unreachable / connection refused — let the browser handle it
            return route.continue();
        }
        const headers = { ...response.headers() };
        delete headers['x-frame-options'];
        delete headers['X-Frame-Options'];
        if (headers['content-security-policy']) {
            headers['content-security-policy'] = headers['content-security-policy']
                .replace(/frame-ancestors[^;]*(;|$)/gi, '');
        }
        await route.fulfill({ response, headers });
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(err => {
        console.error(`[webkit] Navigation failed: ${err.message}`);
        process.exit(1);
    });

    // ── Click the start button to unblock the WebGL render loop ─────────────
    // setSceneReady() (which enables MonitorScreen.render) is only called from
    // the start button's onclick handler. Without this click, iframeEl.src is
    // never set and the CSS3D render loop never runs.
    console.log('[webkit] Waiting for start button to become enabled...');
    await page.waitForSelector('#start-button:not([disabled])', { timeout: 60000 })
        .catch(() => console.warn('[webkit] Start button never enabled — proceeding anyway'));
    console.log('[webkit] Clicking start button...');
    await page.click('#start-button').catch(err => console.warn('[webkit] Click failed:', err.message));

    // ── CSS3D diagnostic — awaited in the main async chain ───────────────────
    console.log('[webkit] Waiting 10s for scene to boot and first CSS3D render...');
    await page.waitForTimeout(10000);
    console.log('[webkit] Running CSS3D diagnostic now...');

    const report = await page.evaluate(() => {
        function css(el, prop) {
            return window.getComputedStyle(el).getPropertyValue(prop);
        }
        function snap(el, label) {
            return {
                label, tag: el.tagName, id: el.id,
                inline: el.style.cssText.substring(0, 250),
                overflow:          css(el, 'overflow'),
                transformStyle:    css(el, 'transform-style'),
                wkTransformStyle:  css(el, '-webkit-transform-style'),
                perspective:       css(el, 'perspective'),
                wkPerspective:     css(el, '-webkit-perspective'),
                transform:         css(el, 'transform').substring(0, 80),
                display:           css(el, 'display'),
                position:          css(el, 'position'),
                zIndex:            css(el, 'z-index'),
                opacity:           css(el, 'opacity'),
                willChange:        css(el, 'will-change'),
            };
        }

        const out = [];

        // body + html stats
        out.push(snap(document.body, 'BODY'));
        out.push(snap(document.documentElement, 'HTML'));

        // All divs that are direct children of body (the full stacking layer list)
        const bodyChildren = Array.from(document.body.children);
        out.push({ bodyChildCount: bodyChildren.length, tags: bodyChildren.map(e => e.tagName + (e.id ? '#'+e.id : '')).join(', ') });

        const canvas = document.querySelector('canvas');
        if (!canvas) { out.push({ ERROR: 'no canvas' }); return out; }
        out.push(snap(canvas, 'CANVAS'));

        // Every sibling before the canvas
        let sib = canvas.previousElementSibling, si = 0;
        while (sib) {
            out.push(snap(sib, 'PRE-CANVAS-SIB-' + si));
            // Walk down up to 5 levels
            let cur = sib.firstElementChild, depth = 0;
            while (cur && depth < 5) {
                const label = '  L' + depth + ' ' + cur.tagName + (cur.id ? '#'+cur.id : '');
                out.push(snap(cur, label));
                if (cur.tagName === 'IFRAME') {
                    out.push({ IFRAME_SRC: cur.src, w: cur.offsetWidth, h: cur.offsetHeight, visible: cur.offsetWidth > 0 });
                }
                // also check for iframes deeper
                const iframes = cur.querySelectorAll('iframe');
                iframes.forEach((f, fi) => {
                    out.push(snap(f, '  IFRAME-' + fi));
                    out.push({ IFRAME_SRC: f.src, w: f.offsetWidth, h: f.offsetHeight, visible: f.offsetWidth > 0 });
                });
                cur = cur.firstElementChild;
                depth++;
            }
            sib = sib.previousElementSibling;
            si++;
        }
        return out;
    }).catch(err => {
        return [{ EVALUATE_ERROR: err.message, stack: err.stack }];
    });

    console.log('\n[webkit:css3d-diag] ══════════════════════════════════════════');
    report.forEach(item => console.log(JSON.stringify(item)));
    console.log('[webkit:css3d-diag] ══════════════════════════════════════════\n');

    // Keep the process alive so the browser window stays open
    await new Promise(resolve => {
        process.on('SIGINT',  resolve);
        process.on('SIGTERM', resolve);
    });

    console.log('\n[webkit] Closing browser...');
    await browser.close();
    process.exit(0);
})();

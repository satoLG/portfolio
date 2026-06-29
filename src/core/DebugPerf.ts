// DEBUG-PERF — TEMPORARY on-screen device + FPS readout.
// Shows the signals the auto-tier guess relies on (GPU string, cores, RAM, DPR,
// refresh rate) plus live FPS, so we can calibrate the static thresholds against
// real target devices (Redmi 11 / iPhone 14) without devtools. Remove this whole
// file and its single call site (Scene.Start) before merging.

import { getDeviceInfo } from "./DeviceCapability";

let _initialized = false;

export function initDebugPerfOverlay(): void {
    if (_initialized) return;
    if (typeof document === 'undefined') return;
    _initialized = true;

    const panel = document.createElement('div');
    panel.id = 'debug-perf-overlay';
    Object.assign(panel.style, {
        position: 'fixed',
        left: '0',
        bottom: '0',
        zIndex: '99999',
        padding: '6px 8px',
        background: 'rgba(0,0,0,0.6)',
        font: '600 12px/1.35 monospace',
        color: '#fff',
        pointerEvents: 'none',
        whiteSpace: 'pre',
        maxWidth: '70vw',
    });
    panel.textContent = 'FPS --';

    const mount = () => document.body.appendChild(panel);
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);

    // Static device info (read once).
    const info = getDeviceInfo();
    const staticLines = [
        `gpu:   ${info.gpu}`,
        `cores: ${info.cores}   mem: ${info.memory || '?'}GB   dpr: ${info.dpr}`,
        `mobile:${info.mobile} ios:${info.ios}`,
    ].join('\n');

    // Live FPS (rolling average over ~30 frames).
    let last = performance.now();
    const samples: number[] = [];
    const tick = () => {
        const now = performance.now();
        const dt = now - last;
        last = now;
        if (dt > 0) {
            samples.push(1000 / dt);
            if (samples.length > 30) samples.shift();
            let sum = 0;
            for (const s of samples) sum += s;
            const fps = sum / samples.length;
            const hz = getDeviceInfo().refreshHz;
            panel.textContent = `FPS ${fps.toFixed(0)}${hz ? `  (~${hz}Hz)` : ''}\n${staticLines}`;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

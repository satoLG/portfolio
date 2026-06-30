/**
 * DeviceCapability.ts
 *
 * Picks an initial graphics tier from cheap device signals, and runs a
 * downgrade-only FPS governor that corrects the guess against real performance.
 *
 * Why hybrid: a static guess alone can't reliably rank devices — iOS Safari
 * masks the GPU model (every iPhone reports "Apple GPU") and exposes no
 * deviceMemory, so a strong and a weak iPhone look identical. The governor
 * measures the actual frame rate and steps the tier down when it's sustainedly
 * low, which is what ultimately lands a Redmi 11 on 'low' and keeps an
 * iPhone 14 on 'high'. The static guess only sets a sensible STARTING tier
 * (and, since the governor only ever downgrades, the per-device ceiling).
 */

export type Tier = 'low' | 'medium' | 'high';

// ── Static signals ────────────────────────────────────────────────────────────

const _ua = navigator.userAgent;
const _isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(_ua) || window.innerWidth < 768;
const _isIOS = /iPad|iPhone|iPod/.test(_ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Read the unmasked GPU renderer string (lowercase). Empty if unavailable. */
function readGPURenderer(): string {
    try {
        const canvas = document.createElement('canvas');
        const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
        if (!gl) return '';
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        // Drop the throwaway context so it doesn't sit around.
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return String(raw || '').toLowerCase();
    } catch {
        return '';
    }
}

let _gpu = '';
function gpu(): string { return _gpu || (_gpu = readGPURenderer()); }

export interface DeviceInfo {
    gpu: string;
    cores: number;
    memory: number;   // GB, 0 if unknown (iOS never reports this)
    dpr: number;
    mobile: boolean;
    ios: boolean;
    refreshHz: number; // 0 until measured
}

let _refreshHz = 0;

export function getDeviceInfo(): DeviceInfo {
    return {
        gpu: gpu() || '(hidden)',
        cores: (navigator as any).hardwareConcurrency || 0,
        memory: (navigator as any).deviceMemory || 0,
        dpr: window.devicePixelRatio || 1,
        mobile: _isMobile,
        ios: _isIOS,
        refreshHz: _refreshHz,
    };
}

/**
 * Best-effort starting tier. Errs optimistic for devices we can't read (iOS,
 * desktop, unknown Android) because the governor can only ever lower it.
 * Thresholds are intentionally simple and will be calibrated against real
 * Redmi 11 / iPhone 14 readouts.
 */
export function guessInitialTier(): Tier {
    if (!_isMobile) return 'high';   // desktop
    if (_isIOS) return 'high';       // Apple GPUs are strong; governor demotes old/weak iPhones

    // Android (and other mobile). A downgrade-only governor can only REACH 'high'
    // if it STARTS there — so any device powerful enough to hold the frame rate
    // must start high, not just iOS or GPUs we happen to recognise. We therefore
    // default to 'high' and let the governor lower it. Only devices we can
    // positively flag as weak start low, to spare them a janky first few seconds
    // before the governor catches up.
    const g = gpu();
    const mem = (navigator as any).deviceMemory || 0;   // GB, 0 = unknown

    // Clearly weak/entry mobile GPUs: Adreno 3xx–5xx & 60x–61x, Mali T/G3x/G5(0-2)/4xx,
    // PowerVR, VideoCore. Strong/mid parts (Adreno 62x+/7xx/8xx, Mali G57+/G6x/G7x/
    // G9x/Immortalis) are intentionally NOT here — they start high and the governor
    // decides. (Redmi 11 = Adreno 610 / Mali-G52 → matches → starts low.)
    const weakGPU = /(adreno \(?tm\)? ?([3-5]\d\d|6[01]\d)|mali-(t\d|g3\d|g5[0-2]|4\d\d)|powervr|videocore)/.test(g);
    const lowRAM = mem > 0 && mem <= 3;
    if (weakGPU || lowRAM) return 'low';

    return 'high';
}

// ── Downgrade-only FPS governor ────────────────────────────────────────────────

const ORDER: Tier[] = ['low', 'medium', 'high'];
export function lowerTier(t: Tier): Tier | null {
    const i = ORDER.indexOf(t);
    return i > 0 ? ORDER[i - 1] : null;
}

interface GovernorCfg {
    targetFps?: number;   // downgrade if the windowed average drops below this
    windowMs?: number;    // length of each measurement window
    warmupMs?: number;    // settle time after start / after a tier change
    getTier: () => Tier;
    downgrade: () => void;   // caller drops the tier (apply preset + persist + UI)
    ready?: () => boolean;   // only measure when true (skip loading screen / intro)
}

let _raf = 0;
let _running = false;

export function stopPerfGovernor(): void {
    _running = false;
    if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
}

export function startPerfGovernor(cfg: GovernorCfg): void {
    stopPerfGovernor();
    const targetFps = cfg.targetFps ?? 30;
    const windowMs = cfg.windowMs ?? 3000;
    const warmupMs = cfg.warmupMs ?? 2500;

    _running = true;
    let last = performance.now();
    let warmupUntil = last + warmupMs;
    let winStart = last;
    let frames = 0;
    let elapsed = 0;
    // Track display refresh so we don't confuse "capped at refresh rate" with slow.
    let refreshSamples = 0;

    const tick = () => {
        if (!_running) return;
        const now = performance.now();
        const dt = now - last;
        last = now;

        // Estimate refresh rate from the fastest frames seen (first ~120 frames).
        if (refreshSamples < 120 && dt > 0) {
            const inst = 1000 / dt;
            if (inst > _refreshHz) _refreshHz = Math.min(240, Math.round(inst));
            refreshSamples++;
        }

        // Hold off entirely until the scene is actually rendering — a long load
        // would otherwise look like a slow device and trigger a false downgrade.
        if (cfg.ready && !cfg.ready()) {
            warmupUntil = now + warmupMs;
            frames = 0; elapsed = 0;
            _raf = requestAnimationFrame(tick);
            return;
        }

        if (now >= warmupUntil) {
            frames++;
            elapsed += dt;
            if (elapsed >= windowMs) {
                const avg = (frames * 1000) / elapsed;
                frames = 0; elapsed = 0; winStart = now;
                if (cfg.getTier() !== 'low' && avg < targetFps) {
                    cfg.downgrade();
                    // Let the new tier settle before measuring again.
                    warmupUntil = performance.now() + warmupMs;
                }
            }
        } else {
            winStart = now;
        }
        void winStart;

        _raf = requestAnimationFrame(tick);
    };
    _raf = requestAnimationFrame(tick);
}

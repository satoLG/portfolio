/**
 * DeviceCapability.ts
 *
 * Picks the graphics tier from cheap device signals at startup. No runtime
 * monitoring — whatever this returns is what the scene uses for the session.
 */

export type Tier = 'low' | 'high';

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
}

export function getDeviceInfo(): DeviceInfo {
    return {
        gpu: gpu() || '(hidden)',
        cores: (navigator as any).hardwareConcurrency || 0,
        memory: (navigator as any).deviceMemory || 0,
        dpr: window.devicePixelRatio || 1,
        mobile: _isMobile,
        ios: _isIOS,
    };
}

/**
 * Best-effort starting (and only) tier, from static device signals alone.
 * Errs optimistic for devices we can't read (iOS, desktop, unknown Android).
 */
export function guessInitialTier(): Tier {
    if (!_isMobile) return 'high';   // desktop
    if (_isIOS) return 'high';       // Apple GPUs are strong; GPU model is masked on iOS Safari

    // Android (and other mobile). Only devices we can positively flag as weak
    // start low; everything else defaults to high.
    const g = gpu();
    const mem = (navigator as any).deviceMemory || 0;   // GB, 0 = unknown

    // Clearly weak/entry mobile GPUs: Adreno 3xx–5xx & 60x–61x, Mali T/G3x/G5(0-2)/4xx,
    // PowerVR, VideoCore. Strong/mid parts (Adreno 62x+/7xx/8xx, Mali G57+/G6x/G7x/
    // G9x/Immortalis) are intentionally NOT here — they start high.
    // (Redmi 11 = Adreno 610 / Mali-G52 → matches → starts low.)
    const weakGPU = /(adreno \(?tm\)? ?([3-5]\d\d|6[01]\d)|mali-(t\d|g3\d|g5[0-2]|4\d\d)|powervr|videocore)/.test(g);
    const lowRAM = mem > 0 && mem <= 3;
    if (weakGPU || lowRAM) return 'low';

    return 'high';
}

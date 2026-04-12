import {
    BoxGeometry,
    Mesh,
    RawShaderMaterial,
    Group,
    Data3DTexture,
    RGBAFormat,
    LinearFilter,
    RepeatWrapping,
    BackSide,
    GLSL3,
} from 'three';
import * as CC from '../scene/config/SkyConfig';

// ── Device quality tier ───────────────────────────────────────────────────────
// Inline detection (avoids circular dep with Scene.ts which imports Clouds).
const _isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || window.innerWidth < 768;

// Scale noise texture size to device capability.
// 64³ = 262 144 voxels (desktop) · 32³ = 32 768 (mobile) — 8× cheaper to build
// and to sample (smaller 3-D texture → better GPU cache utilisation).
const NOISE_SIZE = _isMobile ? 32 : 64;

function buildNoiseTexture(): Data3DTexture {
    const N = NOISE_SIZE;
    function octave(nc: number): Float32Array {
        const grid = new Float32Array(nc * nc * nc);
        for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
        const out = new Float32Array(N * N * N);
        for (let iz = 0; iz < N; iz++) {
            for (let iy = 0; iy < N; iy++) {
                for (let ix = 0; ix < N; ix++) {
                    const tx = (ix / N) * nc, ty = (iy / N) * nc, tz = (iz / N) * nc;
                    const x0 = Math.floor(tx) % nc, x1 = (x0 + 1) % nc;
                    const y0 = Math.floor(ty) % nc, y1 = (y0 + 1) % nc;
                    const z0 = Math.floor(tz) % nc, z1 = (z0 + 1) % nc;
                    const fx = tx - Math.floor(tx), fy = ty - Math.floor(ty), fz = tz - Math.floor(tz);
                    const ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy), uz = fz*fz*(3-2*fz);
                    const g = (z: number, y: number, x: number) => grid[z*nc*nc + y*nc + x];
                    out[iz*N*N + iy*N + ix] =
                        g(z0,y0,x0)*(1-ux)*(1-uy)*(1-uz) + g(z0,y0,x1)*ux*(1-uy)*(1-uz) +
                        g(z0,y1,x0)*(1-ux)*uy*(1-uz)     + g(z0,y1,x1)*ux*uy*(1-uz) +
                        g(z1,y0,x0)*(1-ux)*(1-uy)*uz     + g(z1,y0,x1)*ux*(1-uy)*uz +
                        g(z1,y1,x0)*(1-ux)*uy*uz         + g(z1,y1,x1)*ux*uy*uz;
                }
            }
        }
        return out;
    }
    const o1 = octave(4), o2 = octave(8), o3 = octave(16);
    const data = new Uint8Array(N * N * N * 4);
    for (let i = 0; i < N * N * N; i++) {
        data[i*4+0] = Math.round(o1[i]*255);
        data[i*4+1] = Math.round(o2[i]*255);
        data[i*4+2] = Math.round(o3[i]*255);
        data[i*4+3] = 255;
    }
    const tex = new Data3DTexture(data, N, N, N);
    tex.format = RGBAFormat;
    tex.minFilter = tex.magFilter = LinearFilter;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.wrapR = RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
}

// ── Runtime config ────────────────────────────────────────────────────────────
export const config = {
    posX: CC.posX, posY: CC.posY, posZ: CC.posZ,
    scaleX: CC.scaleX, scaleY: CC.scaleY, scaleZ: CC.scaleZ,
    windSpeed:         CC.windSpeed,
    noiseScale:        CC.noiseScale,
    turbulenceStrength: CC.turbulenceStrength,
    turbulenceSpeed:    CC.turbulenceSpeed,
    threshold:  CC.threshold,
    range:      CC.range,
    opacity:    CC.opacity,
    edgeFade:   CC.edgeFade,
    marchSteps: CC.marchSteps,
    dayR: CC.dayR, dayG: CC.dayG, dayB: CC.dayB,
    nightR: CC.nightR, nightG: CC.nightG, nightB: CC.nightB,
};

export const cloudsGroup = new Group();

let _mesh: Mesh | null = null;
let _material: RawShaderMaterial | null = null;
let _frame = 0;

const VERT = `in vec3 position;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;

out vec3 vOrigin;
out vec3 vDirection;

void main() {
    // Ray origin in object (local) space
    vOrigin    = vec3(inverse(modelMatrix) * vec4(cameraPosition, 1.0));
    // Ray direction in object space: from origin toward this vertex
    vDirection = position - vOrigin;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = `precision highp float;
precision highp sampler3D;

uniform sampler3D uNoise;
uniform float     uTime;
uniform float     uWindSpeed;
uniform float     uNoiseScale;
uniform float     uTurbStrength;
uniform float     uTurbSpeed;
uniform float     uThreshold;
uniform float     uRange;
uniform float     uOpacity;
uniform float     uEdgeFade;
uniform float     uSteps;
uniform float     uFrame;
uniform vec3      uColorDay;
uniform vec3      uColorNight;
uniform float     uDayFraction;

in  vec3 vOrigin;
in  vec3 vDirection;
out vec4 fragColor;

// --- PRNG (Wang hash) --------------------------------------------------------
uint wangHash(uint seed) {
    seed = (seed ^ 61u) ^ (seed >> 16u);
    seed *= 9u;
    seed = seed ^ (seed >> 4u);
    seed *= 0x27d4eb2du;
    seed = seed ^ (seed >> 15u);
    return seed;
}
float randFloat(inout uint seed) {
    return float(wangHash(seed)) / 4294967296.0;
}

// --- Ray vs unit cube [-0.5, 0.5] --------------------------------------------
vec2 hitBox(vec3 orig, vec3 dir) {
    const vec3 bMin = vec3(-0.5);
    const vec3 bMax = vec3( 0.5);
    vec3 invDir  = 1.0 / dir;
    vec3 tmin    = (bMin - orig) * invDir;
    vec3 tmax    = (bMax - orig) * invDir;
    vec3 t0      = min(tmin, tmax);
    vec3 t1      = max(tmin, tmax);
    float tNear  = max(max(t0.x, t0.y), t0.z);
    float tFar   = min(min(t1.x, t1.y), t1.z);
    return vec2(tNear, tFar);
}

// --- Coarse (warp-scale) UV for a point — shared by pre-pass and density -----
vec3 coarseUV(vec3 p) {
    vec3 uv = p + 0.5;
    return vec3(
        uv.x * 0.45 + uTime * uWindSpeed * 0.5,
        uv.y * 0.45 - uTime * uTurbSpeed * 0.37,
        uv.z * 0.45 + uTime * uTurbSpeed * 0.23
    );
}

// --- Density sample with domain warp -----------------------------------------
// Only 2 texture lookups total:
//   #1  coarseUV  — used as warp offset AND as cheap pre-rejection estimate.
//       If the coarse channel is well below the threshold the fine sample
//       can't rescue it (the warp only displaces by uTurbStrength), so we
//       return 0 immediately without a second lookup.
//   #2  fine scaled UV with warp applied — full 3-channel density.
float sampleDensity(vec3 p) {
    // Lookup 1: coarse warp field
    vec4 warpN = texture(uNoise, coarseUV(p));

    // Early rejection: coarse red channel is a low-freq density proxy.
    // The warp can shift the fine UV by at most uTurbStrength, so use a
    // generous margin to avoid false negatives (visual holes).
    if (warpN.r < uThreshold - uRange - uTurbStrength * 0.7) return 0.0;

    // Apply domain warp to the base UV
    vec3 uv = p + 0.5 + (warpN.rgb - 0.5) * uTurbStrength;

    // Lookup 2: fine detail noise at scaled + wind-drifted UV
    vec4  n    = texture(uNoise, vec3(
        uv.x * uNoiseScale + uTime * uWindSpeed,
        uv.y * uNoiseScale,
        uv.z * uNoiseScale
    ));
    float base = n.r * 0.60 + n.g * 0.25 + n.b * 0.15;
    float d    = smoothstep(uThreshold - uRange, uThreshold + uRange, base);

    // Vertical fade: dissolve near top and bottom of the box
    float yAbs = abs(p.y);
    float fade = 1.0 - smoothstep(0.5 - uEdgeFade, 0.5, yAbs);
    return d * fade;
}

void main() {
    vec3 rayDir = normalize(vDirection);
    vec2 bounds = hitBox(vOrigin, rayDir);
    if (bounds.x > bounds.y) discard;
    bounds.x = max(bounds.x, 0.0);

    float totalDist = bounds.y - bounds.x;
    float stepSize  = totalDist / uSteps;

    // --- Coarse pre-pass (8 cheap single-lookup samples) ---------------------
    // Quickly discard rays that pass only through empty air, sparing them the
    // full march. Uses the same coarse UV as the warp field so no extra code path.
    float rejectThreshold = uThreshold - uRange - uTurbStrength * 0.7;
    float coarseStride    = totalDist / 8.0;
    bool  anyCloud        = false;
    for (int ci = 0; ci < 8; ci++) {
        vec3 p = vOrigin + rayDir * (bounds.x + (float(ci) + 0.5) * coarseStride);
        if (texture(uNoise, coarseUV(p)).r > rejectThreshold) {
            anyCloud = true;
            break;
        }
    }
    if (!anyCloud) discard;

    // --- Per-pixel jitter to break up banding --------------------------------
    uint seed   = uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u
                + uint(uFrame) * 26699u;
    float jitter = randFloat(seed) * 2.0 - 1.0;

    vec3 cloudColor = mix(uColorNight, uColorDay, uDayFraction);

    vec4 ac = vec4(0.0);
    for (float i = 0.0; i < uSteps; i += 1.0) {
        vec3 p = vOrigin + bounds.x * rayDir + rayDir * (i + jitter) * stepSize;
        float d = sampleDensity(p) * uOpacity;
        if (d <= 0.0) continue;

        // Simple ambient shading: lighter at top, darker at bottom
        float shade = 0.2 + 0.8 * clamp((p.y + 0.5), 0.0, 1.0);
        ac.rgb += (1.0 - ac.a) * d * cloudColor * shade;
        ac.a   += (1.0 - ac.a) * d;
        if (ac.a >= 0.95) break;
    }

    if (ac.a == 0.0) discard;

    // sRGB gamma correction (matches TJS example)
    ac.rgb = mix(pow(ac.rgb, vec3(0.41666)) * 1.055 - vec3(0.055),
                 ac.rgb * 12.92,
                 vec3(lessThanEqual(ac.rgb, vec3(0.0031308))));

    fragColor = ac;
}`;

// ── Lifecycle ─────────────────────────────────────────────────────────────────
export function Start(): void {
    const noiseTex = buildNoiseTexture();

    // Clamp default march steps to a device-appropriate ceiling.
    // CC.marchSteps (64) is the high-quality target; real visitors rarely have
    // the GPU headroom for it.  Desktop gets 24 steps, mobile gets 12 steps.
    // Jitter + alpha early-exit make these visually close to higher counts.
    const stepCeil = _isMobile ? 12 : 24;
    config.marchSteps = Math.min(CC.marchSteps, stepCeil);

    _material = new RawShaderMaterial({
        glslVersion: GLSL3,
        uniforms: {
            uNoise:        { value: noiseTex },
            uTime:         { value: 0.0 },
            uWindSpeed:    { value: CC.windSpeed },
            uNoiseScale:   { value: CC.noiseScale },
            uTurbStrength: { value: CC.turbulenceStrength },
            uTurbSpeed:    { value: CC.turbulenceSpeed },
            uThreshold:    { value: CC.threshold },
            uRange:       { value: CC.range },
            uOpacity:     { value: CC.opacity },
            uEdgeFade:    { value: CC.edgeFade },
            uSteps:       { value: config.marchSteps },
            uFrame:       { value: 0 },
            uColorDay:    { value: [CC.dayR,   CC.dayG,   CC.dayB]   },
            uColorNight:  { value: [CC.nightR, CC.nightG, CC.nightB] },
            uDayFraction: { value: 1.0 },
        },
        vertexShader:   VERT,
        fragmentShader: FRAG,
        side:           BackSide,
        transparent:    true,
        depthWrite:     false,
    });

    const geo  = new BoxGeometry(1, 1, 1);
    _mesh      = new Mesh(geo, _material);
    _mesh.position.set(CC.posX, CC.posY, CC.posZ);
    _mesh.scale.set(CC.scaleX, CC.scaleY, CC.scaleZ);
    _mesh.frustumCulled = false;
    _mesh.renderOrder   = 0;

    cloudsGroup.add(_mesh);
}

/** Override the ray-march step count for quality presets (Low=16, Medium=32, High=48). */
export function setMarchSteps(steps: number): void {
    config.marchSteps = steps;
}

// ── Per-frame update ──────────────────────────────────────────────────────────
export function Update(deltaTime: number, dayFraction: number): void {
    if (!_material || !_mesh) return;

    const u = _material.uniforms;
    u.uTime.value        = (u.uTime.value as number) + deltaTime;
    u.uFrame.value       = _frame++;
    u.uDayFraction.value = dayFraction;

    // Sync config to uniforms every frame (debug GUI changes apply live)
    u.uWindSpeed.value    = config.windSpeed;
    u.uNoiseScale.value   = config.noiseScale;
    u.uTurbStrength.value = config.turbulenceStrength;
    u.uTurbSpeed.value    = config.turbulenceSpeed;
    u.uThreshold.value    = config.threshold;
    u.uRange.value      = config.range;
    u.uOpacity.value    = config.opacity;
    u.uEdgeFade.value   = config.edgeFade;
    u.uSteps.value      = config.marchSteps;
    (u.uColorDay.value  as number[])[0] = config.dayR;
    (u.uColorDay.value  as number[])[1] = config.dayG;
    (u.uColorDay.value  as number[])[2] = config.dayB;
    (u.uColorNight.value as number[])[0] = config.nightR;
    (u.uColorNight.value as number[])[1] = config.nightG;
    (u.uColorNight.value as number[])[2] = config.nightB;

    // Mesh placement — only dirty the matrix when values actually changed.
    // Unconditional position.set/scale.set marks matrixWorldNeedsUpdate every
    // frame (no-op cost + compositing impact on iOS/WebKit).
    if (_mesh.position.x !== config.posX || _mesh.position.y !== config.posY || _mesh.position.z !== config.posZ) {
        _mesh.position.set(config.posX, config.posY, config.posZ);
    }
    if (_mesh.scale.x !== config.scaleX || _mesh.scale.y !== config.scaleY || _mesh.scale.z !== config.scaleZ) {
        _mesh.scale.set(config.scaleX, config.scaleY, config.scaleZ);
    }
}

import { 
    Group, 
    Mesh, 
    PlaneGeometry, 
    ShaderMaterial, 
    DoubleSide, 
    AdditiveBlending,
    NormalBlending,
    PointLight,
    SpotLight,
    BufferGeometry,
    Float32BufferAttribute,
    Points,
    Vector3
} from "three";
import { deltaTime, time } from "../scripts/Time";
import { isDayTime } from "./Skybox";

export const fire = new Group();

export const fireLight = new PointLight(0xff6622, 0, 8, 2);

// PointLight doesn't support VSM blur, so use it only for illumination
fireLight.castShadow = false;

// Separate SpotLight for shadow casting (VSM compatible — real blur)
// Added to scene directly (not fire group) to avoid the 0.25x scale
export const fireShadowLight = new SpotLight(0xff6622, 0, 12, Math.PI / 2.5, 0.5, 1.2);
fireShadowLight.castShadow = true;
fireShadowLight.shadow.mapSize.width = 512;
fireShadowLight.shadow.mapSize.height = 512;
fireShadowLight.shadow.camera.near = 0.05;
fireShadowLight.shadow.camera.far = 6;
fireShadowLight.shadow.bias = 0.0005;
fireShadowLight.shadow.normalBias = 0.02;
fireShadowLight.shadow.radius = 2;
fireShadowLight.shadow.blurSamples = 8;

const FIRE_SCALE = 0.25;
const FIRE_HEIGHT_OFFSET = 0.13;
const FIRE_LIGHT_INTENSITY = 3.0;
const FIRE_LIGHT_FLICKER = 0.3;
const FADE_SPEED = 1.5;

const EMBER_COUNT = 15;
const EMBER_SPEED = 0.4;
const EMBER_SIZE = 0.02;
const EMBER_LIFETIME = 2.5;

// ============================================
// SMOKE SETTINGS
// ============================================
const SMOKE_PARTICLE_COUNT = 10;
const SMOKE_RISE_SPEED = 0.12;
const SMOKE_PARTICLE_SIZE = 0.035;
const SMOKE_PARTICLE_LIFETIME = 3.0;
const SMOKE_PARTICLE_SPREAD = 0.04;
const SMOKE_DURATION = 3.5;          // Seconds of smoke before auto-fade starts
const SMOKE_AUTO_FADE_SPEED = 0.6;   // How fast smoke fades after duration
const SMOKE_APPEAR_SPEED = 3.0;      // How fast smoke appears when fire dies
const SMOKE_DISMISS_SPEED = 2.5;     // How fast smoke disappears when fire relights

let fireIntensity = 1.0;
let targetIntensity = 1.0;

const fireVertexShader = /*glsl*/`
    varying vec2 vUv;
    varying float vHeight;
    
    void main() {
        vUv = uv;
        vHeight = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fireFragmentShader = /*glsl*/`
    uniform float uTime;
    uniform float uIntensity;
    
    varying vec2 vUv;
    varying float vHeight;
    
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
    
    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
        m = m * m;
        m = m * m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }
    
    float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        for (int i = 0; i < 4; i++) {
            value += amplitude * snoise(p * frequency);
            amplitude *= 0.5;
            frequency *= 2.0;
        }
        return value;
    }
    
    void main() {
        vec2 uv = vUv;
        uv.x = uv.x * 2.0 - 1.0;
        
        float shape = 1.0 - abs(uv.x) * (0.8 + uv.y * 1.5);
        shape *= 1.0 - uv.y;
        shape = max(shape, 0.0);
        
        float noise1 = fbm(vec2(uv.x * 3.0, uv.y * 2.0 - uTime * 3.0));
        float noise2 = fbm(vec2(uv.x * 5.0 + 10.0, uv.y * 3.0 - uTime * 4.0));
        float noise = noise1 * 0.6 + noise2 * 0.4;
        
        float fire = shape + noise * 0.4 * shape;
        fire = smoothstep(0.1, 0.9, fire);
        
        vec3 color;
        float t = fire;
        if (t > 0.8) {
            color = mix(vec3(1.0, 0.9, 0.5), vec3(1.0, 1.0, 0.9), (t - 0.8) / 0.2);
        } else if (t > 0.5) {
            color = mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 0.9, 0.5), (t - 0.5) / 0.3);
        } else if (t > 0.2) {
            color = mix(vec3(0.8, 0.2, 0.0), vec3(1.0, 0.5, 0.0), (t - 0.2) / 0.3);
        } else {
            color = mix(vec3(0.0, 0.0, 0.0), vec3(0.8, 0.2, 0.0), t / 0.2);
        }
        
        float alpha = fire * uIntensity;
        
        alpha *= smoothstep(0.0, 0.1, uv.y);
        alpha *= smoothstep(0.0, 0.2, shape);
        
        gl_FragColor = vec4(color, alpha);
    }
`;

const fireUniforms = {
    uTime: { value: 0.0 },
    uIntensity: { value: 0.0 }
};

const emberVertexShader = /*glsl*/`
    attribute float aLife;
    attribute float aRandom;
    
    uniform float uTime;
    uniform float uIntensity;
    uniform float uEmberSize;
    
    varying float vLife;
    varying float vRandom;
    
    void main() {
        vLife = aLife;
        vRandom = aRandom;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        
        float life01 = aLife;
        float size = uEmberSize * (0.5 + life01 * 0.5) * uIntensity;
        
        gl_PointSize = size * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const emberFragmentShader = /*glsl*/`
    uniform float uIntensity;
    
    varying float vLife;
    varying float vRandom;
    
    void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center);
        if (dist > 0.5) discard;
        
        float alpha = smoothstep(0.5, 0.2, dist);
        
        alpha *= vLife * uIntensity;
        
        vec3 color = mix(
            vec3(1.0, 0.3, 0.0),
            vec3(1.0, 0.8, 0.3),
            vLife * 0.7 + vRandom * 0.3
        );
        
        color *= 1.5;
        
        gl_FragColor = vec4(color, alpha);
    }
`;

const emberUniforms = {
    uTime: { value: 0.0 },
    uIntensity: { value: 0.0 },
    uEmberSize: { value: EMBER_SIZE }
};

// ============================================
// SMOKE COLUMN SHADER (billboard planes like fire)
// ============================================
const smokeColumnVertexShader = /*glsl*/`
    varying vec2 vUv;
    
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const smokeColumnFragmentShader = /*glsl*/`
    uniform float uTime;
    uniform float uIntensity;
    uniform float uGrowth;
    
    varying vec2 vUv;
    
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
    
    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
        m = m * m * m * m;
        vec3 x2 = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x2) - 0.5;
        vec3 ox = floor(x2 + 0.5);
        vec3 a0 = x2 - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }
    
    float fbm(vec2 p) {
        float value = 0.0;
        float amp = 0.5;
        float freq = 1.0;
        for (int i = 0; i < 3; i++) {
            value += amp * snoise(p * freq);
            amp *= 0.5;
            freq *= 2.0;
        }
        return value;
    }
    
    void main() {
        vec2 uv = vUv;
        float cx = uv.x * 2.0 - 1.0; // center X: -1 to 1
        
        // Growth mask: column grows from bottom up
        // uGrowth 0..1 maps to how much of the column is visible
        float growCutoff = uGrowth;  // top edge of visible region
        float growFade = smoothstep(growCutoff, growCutoff - 0.15, uv.y);
        if (growFade <= 0.0) discard;
        
        // Thin column shape: narrower than fire, widens slightly towards top
        float width = 0.3 + uv.y * 0.25;
        float shape = 1.0 - abs(cx) / width;
        shape = max(shape, 0.0);
        shape = smoothstep(0.0, 0.6, shape);
        
        // Fade at bottom and at the growing top edge
        shape *= smoothstep(0.0, 0.12, uv.y);
        shape *= growFade;
        
        // Wispy noise that scrolls upward
        float n1 = fbm(vec2(cx * 4.0, uv.y * 3.0 - uTime * 1.2));
        float n2 = fbm(vec2(cx * 6.0 + 5.0, uv.y * 4.0 - uTime * 1.8));
        float noise = n1 * 0.6 + n2 * 0.4;
        
        // Break up the column with noise for wispy look
        float smoke = shape * (0.5 + noise * 0.5);
        smoke = smoothstep(0.05, 0.5, smoke);
        
        // Dark gray color
        vec3 color = vec3(0.12, 0.11, 0.10);
        
        float alpha = smoke * uIntensity * 0.35;
        
        gl_FragColor = vec4(color, alpha);
    }
`;

const smokeColumnUniforms = {
    uTime: { value: 0.0 },
    uIntensity: { value: 0.0 },
    uGrowth: { value: 0.0 }    // 0 = nothing visible, 1 = full column
};

// Smoke accent particles (small wisps)
const smokeParticleVertexShader = /*glsl*/`
    attribute float aLife;
    attribute float aRandom;
    
    uniform float uSmokeSize;
    uniform float uSmokeIntensity;
    
    varying float vLife;
    varying float vRandom;
    
    void main() {
        vLife = aLife;
        vRandom = aRandom;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        
        float age = 1.0 - aLife;
        float size = uSmokeSize * (0.5 + age * 1.2) * uSmokeIntensity;
        
        gl_PointSize = size * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const smokeParticleFragmentShader = /*glsl*/`
    uniform float uSmokeIntensity;
    
    varying float vLife;
    varying float vRandom;
    
    void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center);
        if (dist > 0.5) discard;
        
        float alpha = smoothstep(0.5, 0.1, dist);
        float ageFade = smoothstep(0.0, 0.2, 1.0 - vLife) * smoothstep(0.0, 0.35, vLife);
        alpha *= ageFade * uSmokeIntensity;
        
        float shade = 0.13 + vRandom * 0.08;
        vec3 color = vec3(shade, shade, shade);
        
        alpha = min(alpha, 0.2);
        
        gl_FragColor = vec4(color, alpha);
    }
`;

const smokeParticleUniforms = {
    uSmokeSize: { value: SMOKE_PARTICLE_SIZE },
    uSmokeIntensity: { value: 0.0 }
};

let smokePositions: Float32Array;
let smokeLifes: Float32Array;
let smokeRandoms: Float32Array;
let smokeVelocities: Array<{ x: number; y: number; z: number }>;
let smokeGeometry: BufferGeometry;
let smokeParticlePoints: Points;

let smokeColumnPlanes: Mesh[] = [];
let smokeIntensity = 0.0;
let smokeGrowth = 0.0;         // 0 = column hidden, 1 = fully grown
let smokeActive = false;       // Whether smoke effect is currently running
let smokeTimer = 0.0;          // How long smoke has been active
let fireWasActive = false;
const SMOKE_GROW_SPEED = 0.7;  // How fast the column grows upward
const SMOKE_SHRINK_SPEED = 0.5; // How fast the column shrinks when disappearing

let emberPositions: Float32Array;
let emberLifes: Float32Array;
let emberRandoms: Float32Array;
let emberVelocities: Array<{ x: number; y: number; z: number }>;
let emberGeometry: BufferGeometry;
let emberPoints: Points;

function initEmbers(): Points {
    emberPositions = new Float32Array(EMBER_COUNT * 3);
    emberLifes = new Float32Array(EMBER_COUNT);
    emberRandoms = new Float32Array(EMBER_COUNT);
    emberVelocities = [];
    
    for (let i = 0; i < EMBER_COUNT; i++) {
        emberVelocities[i] = { x: 0, y: 0, z: 0 };
        resetEmber(i);
        emberLifes[i] = Math.random();
    }
    
    emberGeometry = new BufferGeometry();
    emberGeometry.setAttribute('position', new Float32BufferAttribute(emberPositions, 3));
    emberGeometry.setAttribute('aLife', new Float32BufferAttribute(emberLifes, 1));
    emberGeometry.setAttribute('aRandom', new Float32BufferAttribute(emberRandoms, 1));
    
    const emberMaterial = new ShaderMaterial({
        uniforms: emberUniforms,
        vertexShader: emberVertexShader,
        fragmentShader: emberFragmentShader,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false
    });
    
    emberPoints = new Points(emberGeometry, emberMaterial);
    return emberPoints;
}

function resetEmber(index: number): void {
    const i3 = index * 3;
    
    emberPositions[i3] = (Math.random() - 0.5) * 0.1;
    emberPositions[i3 + 1] = 0.1 + Math.random() * 0.2;
    emberPositions[i3 + 2] = (Math.random() - 0.5) * 0.1;
    
    emberLifes[index] = 1.0;
    emberRandoms[index] = Math.random();
    
    const speedVariation = 0.5 + Math.random() * 1.0;
    emberVelocities[index] = {
        x: (Math.random() - 0.5) * 0.1,
        y: EMBER_SPEED * speedVariation,
        z: (Math.random() - 0.5) * 0.1
    };
}

function updateEmbers(): void {
    const posAttr = emberGeometry.attributes.position;
    const lifeAttr = emberGeometry.attributes.aLife;
    
    for (let i = 0; i < EMBER_COUNT; i++) {
        const i3 = i * 3;
        const vel = emberVelocities[i];
        
        emberPositions[i3] += vel.x * deltaTime;
        emberPositions[i3 + 1] += vel.y * deltaTime;
        emberPositions[i3 + 2] += vel.z * deltaTime;
        
        emberPositions[i3] += Math.sin(time * 3.0 + i * 2.5) * 0.003 * deltaTime * 60;
        emberPositions[i3 + 2] += Math.cos(time * 2.5 + i * 1.7) * 0.003 * deltaTime * 60;
        
        vel.x *= 0.99;
        vel.z *= 0.99;
        
        emberLifes[i] -= deltaTime / EMBER_LIFETIME;
        
        (posAttr.array as Float32Array)[i3] = emberPositions[i3];
        (posAttr.array as Float32Array)[i3 + 1] = emberPositions[i3 + 1];
        (posAttr.array as Float32Array)[i3 + 2] = emberPositions[i3 + 2];
        (lifeAttr.array as Float32Array)[i] = emberLifes[i];
        
        if (emberLifes[i] <= 0) {
            resetEmber(i);
            (posAttr.array as Float32Array)[i3] = emberPositions[i3];
            (posAttr.array as Float32Array)[i3 + 1] = emberPositions[i3 + 1];
            (posAttr.array as Float32Array)[i3 + 2] = emberPositions[i3 + 2];
            (lifeAttr.array as Float32Array)[i] = emberLifes[i];
        }
    }
    
    posAttr.needsUpdate = true;
    lifeAttr.needsUpdate = true;
}

// ============================================
// SMOKE COLUMN + PARTICLE SYSTEM
// ============================================
function createSmokeColumnPlane(): Mesh {
    // Taller and narrower than fire planes
    const geometry = new PlaneGeometry(0.6, 2.0, 1, 1);
    const material = new ShaderMaterial({
        uniforms: smokeColumnUniforms,
        vertexShader: smokeColumnVertexShader,
        fragmentShader: smokeColumnFragmentShader,
        transparent: true,
        blending: NormalBlending,
        side: DoubleSide,
        depthWrite: false
    });
    return new Mesh(geometry, material);
}

// @ts-ignore: smoke disabled temporarily
function _initSmokeColumn(): Mesh[] {
    const p1 = createSmokeColumnPlane();
    const p2 = createSmokeColumnPlane();
    const p3 = createSmokeColumnPlane();
    
    p1.rotation.y = 0;
    p2.rotation.y = Math.PI / 3;
    p3.rotation.y = -Math.PI / 3;
    
    // Offset up so smoke starts above fire base
    p1.position.y = 0.4;
    p2.position.y = 0.4;
    p3.position.y = 0.4;
    
    smokeColumnPlanes = [p1, p2, p3];
    return smokeColumnPlanes;
}

// @ts-ignore: smoke disabled temporarily
function _initSmokeParticles(): Points {
    smokePositions = new Float32Array(SMOKE_PARTICLE_COUNT * 3);
    smokeLifes = new Float32Array(SMOKE_PARTICLE_COUNT);
    smokeRandoms = new Float32Array(SMOKE_PARTICLE_COUNT);
    smokeVelocities = [];
    
    for (let i = 0; i < SMOKE_PARTICLE_COUNT; i++) {
        smokeVelocities[i] = { x: 0, y: 0, z: 0 };
        resetSmokeParticle(i);
        smokeLifes[i] = Math.random();
    }
    
    smokeGeometry = new BufferGeometry();
    smokeGeometry.setAttribute('position', new Float32BufferAttribute(smokePositions, 3));
    smokeGeometry.setAttribute('aLife', new Float32BufferAttribute(smokeLifes, 1));
    smokeGeometry.setAttribute('aRandom', new Float32BufferAttribute(smokeRandoms, 1));
    
    const material = new ShaderMaterial({
        uniforms: smokeParticleUniforms,
        vertexShader: smokeParticleVertexShader,
        fragmentShader: smokeParticleFragmentShader,
        transparent: true,
        blending: NormalBlending,
        depthWrite: false
    });
    
    smokeParticlePoints = new Points(smokeGeometry, material);
    return smokeParticlePoints;
}

function resetSmokeParticle(index: number): void {
    const i3 = index * 3;
    
    smokePositions[i3] = (Math.random() - 0.5) * SMOKE_PARTICLE_SPREAD;
    smokePositions[i3 + 1] = 0.1 + Math.random() * 0.15;
    smokePositions[i3 + 2] = (Math.random() - 0.5) * SMOKE_PARTICLE_SPREAD;
    
    smokeLifes[index] = 1.0;
    smokeRandoms[index] = Math.random();
    
    const speedVar = 0.7 + Math.random() * 0.6;
    smokeVelocities[index] = {
        x: (Math.random() - 0.5) * 0.025,
        y: SMOKE_RISE_SPEED * speedVar,
        z: (Math.random() - 0.5) * 0.025
    };
}

// @ts-ignore: smoke disabled temporarily
function _updateSmokeParticles(): void {
    const posAttr = smokeGeometry.attributes.position;
    const lifeAttr = smokeGeometry.attributes.aLife;
    
    for (let i = 0; i < SMOKE_PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        const vel = smokeVelocities[i];
        
        smokePositions[i3] += vel.x * deltaTime;
        smokePositions[i3 + 1] += vel.y * deltaTime;
        smokePositions[i3 + 2] += vel.z * deltaTime;
        
        smokePositions[i3] += Math.sin(time * 1.5 + i * 3.1) * 0.0015 * deltaTime * 60;
        smokePositions[i3 + 2] += Math.cos(time * 1.2 + i * 2.3) * 0.0015 * deltaTime * 60;
        
        vel.x *= 1.0 + 0.2 * deltaTime;
        vel.z *= 1.0 + 0.2 * deltaTime;
        vel.y *= 1.0 - 0.15 * deltaTime;
        
        smokeLifes[i] -= deltaTime / SMOKE_PARTICLE_LIFETIME;
        
        (posAttr.array as Float32Array)[i3] = smokePositions[i3];
        (posAttr.array as Float32Array)[i3 + 1] = smokePositions[i3 + 1];
        (posAttr.array as Float32Array)[i3 + 2] = smokePositions[i3 + 2];
        (lifeAttr.array as Float32Array)[i] = smokeLifes[i];
        
        if (smokeLifes[i] <= 0) {
            if (smokeActive && smokeTimer < SMOKE_DURATION) {
                resetSmokeParticle(i);
                (posAttr.array as Float32Array)[i3] = smokePositions[i3];
                (posAttr.array as Float32Array)[i3 + 1] = smokePositions[i3 + 1];
                (posAttr.array as Float32Array)[i3 + 2] = smokePositions[i3 + 2];
                (lifeAttr.array as Float32Array)[i] = smokeLifes[i];
            }
        }
    }
    
    posAttr.needsUpdate = true;
    lifeAttr.needsUpdate = true;
}

function createFirePlane(): Mesh {
    const geometry = new PlaneGeometry(1, 1.5, 1, 1);
    const material = new ShaderMaterial({
        uniforms: fireUniforms,
        vertexShader: fireVertexShader,
        fragmentShader: fireFragmentShader,
        transparent: true,
        blending: AdditiveBlending,
        side: DoubleSide,
        depthWrite: false
    });
    return new Mesh(geometry, material);
}

export function Start(): void {
    const plane1 = createFirePlane();
    const plane2 = createFirePlane();
    const plane3 = createFirePlane();
    
    plane1.rotation.y = 0;
    plane2.rotation.y = Math.PI / 3;
    plane3.rotation.y = -Math.PI / 3;
    
    fire.add(plane1);
    fire.add(plane2);
    fire.add(plane3);
    fire.scale.setScalar(FIRE_SCALE);
    fire.position.y = FIRE_HEIGHT_OFFSET;
    
    const embers = initEmbers();
    fire.add(embers);
    
    // // Smoke column (billboard planes) — disabled for now
    // const smokePlanes = initSmokeColumn();
    // for (const p of smokePlanes) fire.add(p);
    // 
    // // Smoke accent particles
    // const smokeParticles = initSmokeParticles();
    // fire.add(smokeParticles);
    
    fireLight.position.copy(fire.position);
    fireLight.position.y += 0.05;  // TWEAK: Height offset above firecamp
    fire.add(fireLight);

    // Shadow spotlight is added to the scene (not fire group) — see Scene.ts
    // Its position is updated each frame in Update()
    
    fireIntensity = 0.0;
    targetIntensity = isDayTime() ? 0.0 : 1.0;
    fireWasActive = !isDayTime();
}

export function Update(): void {
    const isDay = isDayTime();
    targetIntensity = isDay ? 0.0 : 1.0;
    
    // Detect fire going out: was active (night) and now switching to day
    if (isDay && fireWasActive) {
        smokeActive = true;
        smokeTimer = 0.0;
        fireWasActive = false;
    }
    // Detect fire coming back: switching to night → dismiss smoke quickly
    if (!isDay) {
        if (smokeActive) {
            // Force timer past duration so it fades out fast
            smokeTimer = Math.max(smokeTimer, SMOKE_DURATION);
        }
        fireWasActive = true;
    }
    
    // Fade fire intensity
    if (fireIntensity !== targetIntensity) {
        const diff = targetIntensity - fireIntensity;
        const step = FADE_SPEED * deltaTime;
        
        if (Math.abs(diff) < step) {
            fireIntensity = targetIntensity;
        } else {
            fireIntensity += Math.sign(diff) * step;
        }
    }
    
    // Smoke lifecycle with auto-fade
    if (smokeActive) {
        smokeTimer += deltaTime;
        
        if (smokeTimer < SMOKE_DURATION) {
            // Phase 1: Smoke rising — grow from bottom up + fade in
            smokeIntensity = Math.min(smokeIntensity + SMOKE_APPEAR_SPEED * deltaTime, 1.0);
            smokeGrowth = Math.min(smokeGrowth + SMOKE_GROW_SPEED * deltaTime, 1.0);
        } else {
            // Phase 2: Auto-fade out — shrink from top down + fade opacity
            const fadeSpeed = !isDay ? SMOKE_DISMISS_SPEED : SMOKE_AUTO_FADE_SPEED;
            smokeIntensity = Math.max(smokeIntensity - fadeSpeed * deltaTime, 0.0);
            smokeGrowth = Math.max(smokeGrowth - SMOKE_SHRINK_SPEED * deltaTime, 0.0);
            
            if (smokeIntensity <= 0 && smokeGrowth <= 0) {
                smokeActive = false;
                smokeIntensity = 0.0;
                smokeGrowth = 0.0;
            }
        }
    }
    
    fireUniforms.uTime.value = time;
    fireUniforms.uIntensity.value = fireIntensity;
    
    emberUniforms.uTime.value = time;
    emberUniforms.uIntensity.value = fireIntensity;
    if (fireIntensity > 0.01) {
        updateEmbers();
    }
    
    // // Update smoke column + particles — disabled for now
    // smokeColumnUniforms.uTime.value = time;
    // smokeColumnUniforms.uIntensity.value = smokeIntensity;
    // smokeColumnUniforms.uGrowth.value = smokeGrowth;
    // smokeParticleUniforms.uSmokeIntensity.value = smokeIntensity;
    // 
    // const smokeVisible = smokeIntensity > 0.001;
    // for (const p of smokeColumnPlanes) p.visible = smokeVisible;
    // smokeParticlePoints.visible = smokeVisible;
    // 
    // if (smokeIntensity > 0.01) {
    //     updateSmokeParticles();
    // }
    
    const flicker = 1.0 + (Math.sin(time * 15.0) * 0.3 + Math.sin(time * 23.0) * 0.2) * FIRE_LIGHT_FLICKER;
    fireLight.intensity = fireIntensity * FIRE_LIGHT_INTENSITY * flicker;
    fireShadowLight.intensity = fireIntensity * FIRE_LIGHT_INTENSITY * flicker * 0.7;
    
    const colorFlicker = 0.9 + Math.sin(time * 10.0) * 0.1;
    fireLight.color.setRGB(1.0, 0.4 * colorFlicker, 0.1 * colorFlicker);
    fireShadowLight.color.setRGB(1.0, 0.4 * colorFlicker, 0.1 * colorFlicker);

    // Update shadow spotlight world position to follow fire
    // Positioned just slightly above the fire so shadows spread outward with visible length
    fireLight.getWorldPosition(_fireShadowWorldPos);
    fireShadowLight.position.set(_fireShadowWorldPos.x, _fireShadowWorldPos.y + 0.3, _fireShadowWorldPos.z);
    fireShadowLight.target.position.set(_fireShadowWorldPos.x, _fireShadowWorldPos.y - 1, _fireShadowWorldPos.z);
    
    // Keep fire.visible = true always so shaders stay compiled (avoids first-toggle stall).
    // When fireIntensity == 0 the shaders output alpha 0, so cost is negligible.
    fire.visible = true;
}

const _fireLightWorldPos = new Vector3();
const _fireShadowWorldPos = new Vector3();

export function getFireLightData(): { position: Vector3; color: typeof fireLight.color; intensity: number } {
    return {
        position: fireLight.getWorldPosition(_fireLightWorldPos),
        color: fireLight.color,
        intensity: fireLight.intensity
    };
}

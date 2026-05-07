import {
    Group,
    Mesh,
    Sprite,
    SpriteMaterial,
    TextureLoader,
    Texture,
    RepeatWrapping,
    SRGBColorSpace,
    PlaneGeometry,
    ShaderMaterial,
    NormalBlending,
    PointLight,
    SpotLight,
    BufferGeometry,
    Float32BufferAttribute,
    Points,
    Vector3
} from "three";
import { deltaTime, time } from "../core/Time";
import { isDayTime } from "./Skybox";
import { FIRE_LIGHT_INTENSITY, FIRE_LIGHT_RANGE, FIRE_LIGHT_DECAY, FIRE_LIGHT_FLICKER } from "./config/IslandConfig";

export const fire = new Group();

export const fireLight = new PointLight(0xff6622, 0, FIRE_LIGHT_RANGE, FIRE_LIGHT_DECAY);
fireLight.castShadow = false;

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

const FIRE_SCALE = 0.2;
const FIRE_HEIGHT_OFFSET = -0.01;

export const fireLightConfig = {
    intensity: FIRE_LIGHT_INTENSITY,
    range:     FIRE_LIGHT_RANGE,
    flicker:   FIRE_LIGHT_FLICKER,
};

const FADE_SPEED = 1.0;

// ============================================
// SPRITE SHEET SETTINGS
// ============================================
const SPRITE_COLS          = 9;
const SPRITE_ROWS          = 6;
const SPRITE_TOTAL_FRAMES  = 48;
const SPRITE_FPS           = 16; // lower = slower animation — tweak this
// Local-space size — world size = value * FIRE_SCALE(0.25) * firecampScale(~1.4)
const SPRITE_WIDTH         = 1.5;
const SPRITE_HEIGHT        = 2.2;

let _fireSpriteTex: Texture;
let _fireSpriteMat: SpriteMaterial;
let _spriteFrame     = 0;
let _spriteFrameTime = 0;

function createFireSprite(): Sprite {
    _fireSpriteTex = new TextureLoader().load('images/fire_spritesheet.png');
    _fireSpriteTex.colorSpace  = SRGBColorSpace;
    _fireSpriteTex.wrapS       = RepeatWrapping;
    _fireSpriteTex.wrapT       = RepeatWrapping;
    _fireSpriteTex.repeat.set(1 / SPRITE_COLS, 1 / SPRITE_ROWS);
    // Start at frame 0 — top-left cell; Three.js UV origin is bottom-left so flip Y
    _fireSpriteTex.offset.set(0, (SPRITE_ROWS - 1) / SPRITE_ROWS);

    _fireSpriteMat = new SpriteMaterial({
        map:        _fireSpriteTex,
        transparent: true,
        alphaTest:  0.05,
        depthWrite: true,
    });

    const sprite = new Sprite(_fireSpriteMat);
    sprite.scale.set(SPRITE_WIDTH, SPRITE_HEIGHT, 1);
    sprite.position.y = 0.6; // local units — lift center above the log pile
    return sprite;
}

function updateSpriteFrame(): void {
    _spriteFrameTime += deltaTime;
    if (_spriteFrameTime < 1 / SPRITE_FPS) return;

    _spriteFrameTime -= 1 / SPRITE_FPS;
    _spriteFrame = (_spriteFrame + 1) % SPRITE_TOTAL_FRAMES;

    const col = _spriteFrame % SPRITE_COLS;
    const row = Math.floor(_spriteFrame / SPRITE_COLS);
    // Flip row index: image row 0 is at the top, UV row 0 is at the bottom
    _fireSpriteTex.offset.set(
        col / SPRITE_COLS,
        (SPRITE_ROWS - 1 - row) / SPRITE_ROWS
    );
}

// ============================================
// EMBERS
// ============================================
const EMBER_COUNT    = 15;
const EMBER_SPEED    = 0.4;
const EMBER_SIZE     = 0.02;
const EMBER_LIFETIME = 2.5;

const smokeColumnUniforms = {
    uTime:      { value: 0.0 },
    uIntensity: { value: 0.0 },
    uGrowth:    { value: 0.0 }
};

const smokeParticleUniforms = {
    uSmokeSize:      { value: 0.035 },
    uSmokeIntensity: { value: 0.0 }
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
    uTime:      { value: 0.0 },
    uIntensity: { value: 0.0 },
    uEmberSize: { value: EMBER_SIZE }
};

let emberPositions: Float32Array;
let emberLifes: Float32Array;
let emberRandoms: Float32Array;
let emberVelocities: Array<{ x: number; y: number; z: number }>;
let emberGeometry: BufferGeometry;
let emberPoints: Points;

function initEmbers(): Points {
    emberPositions = new Float32Array(EMBER_COUNT * 3);
    emberLifes     = new Float32Array(EMBER_COUNT);
    emberRandoms   = new Float32Array(EMBER_COUNT);
    emberVelocities = [];

    for (let i = 0; i < EMBER_COUNT; i++) {
        emberVelocities[i] = { x: 0, y: 0, z: 0 };
        resetEmber(i);
        emberLifes[i] = Math.random();
    }

    emberGeometry = new BufferGeometry();
    emberGeometry.setAttribute('position', new Float32BufferAttribute(emberPositions, 3));
    emberGeometry.setAttribute('aLife',    new Float32BufferAttribute(emberLifes, 1));
    emberGeometry.setAttribute('aRandom',  new Float32BufferAttribute(emberRandoms, 1));

    const emberMaterial = new ShaderMaterial({
        uniforms:       emberUniforms,
        vertexShader:   emberVertexShader,
        fragmentShader: emberFragmentShader,
        transparent:    true,
        blending:       NormalBlending,
        depthWrite:     false
    });

    emberPoints = new Points(emberGeometry, emberMaterial);
    return emberPoints;
}

function resetEmber(index: number): void {
    const i3 = index * 3;
    emberPositions[i3]     = (Math.random() - 0.5) * 0.1;
    emberPositions[i3 + 1] = 1.2 + Math.random() * 0.4;
    emberPositions[i3 + 2] = (Math.random() - 0.5) * 0.1;
    emberLifes[index]      = 1.0;
    emberRandoms[index]    = Math.random();
    const speedVariation   = 0.5 + Math.random() * 1.0;
    emberVelocities[index] = {
        x: (Math.random() - 0.5) * 0.1,
        y: EMBER_SPEED * speedVariation,
        z: (Math.random() - 0.5) * 0.1
    };
}

function updateEmbers(): void {
    const posAttr  = emberGeometry.attributes.position;
    const lifeAttr = emberGeometry.attributes.aLife;

    for (let i = 0; i < EMBER_COUNT; i++) {
        const i3  = i * 3;
        const vel = emberVelocities[i];

        emberPositions[i3]     += vel.x * deltaTime;
        emberPositions[i3 + 1] += vel.y * deltaTime;
        emberPositions[i3 + 2] += vel.z * deltaTime;

        emberPositions[i3]     += Math.sin(time * 3.0 + i * 2.5) * 0.003 * deltaTime * 60;
        emberPositions[i3 + 2] += Math.cos(time * 2.5 + i * 1.7) * 0.003 * deltaTime * 60;

        vel.x *= 0.99;
        vel.z *= 0.99;

        emberLifes[i] -= deltaTime / EMBER_LIFETIME;

        (posAttr.array  as Float32Array)[i3]     = emberPositions[i3];
        (posAttr.array  as Float32Array)[i3 + 1] = emberPositions[i3 + 1];
        (posAttr.array  as Float32Array)[i3 + 2] = emberPositions[i3 + 2];
        (lifeAttr.array as Float32Array)[i]      = emberLifes[i];

        if (emberLifes[i] <= 0) {
            resetEmber(i);
            (posAttr.array  as Float32Array)[i3]     = emberPositions[i3];
            (posAttr.array  as Float32Array)[i3 + 1] = emberPositions[i3 + 1];
            (posAttr.array  as Float32Array)[i3 + 2] = emberPositions[i3 + 2];
            (lifeAttr.array as Float32Array)[i]      = emberLifes[i];
        }
    }

    posAttr.needsUpdate  = true;
    lifeAttr.needsUpdate = true;
}

// ============================================
// SMOKE (disabled — kept for future use)
// ============================================
const SMOKE_PARTICLE_COUNT    = 10;
const SMOKE_RISE_SPEED        = 0.12;
const SMOKE_PARTICLE_LIFETIME = 3.0;
const SMOKE_PARTICLE_SPREAD   = 0.04;
const SMOKE_DURATION          = 3.5;
const SMOKE_AUTO_FADE_SPEED   = 0.6;
const SMOKE_APPEAR_SPEED      = 3.0;
const SMOKE_DISMISS_SPEED     = 2.5;

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
        vec3 h  = abs(x2) - 0.5;
        vec3 ox = floor(x2 + 0.5);
        vec3 a0 = x2 - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }

    float fbm(vec2 p) {
        float value = 0.0; float amp = 0.5; float freq = 1.0;
        for (int i = 0; i < 3; i++) {
            value += amp * snoise(p * freq); amp *= 0.5; freq *= 2.0;
        }
        return value;
    }

    void main() {
        vec2 uv = vUv;
        float cx = uv.x * 2.0 - 1.0;
        float growCutoff = uGrowth;
        float growFade = smoothstep(growCutoff, growCutoff - 0.15, uv.y);
        if (growFade <= 0.0) discard;
        float width = 0.3 + uv.y * 0.25;
        float shape = smoothstep(0.0, 0.6, max(1.0 - abs(cx) / width, 0.0));
        shape *= smoothstep(0.0, 0.12, uv.y) * growFade;
        float n1 = fbm(vec2(cx * 4.0, uv.y * 3.0 - uTime * 1.2));
        float n2 = fbm(vec2(cx * 6.0 + 5.0, uv.y * 4.0 - uTime * 1.8));
        float smoke = smoothstep(0.05, 0.5, shape * (0.5 + (n1 * 0.6 + n2 * 0.4) * 0.5));
        gl_FragColor = vec4(vec3(0.12, 0.11, 0.10), smoke * uIntensity * 0.35);
    }
`;

const smokeParticleVertexShader = /*glsl*/`
    attribute float aLife;
    attribute float aRandom;
    uniform float uSmokeSize;
    uniform float uSmokeIntensity;
    varying float vLife;
    varying float vRandom;
    void main() {
        vLife = aLife; vRandom = aRandom;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float size = uSmokeSize * (0.5 + (1.0 - aLife) * 1.2) * uSmokeIntensity;
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
        if (length(center) > 0.5) discard;
        float alpha = smoothstep(0.5, 0.1, length(center));
        alpha *= smoothstep(0.0, 0.2, 1.0 - vLife) * smoothstep(0.0, 0.35, vLife) * uSmokeIntensity;
        float shade = 0.13 + vRandom * 0.08;
        gl_FragColor = vec4(vec3(shade), min(alpha, 0.2));
    }
`;

let smokePositions: Float32Array;
let smokeLifes: Float32Array;
let smokeRandoms: Float32Array;
let smokeVelocities: Array<{ x: number; y: number; z: number }>;
let smokeGeometry: BufferGeometry;
let smokeParticlePoints: Points;
let smokeColumnPlanes: Mesh[] = [];

let smokeIntensity  = 0.0;
let smokeGrowth     = 0.0;
let smokeActive     = false;
let smokeTimer      = 0.0;
let fireWasActive   = false;

const SMOKE_GROW_SPEED   = 0.7;
const SMOKE_SHRINK_SPEED = 0.5;

// @ts-ignore: smoke disabled temporarily
function _initSmokeColumn(): Mesh[] {
    const make = () => new Mesh(
        new PlaneGeometry(0.6, 2.0, 1, 1),
        new ShaderMaterial({
            uniforms: smokeColumnUniforms,
            vertexShader: smokeColumnVertexShader,
            fragmentShader: smokeColumnFragmentShader,
            transparent: true, blending: NormalBlending, depthWrite: false
        })
    );
    const p1 = make(); const p2 = make(); const p3 = make();
    p2.rotation.y = Math.PI / 3;
    p3.rotation.y = -Math.PI / 3;
    p1.position.y = p2.position.y = p3.position.y = 0.4;
    smokeColumnPlanes = [p1, p2, p3];
    return smokeColumnPlanes;
}

// @ts-ignore: smoke disabled temporarily
function _initSmokeParticles(): Points {
    smokePositions  = new Float32Array(SMOKE_PARTICLE_COUNT * 3);
    smokeLifes      = new Float32Array(SMOKE_PARTICLE_COUNT);
    smokeRandoms    = new Float32Array(SMOKE_PARTICLE_COUNT);
    smokeVelocities = [];
    for (let i = 0; i < SMOKE_PARTICLE_COUNT; i++) {
        smokeVelocities[i] = { x: 0, y: 0, z: 0 };
        resetSmokeParticle(i);
        smokeLifes[i] = Math.random();
    }
    smokeGeometry = new BufferGeometry();
    smokeGeometry.setAttribute('position', new Float32BufferAttribute(smokePositions, 3));
    smokeGeometry.setAttribute('aLife',    new Float32BufferAttribute(smokeLifes, 1));
    smokeGeometry.setAttribute('aRandom',  new Float32BufferAttribute(smokeRandoms, 1));
    smokeParticlePoints = new Points(smokeGeometry, new ShaderMaterial({
        uniforms: smokeParticleUniforms,
        vertexShader: smokeParticleVertexShader,
        fragmentShader: smokeParticleFragmentShader,
        transparent: true, blending: NormalBlending, depthWrite: false
    }));
    return smokeParticlePoints;
}

function resetSmokeParticle(index: number): void {
    const i3 = index * 3;
    smokePositions[i3]     = (Math.random() - 0.5) * SMOKE_PARTICLE_SPREAD;
    smokePositions[i3 + 1] = 0.1 + Math.random() * 0.15;
    smokePositions[i3 + 2] = (Math.random() - 0.5) * SMOKE_PARTICLE_SPREAD;
    smokeLifes[index]      = 1.0;
    smokeRandoms[index]    = Math.random();
    const speedVar         = 0.7 + Math.random() * 0.6;
    smokeVelocities[index] = {
        x: (Math.random() - 0.5) * 0.025,
        y: SMOKE_RISE_SPEED * speedVar,
        z: (Math.random() - 0.5) * 0.025
    };
}

// @ts-ignore: smoke disabled temporarily
function _updateSmokeParticles(): void {
    const posAttr  = smokeGeometry.attributes.position;
    const lifeAttr = smokeGeometry.attributes.aLife;
    for (let i = 0; i < SMOKE_PARTICLE_COUNT; i++) {
        const i3  = i * 3;
        const vel = smokeVelocities[i];
        smokePositions[i3]     += vel.x * deltaTime;
        smokePositions[i3 + 1] += vel.y * deltaTime;
        smokePositions[i3 + 2] += vel.z * deltaTime;
        smokePositions[i3]     += Math.sin(time * 1.5 + i * 3.1) * 0.0015 * deltaTime * 60;
        smokePositions[i3 + 2] += Math.cos(time * 1.2 + i * 2.3) * 0.0015 * deltaTime * 60;
        vel.x *= 1.0 + 0.2 * deltaTime;
        vel.z *= 1.0 + 0.2 * deltaTime;
        vel.y *= 1.0 - 0.15 * deltaTime;
        smokeLifes[i] -= deltaTime / SMOKE_PARTICLE_LIFETIME;
        (posAttr.array  as Float32Array)[i3]     = smokePositions[i3];
        (posAttr.array  as Float32Array)[i3 + 1] = smokePositions[i3 + 1];
        (posAttr.array  as Float32Array)[i3 + 2] = smokePositions[i3 + 2];
        (lifeAttr.array as Float32Array)[i]      = smokeLifes[i];
        if (smokeLifes[i] <= 0 && smokeActive && smokeTimer < SMOKE_DURATION) {
            resetSmokeParticle(i);
            (posAttr.array  as Float32Array)[i3]     = smokePositions[i3];
            (posAttr.array  as Float32Array)[i3 + 1] = smokePositions[i3 + 1];
            (posAttr.array  as Float32Array)[i3 + 2] = smokePositions[i3 + 2];
            (lifeAttr.array as Float32Array)[i]      = smokeLifes[i];
        }
    }
    posAttr.needsUpdate  = true;
    lifeAttr.needsUpdate = true;
}

// ============================================
// STATE
// ============================================
let fireIntensity   = 1.0;
let targetIntensity = 1.0;
let _currentScale   = 0.0;

// ============================================
// PUBLIC API
// ============================================
export function Start(): void {
    const sprite = createFireSprite();
    fire.add(sprite);
    fire.scale.setScalar(0.0);
    fire.position.y = FIRE_HEIGHT_OFFSET;

    const embers = initEmbers();
    fire.add(embers);

    fireLight.position.copy(fire.position);
    fireLight.position.y += 0.05;
    fire.add(fireLight);

    _currentScale   = 0.0;
    fireIntensity   = 0.0;
    targetIntensity = isDayTime() ? 0.0 : 1.0;
    fireWasActive   = !isDayTime();
}

export function Update(): void {
    const isDay = isDayTime();
    targetIntensity = isDay ? 0.0 : 1.0;

    if (isDay && fireWasActive) {
        smokeActive   = true;
        smokeTimer    = 0.0;
        fireWasActive = false;
    }
    if (!isDay) {
        if (smokeActive) smokeTimer = Math.max(smokeTimer, SMOKE_DURATION);
        fireWasActive = true;
    }

    // Fade intensity + scale together
    const step = FADE_SPEED * deltaTime;
    if (fireIntensity !== targetIntensity) {
        const diff = targetIntensity - fireIntensity;
        fireIntensity = Math.abs(diff) < step ? targetIntensity : fireIntensity + Math.sign(diff) * step;
    }
    const targetScale = isDay ? 0.0 : FIRE_SCALE;
    if (_currentScale !== targetScale) {
        const diff = targetScale - _currentScale;
        _currentScale = Math.abs(diff) < step ? targetScale : _currentScale + Math.sign(diff) * step;
    }
    fire.scale.setScalar(_currentScale);

    // Smoke lifecycle
    if (smokeActive) {
        smokeTimer += deltaTime;
        if (smokeTimer < SMOKE_DURATION) {
            smokeIntensity = Math.min(smokeIntensity + SMOKE_APPEAR_SPEED * deltaTime, 1.0);
            smokeGrowth    = Math.min(smokeGrowth    + SMOKE_GROW_SPEED   * deltaTime, 1.0);
        } else {
            const fadeSpeed = !isDay ? SMOKE_DISMISS_SPEED : SMOKE_AUTO_FADE_SPEED;
            smokeIntensity  = Math.max(smokeIntensity - fadeSpeed         * deltaTime, 0.0);
            smokeGrowth     = Math.max(smokeGrowth    - SMOKE_SHRINK_SPEED * deltaTime, 0.0);
            if (smokeIntensity <= 0 && smokeGrowth <= 0) {
                smokeActive    = false;
                smokeIntensity = 0.0;
                smokeGrowth    = 0.0;
            }
        }
    }

    // Sprite sheet: advance frame + sync opacity to fire intensity
    if (_fireSpriteMat) {
        updateSpriteFrame();
        _fireSpriteMat.opacity = fireIntensity;
    }

    // Embers
    emberUniforms.uTime.value      = time;
    emberUniforms.uIntensity.value = fireIntensity;
    if (fireIntensity > 0.01) updateEmbers();

    // Lights + flicker
    const flicker = 1.0 + (Math.sin(time * 15.0) * 0.3 + Math.sin(time * 23.0) * 0.2) * fireLightConfig.flicker;
    fireLight.intensity       = fireIntensity * fireLightConfig.intensity * flicker;
    fireShadowLight.intensity = fireIntensity * fireLightConfig.intensity * flicker * 0.7;
    fireLight.distance        = fireLightConfig.range;

    const colorFlicker = 0.9 + Math.sin(time * 10.0) * 0.1;
    fireLight.color.setRGB(1.0, 0.4 * colorFlicker, 0.1 * colorFlicker);
    fireShadowLight.color.setRGB(1.0, 0.4 * colorFlicker, 0.1 * colorFlicker);

    fireLight.getWorldPosition(_fireShadowWorldPos);
    fireShadowLight.position.set(_fireShadowWorldPos.x, _fireShadowWorldPos.y + 0.4, _fireShadowWorldPos.z);
    fireShadowLight.target.position.set(_fireShadowWorldPos.x, _fireShadowWorldPos.y - 1, _fireShadowWorldPos.z);

    fire.visible = true;
}

const _fireLightWorldPos  = new Vector3();
const _fireShadowWorldPos = new Vector3();

export function getFireLightData(): { position: Vector3; color: typeof fireLight.color; intensity: number } {
    return {
        position:  fireLight.getWorldPosition(_fireLightWorldPos),
        color:     fireLight.color,
        intensity: fireLight.intensity
    };
}

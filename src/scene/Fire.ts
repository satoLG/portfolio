import { 
    Group, 
    Mesh, 
    PlaneGeometry, 
    ShaderMaterial, 
    DoubleSide, 
    AdditiveBlending,
    PointLight,
    BufferGeometry,
    Float32BufferAttribute,
    Points,
    Vector3
} from "three";
import { deltaTime, time } from "../scripts/Time";
import { isDayTime } from "./Skybox";

export const fire = new Group();

export const fireLight = new PointLight(0xff6622, 0, 8, 2);

// Configure shadow casting for fire light
fireLight.castShadow = true;
fireLight.shadow.mapSize.width = 1024;
fireLight.shadow.mapSize.height = 1024;
fireLight.shadow.camera.near = 0.1;
fireLight.shadow.camera.far = 5;
fireLight.shadow.bias = -0.001;  // Negative bias for PCF
fireLight.shadow.normalBias = 0.1;  // TWEAK: Higher = smoother edges (0.02-0.15)

const FIRE_SCALE = 0.25;
const FIRE_HEIGHT_OFFSET = 0.13;
const FIRE_LIGHT_INTENSITY = 3.0;
const FIRE_LIGHT_FLICKER = 0.3;
const FADE_SPEED = 1.5;

const EMBER_COUNT = 15;
const EMBER_SPEED = 0.4;
const EMBER_SIZE = 0.02;
const EMBER_LIFETIME = 2.5;

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
    
    fireLight.position.copy(fire.position);
    fireLight.position.y += 0.05;
    fire.add(fireLight);
    
    fireIntensity = 0.0;
    targetIntensity = isDayTime() ? 0.0 : 1.0;
}

export function Update(): void {
    targetIntensity = isDayTime() ? 0.0 : 1.0;
    
    if (fireIntensity !== targetIntensity) {
        const diff = targetIntensity - fireIntensity;
        const step = FADE_SPEED * deltaTime;
        
        if (Math.abs(diff) < step) {
            fireIntensity = targetIntensity;
        } else {
            fireIntensity += Math.sign(diff) * step;
        }
    }
    
    fireUniforms.uTime.value = time;
    fireUniforms.uIntensity.value = fireIntensity;
    
    emberUniforms.uTime.value = time;
    emberUniforms.uIntensity.value = fireIntensity;
    if (fireIntensity > 0.01) {
        updateEmbers();
    }
    
    const flicker = 1.0 + (Math.sin(time * 15.0) * 0.3 + Math.sin(time * 23.0) * 0.2) * FIRE_LIGHT_FLICKER;
    fireLight.intensity = fireIntensity * FIRE_LIGHT_INTENSITY * flicker;
    
    const colorFlicker = 0.9 + Math.sin(time * 10.0) * 0.1;
    fireLight.color.setRGB(1.0, 0.4 * colorFlicker, 0.1 * colorFlicker);
    
    fire.visible = fireIntensity > 0.001;
}

export function getFireLightData(): { position: Vector3; color: typeof fireLight.color; intensity: number } {
    return {
        position: fireLight.getWorldPosition(new Vector3()),
        color: fireLight.color,
        intensity: fireLight.intensity
    };
}

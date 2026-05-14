import {
    BufferAttribute,
    BufferGeometry,
    Color,
    Camera,
    Group,
    LinearFilter,
    LinearMipmapLinearFilter,
    Mesh,
    Scene,
    ShaderMaterial,
    TextureLoader,
    WebGLRenderer,
} from "three";

export const cloudSpritesGroup = new Group();
const cloudSpritesScene = new Scene();

const CLOUDS_PER_CHUNK = 2200;
const CLOUD_CHUNK_COUNT = 3;
const CLOUD_LOOP_DEPTH = 35;
const CLOUD_GROUP_Z = 10;
const CLOUD_WIDTH = 180;
// Tweak this to keep the initial cloud sprites below the welcome Tegaki text.
// This is a hard cap for the rotated sprite vertices, not just the sprite center.
const CLOUD_MAX_TOP_Y = 9.25;
const CLOUD_LAYER_DEPTH = 1.7;
const CLOUD_BASE_SIZE = 2.95;

// How fast the cloud belt drifts toward the camera before the Start click.
const PRE_START_Z_SPEED = 0.3;

// Per-sprite opacity ramp through the loop. Rear layers stay subtle, but front
// layers must get dense quickly so the cloud bank reads solid near the camera.
const LAYER_BACK_OPACITY = 0.0;
const LAYER_FRONT_OPACITY = 1.0;
const LAYER_OPACITY_RAMP_START = 0.02;
const LAYER_OPACITY_RAMP_END = 0.62;
const SPAWN_FADE_START = 0.05;
const SPAWN_FADE_END = 0.28;

// Fades fragments right at the near clip plane, avoiding the hard straight-line
// cut when the camera passes through a billboard.
const NEAR_CLIP_FADE_START = 0.0;
const NEAR_CLIP_FADE_END = 0.22;

// Rear layers stay lighter/flatter; front layers keep more cloud10.png detail.
const BACK_FOG_STRENGTH = 0.04;
const FRONT_FOG_STRENGTH = 0.16;
const BACK_SHADOW_LIFT = 0.78;
const FRONT_SHADOW_LIFT = 0.02;

// Post-click lift: clouds keep masking the descent, then rise out of frame.
const LIFT_SPEED = 6.0;
const LIFT_HIDE_Y = 40;
const LIFT_DELAY = 1.15;

// Seconds after Start before hiding rear cloud depth while the camera is inside
// the cloud belt. Lower = rear layers disappear earlier in the descent.
const BACK_LAYER_HIDE_TIME = 0.5;
// Fraction of the rear part of each visible loop chunk hidden after that time.
// 0.35 hides the farthest 35%; 0.6 hides much more of the cloud depth.
const BACK_LAYER_HIDE_AMOUNT = 0.45;
// Seconds used to fade that rear-depth mask in, so it does not pop.
const BACK_LAYER_HIDE_FADE_DURATION = 0.7;
const BACK_LAYER_HIDE_SOFTNESS = 0.14;

const vertex = /* glsl */`
    uniform float chunkZ;
    uniform float loopDepth;

    varying vec2 vUv;
    varying float vLayerNear;

    void main() {
        vUv = uv;
        vLayerNear = clamp((position.z + chunkZ + loopDepth) / loopDepth, 0.0, 1.0);

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragment = /* glsl */`
    uniform sampler2D map;
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    uniform float opacity;
    uniform float layerBackOpacity;
    uniform float layerFrontOpacity;
    uniform float layerOpacityRampStart;
    uniform float layerOpacityRampEnd;
    uniform float spawnFadeStart;
    uniform float spawnFadeEnd;
    uniform float nearClipFadeStart;
    uniform float nearClipFadeEnd;
    uniform float backFogStrength;
    uniform float frontFogStrength;
    uniform float backShadowLift;
    uniform float frontShadowLift;
    uniform float backLayerHideProgress;
    uniform float backLayerHideAmount;
    uniform float backLayerHideSoftness;
    uniform float nightBlend;

    varying vec2 vUv;
    varying float vLayerNear;

    void main() {
        float depth = gl_FragCoord.z / gl_FragCoord.w;
        float fogFactor = smoothstep(fogNear, fogFar, depth);
        float layerPresence = pow(smoothstep(layerOpacityRampStart, layerOpacityRampEnd, vLayerNear), 0.9);

        vec4 cloud = texture2D(map, vUv);
        float luma = dot(cloud.rgb, vec3(0.299, 0.587, 0.114));
        float shadow = 1.0 - smoothstep(0.28, 0.72, luma);
        float shadowLift = mix(backShadowLift, frontShadowLift, layerPresence);
        cloud.rgb = mix(cloud.rgb, vec3(1.0), shadow * shadowLift);

        float distanceAlpha = mix(1.0, 0.7, fogFactor);
        float layerAlpha = mix(layerBackOpacity, layerFrontOpacity, layerPresence);
        float spawnFade = smoothstep(spawnFadeStart, spawnFadeEnd, vLayerNear);
        float nearClipFade = smoothstep(nearClipFadeStart, nearClipFadeEnd, gl_FragCoord.z);
        float rearLayerMask = mix(
            1.0,
            smoothstep(backLayerHideAmount, backLayerHideAmount + backLayerHideSoftness, vLayerNear),
            backLayerHideProgress
        );

        cloud.a *= distanceAlpha * layerAlpha * spawnFade * nearClipFade * rearLayerMask * opacity;
        float fogStrength = mix(backFogStrength, frontFogStrength, layerPresence);
        cloud.rgb = mix(cloud.rgb, fogColor, fogFactor * fogStrength);
        float grey = dot(cloud.rgb, vec3(0.299, 0.587, 0.114));
        vec3 nightCloud = vec3(grey) * 0.48;
        cloud.rgb = mix(cloud.rgb, nightCloud, nightBlend);
        gl_FragColor = cloud;
    }
`;

let textureMap: any = null;
const chunks: Mesh[] = [];
let liftY = 0;
let lifting = false;
let descentTime = 0;
let started = false;
let farChunkHidden = false;
let hiddenAfterDescent = false;
let backLayerHideProgress = 0;
let frontChunkDuringDescent: Mesh | null = null;

export function Start(): void {
    cloudSpritesScene.add(cloudSpritesGroup);

    const texture = new TextureLoader().load("/images/cloud10.png");
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    textureMap = texture;

    chunks.length = 0;
    cloudSpritesGroup.clear();
    for (let i = 0; i < CLOUD_CHUNK_COUNT; i++) {
        const chunk = createCloudMesh(createCloudGeometry(CLOUDS_PER_CHUNK), createCloudMaterial());
        chunk.position.z = -CLOUD_LOOP_DEPTH * i;
        chunks.push(chunk);
        cloudSpritesGroup.add(chunk);
    }

    cloudSpritesGroup.position.set(0, 0, CLOUD_GROUP_Z);
    updateChunkMaterials();
}

function createCloudMaterial(): ShaderMaterial {
    return new ShaderMaterial({
        uniforms: {
            map: { value: textureMap },
            fogColor: { value: new Color(0xd9eef8) },
            fogNear: { value: 2.0 },
            fogFar: { value: 64.0 },
            opacity: { value: 1.0 },
            chunkZ: { value: 0.0 },
            loopDepth: { value: CLOUD_LOOP_DEPTH },
            layerBackOpacity: { value: LAYER_BACK_OPACITY },
            layerFrontOpacity: { value: LAYER_FRONT_OPACITY },
            layerOpacityRampStart: { value: LAYER_OPACITY_RAMP_START },
            layerOpacityRampEnd: { value: LAYER_OPACITY_RAMP_END },
            spawnFadeStart: { value: SPAWN_FADE_START },
            spawnFadeEnd: { value: SPAWN_FADE_END },
            nearClipFadeStart: { value: NEAR_CLIP_FADE_START },
            nearClipFadeEnd: { value: NEAR_CLIP_FADE_END },
            backFogStrength: { value: BACK_FOG_STRENGTH },
            frontFogStrength: { value: FRONT_FOG_STRENGTH },
            backShadowLift: { value: BACK_SHADOW_LIFT },
            frontShadowLift: { value: FRONT_SHADOW_LIFT },
            backLayerHideProgress: { value: 0.0 },
            backLayerHideAmount: { value: BACK_LAYER_HIDE_AMOUNT },
            backLayerHideSoftness: { value: BACK_LAYER_HIDE_SOFTNESS },
            nightBlend: { value: 0.0 },
        },
        vertexShader: vertex,
        fragmentShader: fragment,
        depthWrite: false,
        depthTest: false,
        transparent: true,
    });
}

export function beginDescent(): void {
    started = true;
    lifting = true;
    liftY = 0;
    descentTime = 0;
    farChunkHidden = false;
    hiddenAfterDescent = false;
    backLayerHideProgress = 0;
    frontChunkDuringDescent = getNearestChunk();
    cloudSpritesGroup.visible = true;
    for (const chunk of chunks) chunk.visible = true;
    updateChunkMaterials();
}

export function Update(cameraY: number, deltaTime: number, dayNightBlend = 0): void {
    if (chunks.length === 0) return;

    if (!started) {
        updatePreStartLoop(deltaTime);
    }

    if (lifting) {
        descentTime += deltaTime;

        if (descentTime >= BACK_LAYER_HIDE_TIME) {
            backLayerHideProgress = Math.min(1, backLayerHideProgress + deltaTime / BACK_LAYER_HIDE_FADE_DURATION);
        }

        if (!farChunkHidden && backLayerHideProgress >= 1) {
            hideFarthestChunk();
            farChunkHidden = true;
        }
        if (descentTime >= LIFT_DELAY) {
            liftY += LIFT_SPEED * deltaTime;
        }
        if (liftY >= LIFT_HIDE_Y) {
            lifting = false;
            hiddenAfterDescent = true;
            cloudSpritesGroup.visible = false;
        }

    }

    cloudSpritesGroup.position.set(0, liftY, CLOUD_GROUP_Z);
    updateChunkMaterials(dayNightBlend);
    if (!started && !lifting && liftY < LIFT_HIDE_Y) cloudSpritesGroup.visible = true;
    if (hiddenAfterDescent) cloudSpritesGroup.visible = false;
}

export function Render(renderer: WebGLRenderer, camera: Camera): void {
    if (!cloudSpritesGroup.visible) return;

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(cloudSpritesScene, camera);
    renderer.autoClear = prevAutoClear;
}

function createCloudMesh(geometry: BufferGeometry, material: ShaderMaterial): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1000;
    return mesh;
}

function updatePreStartLoop(deltaTime: number): void {
    for (const chunk of chunks) {
        chunk.position.z += PRE_START_Z_SPEED * deltaTime;
        if (chunk.position.z >= CLOUD_LOOP_DEPTH) {
            chunk.position.z -= CLOUD_LOOP_DEPTH * CLOUD_CHUNK_COUNT;
        }
    }
}

function updateChunkMaterials(dayNightBlend = 0): void {
    for (const chunk of chunks) {
        const mat = chunk.material as ShaderMaterial;
        mat.uniforms.nightBlend.value = dayNightBlend;
        mat.uniforms.chunkZ.value = chunk.position.z;
        mat.uniforms.backLayerHideProgress.value = backLayerHideProgress;
    }
}

function getNearestChunk(): Mesh | null {
    let nearest: Mesh | null = null;
    let nearestZ = Number.NEGATIVE_INFINITY;

    for (const chunk of chunks) {
        if (chunk.position.z > nearestZ) {
            nearestZ = chunk.position.z;
            nearest = chunk;
        }
    }

    return nearest;
}

function hideFarthestChunk(): void {
    let farthest: Mesh | null = null;
    let farthestZ = Number.POSITIVE_INFINITY;

    for (const chunk of chunks) {
        if (!chunk.visible) continue;
        if (chunk.position.z < farthestZ) {
            farthestZ = chunk.position.z;
            farthest = chunk;
        }
    }

    if (frontChunkDuringDescent) {
        for (const chunk of chunks) {
            if (chunk !== frontChunkDuringDescent) chunk.visible = false;
        }
        return;
    }

    if (farthest) farthest.visible = false;
}

function createCloudGeometry(count: number): BufferGeometry {
    const positions = new Float32Array(count * 4 * 3);
    const uvs = new Float32Array(count * 4 * 2);
    const indices = new Uint32Array(count * 6);

    for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const z = -CLOUD_LOOP_DEPTH + t * CLOUD_LOOP_DEPTH;
        const x = Math.random() * CLOUD_WIDTH - CLOUD_WIDTH * 0.5;
        const rotation = Math.random() * Math.PI;
        const scale = Math.random() * Math.random() * 1.5 + 0.5;
        const half = CLOUD_BASE_SIZE * scale * 0.5;
        const topExtent = half * (Math.abs(Math.cos(rotation)) + Math.abs(Math.sin(rotation)));
        const y = CLOUD_MAX_TOP_Y - topExtent - Math.random() * Math.random() * CLOUD_LAYER_DEPTH;

        writePlane(positions, uvs, indices, i, x, y, z, half, rotation);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();

    return geometry;
}

function writePlane(
    positions: Float32Array,
    uvs: Float32Array,
    indices: Uint32Array,
    planeIndex: number,
    x: number,
    y: number,
    z: number,
    halfSize: number,
    rotation: number,
): void {
    const vertexBase = planeIndex * 4;
    const posBase = vertexBase * 3;
    const uvBase = vertexBase * 2;
    const indexBase = planeIndex * 6;

    const c = Math.cos(rotation);
    const s = Math.sin(rotation);

    setCorner(positions, posBase, 0, x, y, z, -halfSize, -halfSize, c, s);
    setCorner(positions, posBase, 1, x, y, z, halfSize, -halfSize, c, s);
    setCorner(positions, posBase, 2, x, y, z, -halfSize, halfSize, c, s);
    setCorner(positions, posBase, 3, x, y, z, halfSize, halfSize, c, s);

    uvs[uvBase] = 0;
    uvs[uvBase + 1] = 0;
    uvs[uvBase + 2] = 1;
    uvs[uvBase + 3] = 0;
    uvs[uvBase + 4] = 0;
    uvs[uvBase + 5] = 1;
    uvs[uvBase + 6] = 1;
    uvs[uvBase + 7] = 1;

    indices[indexBase] = vertexBase;
    indices[indexBase + 1] = vertexBase + 1;
    indices[indexBase + 2] = vertexBase + 2;
    indices[indexBase + 3] = vertexBase + 1;
    indices[indexBase + 4] = vertexBase + 3;
    indices[indexBase + 5] = vertexBase + 2;
}

function setCorner(
    positions: Float32Array,
    posBase: number,
    corner: number,
    x: number,
    y: number,
    z: number,
    localX: number,
    localY: number,
    c: number,
    s: number,
): void {
    const offset = posBase + corner * 3;
    positions[offset] = x + localX * c - localY * s;
    positions[offset + 1] = y + localX * s + localY * c;
    positions[offset + 2] = z;
}

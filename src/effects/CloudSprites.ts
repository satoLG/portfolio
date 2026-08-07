import {
    BufferAttribute,
    BufferGeometry,
    Color,
    Camera,
    DoubleSide,
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

// Horizon cloud band — lives in the MAIN scene (see the HORIZON_CLOUD_* block).
export const horizonCloudsGroup = new Group();
let horizonMaterial: ShaderMaterial | null = null;
// Their reflections need to land after the ocean surface pass, so they sit in
// their own scene that Scene.ts renders at that point (RenderHorizonReflections).
const horizonReflectionScene = new Scene();
let horizonReflectionMaterial: ShaderMaterial | null = null;

const CLOUDS_PER_CHUNK = 2200;
const CLOUD_CHUNK_COUNT = 3;
const CLOUD_LOOP_DEPTH = 35;
const CLOUD_GROUP_Z = 10;
const CLOUD_WIDTH = 180;
// Tweak this to keep the initial cloud sprites below the welcome text.
// This is a hard cap for the rotated sprite vertices, not just the sprite center.
const CLOUD_MAX_TOP_Y = 10;
const CLOUD_LAYER_DEPTH = 1.7;
// Per-sprite Y jitter (world units, zero-mean ±value) layered on top of the base
// placement so the deck reads less flat / more hand-painted. Does NOT move the deck's
// base Y — sprites still hang from the same CLOUD_MAX_TOP_Y anchor, and the top of any
// jittered-up sprite is clamped to that cap so nothing pokes above the welcome text.
// Set to 0 to disable; raise for a more scattered, cottony look.
const CLOUD_Y_VARIANCE = 0.8;
const CLOUD_BASE_SIZE = 2.95;
const CLOUD_FRONT_DROP_START = 0.1;
const CLOUD_FRONT_DROP_END = 0.96;
const CLOUD_FRONT_TOP_DROP = 2.35;

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
const LIFT_HIDE_Y = 80;
const LIFT_DELAY = 1.15;

// Seconds after Start before hiding rear cloud depth while the camera is inside
// the cloud belt. Lower = rear layers disappear earlier in the descent.
const BACK_LAYER_HIDE_TIME = 0.35;
// Fraction of the rear part of each visible loop chunk hidden after that time.
// 0.35 hides the farthest 35%; 0.6 hides much more of the cloud depth.
const BACK_LAYER_HIDE_AMOUNT = 0.45;
// Seconds used to fade that rear-depth mask in, so it does not pop.
const BACK_LAYER_HIDE_FADE_DURATION = 0.7;
const BACK_LAYER_HIDE_SOFTNESS = 0.14;

// ── Horizon cloud band ───────────────────────────────────────────────────────
// A second, always-on cloud layer, unrelated to the intro deck above. These are
// distant cards standing far out at sea and clipped at the waterline, so only
// their top half clears the ocean horizon — the way distant clouds read when
// you're low on the water.
//
// Unlike the intro deck (own scene, depth cleared, painted over everything),
// this layer lives in the MAIN scene so the ocean, island and post-processing
// sort against it normally. Scene.ts adds `horizonCloudsGroup`, keeps it out of
// the foam depth pre-pass, and hides it with the skybox inside the cabana.
const HORIZON_CLOUD_COUNT = 10;
// Z band the cards scatter through. The ocean plane runs to z = -400, so these
// stay comfortably over water — a card past the plane's far edge would have
// nothing to be cut by and would float in the sky instead.
const HORIZON_CLOUD_NEAR_Z = -150;
const HORIZON_CLOUD_FAR_Z  = -330;
// Total world-X width of the band. Wider than the view frustum on purpose: the
// clouds that fall off-frame are what keep the visible ones irregularly spaced
// instead of evenly dealt across the screen.
const HORIZON_CLOUD_X_SPREAD = 520;
const HORIZON_CLOUD_MIN_SIZE = 34;
const HORIZON_CLOUD_MAX_SIZE = 78;
// Fraction of each card sitting BELOW the waterline. cloud10.png's alpha is
// vertically centred in its quad (measured centroid: uv.y 0.507), so 0.5 leaves
// visually half the cloud showing. Raise to sink them, lower to lift them.
const HORIZON_CLOUD_SINK = 0.5;
const HORIZON_CLOUD_SINK_VARIANCE = 0.1;
// World units of dissolve just above the cut. Without it the clip reads as a
// ruler-drawn line; this also hides the 1-2px band where the ocean surface pass
// paints over the card's foot (water farther than the card still draws on top
// of it — the cards are transparent and don't write depth).
const HORIZON_CLOUD_WATERLINE_FADE = 1.6;
const HORIZON_CLOUD_OPACITY = 0.34;
// Distant clouds lose contrast against the sky — blend them toward the haze.
const HORIZON_CLOUD_HAZE_COLOR = 0xdfeef8;
const HORIZON_CLOUD_HAZE = 0.45;
// Fixed seed: the scatter is random-looking but identical on every reload, so a
// visual tweak is the only thing that changes between two screenshots.
const HORIZON_CLOUD_SEED = 20260807;

// ── Horizon cloud reflections ────────────────────────────────────────────────
// Each card gets a mirrored twin below the waterline, so the half the horizon
// cut takes away comes back as a reflection lying on the water — the two meet
// edge-to-edge at the horizon and read as one shape.
//
// These draw AFTER the ocean surface pass (Scene.ts calls RenderHorizonReflections
// from inside renderSceneFrame), because a reflection sits ON the water rather
// than behind it. Depth testing stays on, so the island still occludes the ones
// behind it — the ocean surface itself writes no depth, which is what lets the
// reflections land on top of the water without punching through the island.
const HORIZON_REFLECTION_OPACITY = 0.22;
// Vertical squash. A real reflection on a flat sea is compressed at these
// grazing angles; 1.0 would be a perfect mirror twin and read as a mistake.
const HORIZON_REFLECTION_SQUASH = 0.62;
// Mip bias for the reflection sample — this is the "low resolution" part.
// Positive values force a coarser mip, so the reflection is a soft smear of the
// cloud rather than a second sharp copy of it. Don't push this much higher: past
// ~2 the mip is coarse enough that cloud alpha bleeds into every corner of the
// quad and the reflection stops being cloud-shaped, reading as a translucent
// rectangle lying on the water.
const HORIZON_REFLECTION_BLUR = 1.6;
// Where the reflection starts dying out, as a fraction down the card (the
// waterline sits at ~0.5, the card's bottom edge at 1.0). Measured in card space
// rather than world units so the falloff always completes before the geometry
// ends — a reflection still carrying alpha at its bottom edge shows up as a
// rectangle lying in the water. Bigger clouds get longer reflections for free.
const HORIZON_REFLECTION_FADE_START = 0.5;
// Feather on the card's borders. The mip bias above samples a coarse mip whose
// texels bleed cloud alpha into the quad's edges, which would otherwise outline
// the rectangle on the water; this fades the last stretch of UV to nothing.
const HORIZON_REFLECTION_EDGE_FEATHER = 0.45;
// Reflections take the water's colour, not the sky's.
const HORIZON_REFLECTION_TINT_COLOR = 0x9dc4d6;
const HORIZON_REFLECTION_TINT = 0.55;

// Shared by the cards and their reflections — `yScale` is the only difference:
// 1.0 draws the cloud, a negative value mirrors it under the waterline (and its
// magnitude squashes the reflection).
const horizonVertex = /* glsl */`
    attribute vec2 cornerOffset;

    uniform float yScale;

    varying vec2 vUv;
    varying float vWorldY;

    void main() {
        vUv = uv;

        vec3 centre = (modelMatrix * vec4(position, 1.0)).xyz;
        // Yaw-only billboard: expand along the camera's world-space right vector
        // so the cards keep facing the camera as it turns, but never tip with its
        // pitch. Tipping would tilt the waterline cut off horizontal, and the cut
        // is the whole point of this layer.
        vec2 rightXZ = vec2(viewMatrix[0][0], viewMatrix[2][0]);
        vec3 camRight = vec3(rightXZ.x, 0.0, rightXZ.y) / max(length(rightXZ), 1e-4);

        vec3 worldPos = centre + camRight * cornerOffset.x + vec3(0.0, cornerOffset.y * yScale, 0.0);
        vWorldY = worldPos.y;

        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
    }
`;

const horizonFragment = /* glsl */`
    uniform sampler2D map;
    uniform vec3 hazeColor;
    uniform float haze;
    uniform float waterlineFade;
    uniform float opacity;
    uniform float nightBlend;

    varying vec2 vUv;
    varying float vWorldY;

    void main() {
        // Anything below the waterline belongs to the water, not the sky.
        if (vWorldY <= 0.0) discard;

        vec4 cloud = texture2D(map, vUv);
        cloud.rgb = mix(cloud.rgb, hazeColor, haze);
        float grey = dot(cloud.rgb, vec3(0.299, 0.587, 0.114));
        cloud.rgb = mix(cloud.rgb, vec3(grey) * 0.48, nightBlend);

        cloud.a *= smoothstep(0.0, waterlineFade, vWorldY) * opacity;
        if (cloud.a <= 0.001) discard;

        gl_FragColor = cloud;
    }
`;

const horizonReflectionFragment = /* glsl */`
    uniform sampler2D map;
    uniform vec3 tintColor;
    uniform float tint;
    uniform float blur;
    uniform float fadeStart;
    uniform float edgeFeather;
    uniform float opacity;
    uniform float nightBlend;

    varying vec2 vUv;
    varying float vWorldY;

    void main() {
        // Mirror image only — above the waterline is the cloud's own business.
        if (vWorldY >= 0.0) discard;

        // Third argument is a mip bias: the reflection samples a coarser mip than
        // the cloud, which is what makes it a soft low-res smear instead of a
        // second sharp copy.
        vec4 cloud = texture2D(map, vUv, blur);
        // A coarse mip bleeds cloud alpha outward, all the way into the quad's
        // corners where the cloud isn't. Gating on the unbiased alpha keeps the
        // reflection inside the silhouette it's reflecting, so no amount of blur
        // can turn it into a translucent rectangle on the water.
        cloud.a *= texture2D(map, vUv).a;
        cloud.rgb = mix(cloud.rgb, tintColor, tint);
        float grey = dot(cloud.rgb, vec3(0.299, 0.587, 0.114));
        cloud.rgb = mix(cloud.rgb, vec3(grey) * 0.48, nightBlend);

        // Full strength against the waterline so it meets the cloud edge-to-edge,
        // dying out with depth the way a reflection loses its shape on open water.
        // uv.y runs 0 at the card's top to 1 at its bottom; the mirroring puts the
        // waterline near 0.5, so this fades over the submerged stretch.
        float depthFade = 1.0 - smoothstep(fadeStart, 1.0, vUv.y);

        // Kill the coarse-mip bleed at the card's borders (see EDGE_FEATHER).
        vec2 edge = smoothstep(vec2(0.0), vec2(edgeFeather), vUv)
                  * (1.0 - smoothstep(vec2(1.0 - edgeFeather), vec2(1.0), vUv));

        cloud.a *= depthFade * edge.x * edge.y * opacity;
        if (cloud.a <= 0.001) discard;

        gl_FragColor = cloud;
    }
`;

const vertex = /* glsl */`
    uniform float chunkZ;
    uniform float loopDepth;
    uniform float frontDropStart;
    uniform float frontDropEnd;
    uniform float frontTopDrop;

    varying vec2 vUv;
    varying float vLayerNear;

    void main() {
        vUv = uv;
        vLayerNear = clamp((position.z + chunkZ + loopDepth) / loopDepth, 0.0, 1.0);

        float frontDrop = smoothstep(frontDropStart, frontDropEnd, vLayerNear) * frontTopDrop;
        vec3 loweredPosition = vec3(position.x, position.y - frontDrop, position.z);
        vec4 mvPosition = modelViewMatrix * vec4(loweredPosition, 1.0);
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

    buildHorizonClouds();

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
            frontDropStart: { value: CLOUD_FRONT_DROP_START },
            frontDropEnd: { value: CLOUD_FRONT_DROP_END },
            frontTopDrop: { value: CLOUD_FRONT_TOP_DROP },
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
    // Ahead of the guard below — the horizon band is independent of the intro
    // deck's chunks and has to keep tracking day/night even once they're gone.
    if (horizonMaterial) horizonMaterial.uniforms.nightBlend.value = dayNightBlend;
    if (horizonReflectionMaterial) horizonReflectionMaterial.uniforms.nightBlend.value = dayNightBlend;

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

// Small deterministic LCG so the scatter is stable across reloads (see
// HORIZON_CLOUD_SEED). Math.random() would reshuffle the band on every refresh,
// which makes eyeballing a tweak impossible.
function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function buildHorizonClouds(): void {
    horizonCloudsGroup.clear();
    horizonReflectionScene.clear();

    horizonMaterial = new ShaderMaterial({
        uniforms: {
            map: { value: textureMap },
            hazeColor: { value: new Color(HORIZON_CLOUD_HAZE_COLOR) },
            haze: { value: HORIZON_CLOUD_HAZE },
            waterlineFade: { value: HORIZON_CLOUD_WATERLINE_FADE },
            opacity: { value: HORIZON_CLOUD_OPACITY },
            yScale: { value: 1.0 },
            nightBlend: { value: 0.0 },
        },
        vertexShader: horizonVertex,
        fragmentShader: horizonFragment,
        // Transparent cards: no depth write, or they'd punch each other out.
        depthWrite: false,
        depthTest: true,
        transparent: true,
        // The yaw billboard can swing either face toward the camera.
        side: DoubleSide,
    });

    horizonReflectionMaterial = new ShaderMaterial({
        uniforms: {
            map: { value: textureMap },
            tintColor: { value: new Color(HORIZON_REFLECTION_TINT_COLOR) },
            tint: { value: HORIZON_REFLECTION_TINT },
            blur: { value: HORIZON_REFLECTION_BLUR },
            fadeStart: { value: HORIZON_REFLECTION_FADE_START },
            edgeFeather: { value: HORIZON_REFLECTION_EDGE_FEATHER },
            opacity: { value: HORIZON_REFLECTION_OPACITY },
            // Negative mirrors the card under the waterline; the magnitude squashes it.
            yScale: { value: -HORIZON_REFLECTION_SQUASH },
            nightBlend: { value: 0.0 },
        },
        vertexShader: horizonVertex,
        fragmentShader: horizonReflectionFragment,
        depthWrite: false,
        depthTest: true,
        transparent: true,
        side: DoubleSide,
    });

    // One geometry, drawn twice — the reflection is the same cards read upside
    // down, so they can never drift out of alignment with what they mirror.
    const geometry = createHorizonGeometry(HORIZON_CLOUD_COUNT);

    const mesh = new Mesh(geometry, horizonMaterial);
    // Billboarding happens in the vertex shader, so the CPU-side bounding sphere
    // never matches what's drawn.
    mesh.frustumCulled = false;
    horizonCloudsGroup.add(mesh);

    const reflection = new Mesh(geometry, horizonReflectionMaterial);
    reflection.frustumCulled = false;
    horizonReflectionScene.add(reflection);
}

/** Draws the cloud reflections onto the water. Must run AFTER the ocean surface
 *  pass — Scene.ts calls this from inside renderSceneFrame's ocean callback. */
export function RenderHorizonReflections(renderer: WebGLRenderer, camera: Camera): void {
    if (!horizonCloudsGroup.visible) return;

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    // No clearDepth here, unlike the intro deck's pass: the reflections are meant
    // to be occluded by anything the main pass already drew in front of them.
    renderer.render(horizonReflectionScene, camera);
    renderer.autoClear = prevAutoClear;
}

function createHorizonGeometry(count: number): BufferGeometry {
    const positions = new Float32Array(count * 4 * 3);   // sprite centre, repeated per corner
    const offsets = new Float32Array(count * 4 * 2);     // corner offset, expanded in the shader
    const uvs = new Float32Array(count * 4 * 2);
    const indices = new Uint32Array(count * 6);

    const random = makeRandom(HORIZON_CLOUD_SEED);

    for (let i = 0; i < count; i++) {
        const x = (random() - 0.5) * HORIZON_CLOUD_X_SPREAD;
        const z = HORIZON_CLOUD_NEAR_Z + random() * (HORIZON_CLOUD_FAR_Z - HORIZON_CLOUD_NEAR_Z);
        const size = HORIZON_CLOUD_MIN_SIZE + random() * (HORIZON_CLOUD_MAX_SIZE - HORIZON_CLOUD_MIN_SIZE);
        const sink = HORIZON_CLOUD_SINK + (random() - 0.5) * 2 * HORIZON_CLOUD_SINK_VARIANCE;
        // sink is measured from the card's bottom edge, so sink = 0.5 puts the
        // card's centre (and the texture's alpha centroid) on the waterline.
        const y = size * (0.5 - sink);
        // Mirror half of them so the same puff doesn't read as a repeat.
        const flip = random() < 0.5;

        const half = size * 0.5;
        const vertexBase = i * 4;
        const posBase = vertexBase * 3;
        const offBase = vertexBase * 2;
        const uvBase = vertexBase * 2;
        const indexBase = i * 6;

        for (let corner = 0; corner < 4; corner++) {
            const o = posBase + corner * 3;
            positions[o] = x;
            positions[o + 1] = y;
            positions[o + 2] = z;
        }

        offsets[offBase]     = -half; offsets[offBase + 1] = -half;
        offsets[offBase + 2] =  half; offsets[offBase + 3] = -half;
        offsets[offBase + 4] = -half; offsets[offBase + 5] =  half;
        offsets[offBase + 6] =  half; offsets[offBase + 7] =  half;

        const uLeft = flip ? 1 : 0;
        const uRight = flip ? 0 : 1;
        uvs[uvBase]     = uLeft;  uvs[uvBase + 1] = 0;
        uvs[uvBase + 2] = uRight; uvs[uvBase + 3] = 0;
        uvs[uvBase + 4] = uLeft;  uvs[uvBase + 5] = 1;
        uvs[uvBase + 6] = uRight; uvs[uvBase + 7] = 1;

        indices[indexBase]     = vertexBase;
        indices[indexBase + 1] = vertexBase + 1;
        indices[indexBase + 2] = vertexBase + 2;
        indices[indexBase + 3] = vertexBase + 1;
        indices[indexBase + 4] = vertexBase + 3;
        indices[indexBase + 5] = vertexBase + 2;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("cornerOffset", new BufferAttribute(offsets, 2));
    geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(indices, 1));

    return geometry;
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
        // Zero-mean jitter for a more natural, scattered deck. Clamp the result so a
        // jittered-up sprite's top vertex never rises past CLOUD_MAX_TOP_Y (the welcome-text cap).
        const yJitter = (Math.random() - 0.5) * 2 * CLOUD_Y_VARIANCE;
        const yMax = CLOUD_MAX_TOP_Y - topExtent;
        const y = Math.min(yMax, yMax - Math.random() * Math.random() * CLOUD_LAYER_DEPTH + yJitter);

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

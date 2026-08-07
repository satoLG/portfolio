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

// Horizon cloud band — cards and their reflections both live here, in their own
// scene drawn after the ocean surface pass (see the HORIZON_CLOUD_* block).
export const horizonCloudsGroup = new Group();
const horizonBandScene = new Scene();
let horizonMaterial: ShaderMaterial | null = null;
let horizonReflectionMaterial: ShaderMaterial | null = null;
// 0 while the camera is up in the intro sky, 1 once it has descended to the
// water (see HORIZON_REVEAL_START_Y).
let horizonReveal = 0;

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
// A second cloud layer, unrelated to the intro deck above. These are distant
// cards standing far out at sea and clipped at the waterline, so only their top
// half clears the ocean horizon — the way distant clouds read when you're low on
// the water. Each one is mirrored below the cut as a reflection (see the
// HORIZON_REFLECTION_* block), and both halves draw in one pass after the ocean
// surface (RenderHorizonBand).
//
// Like the intro deck this is its own scene, but it does NOT clear depth first,
// so the island still occludes it. It fades in with the camera's descent rather
// than being on from the start — see HORIZON_REVEAL_START_Y.
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
// World units of dissolve just above the cut. Effectively zero — the reflection
// picks the image straight back up below the waterline, so it is what softens the
// cut, and any fade here just carves a dim notch across the seam instead. The cut
// itself is always exactly horizontal on screen, so it needs no anti-aliasing.
const HORIZON_CLOUD_WATERLINE_FADE = 0.02;
const HORIZON_CLOUD_OPACITY = 0.34;
// Distant clouds lose contrast against the sky — blend them toward the haze.
const HORIZON_CLOUD_HAZE_COLOR = 0xdfeef8;
const HORIZON_CLOUD_HAZE = 0.45;
// The band takes only ALPHA from cloud10.png and colours it with this. The
// texture's transparent areas carry dark RGB (~53 grey) behind their zero alpha,
// and mip filtering averages colour and alpha independently — so any minified or
// mip-biased sample drags that grey into the cloud's colour and lays a dirty
// smear on the water. Sampling colour from a constant sidesteps the whole class
// of bug. What's lost is the texture's internal shading, which at this distance
// and opacity the haze blend was flattening anyway.
const HORIZON_CLOUD_BODY_COLOR = 0xeef1f3;
// Fixed seed: the scatter is random-looking but identical on every reload, so a
// visual tweak is the only thing that changes between two screenshots.
const HORIZON_CLOUD_SEED = 20260807;

// ── Horizon cloud reflections ────────────────────────────────────────────────
// Each card gets a mirrored twin below the waterline, so the half the horizon
// cut takes away comes back as a reflection lying on the water — the two meet
// edge-to-edge at the horizon and read as one shape.
// Matched to HORIZON_CLOUD_OPACITY on purpose. The reflection is at full
// strength exactly where it meets the card, so the pair crosses the waterline
// with no step in brightness — a weaker reflection leaves the card's cut showing
// as a bright edge against the water, which is the seam this is meant to avoid.
// The depth falloff below takes it down from there.
const HORIZON_REFLECTION_OPACITY = HORIZON_CLOUD_OPACITY;
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
// How far the reflection reaches below the waterline, as a fraction of the
// card's mirrored half-height. Card-relative rather than in world units, so the
// falloff always completes before the geometry ends (a reflection still carrying
// alpha at its bottom edge shows up as a rectangle lying in the water) and
// bigger clouds get longer reflections for free.
const HORIZON_REFLECTION_REACH = 0.85;
// Feather on the card's borders. The mip bias above samples a coarse mip whose
// texels bleed cloud alpha into the quad's edges, which would otherwise outline
// the rectangle on the water; this fades the last stretch of UV to nothing.
const HORIZON_REFLECTION_EDGE_FEATHER = 0.15;
// Reflections take the water's colour, not the sky's. Both the tint and the blur
// ramp in with depth rather than applying flat, so right at the waterline the
// reflection still matches the card's colour and sharpness and the two read as
// one continuous shape; it turns into water further down.
const HORIZON_REFLECTION_TINT_COLOR = 0x9dc4d6;
const HORIZON_REFLECTION_TINT = 0.55;

// ── Horizon band reveal ──────────────────────────────────────────────────────
// The waterline cut is a dead-straight line spanning the frame, so the band must
// not be on screen while the camera is up in the sky during the intro — there it
// shows through the deck's semi-transparent edges and reads as the ocean bleeding
// through the clouds. Fading on camera height rather than switching on an event
// also means it arrives gradually as the descent brings the sea up to meet you.
const HORIZON_REVEAL_START_Y = 7.0;   // camera Y where the band starts appearing
const HORIZON_REVEAL_END_Y   = 2.4;   // camera Y where it's fully faded in

// Shared by the cards and their reflections — `yScale` is the only difference:
// 1.0 draws the cloud, a negative value mirrors it under the waterline (and its
// magnitude squashes the reflection).
//
// Note that yScale scales the whole world height, not just the corner offset, so
// the mirror axis is the WATERLINE and not the card's centre. Per-card sink
// variance puts those in different places, and mirroring about the centre
// reflects the half of the card that is underwater — for a card sitting low that
// is its dense middle, so the water below the horizon lights up with a bright
// slab that has no cloud above it to have come from.
const horizonVertex = /* glsl */`
    attribute vec2 cornerOffset;

    uniform float yScale;

    varying vec2 vUv;
    varying float vWorldY;
    varying float vDepthRange;

    void main() {
        vUv = uv;

        vec3 centre = (modelMatrix * vec4(position, 1.0)).xyz;
        // Yaw-only billboard: expand along the camera's world-space right vector
        // so the cards keep facing the camera as it turns, but never tip with its
        // pitch. Tipping would tilt the waterline cut off horizontal, and the cut
        // is the whole point of this layer.
        vec2 rightXZ = vec2(viewMatrix[0][0], viewMatrix[2][0]);
        vec3 camRight = vec3(rightXZ.x, 0.0, rightXZ.y) / max(length(rightXZ), 1e-4);

        float worldY = (centre.y + cornerOffset.y) * yScale;
        vec3 worldPos = vec3(centre.x, worldY, centre.z) + camRight * cornerOffset.x;
        vWorldY = worldY;

        // How far this card's mirror image can reach below the waterline: the top
        // of the card, reflected. Constant across the quad, so the fragment stage
        // gets it as a per-card value to normalise depth against.
        vDepthRange = abs((centre.y + abs(cornerOffset.y)) * yScale);

        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
    }
`;

const horizonFragment = /* glsl */`
    uniform sampler2D map;
    uniform vec3 bodyColor;
    uniform vec3 hazeColor;
    uniform float haze;
    uniform float waterlineFade;
    uniform float opacity;
    uniform float reveal;
    uniform float nightBlend;

    varying vec2 vUv;
    varying float vWorldY;

    void main() {
        // Anything below the waterline belongs to the water, not the sky.
        if (vWorldY <= 0.0) discard;

        // Alpha from the texture, colour from a constant — see BODY_COLOR.
        float alpha = texture2D(map, vUv).a;

        vec3 rgb = mix(bodyColor, hazeColor, haze);
        float grey = dot(rgb, vec3(0.299, 0.587, 0.114));
        rgb = mix(rgb, vec3(grey) * 0.48, nightBlend);

        alpha *= smoothstep(0.0, waterlineFade, vWorldY) * opacity * reveal;
        if (alpha <= 0.001) discard;

        gl_FragColor = vec4(rgb, alpha);
    }
`;

const horizonReflectionFragment = /* glsl */`
    uniform sampler2D map;
    uniform vec3 bodyColor;
    uniform vec3 hazeColor;
    uniform float haze;
    uniform vec3 tintColor;
    uniform float tint;
    uniform float blur;
    uniform float reach;
    uniform float edgeFeather;
    uniform float opacity;
    uniform float reveal;
    uniform float nightBlend;

    varying vec2 vUv;
    varying float vWorldY;
    varying float vDepthRange;

    void main() {
        // Mirror image only — above the waterline is the cloud's own business.
        if (vWorldY >= 0.0) discard;

        // How far under the waterline this fragment is: 0 at the cut, 1 where the
        // reflection has fully died out. Everything below keys off it, because the
        // reflection has to start as a copy of the cloud and only become water
        // further down.
        //
        // Measured against how far this card's mirror image reaches (vDepthRange)
        // rather than a fixed point in its UVs, since per-card sink variance moves
        // where the card crosses the waterline.
        float depth = clamp(-vWorldY / max(vDepthRange * reach, 1e-4), 0.0, 1.0);

        // Third argument is a mip bias: the reflection reads a coarser mip than the
        // cloud, which is what makes it a soft low-res smear instead of a second
        // sharp copy. Ramped with depth so the fragments touching the cut are as
        // sharp as the card they continue. ALPHA ONLY — see BODY_COLOR for why a
        // biased sample's colour can't be trusted.
        float alpha = texture2D(map, vUv, blur * depth).a;
        // A coarse mip bleeds alpha outward, all the way into the quad's corners
        // where the cloud isn't. Gating on the unbiased alpha keeps the reflection
        // inside the silhouette it's reflecting, so no amount of blur can turn it
        // into a translucent rectangle on the water.
        alpha *= texture2D(map, vUv).a;

        // Colour ramps from the card's own to the water's, so the two match where
        // they meet and it only reads as reflection once it's deep enough.
        vec3 rgb = mix(mix(bodyColor, hazeColor, haze), tintColor, tint * depth);
        float grey = dot(rgb, vec3(0.299, 0.587, 0.114));
        rgb = mix(rgb, vec3(grey) * 0.48, nightBlend);

        // Feather the card's side borders so a partly-blurred silhouette can't end
        // on a straight vertical edge. Horizontal only — vertically the waterline
        // discard bounds the top and the depth falloff bounds the bottom, and
        // feathering on top of those would eat most of the reflection's length.
        float edge = smoothstep(0.0, edgeFeather, vUv.x)
                   * (1.0 - smoothstep(1.0 - edgeFeather, 1.0, vUv.x));

        // Full strength against the waterline, dying out with depth the way a
        // reflection loses its shape on open water.
        alpha *= (1.0 - depth) * edge * opacity * reveal;
        if (alpha <= 0.001) discard;

        gl_FragColor = vec4(rgb, alpha);
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
    // deck's chunks and has to keep tracking the camera and day/night even once
    // those are gone.
    updateHorizonBand(cameraY, dayNightBlend);

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
    horizonBandScene.add(horizonCloudsGroup);

    horizonMaterial = new ShaderMaterial({
        uniforms: {
            map: { value: textureMap },
            bodyColor: { value: new Color(HORIZON_CLOUD_BODY_COLOR) },
            hazeColor: { value: new Color(HORIZON_CLOUD_HAZE_COLOR) },
            haze: { value: HORIZON_CLOUD_HAZE },
            waterlineFade: { value: HORIZON_CLOUD_WATERLINE_FADE },
            opacity: { value: HORIZON_CLOUD_OPACITY },
            yScale: { value: 1.0 },
            reveal: { value: 0.0 },
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
            bodyColor: { value: new Color(HORIZON_CLOUD_BODY_COLOR) },
            hazeColor: { value: new Color(HORIZON_CLOUD_HAZE_COLOR) },
            haze: { value: HORIZON_CLOUD_HAZE },
            tintColor: { value: new Color(HORIZON_REFLECTION_TINT_COLOR) },
            tint: { value: HORIZON_REFLECTION_TINT },
            blur: { value: HORIZON_REFLECTION_BLUR },
            reach: { value: HORIZON_REFLECTION_REACH },
            edgeFeather: { value: HORIZON_REFLECTION_EDGE_FEATHER },
            opacity: { value: HORIZON_REFLECTION_OPACITY },
            // Negative mirrors the card under the waterline; the magnitude squashes it.
            yScale: { value: -HORIZON_REFLECTION_SQUASH },
            reveal: { value: 0.0 },
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
    // Cards first, reflections over them — they only meet along the waterline, so
    // the order is about intent rather than overlap.
    mesh.renderOrder = 0;
    horizonCloudsGroup.add(mesh);

    const reflection = new Mesh(geometry, horizonReflectionMaterial);
    reflection.frustumCulled = false;
    reflection.renderOrder = 1;
    horizonCloudsGroup.add(reflection);
}

/** Fades the band in as the camera descends toward the water, and keeps it in
 *  step with day/night. See HORIZON_REVEAL_START_Y — up in the intro sky the band
 *  is fully faded out, so its waterline cut can't show through the cloud deck. */
function updateHorizonBand(cameraY: number, dayNightBlend: number): void {
    if (!horizonMaterial || !horizonReflectionMaterial) return;

    const span = HORIZON_REVEAL_START_Y - HORIZON_REVEAL_END_Y;
    const t = (HORIZON_REVEAL_START_Y - cameraY) / span;
    horizonReveal = Math.max(0, Math.min(1, t));

    horizonMaterial.uniforms.reveal.value = horizonReveal;
    horizonReflectionMaterial.uniforms.reveal.value = horizonReveal;
    horizonMaterial.uniforms.nightBlend.value = dayNightBlend;
    horizonReflectionMaterial.uniforms.nightBlend.value = dayNightBlend;
}

/** Draws the horizon cards and their reflections. Must run AFTER the ocean
 *  surface pass — Scene.ts calls this from inside renderSceneFrame's ocean
 *  callback.
 *
 *  Both halves go down here, not just the reflections. The ocean surface is
 *  transparent and writes no depth, so anything drawn before it loses to water
 *  that is FARTHER away but sits higher on screen — which would slice a strip of
 *  water between each card's waterline cut and its reflection, exactly where the
 *  two are supposed to meet. Drawing after the surface restores the real
 *  ordering: the card is nearer than that water, so it wins. */
export function RenderHorizonBand(renderer: WebGLRenderer, camera: Camera): void {
    if (horizonReveal <= 0 || !horizonCloudsGroup.visible) return;

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    // No clearDepth here, unlike the intro deck's pass: the band is meant to be
    // occluded by anything the main pass already drew in front of it (the island).
    renderer.render(horizonBandScene, camera);
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

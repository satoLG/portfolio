import { Camera, DataTexture, DoubleSide, FramebufferTexture, LinearFilter, PerspectiveCamera, RepeatWrapping, RGBAFormat, ShaderMaterial, Texture, TextureLoader, Uniform, UnsignedByteType, Vector3, Vector2, WebGLRenderer } from "three";
import * as OceanShaders from "../shaders/OceanShaders";
import { cameraForward } from "../core/Scene";
import { timeUniform } from "../core/Time";
import { SetSkyboxUniforms } from "./SkyboxMaterial";
import * as OceanConfig from '../scene/config/OceanConfig';

export const surface = new ShaderMaterial();
// High-tessellation patch that fills the circular hole `surface` discards
// near the camera, so the near-camera swell's silhouette reads as curved
// instead of faceted at surfaceWaveLength's scale. Shares `surface`'s live
// Uniform objects (see Start()) so any tuning of one applies to both.
export const patch = new ShaderMaterial();
export const volume = new ShaderMaterial();
export const object = new ShaderMaterial();
export const triplanar = new ShaderMaterial();

const normalMap1 = new Uniform(new TextureLoader().load("images/waterNormal1.webp"));
normalMap1.value.wrapS = RepeatWrapping;
normalMap1.value.wrapT = RepeatWrapping;
const normalMap2 = new Uniform(new TextureLoader().load("images/waterNormal2.webp"));
normalMap2.value.wrapS = RepeatWrapping;
normalMap2.value.wrapT = RepeatWrapping;

const spotLightSharpness = 10;

export const spotLightDistance = 200;
export const spotLightDistanceUniform = new Uniform(0);

const objectTexture = new TextureLoader().load("images/basicChecker.png");
objectTexture.wrapS = RepeatWrapping;
objectTexture.wrapT = RepeatWrapping;

const landTexture = new TextureLoader().load("images/sand.webp");
landTexture.wrapS = RepeatWrapping;
landTexture.wrapT = RepeatWrapping;

const blendSharpness = 3;
const triplanarScale = 1;

export const oceanAbsorptionUniform  = new Uniform(new Vector3(OceanConfig.oceanAbsorption.r, OceanConfig.oceanAbsorption.g, OceanConfig.oceanAbsorption.b));
export const underwaterFogDistUniform = new Uniform(OceanConfig.underwaterFogDist);

export const normalMapScaleUniform    = new Uniform(OceanConfig.normalMapScale);
export const normalMapStrengthUniform = new Uniform(OceanConfig.normalMapStrength);
export const waveVelocity1Uniform     = new Uniform({ x: OceanConfig.waveVelocity1.x, y: OceanConfig.waveVelocity1.y });
export const waveVelocity2Uniform     = new Uniform({ x: OceanConfig.waveVelocity2.x, y: OceanConfig.waveVelocity2.y });

export const edgeFadeDistanceUniform = new Uniform(OceanConfig.edgeFadeDistance);

export const horizonFadeStartUniform = new Uniform(OceanConfig.horizonFadeStart);
export const horizonFadeEndUniform   = new Uniform(OceanConfig.horizonFadeEnd);

// Near-camera vertex displacement (surface swell) — see OceanConfig for meaning
export const surfaceWaveAmplitudeUniform   = new Uniform(OceanConfig.surfaceWaveAmplitude);
export const surfaceWaveLengthUniform      = new Uniform(OceanConfig.surfaceWaveLength);
export const surfaceWaveSpeedUniform       = new Uniform(OceanConfig.surfaceWaveSpeed);
export const surfaceWaveRangeUniform       = new Uniform(OceanConfig.surfaceWaveRange);
export const surfaceWaveForwardBiasUniform = new Uniform(OceanConfig.surfaceWaveForwardBias);
export const surfaceWaveSteepnessUniform   = new Uniform(OceanConfig.surfaceWaveSteepness);
export const surfaceWaveHeightFadeStartUniform = new Uniform(OceanConfig.surfaceWaveHeightFadeStart);
export const surfaceWaveHeightFadeEndUniform   = new Uniform(OceanConfig.surfaceWaveHeightFadeEnd);

// Foam mask — generated at runtime from island silhouette
export const foamMaskUniform         = new Uniform(null as Texture | null);         // Top-down silhouette texture
export const foamMaskCenterUniform   = new Uniform(new Vector2(0.0, 0.0));          // World XZ center — overwritten by setFoamMask()
export const foamMaskSizeUniform     = new Uniform(new Vector2(4.0, 4.0));          // World XZ extent — overwritten by setFoamMask()
export const foamCenterOffsetUniform = new Uniform(new Vector2(OceanConfig.foamCenterOffset.x, OceanConfig.foamCenterOffset.y)); // user nudge on top of baked center
export const foamWidthUniform        = new Uniform(OceanConfig.foamWidth);
const _isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;

// Re-enabled on mobile: calcFoam() (the SDF ring / "foam lines") never reads
// _SceneDepth or gl_FragCoord.z — it was zeroed alongside edgeFoam purely to
// rule out every suspect while chasing the iOS flicker, not because it was
// itself implicated. The actual flicker sources found since: edge-foam's
// depth-buffer precision (fixed by deriving oceanLinear analytically) and the
// underwater volume mesh blowing out at the horizon (fixed by Y-limiting its
// visibility). Trying foam lines live on mobile again now that both are gone.
export const foamIntensityUniform    = new Uniform(OceanConfig.foamIntensity);
export const foamAnimSpeedUniform    = new Uniform(OceanConfig.foamAnimSpeed);
export const foamEdgeNoiseAmtUniform = new Uniform(OceanConfig.foamEdgeNoiseAmt);
export const foamWobbleAmtUniform    = new Uniform(OceanConfig.foamWobbleAmt);
export const foamWobbleFreqUniform   = new Uniform(OceanConfig.foamWobbleFreq);
export const foamWobbleSpeedUniform  = new Uniform(OceanConfig.foamWobbleSpeed);
export const foamRadiusUniform       = new Uniform(OceanConfig.foamRadius);
export const foamLineFrequencyUniform = new Uniform(OceanConfig.foamLineFrequency);
export const foamLineThicknessUniform = new Uniform(OceanConfig.foamLineThickness);
export const foamLineCountUniform     = new Uniform(OceanConfig.foamLineCount);
export const foamLineBreakupUniform   = new Uniform(OceanConfig.foamLineBreakup);
export const foamLineColorUniform     = new Uniform(new Vector3(OceanConfig.foamLineColor.r, OceanConfig.foamLineColor.g, OceanConfig.foamLineColor.b));
export const foamQualityUniform      = new Uniform(3); // 1=fast, 2=medium, 3=full FBM

/** Set foam noise quality: 1 = single tap, 2 = 2 octaves, 3 = 3-octave FBM (default). */
export function setFoamQuality(quality: 1 | 2 | 3): void {
    foamQualityUniform.value = quality;
}

// Sky reflection parameters (analytical skybox sample, no render target)
export const reflectionFresnelPowerUniform      = new Uniform(OceanConfig.reflectionFresnelPower);
export const reflectionFloorUniform             = new Uniform(OceanConfig.reflectionFloor);
export const skyReflectionBrightnessUniform = new Uniform(OceanConfig.skyReflectionBrightness);
export const skyReflFalloffUniform          = new Uniform(OceanConfig.skyReflFalloff);

// Surface appearance — independent of underwater fog
export const surfaceColorUniform   = new Uniform(new Vector3(OceanConfig.surfaceColor.r, OceanConfig.surfaceColor.g, OceanConfig.surfaceColor.b));
export const surfaceOpacityUniform = new Uniform(OceanConfig.surfaceOpacity);
export const waterBlurStrengthUniform = new Uniform(OceanConfig.waterBlurStrength);
export const waterBlurRadiusUniform   = new Uniform(OceanConfig.waterBlurRadius);
export const waterBlurOpacityUniform  = new Uniform(OceanConfig.waterBlurOpacity);
export const waterlineCompositeOpacityUniform = new Uniform(OceanConfig.waterlineCompositeOpacity);

const fallbackSceneColor = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
fallbackSceneColor.needsUpdate = true;
export const sceneColorUniform = new Uniform<Texture>(fallbackSceneColor);
export const sceneResolutionUniform = new Uniform(new Vector2(1, 1));
let sceneColorTexture: FramebufferTexture | null = null;
const _fbSize = new Vector2();
const _fbOffset = new Vector2(0, 0);

// Canonical sea-level Y. Read by the apple buoyancy physics (the visible
// foam edge is now generated by the ocean shader's depth-intersection pass).
export const waterlineYUniform = new Uniform(OceanConfig.waterlineY);

// ── Depth-intersection foam (ocean side) ──────────────────────────────────────
// Scene depth captured by SceneDepth.ts; the ocean shader linearizes both
// `gl_FragCoord.z` and the sampled scene depth, then brightens fragments where
// the ocean grazes opaque geometry behind it. Camera near/far feed the
// `perspectiveDepthToViewZ` helper.
export const sceneDepthUniform     = new Uniform<Texture | null>(null);
export const cameraNearUniform     = new Uniform(0.1);
export const cameraFarUniform      = new Uniform(2000);
export const edgeFoamWidthUniform  = new Uniform(OceanConfig.edgeFoamWidth);
// Re-enabled on mobile: the iOS jitter this was zeroed for came from deriving
// oceanLinear off the mediump/16-bit depth buffer at the contact line —
// calcEdgeFoam() now computes it analytically from the (full-precision)
// world-space fragment position instead, so that source is gone. The
// remaining iOS back-rock flicker (z ≈ -4.7..-5.6) is handled separately by
// edgeFoamFadeStartZMobile/EndZMobile below. Trying it live again alongside
// the foam-line ring re-enable.
export const edgeFoamIntensityUniform = new Uniform(OceanConfig.edgeFoamIntensity);
export const edgeFoamUnderwaterMulUniform = new Uniform(OceanConfig.edgeFoamUnderwaterMul);
export const edgeFoamColorUniform  = new Uniform(new Vector3(OceanConfig.edgeFoamColor.r, OceanConfig.edgeFoamColor.g, OceanConfig.edgeFoamColor.b));

export const edgeFoamFadeStartZUniform = new Uniform(_isMobile ? OceanConfig.edgeFoamFadeStartZMobile : OceanConfig.edgeFoamFadeStartZDesktop);
export const edgeFoamFadeEndZUniform   = new Uniform(_isMobile ? OceanConfig.edgeFoamFadeEndZMobile   : OceanConfig.edgeFoamFadeEndZDesktop);

// Caustics quality scale: 0 = disabled (mobile/low quality), 1 = full.
// When 0, the GPU skips the entire voronoi caustics loop (uniform branch).
export const causticsScaleUniform = new Uniform(_isMobile ? 0.0 : 1.0);

/** Set caustics intensity scale (0 = off, 1 = full). Used by quality presets. */
export function setCausticsScale(scale: number): void {
    causticsScaleUniform.value = scale;
}

/** Each frame, push the camera's current near/far into the shader uniforms so
 *  the depth linearization in `calcEdgeFoam` stays correct after any FOV /
 *  clip-plane change. */
export function updateSceneDepthCamera(camera: Camera): void {
    const persp = camera as PerspectiveCamera;
    if (persp.isPerspectiveCamera) {
        cameraNearUniform.value = persp.near;
        cameraFarUniform.value = persp.far;
    }
}

export function captureSceneColor(renderer: WebGLRenderer): void {
    renderer.getDrawingBufferSize(_fbSize);
    if (!sceneColorTexture || sceneColorTexture.image.width !== _fbSize.x || sceneColorTexture.image.height !== _fbSize.y) {
        if (sceneColorTexture) sceneColorTexture.dispose();
        sceneColorTexture = new FramebufferTexture(_fbSize.x, _fbSize.y);
        sceneColorTexture.minFilter = LinearFilter;
        sceneColorTexture.magFilter = LinearFilter;
        sceneColorUniform.value = sceneColorTexture;
        sceneResolutionUniform.value.set(_fbSize.x, _fbSize.y);
    }
    renderer.copyFramebufferToTexture(sceneColorTexture, _fbOffset);
}

/** Call after generating the foam mask to wire the texture + bounds into the shader */
export function setFoamMask(texture: Texture, center: { x: number; y: number }, size: { x: number; y: number }): void {
    foamMaskUniform.value = texture;
    foamMaskCenterUniform.value.set(center.x, center.y);
    foamMaskSizeUniform.value.set(size.x, size.y);
    console.log('Foam mask wired into ocean shader');
}

// Ripple system - interactive circular waves
interface Ripple {
    x: number;
    z: number;
    time: number;
}

const MAX_RIPPLES = 3;  // Reduced from 5 for better mobile performance
const ripples: Ripple[] = [];
// Initialise all time slots to -999 (inactive) so the GPU never sees ghost ripples
// before the first Update() call.  rippleCountUniform starts at 0 for the same reason.
const _rippleInitData = new Float32Array(MAX_RIPPLES * 3);
for (let i = 0; i < MAX_RIPPLES; i++) _rippleInitData[i * 3 + 2] = -999;
export const ripplesUniform = new Uniform(_rippleInitData);
export const rippleCountUniform = new Uniform(0);  // was 3 — caused ghost ripples on startup
export const rippleSpeedUniform           = new Uniform(OceanConfig.rippleSpeed);
export const rippleLifetimeUniform        = new Uniform(OceanConfig.rippleLifetime);
export const rippleWidthUniform           = new Uniform(OceanConfig.rippleWidth);
export const rippleNormalStrengthUniform  = new Uniform(OceanConfig.rippleNormalStrength);
/** Max XZ world-space distance from camera within which a click can trigger a ripple. */
export const rippleMaxClickDistance       = OceanConfig.rippleMaxClickDistance;

export function addRipple(x: number, z: number): void {
    // Remove oldest ripple if at max capacity
    if (ripples.length >= MAX_RIPPLES) {
        ripples.shift();
    }
    
    ripples.push({ x, z, time: 0 });
    updateRippleUniforms();
}

function updateRippleUniforms(): void {
    const data = ripplesUniform.value as Float32Array;
    
    for (let i = 0; i < MAX_RIPPLES; i++) {
        if (i < ripples.length) {
            data[i * 3 + 0] = ripples[i].x;
            data[i * 3 + 1] = ripples[i].z;
            data[i * 3 + 2] = ripples[i].time;
        } else {
            data[i * 3 + 0] = 0;
            data[i * 3 + 1] = 0;
            data[i * 3 + 2] = -999; // Inactive
        }
    }
    
    rippleCountUniform.value = ripples.length;
}

export function updateRipples(deltaTime: number): void {
    for (let i = ripples.length - 1; i >= 0; i--) {
        ripples[i].time += deltaTime;
        
        // Remove expired ripples
        if (ripples[i].time > rippleLifetimeUniform.value) {
            ripples.splice(i, 1);
        }
    }
    
    updateRippleUniforms();
}

export function SetOceanColor(r: number, g: number, b: number): void {
    oceanAbsorptionUniform.value.set(r, g, b);
}

export function Start(): void
{  
    surface.vertexShader = OceanShaders.surfaceVertex;
    surface.fragmentShader = OceanShaders.surfaceFragment;
    surface.side = DoubleSide;
    surface.transparent = true;
    surface.depthWrite = false;

    surface.uniforms = 
    {
        _Time: timeUniform,
        _NormalMap1: normalMap1,
        _NormalMap2: normalMap2,
        _Absorption: oceanAbsorptionUniform,
        _NormalMapScale: normalMapScaleUniform,
        _NormalMapStrength: normalMapStrengthUniform,
        _WaveVelocity1: waveVelocity1Uniform,
        _WaveVelocity2: waveVelocity2Uniform,
        _EdgeFadeDistance: edgeFadeDistanceUniform,
        _HorizonFadeStart: horizonFadeStartUniform,
        _HorizonFadeEnd: horizonFadeEndUniform,
        _CameraForward: new Uniform(cameraForward),
        _SurfaceWaveAmplitude: surfaceWaveAmplitudeUniform,
        _SurfaceWaveLength: surfaceWaveLengthUniform,
        _SurfaceWaveSpeed: surfaceWaveSpeedUniform,
        _SurfaceWaveRange: surfaceWaveRangeUniform,
        _SurfaceWaveForwardBias: surfaceWaveForwardBiasUniform,
        _SurfaceWaveSteepness: surfaceWaveSteepnessUniform,
        _SurfaceWaveHeightFadeStart: surfaceWaveHeightFadeStartUniform,
        _SurfaceWaveHeightFadeEnd: surfaceWaveHeightFadeEndUniform,
        _FoamMask: foamMaskUniform,
        _FoamMaskCenter: foamMaskCenterUniform,
        _FoamMaskSize: foamMaskSizeUniform,
        _FoamCenterOffset: foamCenterOffsetUniform,
        _FoamWidth: foamWidthUniform,
        _FoamIntensity: foamIntensityUniform,
        _FoamAnimSpeed: foamAnimSpeedUniform,
        _FoamEdgeNoiseAmt: foamEdgeNoiseAmtUniform,
        _FoamWobbleAmt: foamWobbleAmtUniform,
        _FoamWobbleFreq: foamWobbleFreqUniform,
        _FoamWobbleSpeed: foamWobbleSpeedUniform,
        _FoamRadius: foamRadiusUniform,
        _FoamLineFrequency: foamLineFrequencyUniform,
        _FoamLineThickness: foamLineThicknessUniform,
        _FoamLineCount: foamLineCountUniform,
        _FoamLineBreakup: foamLineBreakupUniform,
        _FoamLineColor: foamLineColorUniform,
        _FoamQuality: foamQualityUniform,
        _Ripples: ripplesUniform,
        _RippleCount: rippleCountUniform,
        _RippleSpeed: rippleSpeedUniform,
        _RippleLifetime: rippleLifetimeUniform,
        _RippleWidth: rippleWidthUniform,
        _RippleNormalStrength: rippleNormalStrengthUniform,
        _ReflectionFresnelPower: reflectionFresnelPowerUniform,
        _ReflectionFloor: reflectionFloorUniform,
        _SkyReflBrightness: skyReflectionBrightnessUniform,
        _SkyReflFalloff: skyReflFalloffUniform,
        _SurfaceColor: surfaceColorUniform,
        _SurfaceOpacity: surfaceOpacityUniform,
        _SceneColor: sceneColorUniform,
        _SceneResolution: sceneResolutionUniform,
        _WaterBlurStrength: waterBlurStrengthUniform,
        _WaterBlurRadius: waterBlurRadiusUniform,
        _WaterBlurOpacity: waterBlurOpacityUniform,
        _WaterlineCompositeOpacity: waterlineCompositeOpacityUniform,
        _SceneDepth: sceneDepthUniform,
        _CameraNear: cameraNearUniform,
        _CameraFar: cameraFarUniform,
        _EdgeFoamWidth: edgeFoamWidthUniform,
        _EdgeFoamIntensity: edgeFoamIntensityUniform,
        _EdgeFoamUnderwaterMul: edgeFoamUnderwaterMulUniform,
        _EdgeFoamColor: edgeFoamColorUniform,
        _EdgeFoamFadeStartZ: edgeFoamFadeStartZUniform,
        _EdgeFoamFadeEndZ: edgeFoamFadeEndZUniform,
    };
    SetSkyboxUniforms(surface);

    // Same shader as `surface`, with OCEAN_PATCH defined so surfaceFragment's
    // complementary discard keeps the two meshes' pixels from ever
    // overlapping (see OceanShaders.ts) — otherwise two overlapping
    // semi-transparent draws would double-alpha-blend into a visible seam.
    patch.vertexShader = OceanShaders.surfaceVertex;
    patch.fragmentShader = OceanShaders.surfaceFragment;
    patch.side = DoubleSide;
    patch.transparent = true;
    patch.depthWrite = false;
    patch.defines = { OCEAN_PATCH: '1' };
    patch.uniforms = { ...surface.uniforms };  // shares the exact same Uniform instances — live-synced, no clone

    volume.vertexShader = OceanShaders.volumeVertex;
    volume.fragmentShader = OceanShaders.volumeFragment;
    volume.uniforms = 
    {
        _Absorption: oceanAbsorptionUniform
    };
    SetSkyboxUniforms(volume);
    
    object.vertexShader = OceanShaders.objectVertex;
    object.fragmentShader = OceanShaders.objectFragment;
    object.uniforms =
    {
        _MainTexture: new Uniform(objectTexture),
        _CameraForward: new Uniform(cameraForward),
        _SpotLightSharpness: new Uniform(spotLightSharpness),
        _SpotLightDistance: spotLightDistanceUniform,
        _Absorption: oceanAbsorptionUniform
    };
    SetSkyboxUniforms(object);

    triplanar.vertexShader = OceanShaders.triplanarVertex;
    triplanar.fragmentShader = OceanShaders.triplanarFragment;
    triplanar.uniforms =
    {
        _MainTexture: new Uniform(landTexture),
        _CameraForward: new Uniform(cameraForward),
        _BlendSharpness: new Uniform(blendSharpness),
        _Scale: new Uniform(triplanarScale),
        _SpotLightSharpness: new Uniform(spotLightSharpness),
        _SpotLightDistance: spotLightDistanceUniform,
        _Absorption: oceanAbsorptionUniform,
        _Time: timeUniform,
        _WaveVelocity1: waveVelocity1Uniform,
        _WaveVelocity2: waveVelocity2Uniform,
        _CausticsScale: causticsScaleUniform
    };
    SetSkyboxUniforms(triplanar);
}

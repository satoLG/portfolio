import { DoubleSide, RepeatWrapping, ShaderMaterial, Texture, TextureLoader, Uniform, Vector3, Vector2 } from "three";
import * as OceanShaders from "../shaders/OceanShaders";
import { cameraForward } from "../scripts/Scene";
import { timeUniform } from "../scripts/Time";
import { SetSkyboxUniforms } from "./SkyboxMaterial";
import * as OceanConfig from '../scene/OceanConfig';

export const surface = new ShaderMaterial();
export const volume = new ShaderMaterial();
export const object = new ShaderMaterial();
export const triplanar = new ShaderMaterial();

const normalMap1 = new Uniform(new TextureLoader().load("images/waterNormal1.png"));
normalMap1.value.wrapS = RepeatWrapping;
normalMap1.value.wrapT = RepeatWrapping;
const normalMap2 = new Uniform(new TextureLoader().load("images/waterNormal2.png"));
normalMap2.value.wrapS = RepeatWrapping;
normalMap2.value.wrapT = RepeatWrapping;

const spotLightSharpness = 10;

export const spotLightDistance = 200;
export const spotLightDistanceUniform = new Uniform(0);

const objectTexture = new TextureLoader().load("images/basicChecker.png");
objectTexture.wrapS = RepeatWrapping;
objectTexture.wrapT = RepeatWrapping;

const landTexture = new TextureLoader().load("images/sand.png");
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

// Foam mask — generated at runtime from island silhouette
export const foamMaskUniform         = new Uniform(null as Texture | null);         // Top-down silhouette texture
export const foamMaskCenterUniform   = new Uniform(new Vector2(0.0, 0.0));          // World XZ center — overwritten by setFoamMask()
export const foamMaskSizeUniform     = new Uniform(new Vector2(4.0, 4.0));          // World XZ extent — overwritten by setFoamMask()
export const foamCenterOffsetUniform = new Uniform(new Vector2(OceanConfig.foamCenterOffset.x, OceanConfig.foamCenterOffset.y)); // user nudge on top of baked center
export const foamWidthUniform        = new Uniform(OceanConfig.foamWidth);
export const foamIntensityUniform    = new Uniform(OceanConfig.foamIntensity);
export const foamAnimSpeedUniform    = new Uniform(OceanConfig.foamAnimSpeed);
export const foamEdgeNoiseAmtUniform = new Uniform(OceanConfig.foamEdgeNoiseAmt);
export const foamWobbleAmtUniform    = new Uniform(OceanConfig.foamWobbleAmt);
export const foamWobbleFreqUniform   = new Uniform(OceanConfig.foamWobbleFreq);
export const foamWobbleSpeedUniform  = new Uniform(OceanConfig.foamWobbleSpeed);
export const foamRadiusUniform       = new Uniform(OceanConfig.foamRadius);

// Planar reflection — render target texture set by OceanReflection.ts each frame
export const reflectionTextureUniform = new Uniform(null as Texture | null);
export const reflectionStrengthUniform          = new Uniform(OceanConfig.reflectionStrength);
export const reflectionFresnelPowerUniform      = new Uniform(OceanConfig.reflectionFresnelPower);
export const reflectionFloorUniform             = new Uniform(OceanConfig.reflectionFloor);
export const skyReflectionBrightnessUniform = new Uniform(OceanConfig.skyReflectionBrightness);
export const skyReflFalloffUniform          = new Uniform(OceanConfig.skyReflFalloff);

// Surface appearance — independent of underwater fog
export const surfaceColorUniform   = new Uniform(new Vector3(OceanConfig.surfaceColor.r, OceanConfig.surfaceColor.g, OceanConfig.surfaceColor.b));
export const surfaceOpacityUniform = new Uniform(OceanConfig.surfaceOpacity);

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
        _Ripples: ripplesUniform,
        _RippleCount: rippleCountUniform,
        _RippleSpeed: rippleSpeedUniform,
        _RippleLifetime: rippleLifetimeUniform,
        _RippleWidth: rippleWidthUniform,
        _RippleNormalStrength: rippleNormalStrengthUniform,
        _ReflectionTexture: reflectionTextureUniform,
        _ReflectionStrength: reflectionStrengthUniform,
        _ReflectionFresnelPower: reflectionFresnelPowerUniform,
        _ReflectionFloor: reflectionFloorUniform,
        _SkyReflBrightness: skyReflectionBrightnessUniform,
        _SkyReflFalloff: skyReflFalloffUniform,
        _SurfaceColor: surfaceColorUniform,
        _SurfaceOpacity: surfaceOpacityUniform,
    };
    SetSkyboxUniforms(surface);
    
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
        _WaveVelocity2: waveVelocity2Uniform
    };
    SetSkyboxUniforms(triplanar);
}

import { DoubleSide, RepeatWrapping, ShaderMaterial, Texture, TextureLoader, Uniform, Vector3, Vector2 } from "three";
import * as OceanShaders from "../shaders/OceanShaders";
import { cameraForward } from "../scripts/Scene";
import { timeUniform } from "../scripts/Time";
import { SetSkyboxUniforms } from "./SkyboxMaterial";

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

export const oceanAbsorptionUniform = new Uniform(new Vector3(0.085, 0.022, 0.015));

export const bigWavesElevationUniform = new Uniform(0.2);
export const bigWavesFrequencyUniform = new Uniform({ x: 4.0, y: 1.5 });
export const bigWavesSpeedUniform = new Uniform(0.75);
export const smallWavesElevationUniform = new Uniform(0.03);
export const smallWavesFrequencyUniform = new Uniform(3.0);
export const smallWavesSpeedUniform = new Uniform(0.2);
export const smallIterationsUniform = new Uniform(2.0);

export const normalMapScaleUniform = new Uniform(0.15);
export const normalMapStrengthUniform = new Uniform(0.85);
export const waveVelocity1Uniform = new Uniform({ x: 0.065, y: 0.0 });
export const waveVelocity2Uniform = new Uniform({ x: 0.0, y: 0.065 });

export const oceanHalfSizeUniform = new Uniform({ x: 200.0, y: 200.0 });
export const edgeFadeDistanceUniform = new Uniform(1.0);

// Foam mask — generated at runtime from island silhouette
export const foamMaskUniform = new Uniform(null as Texture | null);              // Top-down silhouette texture
export const foamMaskCenterUniform = new Uniform(new Vector2(0.0, -1));       // World XZ center of mask region
export const foamMaskSizeUniform = new Uniform(new Vector2(4.0, 4.0));          // World XZ extent of mask region
export const foamWidthUniform = new Uniform(0.12);             // TWEAK: Width of foam band around edge
export const foamIntensityUniform = new Uniform(0.35);         // TWEAK: Overall foam brightness
export const foamAnimSpeedUniform = new Uniform(0.5);          // TWEAK: Speed of foam animation
export const foamEdgeNoiseAmtUniform = new Uniform(0.06);      // TWEAK: How much brightness shimmers near edge
export const foamWobbleAmtUniform = new Uniform(0.07);         // TWEAK: How far (world units) the foam line wobbles
export const foamWobbleFreqUniform = new Uniform(3.0);         // TWEAK: Spatial frequency of the wobble pattern
export const foamWobbleSpeedUniform = new Uniform(0.5);        // TWEAK: How fast the wobble animates
export const foamRadiusUniform = new Uniform(0.94);             // TWEAK: Foam ring scale — >1 pushes foam outward, <1 pulls inward

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
export const ripplesUniform = new Uniform(new Float32Array(MAX_RIPPLES * 3)); // x, z, time for each ripple
export const rippleCountUniform = new Uniform(3);
export const rippleSpeedUniform = new Uniform(1.0);      // How fast ripples expand
export const rippleLifetimeUniform = new Uniform(1.2);   // Reduced from 1.5 for faster cleanup
export const rippleAmplitudeUniform = new Uniform(0.85); // Height of ripple wave
export const rippleWidthUniform = new Uniform(0.15);      // Width of the wave band

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
        uBigWavesElevation: bigWavesElevationUniform,
        uBigWavesFrequency: bigWavesFrequencyUniform,
        uBigWavesSpeed: bigWavesSpeedUniform,
        uSmallWavesElevation: smallWavesElevationUniform,
        uSmallWavesFrequency: smallWavesFrequencyUniform,
        uSmallWavesSpeed: smallWavesSpeedUniform,
        uSmallIterations: smallIterationsUniform,
        _NormalMapScale: normalMapScaleUniform,
        _NormalMapStrength: normalMapStrengthUniform,
        _WaveVelocity1: waveVelocity1Uniform,
        _WaveVelocity2: waveVelocity2Uniform,
        _OceanHalfSize: oceanHalfSizeUniform,
        _EdgeFadeDistance: edgeFadeDistanceUniform,
        _FoamMask: foamMaskUniform,
        _FoamMaskCenter: foamMaskCenterUniform,
        _FoamMaskSize: foamMaskSizeUniform,
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
        _RippleAmplitude: rippleAmplitudeUniform,
        _RippleWidth: rippleWidthUniform
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

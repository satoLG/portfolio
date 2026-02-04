import { DoubleSide, RepeatWrapping, ShaderMaterial, TextureLoader, Uniform, Vector3 } from "three";
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

export const foamIslandCenterUniform = new Uniform({ x: 0.0, y: -3.3 });
export const foamIslandRadiusUniform = new Uniform(1.25);
export const foamWidthUniform = new Uniform(0.01);
export const foamIntensityUniform = new Uniform(0.65);

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
        _FoamIslandCenter: foamIslandCenterUniform,
        _FoamIslandRadius: foamIslandRadiusUniform,
        _FoamWidth: foamWidthUniform,
        _FoamIntensity: foamIntensityUniform
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
        _Absorption: oceanAbsorptionUniform
    };
    SetSkyboxUniforms(triplanar);
}

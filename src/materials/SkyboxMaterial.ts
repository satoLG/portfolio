import { DataTexture, MathUtils, RepeatWrapping, ShaderMaterial, TextureLoader, Uniform, Vector2, Vector3 } from "three";
import { fragment, vertex } from "../shaders/SkyboxShader";
import { dirToLight, rotationMatrix } from "../scene/Skybox";
import { Random } from "../scripts/Random";

export const material = new ShaderMaterial();
export let SetSkyboxUniforms: (material: ShaderMaterial) => void;

const ditherSize = new Uniform(new Vector2());
const dither = new Uniform<any>(null);
const sunVisibility = new Uniform(1);
const twilightTime = new Uniform(0);
const twilightVisibility = new Uniform(0);
const starsTransition = new Uniform(0);
const starsSeed = 87;
const gridSize = 64;

// Stars animation settings - TWEAK THESE
const STARS_APPEAR_DURATION = 3.5;  // Total time for all stars to appear (seconds)
let starsTimer = 0;                  // Independent timer for stars

// Stars count - TWEAK THIS (was 10000)
export let starsCount = 5000;

const maxOffset = 0.43;
const starsMap = new Uint8Array(gridSize * gridSize * 24);
const stars = new Uniform<any>(null);

export const lightUniform = new Uniform(new Vector3(1, 1, 1));
export const sunVisibilityUniform = sunVisibility;

let l = 0;

function Vector3ToStarMap(dir: Vector3, value: number[]): void
{
    const absDir = new Vector3(Math.abs(dir.x), Math.abs(dir.y), Math.abs(dir.z));

    const xPositive = dir.x > 0;
    const yPositive = dir.y > 0;
    const zPositive = dir.z > 0;

    let maxAxis = 0;
    let u = 0;
    let v = 0;
    let i = 0;

    if (xPositive && absDir.x >= absDir.y && absDir.x >= absDir.z)
    {
        maxAxis = absDir.x;
        u = -dir.z;
        v = dir.y;
        i = 0;
    }

    if (!xPositive && absDir.x >= absDir.y && absDir.x >= absDir.z)
    {
        maxAxis = absDir.x;
        u = dir.z;
        v = dir.y;
        i = 1;
    }

    if (yPositive && absDir.y >= absDir.x && absDir.y >= absDir.z)
    {
        maxAxis = absDir.y;
        u = dir.x;
        v = -dir.z;
        i = 2;
    }

    if (!yPositive && absDir.y >= absDir.x && absDir.y >= absDir.z)
    {
        maxAxis = absDir.y;
        u = dir.x;
        v = dir.z;
        i = 3;
    }

    if (zPositive && absDir.z >= absDir.x && absDir.z >= absDir.y)
    {
        maxAxis = absDir.z;
        u = dir.x;
        v = dir.y;
        i = 4;
    }

    if (!zPositive && absDir.z >= absDir.x && absDir.z >= absDir.y)
    {
        maxAxis = absDir.z;
        u = -dir.x;
        v = dir.y;
        i = 5;
    }

    u = Math.floor((u / maxAxis + 1) * 0.5 * gridSize);
    v = Math.floor((v / maxAxis + 1) * 0.5 * gridSize);

    const j = (v * gridSize * 6 + i * gridSize + u) * 4;
    starsMap[j] = value[0];
    starsMap[j + 1] = value[1];
    starsMap[j + 2] = value[2];
    starsMap[j + 3] = value[3];
}

export function Start(): void
{
    dither.value = new TextureLoader().load("images/bluenoise.png", function(texture)
    {
        ditherSize.value.x = texture.image.width;
        ditherSize.value.y = texture.image.height;
        texture.wrapS = RepeatWrapping;
        texture.wrapT = RepeatWrapping;
    });

    const random = new Random(starsSeed);

    for (let i = 0; i < starsCount; i++)
    {
        const a = random.Next() * Math.PI * 2;
        const b = random.Next() * 2 - 1;
        const c = Math.sqrt(1 - b * b);
        const target = new Vector3(Math.cos(a) * c, Math.sin(a) * c, b);
        Vector3ToStarMap(target, [MathUtils.lerp(0.5 - maxOffset, 0.5 + maxOffset, random.Next()) * 255, MathUtils.lerp(0.5 - maxOffset, 0.5 + maxOffset, random.Next()) * 255, Math.pow(random.Next(), 6) * 255, random.Next() * 255]);
    }

    stars.value = new DataTexture(starsMap, gridSize * 6, gridSize);
    stars.value.needsUpdate = true;

    material.vertexShader = vertex;
    material.fragmentShader = fragment;

    // Initial state: day (blend = 0)
    sunVisibility.value = 1;
    twilightTime.value = 0;
    twilightVisibility.value = 0;

    SetSkyboxUniforms = function(mat: ShaderMaterial)
    {
        mat.uniforms._SkyRotationMatrix = rotationMatrix;
        mat.uniforms._DitherTexture = dither;
        mat.uniforms._DitherTextureSize = ditherSize;
        mat.uniforms._SunVisibility = sunVisibility;
        mat.uniforms._TwilightTime = twilightTime;
        mat.uniforms._TwilightVisibility = twilightVisibility;
        mat.uniforms._GridSize = new Uniform(gridSize);
        mat.uniforms._GridSizeScaled = new Uniform(gridSize * 6);
        mat.uniforms._Stars = stars;
        mat.uniforms._StarsTransition = starsTransition;
        mat.uniforms._DirToLight = new Uniform(dirToLight);
        mat.uniforms._Light = lightUniform;
    }
    SetSkyboxUniforms(material);
}

export function Update(dayNightBlend: number, dt: number): void
{
    // Always update sunVisibility smoothly - no threshold checks
    // This avoids first-transition stutter from batched updates
    const newSunVisibility = 1 - dayNightBlend;
    sunVisibility.value = newSunVisibility;
    
    // Twilight effect - smooth transition through sunset colors
    twilightTime.value = 1 - dayNightBlend;
    
    // twilightVisibility: peaks in middle of transition
    // Simplified calculation - avoid double smoothstep
    const t = dayNightBlend;
    twilightVisibility.value = 4 * t * (1 - t); // Simpler parabola, peaks at 0.5
    
    // Update light uniform
    l = Math.min(newSunVisibility + 0.333, 1);
    lightUniform.value.set(l, l, l);
    
    // Stars timer: independent of day/night transition
    // Use smoother transition instead of instant reset
    if (dayNightBlend < 0.4) {
        // Day mode - smooth fade out instead of instant reset
        if (starsTimer > 0) {
            starsTimer = Math.max(0, starsTimer - dt / (STARS_APPEAR_DURATION * 0.3));
            starsTransition.value = starsTimer;
        }
    } else if (dayNightBlend > 0.6) {
        // Night mode - accumulate timer
        const newTimer = Math.min(starsTimer + dt / STARS_APPEAR_DURATION, 1);
        if (Math.abs(newTimer - starsTimer) > 0.001) {
            starsTimer = newTimer;
            starsTransition.value = starsTimer;
        }
    }
}

import { BufferAttribute, BufferGeometry, Matrix3, Mesh, Uniform, Vector3 } from "three";
import * as skyboxMaterial from "../materials/SkyboxMaterial";
import { deltaTime } from "../core/Time";
import { camera } from "../core/Scene";

export const skybox = new Mesh();
export const dirToLight = new Vector3();
export const rotationMatrix = new Uniform(new Matrix3());

const halfSize = 2000;

// Day/Night transition settings - TWEAK THESE
export let transitionSpeed = 1.0;  // Higher = faster transition (was ~0.65 effective)

// Sun direction for lighting (fixed, no rotation)
// Angled to cast visible shadows on the island
// Y is height (1 = overhead), X/Z control horizontal angle
const sunDirection = new Vector3(0.4, 0.4, 0.4).normalize();

// Blend value: 0 = day, 1 = night
export let dayNightBlend = 0;
let targetBlend = 0;
let isDay = true;

// Set initial day/night state (called before Start)
export function setInitialDayNight(day: boolean): void {
    isDay = day;
    targetBlend = isDay ? 0 : 1;
    dayNightBlend = targetBlend;  // Set immediately, no transition
}

export function toggleDayNight(): boolean {
    isDay = !isDay;
    targetBlend = isDay ? 0 : 1;
    return isDay;
}

export function isDayTime(): boolean {
    return isDay;
}

export function getDayNightBlend(): number {
    return dayNightBlend;
}

function setIdentityRotationMatrix(): void
{
    rotationMatrix.value.set(
        1, 0, 0,
        0, 1, 0,
        0, 0, 1
    );
}

export function Start(): void
{
    dayNightBlend = 0;
    targetBlend = 0;
    
    // Fixed sun direction for lighting
    dirToLight.copy(sunDirection);
    
    skyboxMaterial.Start();

    const vertices = new Float32Array([
        -halfSize, -halfSize, -halfSize,
        halfSize, -halfSize, -halfSize,
        -halfSize, -halfSize, halfSize,
        halfSize, -halfSize, halfSize,

        -halfSize, halfSize, -halfSize,
        halfSize, halfSize, -halfSize,
        -halfSize, halfSize, halfSize,
        halfSize, halfSize, halfSize
    ]);

    const indices = [
        2, 3, 0, 3, 1, 0,
        0, 1, 4, 1, 5, 4,
        1, 3, 5, 3, 7, 5,
        3, 2, 7, 2, 6, 7,
        2, 0, 6, 0, 4, 6,
        4, 5, 6, 5, 7, 6
    ];

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(vertices, 3));
    geometry.setAttribute("coord", new BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    skybox.geometry = geometry;
    skybox.material = skyboxMaterial.material;

    setIdentityRotationMatrix();
}

export function Update(): void
{   
    // Smooth blend transition
    if (dayNightBlend !== targetBlend) {
        const diff = targetBlend - dayNightBlend;
        const step = deltaTime * transitionSpeed;
        
        if (Math.abs(diff) <= step) {
            dayNightBlend = targetBlend;
        } else {
            dayNightBlend += step * Math.sign(diff);
        }
    }
    
    // Update material with current blend
    skyboxMaterial.Update(dayNightBlend, deltaTime);
    skybox.position.copy(camera.position);
}

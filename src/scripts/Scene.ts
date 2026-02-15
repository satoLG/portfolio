import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer, PCFSoftShadowMap, BasicShadowMap, PCFShadowMap, VSMShadowMap } from "three";
import * as Skybox from "../scene/Skybox";
import * as Ocean from "../scene/Ocean";
import * as SeaFloor from "../scene/SeaFloor";
import * as Island from "../scene/Island";
import * as Fire from "../scene/Fire.ts";
import * as Fish from "../scene/Fish.ts";
import * as Audio from "./Audio.ts";
import * as UI from "./UI.ts";
import * as MediaPlayer from "./MediaPlayer.ts";
import * as Underwater from "../effects/Underwater.ts";
import * as Bubbles from "../effects/Bubbles.ts";
import { axes } from "./Debug.ts";
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial";

export const body = document.createElement("div");

// Detect device type for default graphics settings
export const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
const defaultHigh = !isMobile;

// Read graphics settings from localStorage (or use device-based defaults)
export let antialias = localStorage.getItem('portfolio-antialias') !== null
    ? localStorage.getItem('portfolio-antialias') === 'true'
    : defaultHigh;
export let shadowsEnabled = localStorage.getItem('portfolio-shadows') !== null
    ? localStorage.getItem('portfolio-shadows') === 'true'
    : defaultHigh;

// Pixel size for post-processing pixelation effect (0 = off)
export let pixelSizeValue = localStorage.getItem('portfolio-pixel-size') !== null
    ? parseInt(localStorage.getItem('portfolio-pixel-size')!)
    : 0;

// Scene lights - synced with skybox
let ambientLight: AmbientLight;
let directionalLight: DirectionalLight;

export let renderer = new WebGLRenderer({ antialias });
export const scene = new Scene();
export const camera = new PerspectiveCamera();
export const staticCamera = new PerspectiveCamera();

export const cameraRight = new Vector3();
export const cameraUp = new Vector3();
export const cameraForward = new Vector3();

export function UpdateCameraRotation(): void
{
    cameraRight.copy(new Vector3(1, 0, 0).applyQuaternion(camera.quaternion));
    cameraUp.copy(new Vector3(0, 1, 0).applyQuaternion(camera.quaternion));
    cameraForward.copy(new Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
}

export let fov = 70;
export function SetFOV(value: number): void
{
    fov = value;
    camera.fov = value;
    camera.updateProjectionMatrix();
}

export function SetAntialias(value: boolean): void
{
    antialias = value;
    // Note: antialias is a WebGL context attribute set at renderer creation.
    // Changing it requires a page reload to take effect.
    localStorage.setItem('portfolio-antialias', value.toString());
}

export function SetPixelSize(value: number): void
{
    pixelSizeValue = value;
    Underwater.setPixelSize(value);
    localStorage.setItem('portfolio-pixel-size', value.toString());
}

export function setShadowsEnabled(value: boolean): void
{
    shadowsEnabled = value;
    renderer.shadowMap.enabled = value;
    renderer.shadowMap.needsUpdate = true;
    
    // Dispose shadow map textures so Three.js recreates them fresh
    scene.traverse((obj) => {
        const light = obj as any;
        if (light.shadow?.map) {
            light.shadow.map.dispose();
            light.shadow.map = null;
        }
    });
    // Also check the directional light directly (may not be in scene yet during init)
    if (directionalLight?.shadow?.map) {
        directionalLight.shadow.map.dispose();
        (directionalLight.shadow as any).map = null;
    }
    
    // Force all materials to recompile with updated shadow defines
    scene.traverse((obj) => {
        const mesh = obj as any;
        if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const m of mats) m.needsUpdate = true;
        }
    });
    
    localStorage.setItem('portfolio-shadows', value.toString());
}

export function Start(): void
{
    document.body.appendChild(body);

    let width = window.innerWidth * window.devicePixelRatio;
    let height = window.innerHeight * window.devicePixelRatio;
    body.style.transform = "";
    body.style.width = window.innerWidth + "px";
    body.style.height = window.innerHeight + "px";
    
    renderer.setSize(width, height, false);
    renderer.autoClearColor = false;
    renderer.shadowMap.enabled = shadowsEnabled;
    renderer.shadowMap.type = PCFSoftShadowMap;  // Stable soft shadows
    body.appendChild(renderer.domElement);
    
    camera.fov = fov;
    camera.aspect = width / height;
    camera.near = 0.3;
    camera.far = 4000;
    camera.updateProjectionMatrix();
    // Position set by Control.js in web page mode
    camera.position.set(50, 50, 0);

    UpdateCameraRotation();

    staticCamera.fov = 70;
    staticCamera.aspect = width / height;
    staticCamera.near = 0.1;
    staticCamera.far = 10;
    staticCamera.updateProjectionMatrix();
    staticCamera.position.set(0, 0, 0);

    window.onresize = function()
    {
        width = window.innerWidth * window.devicePixelRatio;
        height = window.innerHeight * window.devicePixelRatio;
        body.style.transform = "";
        body.style.width = window.innerWidth + "px";
        body.style.height = window.innerHeight + "px";

        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        staticCamera.aspect = width / height;
        staticCamera.updateProjectionMatrix();

        Underwater.onResize(width, height);
    }

    Skybox.Start();
    scene.add(Skybox.skybox);

    // Add lighting for 3D models - synced with skybox
    ambientLight = new AmbientLight(0xffffff, 0.6);  // TWEAK: Base ambient brightness
    scene.add(ambientLight);
    
    directionalLight = new DirectionalLight(0xffffff, 1.0);
    // Position light behind island so shadows go forward towards camera
    directionalLight.position.set(1, 4, -6);  // Behind island at z=-3.3
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 4096;
    directionalLight.shadow.mapSize.height = 4096;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 20;
    directionalLight.shadow.camera.left = -4;
    directionalLight.shadow.camera.right = 4;
    directionalLight.shadow.camera.top = 4;
    directionalLight.shadow.camera.bottom = -8;
    
    // Shadow bias configuration for models with subdivision surfaces
    // Negative bias works better with PCF, positive with VSM
    directionalLight.shadow.bias = -0.0001;  // Very small to prevent shadow acne
    directionalLight.shadow.normalBias = 0.02;  // Lower value to keep shadows attached to surface
    directionalLight.shadow.radius = 1.5;  // Soft edge blur (only works with VSM/PCFSoft)
    
    // Point at island center (firecamp is at z=-2.9)
    directionalLight.target.position.set(0, 0, -3.0);
    scene.add(directionalLight.target);
    scene.add(directionalLight);

    Ocean.Start();
    scene.add(Ocean.surface);

    SeaFloor.Start();
    for (let i = 0; i < SeaFloor.tiles.length; i++)
    {
        scene.add(SeaFloor.tiles[i]);
    }

    // Load island and firecamp models
    Island.Start();
    scene.add(Island.island);
    scene.add(Island.firecamp);
    scene.add(Island.palmtree);
    scene.add(Island.radio);
    scene.add(Island.sword);
    // Grass and clover patches are added dynamically as they load
    const addedPatches = new Set<any>();
    setInterval(() => {
        Island.grassPatches.forEach(patch => {
            if (!addedPatches.has(patch)) {
                scene.add(patch);
                addedPatches.add(patch);
            }
        });
    }, 100);

    // Add fire effect to firecamp
    Fire.Start();
    Island.firecamp.add(Fire.fire);

    // Initialize underwater distortion
    Underwater.Start(renderer);
    
    // Apply saved pixel size
    if (pixelSizeValue > 0) {
        Underwater.setPixelSize(pixelSizeValue);
    }

    // Initialize bubble effect
    Bubbles.Start();

    // Initialize fish
    Fish.Start();
    scene.add(Fish.clownFish);
    scene.add(Fish.doriFish);
    scene.add(Fish.genericFishContainer);

    // Initialize media player (for radio)
    MediaPlayer.Start();

    // Initialize audio system
    Audio.Start();
}

export function Update(): void
{
    Skybox.Update();
    Ocean.Update();
    SeaFloor.Update();
    Island.Update();
    Fish.Update();
    Fire.Update();
    Audio.Update();
    UI.Update();
    MediaPlayer.Update();
    Underwater.Update(camera.position.y);
    Bubbles.Update(camera.position.y);

    // Sync lights with skybox sun position and intensity
    // Keep light close enough for shadow mapping to work
    const lightDir = Skybox.dirToLight.clone();
    directionalLight.position.set(
        lightDir.x * 8 - 7,
        lightDir.y * 8 + 2,
        lightDir.z * 8 - 4.5
    );
    const sunVisible = sunVisibilityUniform.value; // 0 when sun hidden, 1 when fully visible
    const lightIntensity = lightUniform.value.x;
    // Directional light only active when sun is visible
    directionalLight.intensity = sunVisible * lightIntensity * 1.1;  // TWEAK: Lower = lighter shadows
    // Shadows only during day
    directionalLight.castShadow = sunVisible > 0.1;
    // Ambient light - higher = lighter/softer shadows
    ambientLight.intensity = 0.3 + sunVisible * lightIntensity * 0.9;  // TWEAK: Higher base = brighter scene

    Underwater.renderScene(renderer, scene, camera);
    renderer.render(axes, staticCamera);
}

// Shadow configuration helpers
export type ShadowMapType = 'basic' | 'pcf' | 'pcfsoft' | 'vsm';

export function setShadowMapType(type: ShadowMapType): void {
    switch (type) {
        case 'basic':
            renderer.shadowMap.type = BasicShadowMap;
            break;
        case 'pcf':
            renderer.shadowMap.type = PCFShadowMap;
            break;
        case 'pcfsoft':
            renderer.shadowMap.type = PCFSoftShadowMap;
            break;
        case 'vsm':
            renderer.shadowMap.type = VSMShadowMap;
            break;
    }
    renderer.shadowMap.needsUpdate = true;
}

export function setShadowBias(bias: number): void {
    if (directionalLight) {
        directionalLight.shadow.bias = bias;
    }
}

export function setShadowNormalBias(normalBias: number): void {
    if (directionalLight) {
        directionalLight.shadow.normalBias = normalBias;
    }
}

export function setShadowRadius(radius: number): void {
    if (directionalLight) {
        directionalLight.shadow.radius = radius;
    }
}

export function getShadowLight(): DirectionalLight {
    return directionalLight;
}

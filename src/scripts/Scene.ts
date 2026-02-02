import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import * as Skybox from "../scene/Skybox";
import * as Ocean from "../scene/Ocean";
import * as SeaFloor from "../scene/SeaFloor";
import * as Island from "../scene/Island";
import * as Fire from "../scene/Fire.ts";
import * as Audio from "./Audio.ts";
import * as UI from "./UI.ts";
import * as Underwater from "../effects/Underwater.ts";
import * as Bubbles from "../effects/Bubbles.ts";
import { axes } from "./Debug.ts";
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial";

export const body = document.createElement("div");

// Scene lights - synced with skybox
let ambientLight: AmbientLight;
let directionalLight: DirectionalLight;

export const renderer = new WebGLRenderer();
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

export let resMult = 1;
export function SetResolution(value: number): void
{
    resMult = value;
    const width = window.innerWidth * value * window.devicePixelRatio;
    const height = window.innerHeight * value * window.devicePixelRatio;
    body.style.transform = "";
    body.style.width = window.innerWidth + "px";
    body.style.height = window.innerHeight + "px";

    renderer.setSize(width, height, false);
}

export let fov = 70;
export function SetFOV(value: number): void
{
    fov = value;
    camera.fov = value;
    camera.updateProjectionMatrix();
}

export let antialias = true;
export function SetAntialias(value: boolean): void
{
    antialias = value;
    (renderer as unknown as { antialias: boolean }).antialias = antialias;
}

export function Start(): void
{
    document.body.appendChild(body);

    let width = window.innerWidth * resMult * window.devicePixelRatio;
    let height = window.innerHeight * resMult * window.devicePixelRatio;
    body.style.transform = "";
    body.style.width = window.innerWidth + "px";
    body.style.height = window.innerHeight + "px";
    
    renderer.setSize(width, height, false);
    (renderer as unknown as { antialias: boolean }).antialias = antialias;
    renderer.autoClearColor = false;
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
        width = window.innerWidth * resMult * window.devicePixelRatio;
        height = window.innerHeight * resMult * window.devicePixelRatio;
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
    ambientLight = new AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    directionalLight = new DirectionalLight(0xffffff, 1.0);
    directionalLight.position.copy(Skybox.dirToLight).multiplyScalar(100);
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

    // Add fire effect to firecamp
    Fire.Start();
    Island.firecamp.add(Fire.fire);

    // Initialize underwater distortion
    Underwater.Start(renderer);

    // Initialize bubble effect
    Bubbles.Start();

    // Initialize audio system
    Audio.Start();
}

export function Update(): void
{
    Skybox.Update();
    Ocean.Update();
    SeaFloor.Update();
    Island.Update();
    Fire.Update();
    Audio.Update();
    UI.Update();
    Underwater.Update(camera.position.y);
    Bubbles.Update(camera.position.y);

    // Sync lights with skybox sun position and intensity
    directionalLight.position.copy(Skybox.dirToLight).multiplyScalar(100);
    const sunVisible = sunVisibilityUniform.value; // 0 when sun hidden, 1 when fully visible
    const lightIntensity = lightUniform.value.x;
    // Directional light only active when sun is visible
    directionalLight.intensity = sunVisible * lightIntensity * 2.0;
    // Ambient stays very dim at night
    ambientLight.intensity = 0.05 + sunVisible * lightIntensity * 0.5;

    Underwater.renderScene(renderer, scene, camera);
    renderer.render(axes, staticCamera);
}

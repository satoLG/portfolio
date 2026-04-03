import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer, PCFSoftShadowMap, BasicShadowMap, PCFShadowMap, VSMShadowMap } from "three";
import { getIsUnderwater } from "./Control";
import * as Skybox from "../scene/Skybox";
import * as Ocean from "../scene/Ocean";
import * as SeaFloor from "../scene/SeaFloor";
import * as SeaFloorDecor from "../scene/SeaFloorDecor";
import * as Island from "../scene/Island";
import * as Fire from "../scene/Fire.ts";
import * as Fish from "../scene/Fish.ts";
import * as Audio from "./Audio.ts";
import * as UI from "./UI.ts";
import * as MediaPlayer from "./MediaPlayer.ts";
import * as PostProcess from "../effects/PostProcess.ts";
import * as OceanReflection from "../effects/OceanReflection.ts";
import * as Bubbles from "../effects/Bubbles.ts";
import * as UnderwaterParticles from "../effects/UnderwaterParticles.ts";
import * as WindLines from "../effects/WindLines.ts";
import * as Clouds from "../effects/Clouds.ts";
import { axes } from "./Debug.ts";
import { deltaTime } from "./Time.ts";
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer';
import * as PhoneScreen from './PhoneScreen';
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial";
import { reflectionTextureUniform } from "../materials/OceanMaterial";

// Scene-ready flag — scene renders from the very first frame so the sky is
// visible behind the loading button.  Kept as a no-op export for clarity.
let _sceneReady = true;
export function setSceneReady(): void { _sceneReady = true; }

// DOM containers — matching Henry's #css / #webgl structure
export const cssContainer = document.querySelector('#css') as HTMLDivElement;
export const webglContainer = document.querySelector('#webgl') as HTMLDivElement;

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

// Color filter for the 3D scene (none, bw, sepia)
export type ColorFilter = 'none' | 'bw' | 'sepia';
export let colorFilterValue: ColorFilter = (localStorage.getItem('portfolio-color-filter') as ColorFilter) || 'none';

// Scene lights - synced with skybox
let ambientLight: AmbientLight;
let directionalLight: DirectionalLight;

export let renderer = new WebGLRenderer({ antialias, alpha: true, powerPreference: 'high-performance' });
export const scene = new Scene();
export const camera = new PerspectiveCamera();
export const staticCamera = new PerspectiveCamera();

// Single shared CSS3DRenderer + scene — one preserve-3d container matches Henry
export const cssRenderer = new CSS3DRenderer();
export const cssScene = new Scene();

// CSS3D operates at a much larger coordinate space to avoid tiny matrix3d scale
// values that cause iOS WebKit precision issues (downward displacement).
// CSS_SCALE = IFRAME_WIDTH / SCREEN_WIDTH = 1280 / 0.25 = 5120
// At this scale CSS3DObjects have scale (1,1,1) — matching henryjeff.
export const CSS_SCALE = 5120;
export const cssCamera = new PerspectiveCamera();

export const cameraRight = new Vector3();
export const cameraUp = new Vector3();
export const cameraForward = new Vector3();

// Reusable scratch vector for light direction (avoids allocation per frame)
const _scratchLightDir = new Vector3();

// Scratch vectors for UpdateCameraRotation (eliminates 3 Vector3 allocations per frame)
const _basisX = new Vector3();
const _basisY = new Vector3();
const _basisZ = new Vector3();

export function UpdateCameraRotation(): void
{
    cameraRight.copy(_basisX.set(1, 0, 0).applyQuaternion(camera.quaternion));
    cameraUp.copy(_basisY.set(0, 1, 0).applyQuaternion(camera.quaternion));
    cameraForward.copy(_basisZ.set(0, 0, -1).applyQuaternion(camera.quaternion));
}

import { defaultFov } from '../scene/CameraConfig';
export let fov = defaultFov;
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
    PostProcess.setPixelSize(value);
    localStorage.setItem('portfolio-pixel-size', value.toString());
    applyPixelBodyClass(value);
    PhoneScreen.applyPhonePixelSize(value);
}

function applyPixelBodyClass(value: number): void {
    document.body.classList.remove('pixel-medium', 'pixel-max');
    if (value === 5) document.body.classList.add('pixel-medium');
    else if (value >= 10) document.body.classList.add('pixel-max');

    const logoSrc = value > 0 ? '/favicon_pixel.svg' : '/favicon.svg';

    const faviconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (faviconLink) faviconLink.href = logoSrc;

    const nameLogo = document.querySelector<HTMLImageElement>('img.name-logo');
    if (nameLogo) nameLogo.src = logoSrc;
}

export function SetColorFilter(value: ColorFilter): void {
    colorFilterValue = value;
    localStorage.setItem('portfolio-color-filter', value);
    applyColorFilter(value);
}

function applyColorFilter(value: ColorFilter): void {
    const canvas = renderer.domElement;
    let filterStr = '';
    switch (value) {
        case 'bw':    filterStr = 'grayscale(1)'; break;
        case 'sepia': filterStr = 'sepia(1)';     break;
    }
    canvas.style.filter = filterStr;
    PhoneScreen.applyPhoneColorFilter(filterStr);
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
    const dpr = Math.min(window.devicePixelRatio, 2);  // cap DPR to limit GPU memory
    
    // ── Viewport helpers ─────────────────────────────────────────────────────
    // Use window.innerWidth/Height — matches henryjeff's Sizes.ts approach.
    function getViewportWidth(): number {
        return window.innerWidth;
    }
    function getViewportHeight(): number {
        return window.innerHeight;
    }

    renderer.setPixelRatio(dpr);
    renderer.setSize(getViewportWidth(), getViewportHeight());
    renderer.setClearColor(0x000000, 0.0);
    renderer.shadowMap.enabled = shadowsEnabled;
    renderer.shadowMap.type = VSMShadowMap;  // Variance shadows — real Gaussian blur

    // Canvas styling — matches Henry's Renderer.ts
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.zIndex = '1px';
    renderer.domElement.style.top = '0px';
    renderer.domElement.style.pointerEvents = 'auto';   // override #webgl's none
    webglContainer.appendChild(renderer.domElement);

    // Single shared CSS3DRenderer — one preserve-3d container (matches Henry)
    cssRenderer.setSize(getViewportWidth(), getViewportHeight());
    cssRenderer.domElement.style.position = 'absolute';
    cssRenderer.domElement.style.top      = '0px';
    // Keep CSS3DRenderer's default overflow:hidden — henryjeff works with it.
    cssContainer.appendChild(cssRenderer.domElement);

    // Phone screen shares the single CSS renderer + scene
    PhoneScreen.initRenderer(renderer.domElement, cssRenderer, cssScene);
    
    camera.fov = fov;
    camera.aspect = getViewportWidth() / getViewportHeight();
    camera.near = 0.3;
    camera.far = 4000;
    camera.updateProjectionMatrix();
    // Position set by Control.js in web page mode
    camera.position.set(50, 50, 0);

    UpdateCameraRotation();

    staticCamera.fov = 70;
    staticCamera.aspect = getViewportWidth() / getViewportHeight();
    staticCamera.near = 0.1;
    staticCamera.far = 10;
    staticCamera.updateProjectionMatrix();
    staticCamera.position.set(0, 0, 0);

    function onViewportResize() {
        const w = getViewportWidth();
        const h = getViewportHeight();

        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();

        staticCamera.aspect = w / h;
        staticCamera.updateProjectionMatrix();

        // Underwater needs the actual pixel-buffer dimensions, not CSS dimensions
        const buf = new Vector2();
        renderer.getDrawingBufferSize(buf);
        PostProcess.onResize(buf.x, buf.y);
        cssRenderer.setSize(w, h);
    }

    window.onresize = onViewportResize;

    Skybox.Start();
    scene.add(Skybox.skybox);

    // Add lighting for 3D models - synced with skybox
    ambientLight = new AmbientLight(0xffffff, 0.6);  // TWEAK: Base ambient brightness
    scene.add(ambientLight);
    
    directionalLight = new DirectionalLight(0xffffff, 1.0);
    // Position light behind island so shadows go forward towards camera
    directionalLight.position.set(1, 4, -6);  // Behind island at z=-3.3
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 12;
    directionalLight.shadow.camera.left = -2;
    directionalLight.shadow.camera.right = 2;
    directionalLight.shadow.camera.top = 2;
    directionalLight.shadow.camera.bottom = -4;
    
    // Shadow bias configuration — VSM uses positive bias
    directionalLight.shadow.bias = 0.0005;
    directionalLight.shadow.normalBias = 0.05;
    directionalLight.shadow.radius = 4;  // VSM blur radius
    directionalLight.shadow.blurSamples = 10;
    
    // Point at island center (firecamp is at z=-2.9)
    directionalLight.target.position.set(0, 0, -3.0);
    scene.add(directionalLight.target);
    scene.add(directionalLight);

    Ocean.Start();
    scene.add(Ocean.surface);

    // Wire the reflection render-target texture into the ocean surface shader once.
    // The RT texture object is stable; its contents are updated each frame by OceanReflection.update().
    reflectionTextureUniform.value = OceanReflection.renderTarget.texture;

    SeaFloor.Start();
    for (let i = 0; i < SeaFloor.tiles.length; i++)
    {
        scene.add(SeaFloor.tiles[i]);
    }

    // Seafloor decorations (coral rocks, corals, kelp) — loads async
    SeaFloorDecor.Start();
    scene.add(SeaFloorDecor.decorGroup);

    // Load island and firecamp models
    Island.Start();
    scene.add(Island.island);
    scene.add(Island.firecamp);
    scene.add(Island.palmtree);
    scene.add(Island.radio);
    scene.add(Island.sword);
    scene.add(Island.pug);
    scene.add(Island.tent);
    scene.add(Island.chest);
    // Grass and clover patches are added dynamically as they load
    const addedPatches = new Set<any>();
    const grassInterval = setInterval(() => {
        Island.grassPatches.forEach(patch => {
            if (!addedPatches.has(patch)) {
                scene.add(patch);
                addedPatches.add(patch);
            }
        });
        // Stop polling once both grass and clover loaders have finished
        if (Island.isFoliageLoaded()) {
            clearInterval(grassInterval);
        }
    }, 100);

    // Add fire effect to firecamp
    Fire.Start();
    Island.firecamp.add(Fire.fire);
    // Shadow spotlight lives in the scene (not inside fire group which is scaled 0.25x)
    scene.add(Fire.fireShadowLight);
    scene.add(Fire.fireShadowLight.target);

    // Initialize post-processing (underwater distortion + pixelation)
    PostProcess.Start(renderer);
    
    // Apply saved pixel size
    if (pixelSizeValue > 0) {
        PostProcess.setPixelSize(pixelSizeValue);
        applyPixelBodyClass(pixelSizeValue);
    }

    // Apply saved color filter
    if (colorFilterValue !== 'none') {
        applyColorFilter(colorFilterValue);
    }

    // Initialize bubble effect
    Bubbles.Start();

    // Initialize underwater floating particles
    UnderwaterParticles.Start();

    // Initialize fish
    Fish.Start();
    scene.add(Fish.clownFish);
    scene.add(Fish.doriFish);
    scene.add(Fish.genericFishContainer);

    // Initialize media player (for radio)
    MediaPlayer.Start();

    // Initialize audio system
    Audio.Start();

    // Wind lines — 3D ribbon meshes in the Three.js scene (synced with breeze audio)
    WindLines.Start();
    scene.add(WindLines.windLinesGroup);

    // Volumetric clouds
    Clouds.Start();
    scene.add(Clouds.cloudsGroup);
}

export function Update(): void
{
    // Skip all rendering during the loading screen — nothing is visible anyway
    // (camera parked at introStartY, WebGL canvas behind the loading overlay).
    // This frees the GPU entirely for model downloads and decoding.
    if (!_sceneReady) return;

    Skybox.Update();
    Ocean.Update();
    SeaFloor.Update();
    SeaFloorDecor.Update(deltaTime);
    Island.Update();
    Fish.Update();
    Fire.Update();
    Audio.Update();
    UI.Update();
    MediaPlayer.Update();
    PostProcess.updateUnderwaterAmount(camera.position.y);
    Bubbles.Update(camera.position.y);
    UnderwaterParticles.Update(camera.position.y);

    // Reflection pre-pass — renders scene from mirror camera into RT before the main render.
    // Skip when underwater: the mirrored surface is invisible from below.
    if (!getIsUnderwater()) {
        OceanReflection.update(camera, renderer, scene, Ocean.surface);
    }

    // Sync lights with skybox sun position and intensity
    // Keep light close enough for shadow mapping to work
    // Reuse a scratch vector instead of cloning every frame
    _scratchLightDir.copy(Skybox.dirToLight);
    directionalLight.position.set(
        _scratchLightDir.x * 8 - 7,
        _scratchLightDir.y * 8 + 2,
        _scratchLightDir.z * 8 - 4.5
    );
    const sunVisible = sunVisibilityUniform.value; // 0 when sun hidden, 1 when fully visible
    const lightIntensity = lightUniform.value.x;
    // Directional light only active when sun is visible
    directionalLight.intensity = sunVisible * lightIntensity * 1.1;  // TWEAK: Lower = lighter shadows
    // Shadows: fade to zero intensity instead of toggling castShadow on/off
    // Toggling castShadow causes GPU pipeline stall (shadow map alloc/dealloc)
    // Instead, keep castShadow always on (if shadows enabled) and let intensity=0 make it invisible
    if (shadowsEnabled && !directionalLight.castShadow) {
        directionalLight.castShadow = true;
    }
    // Ambient light - higher = lighter/softer shadows
    ambientLight.intensity = 0.3 + sunVisible * lightIntensity * 0.9;  // TWEAK: Higher base = brighter scene

    // Sync occluder transforms BEFORE the render (so NoBlending holes are correct)
    PhoneScreen.preRender(Island.phone, camera);

    // Update projection matrix every frame (matches Henry's Renderer.update())
    camera.updateProjectionMatrix();

    // Sync CSS camera — same orientation/FOV but position scaled to CSS-pixel space
    cssCamera.position.copy(camera.position).multiplyScalar(CSS_SCALE);
    cssCamera.quaternion.copy(camera.quaternion);
    cssCamera.fov = camera.fov;
    cssCamera.aspect = camera.aspect;
    cssCamera.near = camera.near * CSS_SCALE;
    cssCamera.far = camera.far * CSS_SCALE;
    cssCamera.updateProjectionMatrix();

    // Main WebGL render — single-pass: scene includes occluders (MeshBasicMaterial
    // with NoBlending punches transparent holes), matching henryjeff's architecture.
    // PostProcess.renderScene wraps renderer.render() with post-processing
    // (pixelation + underwater distortion).
    PostProcess.renderScene(renderer, scene, camera);

    // Debug axes
    renderer.autoClearColor = false;
    renderer.render(axes, staticCamera);
    renderer.autoClearColor = true;

    // Pointer-events + CSS3D update
    PhoneScreen.render(camera);

    // Single CSS3D render using the scaled CSS camera
    cssRenderer.render(cssScene, cssCamera);

    // Wind lines 3D update — moves ribbon meshes and updates vertex positions
    WindLines.Update(deltaTime, camera.position.x, camera.position.y, camera.position.z, camera.fov);

    // Volumetric clouds — sunVisible drives day(1)/night(0) color transition
    Clouds.Update(deltaTime, sunVisible);
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

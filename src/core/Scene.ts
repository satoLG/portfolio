import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer, PCFSoftShadowMap, BasicShadowMap, PCFShadowMap, VSMShadowMap, Object3D, Quaternion } from "three";
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
import * as Bubbles from "../effects/Bubbles.ts";
import * as UnderwaterParticles from "../effects/UnderwaterParticles.ts";
import * as WindLines from "../effects/WindLines.ts";
import * as CloudSprites from "../effects/CloudSprites.ts";
import * as SceneDepth from "../effects/SceneDepth.ts";
import { sceneDepthUniform, updateSceneDepthCamera } from "../materials/OceanMaterial";
import { axes } from "./Debug.ts";
import { deltaTime } from "./Time.ts";
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer';
import * as PhoneScreen from './PhoneScreen';
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial";

// Scene-ready flag — scene renders from the very first frame so the sky is
// visible behind the loading button.  Kept as a no-op export for clarity.
let _sceneReady = true;
export function setSceneReady(): void { _sceneReady = true; }

/** Reveal the ocean surface — called once when the user clicks Start. */
export function showOcean(): void { Ocean.surface.visible = true; }

// DOM containers — matching Henry's #css / #webgl structure
export const cssContainer = document.querySelector('#css') as HTMLDivElement;
export const webglContainer = document.querySelector('#webgl') as HTMLDivElement;

// Detect device type for default graphics settings
export const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
const defaultHigh = !isMobile;

// Read graphics settings from localStorage (or use device-based defaults).
// MSAA (WebGL antialias) reserves a multi-sample backbuffer that costs ~150–250 MB
// of VRAM at retina resolutions. We default it OFF and rely on FXAA in PostProcess
// for edge smoothing — small per-frame cost, ~0 extra RAM. Users can opt back into
// MSAA through the debug GUI (page reload required, since it's a context attribute).
export let antialias = localStorage.getItem('portfolio-antialias') !== null
    ? localStorage.getItem('portfolio-antialias') === 'true'
    : false;
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

// Debug hooks — `__diag()` in the console returns a snapshot of the
// renderer/scene state. Comparing snapshots before and after a transition
// shows what's being uploaded/compiled at runtime (= stutter source).
(window as any).__r = renderer;
(window as any).__scene = scene;
(window as any).__diag = () => ({
    programs: renderer.info.programs?.length ?? 0,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    calls: renderer.info.render.calls,
    pointLights: scene.children.filter(c => (c as any).isPointLight).length,
    fish: Fish.getDiagState(),
});

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
const _underwaterTransparentTargets: Object3D[] = [];
const _depthExcludedTargets: Object3D[] = [];

// Fire shadow map refreshes every Nth frame (see throttle in Update).
const FIRE_SHADOW_UPDATE_INTERVAL = 3;
let _fireShadowFrame = 0;

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

import { defaultFov } from '../scene/config/CameraConfig';
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

function getUnderwaterTransparentTargets(): Object3D[] {
    _underwaterTransparentTargets.length = 0;
    _underwaterTransparentTargets.push(Fish.clownFish, Fish.doriFish, Fish.genericFishContainer);
    const bubbles = Bubbles.getRenderable();
    if (bubbles) _underwaterTransparentTargets.push(bubbles);
    const particles = UnderwaterParticles.getRenderable();
    if (particles) _underwaterTransparentTargets.push(particles);
    return _underwaterTransparentTargets;
}

function hideUnderwaterTransparents(): Array<{ obj: Object3D; vis: boolean }> {
    const saved: Array<{ obj: Object3D; vis: boolean }> = [];
    for (const obj of getUnderwaterTransparentTargets()) {
        saved.push({ obj, vis: obj.visible });
        obj.visible = false;
    }
    return saved;
}

function restoreVisibility(saved: Array<{ obj: Object3D; vis: boolean }>): void {
    for (const item of saved) item.obj.visible = item.vis;
}

// Objects that are irrelevant to depth-intersection foam but expensive to draw
// a second time in the depth pre-pass. The foam only needs the depth of opaque
// geometry the ocean surface can graze (island, rocks, dock, sea-floor decor).
//   - Procedural grass: the single heaviest geometry in the scene (one merged
//     mesh with a huge vertex count) and it sits entirely above the waterline,
//     so it never produces intersection foam.
//   - Grass shadow floor: flat disc above water, irrelevant.
//   - Skybox: covers the whole screen but reads as background (depth >= 0.9999)
//     anyway — the cleared depth target gives the identical result for free.
//   - Wind lines: thin above-water ribbons, irrelevant.
// Skipping these in the depth-only pass is the bulk of the pre-pass cost.
function getDepthPrePassExcluded(): Object3D[] {
    _depthExcludedTargets.length = 0;
    if (Island.proceduralGrassMesh) _depthExcludedTargets.push(Island.proceduralGrassMesh);
    if (Island.grassShadowMesh)     _depthExcludedTargets.push(Island.grassShadowMesh);
    if (Skybox.skybox)              _depthExcludedTargets.push(Skybox.skybox);
    if (WindLines.windLinesGroup)   _depthExcludedTargets.push(WindLines.windLinesGroup);
    return _depthExcludedTargets;
}

function hideDepthPrePassExcluded(): Array<{ obj: Object3D; vis: boolean }> {
    const saved: Array<{ obj: Object3D; vis: boolean }> = [];
    for (const obj of getDepthPrePassExcluded()) {
        if (!obj.visible) continue; // already hidden by visibility gating — nothing to restore
        saved.push({ obj, vis: obj.visible });
        obj.visible = false;
    }
    return saved;
}

function renderOnlyUnderwaterTransparents(savedTargets: Array<{ obj: Object3D; vis: boolean }>): void {
    const targetSet = new Set(savedTargets.filter(item => item.vis).map(item => item.obj));
    if (targetSet.size === 0) return;

    const savedChildren = scene.children.map(obj => ({ obj, vis: obj.visible }));
    for (const child of scene.children) {
        child.visible = (child as any).isLight === true || targetSet.has(child);
    }

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    // This is a second full renderer.render() in the same frame (only the
    // underwater transparents are visible). Without suspending shadow updates it
    // re-renders both VSM shadow maps a second time per frame for nothing — the
    // shadows were already drawn by the main render and nothing casting them is
    // visible here. Suspend during this pass.
    const prevShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.render(scene, camera);
    renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;
    renderer.autoClear = prevAutoClear;

    restoreVisibility(savedChildren);
}

function renderSceneFrame(useUnderwaterTransparentPass: boolean): void {
    // Hide the underwater transparents (fish, bubbles, particles) BEFORE the
    // depth pre-pass. The pre-pass uses scene.overrideMaterial = MeshDepthMaterial,
    // which forces depthWrite=true and so OVERRIDES these objects' own
    // depthWrite=false — they'd otherwise write depth into the foam depth target
    // while floating in open water. The edge foam reads that depth as "ocean
    // meeting an object" and paints stray foam wherever a bubble/particle/fish
    // drifts, flickering even with the camera still and worst on the first dive
    // (the entry bubble burst). They are re-rendered separately after the ocean.
    const underwaterTransparentVis = useUnderwaterTransparentPass ? hideUnderwaterTransparents() : null;

    // Pre-pass: capture opaque scene depth into SceneDepth's depth target so
    // the ocean shader can do depth-intersection foam in this frame. Must run
    // AFTER per-frame visibility gating (already set above us in Update) and
    // BEFORE the main scene render — the override material is a cheap
    // MeshDepthMaterial so the cost is just vertex pipeline + depth write.
    // Exclude foam-irrelevant heavy geometry (grass, skybox, wind lines) so the
    // pre-pass doesn't re-submit the scene's biggest vertex loads for nothing.
    const depthExcludedVis = hideDepthPrePassExcluded();
    SceneDepth.capture(renderer, scene, camera);
    restoreVisibility(depthExcludedVis);
    sceneDepthUniform.value = SceneDepth.getDepthTexture();
    updateSceneDepthCamera(camera);

    PostProcess.renderScene(renderer, scene, camera, () => {
        Ocean.RenderSurface(renderer, camera);
        if (underwaterTransparentVis) {
            renderOnlyUnderwaterTransparents(underwaterTransparentVis);
            restoreVisibility(underwaterTransparentVis);
        }
    });
}

export function setShadowsEnabled(value: boolean): void
{
    shadowsEnabled = value;
    renderer.shadowMap.enabled = value;
    renderer.shadowMap.needsUpdate = true;
    
    // Dispose shadow map textures so Three.js recreates them fresh
    // VSM uses two render targets: shadow.map (main) and shadow.mapPass (blur pass).
    // Both must be cleared — leaving mapPass causes size mismatch and shadows disappear.
    scene.traverse((obj) => {
        const light = obj as any;
        if (light.shadow?.map) {
            light.shadow.map.dispose();
            light.shadow.map = null;
        }
        if (light.shadow?.mapPass) {
            light.shadow.mapPass.dispose();
            light.shadow.mapPass = null;
        }
    });
    // Also check the directional light directly (may not be in scene yet during init)
    if (directionalLight?.shadow?.map) {
        directionalLight.shadow.map.dispose();
        (directionalLight.shadow as any).map = null;
    }
    if ((directionalLight?.shadow as any)?.mapPass) {
        (directionalLight.shadow as any).mapPass.dispose();
        (directionalLight.shadow as any).mapPass = null;
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
    const dpr = Math.min(window.devicePixelRatio, 1.5);  // cap DPR to limit GPU memory (UI 'high' preset raises it to 2)
    
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

    // Disable automatic per-frame sorting — CPU savings for 250+ objects.
    // Use explicit renderOrder on key meshes instead.
    renderer.sortObjects = false;

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

    const _resizeBuf = new Vector2();
    let _lastViewportW = getViewportWidth();
    let _resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    function applyViewportResize() {
        const w = getViewportWidth();
        const h = getViewportHeight();

        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();

        staticCamera.aspect = w / h;
        staticCamera.updateProjectionMatrix();

        // Underwater needs the actual pixel-buffer dimensions, not CSS dimensions
        renderer.getDrawingBufferSize(_resizeBuf);
        PostProcess.onResize(_resizeBuf.x, _resizeBuf.y);
        SceneDepth.onResize(_resizeBuf.x, _resizeBuf.y);
        cssRenderer.setSize(w, h);

        _lastViewportW = w;
    }

    function onViewportResize() {
        const w = getViewportWidth();

        // On mobile, scrolling collapses/expands the browser URL bar, firing a
        // BURST of resize events that change only the height. Each one resizes the
        // drawing buffer and reallocates the depth + scene-color FBOs. The
        // underwater edge foam samples scene depth in screen space, so this churn
        // makes it flicker — stray foam over open water, real foam dropping out —
        // and it only settles once scrolling stops. When the width is unchanged
        // (i.e. NOT a real rotation/layout change) we debounce: keep the drawing
        // buffer stable during the burst and reallocate once, after it ends. The
        // canvas may stretch by the URL-bar height for a moment; that is far less
        // jarring than the foam flicker and self-corrects the instant scroll stops.
        if (isMobile && w === _lastViewportW) {
            if (_resizeDebounceTimer !== null) clearTimeout(_resizeDebounceTimer);
            _resizeDebounceTimer = setTimeout(() => {
                _resizeDebounceTimer = null;
                applyViewportResize();
            }, 250);
            return;
        }

        // Width changed (orientation / layout) or desktop — apply immediately.
        if (_resizeDebounceTimer !== null) {
            clearTimeout(_resizeDebounceTimer);
            _resizeDebounceTimer = null;
        }
        applyViewportResize();
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
    const shadowRes = isMobile ? 512 : 1024;
    directionalLight.shadow.mapSize.width = shadowRes;
    directionalLight.shadow.mapSize.height = shadowRes;
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
    // Hide ocean until the user clicks Start — at the intro camera height the
    // ocean edge is barely visible and creates a distracting frame flash.
    Ocean.surface.visible = false;

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
    scene.add(Island.tree);
    scene.add(Island.bush);
    scene.add(Island.bushRadio);
    scene.add(Island.bushRadio2);
    scene.add(Island.bushPug);
    scene.add(Island.radio);
    scene.add(Island.sword);
    scene.add(Island.pug);
    scene.add(Island.tent);
    scene.add(Island.chest);
    // Procedural grass/clover meshes are added directly to the scene by Island.ts
    // via threeScene.add() inside waitForIslandMeshes(). No polling needed.

    // Add fire effect to firecamp
    Fire.Start();
    Island.firecamp.add(Fire.fire);
    // Shadow spotlight lives in the scene (not inside fire group which is scaled 0.25x)
    scene.add(Fire.fireShadowLight);
    scene.add(Fire.fireShadowLight.target);

    // Initialize post-processing (underwater distortion + pixelation + FXAA)
    PostProcess.Start(renderer);
    // Allocate the depth-capture target — used by the ocean shader for
    // depth-intersection foam.
    SceneDepth.Start(renderer);
    // FXAA replaces MSAA when antialiasing is off (the new default).
    PostProcess.setFxaaEnabled(!antialias);

    // Apply saved pixel size
    if (pixelSizeValue > 0) {
        PostProcess.setPixelSize(pixelSizeValue);
        applyPixelBodyClass(pixelSizeValue);
        PhoneScreen.applyPhonePixelSize(pixelSizeValue);
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

    CloudSprites.Start();

    // Register GPU prewarm to run after all models finish loading.
    // This compiles every shader program during the loading screen so the
    // first scroll and first underwater transition are stutter-free.
    Island.setOnLoadCallback(prewarmGPU);
}

// ── GPU Prewarming ───────────────────────────────────────────────────────────
// Compiles all shader programs and uploads geometry/textures to the GPU while
// the loading overlay is still visible.  Trades a brief loading-screen pause
// for zero runtime stutter on first interaction.

// Unified loading-bar progress (0–1). The bar reflects the download of ALL
// model subsystems — Island, SeaFloorDecor and Fish — which load in parallel
// via separate GLTFLoaders. Previously the bar tracked only Island, so it hit
// 90% the instant Island finished and then sat there, invisibly, while the
// underwater models kept downloading + the GPU prewarm ran — which read as a
// freeze at 90%. Downloads fill 0–90%; the GPU prewarm pass owns the last 10%.
let _prewarmComplete = false;

export function getStartupProgress(): number {
    if (_prewarmComplete) return 1;
    // Weighted by rough asset heft — Island is the bulk of the bytes.
    const download =
        Island.getDownloadFraction()       * 0.55 +
        SeaFloorDecor.getDownloadFraction() * 0.30 +
        Fish.getDownloadFraction()          * 0.15;
    return Math.min(download, 1) * 0.9;
}

async function prewarmGPU(): Promise<void> {
  try {
    // Wait for SeaFloorDecor models (loaded via a separate GLTFLoader,
    // not tracked by Island's LoadingManager).
    await waitForModels();
    await Audio.preloadAudioBytes();

    // 1. Save visibility & camera state
    const savedVis: Array<{ obj: Object3D; vis: boolean }> = [];
    scene.traverse(obj => {
        savedVis.push({ obj, vis: obj.visible });
        obj.visible = true;
    });
    const savedPos = camera.position.clone();
    const savedQuat = camera.quaternion.clone();
    const savedFov = camera.fov;
    const restoreVariants = Island.beginPrewarmVariants();

    // Steps 2-3 do heavy GPU work that can throw (driver hiccup, lost context,
    // compileAsync rejection). Wrap everything so the camera/visibility/variant
    // state is ALWAYS restored — otherwise a thrown prewarm leaves the camera
    // displaced and the scene's visibility gate corrupted, so the scene that
    // appears after the loading screen is broken rather than just un-warmed.
    try {
        // 2. Compile every material in the scene graph (triggers onBeforeCompile
        //    hooks on SeaFloorDecor ocean lighting, kelp sway, Island wind, etc.)
        renderer.compile(scene, camera);
        Ocean.CompileSurface(renderer, camera);
        if (typeof (renderer as any).compileAsync === 'function') {
            await (renderer as any).compileAsync(scene, camera);
        }
        initGpuTextures(scene);

        // Pre-upload the chest ray canvas textures to GPU (canvas textures require
        // initTexture — they're not uploaded by renderer.compile, only on render).
        for (const mat of Island.getChestRayMats()) {
            if (mat.map) renderer.initTexture(mat.map);
        }

        // Compile the post-process quad (underwater distortion + pixelation)
        PostProcess.prewarm(renderer);
        // Compile the depth-override shader path so the first frame's depth-pre-pass
        // doesn't hitch.
        SceneDepth.prewarm(renderer, scene, camera);

        // 3. Warm render — forces geometry VBO uploads and texture GPU transfers.
        //    Two passes: surface + underwater so both frustum regions are covered.
        //    Surface pass: camera at intro start position, tilted upward (matching
        //    the intro tilt) so only sky is visible — no ocean edge flash.
        camera.position.set(-0.1, 6.05, 1.78);
        camera.lookAt(-0.1, 7.45, -6.0);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        Ocean.RenderSurface(renderer, camera);

        // Island-facing pass: uploads all island/tree/object textures to GPU
        // (the sky pass above looks away from the island, so nothing on it gets uploaded).
        const surfaceWasVisible = Ocean.surface.visible;
        Ocean.surface.visible = true;
        camera.position.set(0, 3.5, 0);
        camera.lookAt(0, 0, -3.3);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        Ocean.RenderSurface(renderer, camera);
        Ocean.surface.visible = surfaceWasVisible;

        // Briefly render the real pooled jellyfish clones with non-zero opacity so
        // their transparent shader variant and buffers are warm before the first dive.
        const restoreJellyfishPrewarm = Fish.beginJellyfishPrewarm();
        try {
            await prewarmChestCorridor();
            // Exercise the full PostProcess pipeline (copyFramebufferToTexture + distortion
            // quad render) so the GPU path is warm before the user actually dives.
            // Without this the first real crossing of UNDERWATER_Y_THRESHOLD causes a
            // pipeline stall on the copyFramebufferToTexture call.
            PostProcess.updateUnderwaterAmount(camera.position.y);  // sets underwaterAmount > 0
            renderSceneFrame(true);
            PostProcess.updateUnderwaterAmount(100);                 // reset to 0 (positive Y → depth < 0)
        } finally {
            // The prewarm temporarily acquires PointLights from the pool. If the
            // GPU work above ever throws, the restore must still run — otherwise
            // leaked golden lights stay attached to the apples for the session.
            restoreJellyfishPrewarm();
        }
    } finally {
        // Undo the variant prewarm FIRST. beginPrewarmVariants() captured each
        // object's visibility AFTER the traverse above forced everything to
        // visible=true, so its own restore would wrongly re-show objects that
        // were hidden pre-prewarm (e.g. the golden ground-apple slot, which then
        // floats underwater). The savedVis loop below holds the true pre-prewarm
        // values and must have the final say, so it runs last.
        restoreVariants();

        // 4. Restore camera
        camera.position.copy(savedPos);
        camera.quaternion.copy(savedQuat);
        camera.fov = savedFov;
        camera.updateProjectionMatrix();

        // 5. Restore visibility (authoritative — runs last)
        for (const { obj, vis } of savedVis) obj.visible = vis;
    }

    // 6. Preload all music tracks into browser cache (non-blocking)
    MediaPlayer.preloadAllTracks();
  } finally {
    // Always drive the bar to 100%, even if the prewarm above threw — a
    // first-interaction hitch is far better than a permanent freeze at 90%.
    _prewarmComplete = true;
  }
}

function initGpuTextures(root: Object3D): void {
    const textureKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap'];
    root.traverse((obj: any) => {
        const raw = obj.material;
        if (!raw) return;
        const materials = Array.isArray(raw) ? raw : [raw];
        for (const mat of materials) {
            for (const key of textureKeys) {
                const tex = mat?.[key];
                if (tex) renderer.initTexture(tex);
            }
        }
    });
}

async function prewarmChestCorridor(): Promise<void> {
    const chestCfg = SeaFloorDecor.config.chest;
    const target = new Vector3(chestCfg.x, chestCfg.y + 0.9, chestCfg.z);
    const mainFov = camera.fov;

    const renderAt = async (pos: Vector3, fov: number): Promise<void> => {
        camera.position.copy(pos);
        camera.lookAt(target);
        camera.fov = fov;
        camera.updateProjectionMatrix();
        renderer.shadowMap.needsUpdate = true;
        renderer.compile(scene, camera);
        if (typeof (renderer as any).compileAsync === 'function') {
            await (renderer as any).compileAsync(scene, camera);
        }
        PostProcess.updateUnderwaterAmount(camera.position.y);
        renderSceneFrame(camera.position.y < 0);
    };

    await renderAt(new Vector3(-0.1, -6.9, 1.78), mainFov);
    await renderAt(new Vector3(-0.1, -8.4, 1.78), mainFov);
    await renderAt(new Vector3(-0.1, -10.0, 1.78), mainFov);
    await renderAt(
        new Vector3(
            chestCfg.x,
            chestCfg.y + SeaFloorDecor.config.chestZoomHeight,
            chestCfg.z + SeaFloorDecor.config.chestZoomDist,
        ),
        SeaFloorDecor.config.chestZoomFov,
    );

    PostProcess.updateUnderwaterAmount(100);
    renderer.getContext().finish();
}

// Safety net: never block the loading screen forever waiting on underwater
// models. If a SeaFloorDecor/Fish asset stalls or fails to settle (network
// drop, hung request, failed pool template), proceed with prewarm anyway after
// this cap so the bar can reach 100% and the scene becomes interactive. A
// missing fish or coral is far better than a permanent freeze at 90%.
const PREWARM_MODEL_WAIT_TIMEOUT_MS = 12000;

function waitForModels(): Promise<void> {
    return new Promise<void>(resolve => {
        const startedAt = performance.now();
        (function check() {
            if (SeaFloorDecor.isLoaded() && Fish.isReady()) {
                resolve();
            } else if (performance.now() - startedAt >= PREWARM_MODEL_WAIT_TIMEOUT_MS) {
                console.warn(
                    '[Scene] Prewarm proceeding before all underwater models were ready ' +
                    `(timed out after ${PREWARM_MODEL_WAIT_TIMEOUT_MS}ms). ` +
                    `SeaFloorDecor.isLoaded=${SeaFloorDecor.isLoaded()} Fish.isReady=${Fish.isReady()}`,
                );
                resolve();
            } else {
                setTimeout(check, 50);
            }
        })();
    });
}

export function Update(): void
{
    // Skip all rendering during the loading screen — nothing is visible anyway
    // (camera parked at introStartY, WebGL canvas behind the loading overlay).
    // This frees the GPU entirely for model downloads and decoding.
    if (!_sceneReady) return;

    const isUnderwater = getIsUnderwater();

    Skybox.Update();
    CloudSprites.Update(camera.position.y, deltaTime, Skybox.getDayNightBlend());
    Ocean.Update();
    Audio.Update(camera.position.y);
    UI.Update();
    MediaPlayer.Update();
    PostProcess.updateUnderwaterAmount(camera.position.y);

    // ── Visibility gating ─────────────────────────────────────────────────────
    // Only update systems relevant to the current view (surface vs underwater).
    // This halves per-frame CPU+GPU work in either mode.
    // Also toggle mesh visibility so the GPU skips hidden geometry entirely.

    // The island extends below the waterline, so keep it visible until the
    // camera is well below the surface. Wind lines are pure sky effects, so
    // hide them as soon as we cross the waterline.
    if (isUnderwater) {
        // Show underwater, hide surface-only
        SeaFloor.setVisible(true);
        SeaFloorDecor.decorGroup.visible = true;
        Fish.setCameraVisibility(true, Island.getLowestY());
        WindLines.windLinesGroup.visible = false;
        // Keep surface groups visibility stable while underwater. A previous
        // depth gate flipped many objects at y=-7, which lined up with the
        // chest approach and could cause a one-frame render-list/shadow hitch.
        Island.island.visible = true;
        Island.firecamp.visible = true;
        Island.tree.visible = true;
        Island.bush.visible = true;
        Island.bushRadio.visible = true;
        Island.bushRadio2.visible = true;
        Island.bushPug.visible = true;
        Fire.fire.visible = true;
        if (Island.proceduralGrassMesh) Island.proceduralGrassMesh.visible = true;
        if (Island.grassShadowMesh)     Island.grassShadowMesh.visible     = true;

        SeaFloor.Update();
        SeaFloorDecor.Update(deltaTime);
        Fish.Update();
        Bubbles.Update(camera.position.y);
        UnderwaterParticles.Update(camera.position.y);
        // Always tick Island.Update underwater — chest open/close animations,
        // glow fade-out, coin springs, and pug all depend on it.  Wind, radio,
        // pug, and music-note work is skipped when isUnderwater=true.
        Island.Update(true);
        Fire.Update();
    } else {
        // Show surface, hide underwater
        SeaFloor.setVisible(false);
        SeaFloorDecor.decorGroup.visible = false;
        Fish.setCameraVisibility(false, Island.getLowestY());
        WindLines.windLinesGroup.visible = true;
        Island.island.visible = true;
        Island.firecamp.visible = true;
        Island.tree.visible = true;
        Island.bush.visible = true;
        Island.bushRadio.visible = true;
        Island.bushRadio2.visible = true;
        Island.bushPug.visible = true;
        Fire.fire.visible = true;
        // Show procedural foliage on surface
        if (Island.proceduralGrassMesh) Island.proceduralGrassMesh.visible = true;

        Island.Update(false);
        Fire.Update();
        Fish.Update();
        Bubbles.Update(camera.position.y);
        UnderwaterParticles.Update(camera.position.y);
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

    // Fire shadow map throttle: its caster geometry is near-static (only the
    // slowly-breathing pug moves under the cone), so refresh it every 3rd frame
    // instead of every frame. ~66% fewer fire-shadow renders; the ~50ms latency
    // on the pug's warm contact shadow is imperceptible. autoUpdate is off on
    // this light (see Fire.ts), so it renders only on the frames flagged here.
    _fireShadowFrame = (_fireShadowFrame + 1) % FIRE_SHADOW_UPDATE_INTERVAL;
    Fire.fireShadowLight.shadow.needsUpdate = (_fireShadowFrame === 0);

    // Main WebGL render — single-pass: scene includes occluders (MeshBasicMaterial
    // with NoBlending punches transparent holes), matching henryjeff's architecture.
    // PostProcess.renderScene wraps renderer.render() with post-processing
    // (pixelation + underwater distortion).
    renderSceneFrame(isUnderwater);
    CloudSprites.Render(renderer, camera);

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

export function setDPR(maxDpr: number): void {
    const dpr = Math.min(window.devicePixelRatio, maxDpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Keep PostProcess framebuffer in sync with the new drawing-buffer size
    const buf = new Vector2();
    renderer.getDrawingBufferSize(buf);
    PostProcess.onResize(buf.x, buf.y);

    // Camera aspect shouldn't change (CSS size is the same), but projection
    // matrix must be current so the first frame after the switch is correct.
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
}

export function setShadowResolution(res: number): void {
    if (!directionalLight) return;
    directionalLight.shadow.mapSize.width = res;
    directionalLight.shadow.mapSize.height = res;
    if (directionalLight.shadow.map) {
        directionalLight.shadow.map.dispose();
        (directionalLight.shadow as any).map = null;
    }
    if ((directionalLight.shadow as any).mapPass) {
        (directionalLight.shadow as any).mapPass.dispose();
        (directionalLight.shadow as any).mapPass = null;
    }
    renderer.shadowMap.needsUpdate = true;
}

import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer, PCFSoftShadowMap, BasicShadowMap, PCFShadowMap, VSMShadowMap, Object3D, Quaternion, MeshLambertMaterial } from "three";
import { getIsUnderwater, isPugZoomActive, isRadioZoomActive, isRadioPugZoomSettling, isNoticeBoardZoomActive } from "./Control";
import * as Skybox from "../scene/Skybox";
import * as Ocean from "../scene/Ocean";
import * as SeaFloor from "../scene/SeaFloor";
import * as SeaFloorDecor from "../scene/SeaFloorDecor";
import * as Island from "../scene/Island";
import * as Fire from "../scene/Fire.ts";
import * as Fish from "../scene/Fish.ts";
import * as Audio from "./Audio.ts";
import * as MediaPlayer from "./MediaPlayer.ts";
import * as PostProcess from "../effects/PostProcess.ts";
import * as Bubbles from "../effects/Bubbles.ts";
import * as UnderwaterParticles from "../effects/UnderwaterParticles.ts";
import * as WindLines from "../effects/WindLines.ts";
import * as CloudSprites from "../effects/CloudSprites.ts";
import * as SceneDepth from "../effects/SceneDepth.ts";
import * as CardCarousel from "../effects/CardCarousel.ts";
import * as CSS3DPanel from "../effects/CSS3DPanel.ts";
import { sceneDepthUniform, updateSceneDepthCamera, edgeFoamIntensityUniform } from "../materials/OceanMaterial";
import { axes } from "./Debug.ts";
import { deltaTime } from "./Time.ts";
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer';
import * as PhoneScreen from './PhoneScreen';
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial";
import * as StutterProbe from './StutterProbe';

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
(window as any).__cam = camera;
(window as any).__diag = () => ({
    programs: renderer.info.programs?.length ?? 0,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    calls: renderer.info.render.calls,
    pointLights: scene.children.filter(c => (c as any).isPointLight).length,
    fish: Fish.getDiagState(),
});

/** Last DPR cap that was applied — setDPR has no getter, and devicePixelRatio is
 *  the device's, not the cap we asked for. Seeded to the constructor default
 *  below; the UI's quality preset overwrites it on startup. */
let _probeDpr = 1.5;

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

// ── Per-frame scratch for the render path ────────────────────────────────────
//
// Everything below exists to keep the underwater render path from ALLOCATING.
// It used to build, every single frame: two arrays of {obj, vis} literals (one
// per hidden target, one per scene child — dozens of objects), a Set, a couple
// of filter()/map() intermediates and a spread. Underwater that is a few
// hundred short-lived objects per frame, which is thousands per second, which
// is a garbage collection every few seconds — a pause that lands wherever it
// lands and reads as the scene stuttering for no reason. Above water most of
// this path is skipped, which is exactly why the stutter has always seemed to
// start at the waterline.
//
// Nothing about what gets rendered changes; only where the bookkeeping lives.

/** A save/restore of `visible` flags that reuses its storage. Parallel arrays
 *  rather than objects so nothing is allocated after the first few frames —
 *  the backing arrays grow to the high-water mark and stay there. */
class VisSnapshot {
    readonly objs: Object3D[] = [];
    readonly vis: boolean[] = [];
    n = 0;

    clear(): void { this.n = 0; }

    /** Record obj's current visibility and hide it. */
    hide(obj: Object3D): void {
        this.objs[this.n] = obj;
        this.vis[this.n] = obj.visible;
        this.n++;
        obj.visible = false;
    }

    /** Record obj's current visibility and set it to `v`. */
    set(obj: Object3D, v: boolean): void {
        this.objs[this.n] = obj;
        this.vis[this.n] = obj.visible;
        this.n++;
        obj.visible = v;
    }

    restore(): void {
        for (let i = 0; i < this.n; i++) this.objs[i].visible = this.vis[i];
        this.n = 0;
    }
}

/** Targets moved after the ocean pass (fish/bubbles/particles), hidden for the
 *  main render. Read back by renderOnlyUnderwaterTransparents to know which of
 *  them were actually visible. */
const _afterOceanVis = new VisSnapshot();
/** Heavy geometry hidden for the depth pre-pass. */
const _depthExcludedVis = new VisSnapshot();
/** Every scene child, for the underwater-transparents pass. */
const _childrenVis = new VisSnapshot();
/** The after-ocean target list, copied (never aliased — getUnderwaterTransparent-
 *  Targets rebuilds its own array later in the same frame). */
const _afterOceanTargets: Object3D[] = [];
const _bubbleTargets: Object3D[] = [];
const _targetSet = new Set<Object3D>();

// Fire shadow map refreshes every Nth frame (see throttle in Update).
// Re-rendering a shadow map means re-drawing every caster under the cone; every 6th
// frame (≈10fps shadow updates at 60fps) is imperceptible for a near-static
// caster (only the gently-breathing pug moves under the cone).
const FIRE_SHADOW_UPDATE_INTERVAL = isMobile ? 6 : 3;
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

import { defaultFov, defaultCameraX, defaultCameraZ } from '../scene/config/CameraConfig';
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
    CardCarousel.applyPixelSize(value);
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
    CardCarousel.applyColorFilter(filterStr);
}

function getUnderwaterTransparentTargets(): Object3D[] {
    _underwaterTransparentTargets.length = 0;
    _underwaterTransparentTargets.push(Fish.clownFish, Fish.doriFish, Fish.genericFishContainer);
    const bubbles = Bubbles.getRenderable();
    if (bubbles) _underwaterTransparentTargets.push(bubbles);
    const particles = UnderwaterParticles.getRenderable();
    if (particles) _underwaterTransparentTargets.push(particles);
    // The carousel's punch planes ride along too, and WHERE they land in this
    // pass is the whole reason the see-through cards work.
    //
    // Left in the main render they fire before this pass exists, dissolving a
    // framebuffer that holds only volume fog and sea floor — a flat blue field,
    // which is why partly punched ink used to be transparent onto nothing.
    //
    // In here, the split falls out of how three orders a render list. Opaque
    // materials always draw before transparent ones, and within the transparent
    // list add-order decides (sortObjects is false). Start() adds this group
    // BEFORE genericFishContainer, so:
    //
    //   opaque fish  → drawn first, already in the buffer, DIMMED into the card
    //                  when behind it; and when in front they wrote nearer depth,
    //                  so the punch is rejected and they stay crisp.
    //   punch planes → here.
    //   whale, jellyfish, bubbles, particles → drawn after, and depth-tested
    //                  against the depth the punch just wrote: behind the card
    //                  they are rejected, in front they draw at FULL strength.
    //
    // So nothing translucent is dimmed or erased by the punch — the earlier
    // attempt at this moved the group after the fish, which put the punch last
    // and cost exactly that. The only change is that opaque fish become visible
    // through the ink, which is the point.
    const carouselPunch = CardCarousel.getOccluderGroup();
    if (carouselPunch.visible) _underwaterTransparentTargets.push(carouselPunch);
    return _underwaterTransparentTargets;
}

// Bubbles alone — bright effect particles that must sit OVER the ocean surface
// as soon as the over/under line is on screen (so the semi-transparent surface
// doesn't paint over them), even while the camera is still above the waterline.
// Fish and ambient particles are intentionally NOT here: above water they read
// as underwater content seen THROUGH the surface and must stay in the main
// render so the surface shader blurs/tints them.
function getBubbleTargets(): Object3D[] {
    _bubbleTargets.length = 0;
    const bubbles = Bubbles.getRenderable();
    if (bubbles) _bubbleTargets.push(bubbles);
    return _bubbleTargets;
}

// Objects that are irrelevant to depth-intersection foam but expensive to draw
// a second time in the depth pre-pass. The foam only needs the depth of opaque
// geometry the ocean surface can graze (island, rocks, sea-floor decor).
//   - Procedural grass: the single heaviest geometry in the scene (one merged
//     mesh with a huge vertex count) and it sits entirely above the waterline,
//     so it never produces intersection foam.
//   - Grass shadow floor: flat disc above water, irrelevant.
//   - Skybox: covers the whole screen but reads as background (depth >= 0.9999)
//     anyway — the cleared depth target gives the identical result for free.
//   - Wind lines: thin above-water ribbons, irrelevant.
//   - Chest ray planes: decorative additive light beams (opacity driven by
//     a separate config, currently 0 / disabled), depthWrite:false in their
//     real material — but the override material ignores that, so left
//     unexcluded they render as opaque thin quads in the depth-only pass.
//     Never meant to interact with water, same category as wind lines.
//   - Fire (campfire flame sprite + embers): a Sprite only stays camera-
//     facing via billboard logic baked into SpriteMaterial's own shader,
//     which the depth override completely bypasses — it renders at its raw,
//     never-rotated local orientation (a flat quad, normal fixed along
//     world Z) instead of facing the camera. Edge-on from most angles, this
//     read as a thin flickering line in the iOS edge foam. Embers share the
//     same "override ignores the real material's transparency" risk.
// Skipping these in the depth-only pass is the bulk of the pre-pass cost.
function getDepthPrePassExcluded(): Object3D[] {
    _depthExcludedTargets.length = 0;
    if (Island.proceduralGrassMesh) _depthExcludedTargets.push(Island.proceduralGrassMesh);
    if (Island.grassShadowMesh)     _depthExcludedTargets.push(Island.grassShadowMesh);
    if (Skybox.skybox)              _depthExcludedTargets.push(Skybox.skybox);
    if (WindLines.windLinesGroup)   _depthExcludedTargets.push(WindLines.windLinesGroup);
    if (Island.getChestRayGroup())  _depthExcludedTargets.push(Island.getChestRayGroup()!);
    if (Fire.fire)                  _depthExcludedTargets.push(Fire.fire);
    // Card carousel punch planes: the override MeshDepthMaterial ignores their
    // per-pixel alpha discard, so left in they'd write the FULL card rects into
    // the foam depth target. They live deep underwater (y≈-6) but excluding
    // them is one push and removes the risk entirely.
    _depthExcludedTargets.push(CardCarousel.getOccluderGroup());
    _depthExcludedTargets.push(CSS3DPanel.getOccluderGroup());
    // Fish/jellyfish/bubbles/underwater particles must be kept out of the depth
    // pre-pass: the override MeshDepthMaterial forces depthWrite=true over their
    // own depthWrite=false, so they'd write into the foam depth target and paint
    // stray/flickering foam wherever one drifts. The after-ocean render path
    // (renderSceneFrame) only hides SOME of them SOME of the time, so exclude ALL
    // of them here unconditionally — this hide/restore is scoped tightly around
    // SceneDepth.capture() alone and doesn't interact with that render path.
    for (const t of getUnderwaterTransparentTargets()) _depthExcludedTargets.push(t);
    return _depthExcludedTargets;
}

function hideDepthPrePassExcluded(): void {
    _depthExcludedVis.clear();
    const excluded = getDepthPrePassExcluded();
    for (let i = 0; i < excluded.length; i++) {
        const obj = excluded[i];
        if (!obj.visible) continue; // already hidden by visibility gating — nothing to restore
        _depthExcludedVis.hide(obj);
    }
}

/** Re-render ONLY the after-ocean targets from _afterOceanVis — the ones that
 *  were visible before the main render hid them. */
function renderOnlyUnderwaterTransparents(): void {
    _targetSet.clear();
    for (let i = 0; i < _afterOceanVis.n; i++) {
        if (_afterOceanVis.vis[i]) _targetSet.add(_afterOceanVis.objs[i]);
    }
    if (_targetSet.size === 0) return;

    _childrenVis.clear();
    const children = scene.children;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        _childrenVis.set(child, (child as any).isLight === true || _targetSet.has(child));
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

    _childrenVis.restore();
}

function renderSceneFrame(deepUnderwater: boolean, effectOnScreen: boolean): void {
    // Choose which transparents get re-drawn AFTER the ocean surface (so it
    // doesn't paint over them). They're hidden here BEFORE the main render and
    // re-rendered in the afterBaseRender callback below.
    //  - camera truly underwater  → all of them (fish/particles/bubbles) sit
    //    clear on top; the volume fog would otherwise swallow them.
    //  - camera above water, over/under line on screen → ONLY bubbles. Fish and
    //    particles stay in the main render so the ocean surface shader blurs and
    //    tints them (they read as underwater content seen through the surface).
    //    Moving them after the surface here is what made their blur vanish
    //    mid-scroll. (All transparents are excluded from the depth pre-pass
    //    separately, via getDepthPrePassExcluded, so foam is unaffected either way.)
    //  - above-water effect sprites (radio music notes / pug sleep Zs) are ALWAYS
    //    moved after the surface: they float above the waterline near the radio/pug
    //    and read as foreground. Left in the main render, the surface shader blurs
    //    and tints them wherever the water sits behind them in screen space — the
    //    reported bug. getAboveWaterParticleTargets() returns [] while none are
    //    alive, so the extra pass is skipped when nothing is playing/sleeping.
    _afterOceanTargets.length = 0;
    if (deepUnderwater) {
        const t = getUnderwaterTransparentTargets();
        for (let i = 0; i < t.length; i++) _afterOceanTargets.push(t[i]);
    } else if (effectOnScreen) {
        const t = getBubbleTargets();
        for (let i = 0; i < t.length; i++) _afterOceanTargets.push(t[i]);
    }
    // COPIED, not aliased: getDepthPrePassExcluded() below rebuilds
    // _underwaterTransparentTargets in this same frame, which would rewrite the
    // list out from under us if this held a reference to it.
    const above = Island.getAboveWaterParticleTargets();
    for (let i = 0; i < above.length; i++) _afterOceanTargets.push(above[i]);

    _afterOceanVis.clear();
    for (let i = 0; i < _afterOceanTargets.length; i++) _afterOceanVis.hide(_afterOceanTargets[i]);

    // Pre-pass: capture opaque scene depth into SceneDepth's depth target so
    // the ocean shader can do depth-intersection foam in this frame. Must run
    // AFTER per-frame visibility gating (already set above us in Update) and
    // BEFORE the main scene render — the override material is a cheap
    // MeshDepthMaterial so the cost is just vertex pipeline + depth write.
    // Exclude foam-irrelevant heavy geometry (grass, skybox, wind lines) so the
    // pre-pass doesn't re-submit the scene's biggest vertex loads for nothing.
    //
    // Skip entirely when edge foam intensity is 0 (mobile/low quality default).
    // The depth texture keeps its last value; calcEdgeFoam() already returns 0
    // for all cleared (depth=1.0) pixels, so the visual result is identical and
    // we save a full scene re-render every frame. The underwater tint no longer
    // needs this depth — it is a pure screen-space over/under line (PostProcess.ts).
    const depthPassActive = (edgeFoamIntensityUniform.value as number) > 0;
    if (depthPassActive) {
        hideDepthPrePassExcluded();
        SceneDepth.capture(renderer, scene, camera);
        _depthExcludedVis.restore();
    }
    sceneDepthUniform.value = SceneDepth.getDepthTexture();
    updateSceneDepthCamera(camera);

    PostProcess.renderScene(renderer, scene, camera, () => {
        // Skip the ocean surface pass while sealed inside the cabana — the dome
        // hides it and the camera is above water, so it's pure waste.
        if (!Island.isCabanaSealed()) Ocean.RenderSurface(renderer, camera);
        if (_afterOceanVis.n > 0) {
            renderOnlyUnderwaterTransparents();
            _afterOceanVis.restore();
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
    // Both must be cleared — leaving mapPass causes size mismatch and shadows
    // disappear. PCF never allocates mapPass, but the switch back to VSM is one
    // runtime call away, so both are still cleared here.
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
    // PCF soft, not VSM.
    //
    // VSM gives the nicest edge in this scene — it is a real Gaussian blur — but
    // it pays for it twice over on every shadow update: the map is a float
    // target rather than a packed depth one, and three runs TWO extra full-screen
    // blur passes over it (horizontal + vertical, blurSamples taps each) for the
    // sun AND again for the campfire spot. On a phone that is the single most
    // expensive thing the renderer does for something the viewer reads as "the
    // palm casts a shadow".
    //
    // PCF-soft samples the depth map directly with a fixed kernel: no blur pass,
    // no float target, one draw per shadow map. The trade is a firmer, slightly
    // grainier shadow edge instead of a smooth falloff — accepted deliberately.
    // setShadowMapType() below still switches back at runtime if the edge turns
    // out to matter more than the frames.
    renderer.shadowMap.type = PCFSoftShadowMap;

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
    
    // Bias for PCF, which is the opposite sign convention to VSM's: VSM compares
    // depth moments and wants a positive nudge, PCF compares raw depth and a
    // positive one would push every caster off its own contact point (the
    // "floating object" look). normalBias does the work here instead — 0.05
    // world units is more than ten shadow texels at this map size, which is
    // plenty to clear acne without detaching anything.
    directionalLight.shadow.bias = 0.0;
    directionalLight.shadow.normalBias = 0.05;
    // radius/blurSamples are VSM-only knobs — PCF-soft uses a fixed kernel and
    // ignores them. Kept at their old values so switching the type back at
    // runtime restores exactly the previous look.
    directionalLight.shadow.radius = 4;
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
    scene.add(Island.noticeBoard);
    scene.add(Island.pictureFrame);
    scene.add(Island.sword);
    scene.add(Island.pug);
    scene.add(Island.tent);
    scene.add(Island.chest);
    // Above-water effect sprites (radio music notes / pug sleep Zs) — a top-level
    // group so renderSceneFrame can re-draw it after the ocean surface pass and
    // keep the semi-transparent water from blurring/tinting it.
    scene.add(Island.aboveWaterParticles);
    // Procedural grass/clover meshes are added directly to the scene by Island.ts
    // via threeScene.add() inside waitForIslandMeshes(). No polling needed.

    // Add fire effect to firecamp
    Fire.Start();
    Island.firecamp.add(Fire.fire);
    // Shadow spotlight lives in the scene (not inside fire group which is scaled 0.25x)
    // Both fire lights live at the scene ROOT so the light COUNT never changes
    // with the fire's visibility — see the note on Fire.fireLight.
    scene.add(Fire.fireLight);
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

    // CSS3D card carousel in the fish band. MUST be added to the scene BEFORE
    // genericFishContainer: sortObjects is false, so add-order decides the
    // transparent-pass draw order, and the depthWrite:false jellyfish need to
    // draw AFTER the carousel's punch planes to blend over the holes instead of
    // being erased by them.
    CardCarousel.Start(scene, cssScene);
    CardCarousel.applyPixelSize(pixelSizeValue);

    // In-scene CSS3D panels (media player + coin tooltips). Same add-before-fish
    // ordering rule as the carousel — the punch planes must precede the
    // depthWrite:false jellyfish in the transparent pass.
    CSS3DPanel.Start(scene, cssScene);

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

    // Frame-cost probe. Off unless ?probe=1 / __probe.enable() — see StutterProbe.
    // Started HERE, not at module scope: its A/B controls read module state
    // (_matMode, shadowsEnabled, cssRenderer) that is still in the temporal dead
    // zone while this module is evaluating, and a probe left enabled in
    // localStorage builds its overlay — and therefore reads them — immediately.
    //
    // The controls exist because 'paint' time covers both browser DOM work and
    // the GPU, and switching one suspect off is the only way to tell them apart
    // on a device with no WebGL timer queries (i.e. any iPhone).
    StutterProbe.Start(renderer, {
        materials: { get: () => _matMode,       set: (v) => setPropMaterials(v) },
        dpr:       { get: () => _probeDpr,      set: (v) => setDPR(v) },
        shadows:   { get: () => shadowsEnabled, set: (v) => setShadowsEnabled(v) },
        css3d:     { get: () => cssRenderer.domElement.style.display !== 'none',
                     set: (v) => { cssRenderer.domElement.style.display = v ? '' : 'none'; } },
    });

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
    // All props are now in the scene — apply the active material tier (e.g. the
    // 'low' Lambert swap) BEFORE the compile pass below, so the right materials
    // get warmed and the first visible frame is already correct.
    reapplyPropMaterials();
    // The prewarm renders frames without running Update(), so anything Update
    // normally keeps in sync has to be placed by hand first.
    Fire.syncLightPosition();
    Island.syncChestGlowLightPosition();
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

        // Page-open PARK pose: the intro now opens higher and steeper than the pose
        // above (introPreStartY=16.0, INTRO_PRE_TETHA_START=0.62 in Control.ts) and
        // eases down to introStartY as the loading blur clears. Warm that frustum too
        // so the very first sky/cloud frame the user sees on page open doesn't hitch.
        // Look direction = pitched up 0.62 rad toward -Z: forward ≈ (0, 0.581, -0.814).
        camera.position.set(-0.1, 16.0, 1.78);
        camera.lookAt(-0.1, 16.0 + 4.52, 1.78 - 6.33);
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
        // Same reason as the jellyfish: the anglerfish's lure light only exists
        // at night, so its lit fragment path has to be exercised here or the
        // first day→night flip compiles it mid-frame. The chest corridor below
        // renders exactly the region it illuminates.
        const restoreAnglerfishPrewarm = SeaFloorDecor.beginAnglerfishPrewarm();
        try {
            await prewarmDescent();
            await prewarmChestCorridor();

            // Park every pooled fish/jelly clone in-frustum so their per-instance GPU
            // buffers (geometry VBOs, skinned bone textures, cloned-material textures)
            // upload now instead of on the first dive/scroll. MUST run AFTER the chest
            // corridor: beginCreaturePrewarm points the camera at a deterministic
            // underwater pose and lays the grid out relative to it, and the corridor
            // above moves the camera — so parking has to be the last thing before the
            // warm render or the grid would sit off-frustum and never get drawn.
            const restoreCreaturePrewarm = Fish.beginCreaturePrewarm();
            try {
                // Exercise the full PostProcess pipeline (copyFramebufferToTexture +
                // distortion quad render) so the GPU path is warm before the user dives.
                // Without this the first real crossing of UNDERWATER_Y_THRESHOLD causes a
                // pipeline stall on the copyFramebufferToTexture call. The same render
                // draws the parked creature grid (via the underwater transparent pass),
                // forcing every clone's buffers to upload. PostProcess.renderScene() now
                // runs its quad pass unconditionally every frame, so no gate needs
                // faking here — this render already exercises the full pipeline.
                renderSceneFrame(true, true);
                renderer.getContext().finish();                         // ensure uploads complete before restore
            } finally {
                // Parking moved the clones (and acquired jelly PointLight intensity);
                // restore even if the warm render threw, or the fish/jelly stay frozen
                // mid-grid for the session.
                restoreCreaturePrewarm();
            }
        } finally {
            // The prewarm temporarily acquires PointLights from the pool. If the
            // GPU work above ever throws, the restore must still run — otherwise
            // leaked golden lights stay attached to the apples for the session.
            restoreJellyfishPrewarm();
            restoreAnglerfishPrewarm();
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

/**
 * Render the actual descent, once, on the loading screen.
 *
 * THIS IS THE HOLE THE PROBE FOUND. Everything else in the prewarm renders a
 * pose that is not the one the visitor is ever in: the surface passes look up
 * at the sky or across at the island, the chest corridor LOOKS AT THE CHEST
 * from three heights, and the creature grid stares at a parked formation. Real
 * play is none of those — the camera sits at the rest X/Z, level with the
 * horizon, and scrolls from the surface down to the sea floor looking straight
 * ahead. Anything that only ever enters THAT frustum was still uploading and
 * still compiling on first sight, mid-dive, which is exactly what the probe
 * caught: two shader compiles of 268ms and 292ms just under the waterline, and
 * a run of ~100ms geometry uploads between y −8 and y −11.
 *
 * So: walk the scroll range in the play pose and draw it. The ladder step is
 * well inside what one frustum covers vertically at these distances, so nothing
 * falls between two rungs.
 *
 * This costs LOADING TIME, not memory. Every byte drawn here was already in RAM
 * — the models all finished downloading before the prewarm starts. The only
 * thing that changes is WHEN it crosses to the GPU: during a loading screen
 * where a stall is invisible, instead of mid-dive where it is the whole
 * problem.
 *
 * Worth knowing when testing: browsers cache linked shader programs per origin
 * on disk, so a SECOND visit never shows the compile spikes whether or not this
 * function exists. Any before/after has to be done with the site's data cleared
 * or in a private window.
 */
async function prewarmDescent(): Promise<void> {
    // The scroll range, from Control.ts: aboveWaterTopY (1.4) down to
    // underwaterBottomY (−12).
    const TOP = 1.4;
    const BOTTOM = -12;
    const STEP = 1.8;

    let lastPrograms = renderer.info.programs?.length ?? 0;

    for (let y = TOP; y >= BOTTOM - 0.001; y -= STEP) {
        camera.position.set(defaultCameraX, y, defaultCameraZ);
        camera.lookAt(defaultCameraX, y, defaultCameraZ - 6);   // level, straight ahead
        camera.updateProjectionMatrix();

        // Materials are traversed whole by compile(), so this is only about
        // catching a variant that this pose's light/shadow state produces.
        // Cheap on a cache hit, which is what it is after the first rung.
        renderer.compile(scene, camera);
        const programs = renderer.info.programs?.length ?? 0;
        if (programs > lastPrograms && typeof (renderer as any).compileAsync === 'function') {
            // Only await when something actually had to be built — awaiting on
            // every rung would add a round trip per rung for nothing.
            await (renderer as any).compileAsync(scene, camera);
            lastPrograms = renderer.info.programs?.length ?? programs;
        }

        // Drawing is the part that varies with the pose: programs are shared,
        // but a geometry's buffers and a texture's bytes only cross to the GPU
        // when the thing is actually rendered in-frustum.
        const under = y < 0;
        renderSceneFrame(under, true);
    }

    renderer.getContext().finish();
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
        renderSceneFrame(camera.position.y < 0, camera.position.y < 0);
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
            if (SeaFloorDecor.isLoaded() && Fish.isReady() && Island.coinsReady()) {
                resolve();
            } else if (performance.now() - startedAt >= PREWARM_MODEL_WAIT_TIMEOUT_MS) {
                console.warn(
                    '[Scene] Prewarm proceeding before all underwater models were ready ' +
                    `(timed out after ${PREWARM_MODEL_WAIT_TIMEOUT_MS}ms). ` +
                    `SeaFloorDecor.isLoaded=${SeaFloorDecor.isLoaded()} Fish.isReady=${Fish.isReady()} ` +
                    `Island.coinsReady=${Island.coinsReady()}`,
                );
                resolve();
            } else {
                setTimeout(check, 50);
            }
        })();
    });
}

// Prop material tier. The 'low' graphics tier swaps the island + decor props
// from MeshStandardMaterial (PBR + realtime lights — the confirmed mobile
// bottleneck) to a cheap MeshLambertMaterial, live. 'standard' restores the
// originals.
type MatMode = 'standard' | 'lambert';
let _matMode: MatMode = 'standard';

function _matRoots(): Array<Object3D | null | undefined> {
    return [
        Island.firecamp, Island.tree, Island.bush, Island.bushRadio, Island.bushRadio2, Island.bushPug,
        Island.radio, Island.noticeBoard, Island.pictureFrame, Island.sword, Island.pug, Island.dogBed,
        Island.apple1, Island.apple2, Island.apple3,
        Island.mossRock1, Island.mossRock2a, Island.mossRock2b, Island.mossRock3a, Island.mossRock3b, Island.mossRock3c,
        Island.tent, Island.chest,
        Island.foldingTrayTable, Island.tentDogBed, Island.rugRound, Island.lantern, Island.dogBowl, Island.dogBiscuit, Island.phone,
        SeaFloorDecor.decorGroup,
    ];
}

// Build a Lambert clone of one source material, preserving texture/transparency
// and the injected shader (ocean fog / kelp sway / bush wind) by copying
// onBeforeCompile — the same string-replace targets exist in the Lambert shader,
// so the injection compiles identically; only the costly PBR/specular lighting
// model is dropped.
function _lambertClone(src: any): any {
    const c: any = new MeshLambertMaterial();
    if (src.map) c.map = src.map;
    if (src.color && c.color) c.color.copy(src.color);
    c.transparent = src.transparent;
    c.opacity = src.opacity;
    c.alphaTest = src.alphaTest;
    c.side = src.side;
    c.depthWrite = src.depthWrite;
    c.vertexColors = src.vertexColors;
    c.onBeforeCompile = src.onBeforeCompile;
    c.customProgramCacheKey = src.customProgramCacheKey;
    c.needsUpdate = true;
    return c;
}

function _lambertFor(o: any): any {
    if (!o.userData.__lambertMat) {
        const orig = o.userData.__origMat;
        o.userData.__lambertMat = Array.isArray(orig)
            ? orig.map((m: any) => _lambertClone(m))
            : _lambertClone(orig);
    }
    return o.userData.__lambertMat;
}

function _applyMatMode(mode: MatMode): void {
    for (const root of _matRoots()) {
        if (!root) continue;
        root.traverse((o: any) => {
            if (!o.isMesh) return;
            if (mode === 'standard') {
                if (o.userData.__origMat) o.material = o.userData.__origMat;
                return;
            }
            // Only swap the expensive PBR materials. Intentional unlit effects
            // (chest light rays, glows — MeshBasicMaterial with additive blending)
            // must keep their original material, or they'd render wrong.
            const cur = o.userData.__origMat ?? o.material;
            const isPBR = Array.isArray(cur)
                ? cur.some((m: any) => m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)
                : (cur.isMeshStandardMaterial || cur.isMeshPhysicalMaterial);
            if (!isPBR) return;
            if (!o.userData.__origMat) o.userData.__origMat = o.material;
            o.material = _lambertFor(o);
        });
    }
}

/** Production entry: set the prop material tier ('low' → 'lambert', else 'standard'). */
export function setPropMaterials(mode: MatMode): void {
    _matMode = mode;
    _applyMatMode(_matMode);
}

/** Re-apply the current prop material tier — call after async model loads so
 *  late-arriving props (decor, island GLBs) pick up the active mode. */
export function reapplyPropMaterials(): void {
    _applyMatMode(_matMode);
}

export function Update(): void
{
    // Skip all rendering during the loading screen — nothing is visible anyway
    // (camera parked at introStartY, WebGL canvas behind the loading overlay).
    // This frees the GPU entirely for model downloads and decoding.
    if (!_sceneReady) return;
    StutterProbe.beginFrame();
    StutterProbe.section('world');

    const isUnderwater = getIsUnderwater();

    Skybox.Update();
    CloudSprites.Update(camera.position.y, deltaTime, Skybox.getDayNightBlend());
    Ocean.Update();
    Audio.Update(camera.position.y);
    // UI.Update() is NOT called here. main.ts already drives it once per frame,
    // after Control.Update(), and running it from here as well ran the whole UI
    // pass twice per frame. That doubled the settings FPS readout (it counts its
    // own invocations) and made the surface-crossing detection below read a
    // camera position from before Control moved it, since this runs first.
    MediaPlayer.Update();
    PostProcess.updateCameraProjectionUniforms(camera);
    // Disable the screen-space underwater effect while a prop zoom reframes the
    // camera (radio/pug), and keep it disabled through the zoom-out transition
    // (isRadioPugZoomSettling) until the camera has fully eased back to its
    // default pose. The over/under line assumes a level scroll camera, so a zoom
    // (or its return trip) would smear the tint/distortion across dry land — and
    // you can never see below the ocean line during any of that anyway.
    PostProcess.setUnderwaterEffectEnabled(!(isRadioZoomActive() || isPugZoomActive() || isNoticeBoardZoomActive() || isRadioPugZoomSettling()));

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
        Bubbles.Update();
        UnderwaterParticles.Update(camera.position.y);
        // Always tick Island.Update underwater — chest open/close animations,
        // glow fade-out, coin springs, and pug all depend on it. Wind, radio,
        // pug-mixer, and music-note work is skipped once the camera has sunk
        // well past the surface (see SURFACE_ANIM_FREEZE_Y in Island.ts).
        Island.Update();
        Fire.Update();
    } else {
        // Show surface, hide underwater.
        // When sealed inside the cabana, the reverse dome hides the outside world,
        // so we also stop rendering it entirely (the big perf win). The interior
        // (tent, lazy-loaded props, dome) stays visible — handled by
        // Island.Update. Un-sealing flips this back the same frame (instant return).
        const cabanaSealed = Island.isCabanaSealed();
        const showOutside = !cabanaSealed;
        SeaFloor.setVisible(false);
        SeaFloorDecor.decorGroup.visible = false;
        Fish.setCameraVisibility(false, Island.getLowestY());
        WindLines.windLinesGroup.visible = showOutside && !isPugZoomActive();
        Skybox.skybox.visible = showOutside;
        Island.island.visible = showOutside;
        Island.firecamp.visible = showOutside;
        Island.tree.visible = showOutside;
        Island.bush.visible = showOutside;
        Island.bushRadio.visible = showOutside;
        Island.bushRadio2.visible = showOutside;
        Island.bushPug.visible = showOutside;
        Island.radio.visible = showOutside;
        Island.noticeBoard.visible = showOutside;
        Island.pictureFrame.visible = showOutside;
        Island.sword.visible = showOutside;
        Island.pug.visible = showOutside;
        Island.dogBed.visible = showOutside;
        Island.apple1.visible = showOutside;
        Island.apple2.visible = showOutside;
        Island.apple3.visible = showOutside;
        Island.mossRock1.visible = showOutside;
        Island.mossRock2a.visible = showOutside;
        Island.mossRock2b.visible = showOutside;
        Island.mossRock3a.visible = showOutside;
        Island.mossRock3b.visible = showOutside;
        Island.mossRock3c.visible = showOutside;
        Fire.fire.visible = showOutside;
        // Show procedural foliage on surface
        if (Island.proceduralGrassMesh) Island.proceduralGrassMesh.visible = showOutside;
        if (Island.grassShadowMesh)     Island.grassShadowMesh.visible     = showOutside;

        Island.Update();
        Fire.Update();
        Fish.Update();
        Bubbles.Update();
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
    StutterProbe.section('css3d');
    PhoneScreen.preRender(Island.phone, camera);
    // Card carousel: advance the track, sync DOM + punch-mesh transforms and
    // update the post-process distortion quiet rect — also pre-render work.
    CardCarousel.Update();
    // In-scene panels: billboard, advance open animation, sync punch holes —
    // must run BEFORE the WebGL render so the holes are correct this frame.
    CSS3DPanel.preRender(camera);

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
    //
    // Two gates (see renderSceneFrame): fish/particles render after the ocean
    // surface only once the camera is truly underwater (isUnderwater, y<0) so the
    // surface keeps blurring them while viewed from above; bubbles render after
    // the surface as soon as the over/under line is on screen — the same gate
    // they spawn on — so the surface never paints over them.
    const underwaterEffectOnScreen = PostProcess.getLineNdcY(camera.position.y) > -1.0;
    StutterProbe.section('render');
    renderSceneFrame(isUnderwater, underwaterEffectOnScreen);
    // Clouds are sky-only — skip them while sealed inside the cabana.
    if (!Island.isCabanaSealed()) CloudSprites.Render(renderer, camera);

    // Debug axes
    renderer.autoClearColor = false;
    renderer.render(axes, staticCamera);
    renderer.autoClearColor = true;

    // Pointer-events + CSS3D update
    StutterProbe.section('css3d');
    PhoneScreen.render(camera);
    // In-scene panels claim the canvas pointer-events last (after PhoneScreen,
    // the other writer) so a visible modal panel receives clicks.
    CSS3DPanel.syncCanvasPointer();

    // Single CSS3D render using the scaled CSS camera
    cssRenderer.render(cssScene, cssCamera);

    // Wind lines 3D update — moves ribbon meshes and updates vertex positions
    StutterProbe.section('world');
    WindLines.Update(deltaTime, camera.position.x, camera.position.y, camera.position.z, camera.fov);

    // Close the probe's frame — must be after every render call above, so the
    // draw-call and upload counters cover the whole frame.
    StutterProbe.endFrame(camera, isUnderwater);
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
    _probeDpr = maxDpr;
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

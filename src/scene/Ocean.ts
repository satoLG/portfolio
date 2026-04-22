import { BufferAttribute, BufferGeometry, Mesh, PlaneGeometry, Raycaster, Vector2 } from "three";
import * as oceanMaterials from "../materials/OceanMaterial";
import { camera } from "../core/Scene";
import { deltaTime } from "../core/Time";
import * as Audio from "../core/Audio";
import { isPugZoomActive, isRadioZoomActive } from "../core/Control";
import { island, firecamp, tree, radio, sword, pug, tent, dogBed, phone } from "./Island";

// All solid island objects that should occlude ripple clicks.
// Built lazily so we never hold stale references.
const _islandBlockers = () => [island, firecamp, tree, radio, sword, pug, tent, dogBed, phone];

export const surface = new Mesh();
export const volume = new Mesh();

const oceanWidth = 400;
const oceanDepth = 400;
const oceanVolumeDepth = 100;

// Ripple interaction
const raycaster = new Raycaster();
const mouse = new Vector2();
let isEnabled = false;

// Local multi-touch tracker — mirrors Island.ts logic so 2-finger scroll
// lifts never accidentally spawn a ripple.
let _touchWasMulti = false;

function setupMultiTouchTracker(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('touchstart', (e: TouchEvent) => {
        if (e.touches.length >= 2) _touchWasMulti = true;
    }, { passive: true });
    canvas.addEventListener('touchend', (e: TouchEvent) => {
        if (e.touches.length === 0) _touchWasMulti = false;
    }, { passive: true });
}

export function Start(): void
{
    oceanMaterials.Start();

    // Reduced from 512x512 to 256x256 for better mobile performance (4x fewer vertices)
    const surfaceGeometry = new PlaneGeometry(oceanWidth, oceanDepth, 256, 256);
    surfaceGeometry.rotateX(-Math.PI / 2);

    surface.geometry = surfaceGeometry;
    surface.material = oceanMaterials.surface;
    surface.receiveShadow = false;  // Custom shader doesn't support shadows

    const halfWidth = oceanWidth / 2;
    const halfDepth = oceanDepth / 2;

    const volumeVertices = new Float32Array([
        -halfWidth, -oceanVolumeDepth, -halfDepth,
        halfWidth, -oceanVolumeDepth, -halfDepth,
        -halfWidth, -oceanVolumeDepth, halfDepth,
        halfWidth, -oceanVolumeDepth, halfDepth,

        -halfWidth, 0, -halfDepth,
        halfWidth, 0, -halfDepth,
        -halfWidth, 0, halfDepth,
        halfWidth, 0, halfDepth
    ]);

    const volumeIndices = [
        2, 3, 0, 3, 1, 0,
        0, 1, 4, 1, 5, 4,
        1, 3, 5, 3, 7, 5,
        3, 2, 7, 2, 6, 7,
        2, 0, 6, 0, 4, 6
    ];

    const volumeGeometry = new BufferGeometry();
    volumeGeometry.setAttribute("position", new BufferAttribute(volumeVertices, 3));
    volumeGeometry.setIndex(volumeIndices);

    volume.geometry = volumeGeometry;
    volume.material = oceanMaterials.volume;

    volume.parent = surface;
    surface.add(volume);
    
    surface.position.set(0, 0, -halfDepth);
    
    // Setup ripple interaction
    setupRippleInteraction();
}

function setupRippleInteraction(): void {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    setupMultiTouchTracker(canvas as HTMLCanvasElement);

    const onInteraction = (clientX: number, clientY: number) => {
        if (!isEnabled || !camera) return;
        // Suppress during model zoom — camera is not pointed at the ocean
        if (isPugZoomActive() || isRadioZoomActive()) return;

        mouse.x = (clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(clientY / window.innerHeight) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);

        // Cast directly against the ocean surface mesh — the ONLY object that matters.
        // Scanning scene.children (the old approach) lets any scene geometry that
        // happens to intersect the ray before y=0 block the click silently.
        // Wind-line meshes float at y=0.75–3.55 (between camera and ocean surface)
        // and are the confirmed culprit for intermittent failures.
        // By querying the surface mesh directly we bypass every possible blocker.
        const surfaceHits = raycaster.intersectObject(surface, false);
        if (surfaceHits.length === 0) return;  // Ray missed ocean entirely (clicked sky / horizon)

        const hit = surfaceHits[0];

        // ── Island occlusion check ─────────────────────────────────────────────
        // If any solid island geometry intersects the ray closer than the ocean
        // surface, the user clicked "through" the island — skip the ripple.
        const blockers = _islandBlockers().filter(g => g.children.length > 0);
        if (blockers.length > 0) {
            const islandHits = raycaster.intersectObjects(blockers, true);
            if (islandHits.length > 0 && islandHits[0].distance < hit.distance) return;
        }

        // ── Far-distance limit ─────────────────────────────────────────────────
        const dx = hit.point.x - camera.position.x;
        const dz = hit.point.z - camera.position.z;
        const maxDist = oceanMaterials.rippleMaxClickDistance;
        if (dx * dx + dz * dz > maxDist * maxDist) return;

        oceanMaterials.addRipple(hit.point.x, hit.point.z);
        Audio.playWaterSplash();
    };

    // Mouse click
    canvas.addEventListener('click', (event: MouseEvent) => {
        onInteraction(event.clientX, event.clientY);
    });

    // Touch — prevent synthetic click; gate on single-finger gestures only
    canvas.addEventListener('touchend', (event: TouchEvent) => {
        event.preventDefault();
        if (_touchWasMulti) return;
        if (event.changedTouches.length > 0) {
            const touch = event.changedTouches[0];
            onInteraction(touch.clientX, touch.clientY);
        }
    });

    isEnabled = true;
}

/**
 * Rebuild the ocean surface geometry at a new subdivision level.
 * @param segs  Width and height segment count (64 = low quality, 256 = high quality).
 */
export function setOceanSegments(segs: 64 | 128 | 256): void {
    const old = surface.geometry;
    const geo = new PlaneGeometry(oceanWidth, oceanDepth, segs, segs);
    geo.rotateX(-Math.PI / 2);
    surface.geometry = geo;
    old.dispose();
}

export function Update(): void
{   
    // Update ripples
    oceanMaterials.updateRipples(deltaTime);
}

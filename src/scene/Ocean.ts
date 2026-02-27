import { BufferAttribute, BufferGeometry, Mesh, PlaneGeometry, Raycaster, Vector2 } from "three";
import * as oceanMaterials from "../materials/OceanMaterial";
import { camera, scene } from "../scripts/Scene";
import { deltaTime } from "../scripts/Time";
import * as Audio from "../scripts/Audio";
import { isPugZoomActive, isRadioZoomActive } from "../scripts/Control";

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

        // Single-pass: walk the sorted hit list and determine what the ray hits first.
        // • Sprites (music notes, Z particles) are transparent overlays — skip them.
        // • The ocean volume backdrop is a non-surface ocean mesh — skip it.
        // • First remaining hit that is `surface` → ripple allowed.
        // • First remaining hit that is anything else → blocked by geometry.
        const allIntersects = raycaster.intersectObjects(scene.children, true);

        for (const hit of allIntersects) {
            const obj = hit.object;
            // Skip transparent overlays and the ocean volume side-box
            if ((obj as any).isSprite) continue;
            if (obj === volume) continue;

            if (obj === surface) {
                // Ocean surface is the first solid hit — spawn ripple
                oceanMaterials.addRipple(hit.point.x, hit.point.z);
                Audio.playWaterSplash();
            }
            // Whether it was surface or a blocker, stop scanning
            break;
        }
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

export function Update(): void
{   
    // Update ripples
    oceanMaterials.updateRipples(deltaTime);
}

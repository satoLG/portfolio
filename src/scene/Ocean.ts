import { BufferAttribute, BufferGeometry, Mesh, PlaneGeometry, Raycaster, Vector2 } from "three";
import * as oceanMaterials from "../materials/OceanMaterial";
import { camera, scene } from "../scripts/Scene";
import { deltaTime } from "../scripts/Time";
import * as Audio from "../scripts/Audio";

export const surface = new Mesh();
export const volume = new Mesh();

const oceanWidth = 400;
const oceanDepth = 400;
const oceanVolumeDepth = 100;

// Ripple interaction
const raycaster = new Raycaster();
const mouse = new Vector2();
let isEnabled = false;

export function Start(): void
{
    oceanMaterials.Start();

    const surfaceGeometry = new PlaneGeometry(oceanWidth, oceanDepth, 512, 512);
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
    
    const onInteraction = (clientX: number, clientY: number) => {
        if (!isEnabled) return;
        
        mouse.x = (clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(clientY / window.innerHeight) * 2 + 1;
        
        raycaster.setFromCamera(mouse, camera);
        
        // Check all objects in the scene to see what was clicked
        const allIntersects = raycaster.intersectObjects(scene.children, true);
        
        if (allIntersects.length > 0) {
            // Get the first (closest) object that was hit
            const firstHit = allIntersects[0];
            
            // Check if the first hit is the ocean surface (not island or other objects)
            // We need to traverse up to find if it's the ocean surface mesh
            let hitObject = firstHit.object;
            let isOceanSurface = false;
            
            // Check if the hit object is the ocean surface or its child
            while (hitObject) {
                if (hitObject === surface) {
                    isOceanSurface = true;
                    break;
                }
                hitObject = hitObject.parent as any;
            }
            
            // Only create ripple if we actually hit the ocean surface (not blocked by island)
            if (isOceanSurface) {
                const point = firstHit.point;
                oceanMaterials.addRipple(point.x, point.z);
                Audio.playWaterSplash();
            }
        }
    };
    
    // Mouse events
    canvas.addEventListener('click', (event: MouseEvent) => {
        onInteraction(event.clientX, event.clientY);
    });
    
    // Touch events
    canvas.addEventListener('touchend', (event: TouchEvent) => {
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

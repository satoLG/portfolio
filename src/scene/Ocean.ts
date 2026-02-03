import { BufferAttribute, BufferGeometry, Mesh, PlaneGeometry } from "three";
import * as oceanMaterials from "../materials/OceanMaterial";

export const surface = new Mesh();
export const volume = new Mesh();

const oceanWidth = 400;
const oceanDepth = 400;
const oceanVolumeDepth = 100;

export function Start(): void
{
    oceanMaterials.Start();

    const surfaceGeometry = new PlaneGeometry(oceanWidth, oceanDepth, 512, 512);
    surfaceGeometry.rotateX(-Math.PI / 2);

    surface.geometry = surfaceGeometry;
    surface.material = oceanMaterials.surface;
    surface.receiveShadow = false;  // No shadows on ocean

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
}

export function Update(): void
{   
    // Ocean is static
}

import { BufferAttribute, BufferGeometry, MathUtils, Mesh, Vector2 } from "three";
import * as oceanMaterials from "../materials/OceanMaterial";
import { Random } from "../utils/Random";
import { camera } from "../core/Scene";

const tilesPerAxis = 13;
const tileSize = 32;
const tilesRadius = MathUtils.clamp(4, 1, tilesPerAxis / 2);
const tileSize1 = tileSize + 1;
const worldSize = tilesPerAxis * tileSize;
const worldSize1 = worldSize + 1;
const scale = 1;
const halfSize = tilesPerAxis * tileSize * 0.5 * scale;

const floorOffsetX = 0;
const floorOffsetZ = -200;

const base1 = new Vector2(0.05, 0.05);
const base2 = new Vector2(0.05, 0.05);
const base3 = new Vector2(0.05, 0.05);

const erosion = { x: 0.0, y: 0.0, z: 0.0 };

const hill = new Vector2(0.0, 0);

const reliefPoints = [
    0, 0,
    0.12, 0,
    0.25, 0.5,
    0.35, 0.5,
    0.45, 0.75,
    0.5, 0.75,
    0.7, 1,
    1, 1,
];

const random = new Random();

const offsets = new Float64Array(12);
for (let i = 0; i < offsets.length; i++)
{
    offsets[i] = random.Next();
}

function CubicInterpolation(a: number, b: number, t: number): number
{
    t = t * t * t * (t * (t * 6 - 15) + 10);
    return (1 - t) * a + t * b;
}

function SampleHeight(x: number, y: number): number
{
    let h = reliefPoints[0] * base1.y - base1.y;

    x += offsets[0];
    y += offsets[1];
    let t = random.Perlin(x * base1.x, y * base1.x) * 0.5 + 0.5;

    x += offsets[2];
    y += offsets[3];
    t += (random.Perlin(x * base2.x, y * base2.x) * 0.5 + 0.5) * base2.y;

    x += offsets[4];
    y += offsets[5];
    t += (random.Perlin(x * base3.x, y * base3.x) * 0.5 + 0.5) * base3.y;

    t /= 1 + base2.y + base3.y;

    for (let i = 2; i < reliefPoints.length; i += 2)
    {
        if (t <= reliefPoints[i])
        {
            h = CubicInterpolation(reliefPoints[i - 1], reliefPoints[i + 1], MathUtils.mapLinear(t, reliefPoints[i - 2], reliefPoints[i], 0, 1)) * base1.y - base1.y;
            break;
        }
    }

    x += offsets[6];
    y += offsets[7];
    let e = random.Perlin(x * erosion.x, y * erosion.x) * 0.5;

    x += offsets[6];
    y += offsets[7];
    e = Math.max(e - (random.Perlin(x * erosion.y, y * erosion.y) * 0.5 + 0.5) * erosion.z, 0);

    x += offsets[10];
    y += offsets[11];
    h += (random.Perlin(x * hill.x, y * hill.x) * 0.5 + 0.5) * e * hill.y - hill.y * 0.3;
    
    return h;
}

export const borderRadius = halfSize - tilesRadius * tileSize;

export const tiles = new Array<Mesh>(tilesPerAxis * tilesPerAxis);

export function Start(): void
{   
    const heights = new Float32Array(worldSize1 * worldSize1);

    const worldVertices = new Float32Array(heights.length * 3);
    const worldIndices = new Array(worldSize * worldSize * 6);

    for (let z = 0; z < worldSize1; z++)
    {
        for (let x = 0; x < worldSize1; x++)
        {
            const i = (z * worldSize1 + x) * 3;
            worldVertices[i] = x;
            worldVertices[i + 1] = SampleHeight(x, z);
            worldVertices[i + 2] = z;

            heights[z * worldSize1 + x] = worldVertices[i + 1];
        }
    }

    for (let z = 0; z < worldSize; z++)
    {
        for (let x = 0; x < worldSize; x++)
        {
            const v = z * worldSize1 + x;
            const i = (z * worldSize + x) * 6;

            if ((x % 2 == 0 && z % 2 == 0) || (x % 2 == 1 && z % 2 == 1))
            {
                worldIndices[i] = v + worldSize1 + 1;
                worldIndices[i + 1] = v + 1;
                worldIndices[i + 2] = v;

                worldIndices[i + 3] = v;
                worldIndices[i + 4] = v + worldSize1;
                worldIndices[i + 5] = v + worldSize1 + 1;
            }
            else
            {
                worldIndices[i] = v + worldSize1;
                worldIndices[i + 1] = v + 1;
                worldIndices[i + 2] = v;

                worldIndices[i + 3] = v + worldSize1;
                worldIndices[i + 4] = v + worldSize1 + 1;
                worldIndices[i + 5] = v + 1;
            }
        }
    }

    const worldGeometry = new BufferGeometry();
    worldGeometry.setAttribute("position", new BufferAttribute(worldVertices, 3));
    worldGeometry.setIndex(worldIndices);
    worldGeometry.computeVertexNormals();
    const worldNormals = worldGeometry.getAttribute("normal").array;

    const indices = new Array(tileSize * tileSize * 6);

    for (let z = 0; z < tileSize; z++)
    {
        for (let x = 0; x < tileSize; x++)
        {
            const v = z * tileSize1 + x;
            const i = (z * tileSize + x) * 6;

            if ((x % 2 == 0 && z % 2 == 0) || (x % 2 == 1 && z % 2 == 1))
            {
                indices[i] = v + tileSize1 + 1;
                indices[i + 1] = v + 1;
                indices[i + 2] = v;

                indices[i + 3] = v;
                indices[i + 4] = v + tileSize1;
                indices[i + 5] = v + tileSize1 + 1;
            }
            else
            {
                indices[i] = v + tileSize1;
                indices[i + 1] = v + 1;
                indices[i + 2] = v;

                indices[i + 3] = v + tileSize1;
                indices[i + 4] = v + tileSize1 + 1;
                indices[i + 5] = v + 1;
            }
        }
    }

    for (let tileZ = 0; tileZ < tilesPerAxis; tileZ++)
    {
        for (let tileX = 0; tileX < tilesPerAxis; tileX++)
        {
            const vertices = new Float32Array(tileSize1 * tileSize1 * 3);
            const normals = new Float32Array(vertices.length);

            for (let z = 0; z < tileSize1; z++)
            {
                for (let x = 0; x < tileSize1; x++)
                {
                    const i = (z * tileSize1 + x) * 3;
                    const worldX = x + tileX * tileSize;
                    const worldZ = z + tileZ * tileSize;

                    vertices[i] = (worldX - halfSize) * scale + floorOffsetX;
                    vertices[i + 1] = heights[worldZ * worldSize1 + worldX] * scale - 10;
                    vertices[i + 2] = (worldZ - halfSize) * scale + floorOffsetZ;

                    const j = ((tileZ * tileSize + z) * worldSize1 + tileX * tileSize + x) * 3;

                    normals[i] = worldNormals[j];
                    normals[i + 1] = worldNormals[j + 1];
                    normals[i + 2] = worldNormals[j + 2];
                }
            }

            const geometry = new BufferGeometry();
            geometry.setAttribute("position", new BufferAttribute(vertices, 3));
            geometry.setIndex(indices);
            geometry.setAttribute("normal", new BufferAttribute(normals, 3));

            const mesh = new Mesh();
            mesh.geometry = geometry;
            mesh.material = oceanMaterials.triplanar;
            mesh.visible = false;

            tiles[tileZ * tilesPerAxis + tileX] = mesh;

            // Pre-compute tile centre for distance culling
            const centerX = ((tileX * tileSize + tileSize * 0.5) - halfSize) * scale + floorOffsetX;
            const centerZ = ((tileZ * tileSize + tileSize * 0.5) - halfSize) * scale + floorOffsetZ;
            tileCenters[tileZ * tilesPerAxis + tileX] = { x: centerX, z: centerZ };
        }
    }
}

// Pre-computed tile centres for distance culling
const tileCenters: { x: number; z: number }[] = [];
const CULL_DISTANCE_SQ = 150 * 150; // tiles beyond 150 units from camera are hidden

const lastTilesIndices = new Array<number>();
let floorEnabled = false;

export function Update(): void
{
    // Distance-based tile culling — only show tiles near the camera
    if (!floorEnabled) return;

    const cx = camera.position.x;
    const cz = camera.position.z;
    lastTilesIndices.length = 0;
    for (let i = 0; i < tiles.length; i++) {
        const tc = tileCenters[i];
        const dx = tc.x - cx;
        const dz = tc.z - cz;
        const distSq = dx * dx + dz * dz;
        const vis = distSq < CULL_DISTANCE_SQ;
        if (tiles[i].visible !== vis) tiles[i].visible = vis;
        if (vis) lastTilesIndices.push(i);
    }
}

/** Toggle visibility of all sea floor tiles (GPU-side culling for surface/underwater gating). */
export function setVisible(visible: boolean): void {
    if (floorEnabled === visible) return;
    floorEnabled = visible;

    if (!visible) {
        for (let i = 0; i < tiles.length; i++) {
            if (tiles[i].visible) tiles[i].visible = false;
        }
    }
}

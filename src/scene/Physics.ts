/**
 * Physics — cannon-es physics world for falling apples.
 *
 * Creates a lightweight physics world with static Trimesh collision bodies
 * built from the island surface (and optionally the palm trunk).
 * Dynamic sphere bodies are added when apples detach from the tree.
 *
 * The world is only stepped while at least one apple is in-flight,
 * so idle overhead is zero.
 */

import { World, Body, Sphere, Trimesh, Vec3, Material, ContactMaterial, SAPBroadphase, GSSolver } from 'cannon-es';
import CannonDebugger from 'cannon-es-debugger';
import { Mesh, Vector3, BufferGeometry, Scene, Group } from 'three';
import {
    GRAVITY, SUBSTEPS, SAFETY_PLANE_Y,
    APPLE_BODY_Y_OFFSET, APPLE_MASS, LINEAR_DAMPING, ANGULAR_DAMPING,
    SPHERE_RADIUS, SPHERE_SPREAD, SPHERE_Y_TOP, SPHERE_Y_BOTTOM,
    FRICTION, RESTITUTION, SLEEP_SPEED_LIMIT, SLEEP_TIME_LIMIT,
    TREE_TRUNK_MAX_Y,
} from './config/Physics/AppleConfig';

// ── Mutable runtime config (seeded from PhysicsConfig, tweakable via GUI) ────
export const physicsConfig = {
    gravity:          GRAVITY,
    appleBodyYOffset: APPLE_BODY_Y_OFFSET,
    appleMass:        APPLE_MASS,
    linearDamping:    LINEAR_DAMPING,
    angularDamping:   ANGULAR_DAMPING,
    // Compound corner spheres
    sphereRadius: SPHERE_RADIUS,
    sphereSpread: SPHERE_SPREAD,
    sphereYTop:   SPHERE_Y_TOP,
    sphereYBottom: SPHERE_Y_BOTTOM,
    friction:         FRICTION,
    restitution:      RESTITUTION,
    sleepSpeedLimit:  SLEEP_SPEED_LIMIT,
    sleepTimeLimit:   SLEEP_TIME_LIMIT,
    safetyPlaneY:     SAFETY_PLANE_Y,
    substeps:         SUBSTEPS,
    treeTrunkMaxY:    TREE_TRUNK_MAX_Y,
};

// ── World ────────────────────────────────────────────────────────────────────
let world: World | null = null;
const appleBodies: Body[] = [];
const pooledAppleBodies: Body[] = [];
let activeCount = 0;

const groundMat = new Material('ground');
const appleMat  = new Material('apple');
let contactMaterial: ContactMaterial | null = null;

// ── Debugger wireframe ───────────────────────────────────────────────────────
let debugger_: { update: () => void } | null = null;
let debugEnabled = false;
let _debugGroup: Group | null = null;
let _debugScene: Scene | null = null;

export function setDebugEnabled(on: boolean, threeScene?: Scene): void {
    debugEnabled = on;
    if (on && world && threeScene) {
        // Create a dedicated group so we can nuke it cleanly
        _debugScene = threeScene;
        _debugGroup = new Group();
        _debugGroup.name = '__cannonDebug';
        threeScene.add(_debugGroup);
        debugger_ = CannonDebugger(_debugGroup as any, world, { color: 0x00ff00, scale: 1 });
    }
    if (!on) {
        if (_debugGroup && _debugScene) {
            _debugScene.remove(_debugGroup);
        }
        _debugGroup = null;
        debugger_ = null;
    }
}

export function updateDebugger(): void {
    if (debugEnabled && debugger_) debugger_.update();
}

// ── Cached source meshes for rebuild ─────────────────────────────────────────
let _islandMeshes: Mesh[] = [];
let _treeMeshes: Mesh[] = [];
let _extraStaticMeshes: Mesh[] = [];

// ── Init ─────────────────────────────────────────────────────────────────────
export function initPhysicsWorld(islandMeshes: Mesh[], treeTrunkMeshes: Mesh[] = []): void {
    _islandMeshes = islandMeshes;
    _treeMeshes   = treeTrunkMeshes;
    rebuildPhysicsWorld();
}

/** Register tree trunk meshes (call when tree finishes loading, triggers rebuild). */
export function registerTreeMeshes(meshes: Mesh[]): void {
    _treeMeshes = meshes;
    if (world) rebuildPhysicsWorld();
}

/** Register additional static meshes like radio, sword, etc. (triggers rebuild). */
export function registerExtraStaticMeshes(meshes: Mesh[]): void {
    _extraStaticMeshes.push(...meshes);
    if (world) rebuildPhysicsWorld();
}

/** Rebuild the entire physics world (called on init and when collider params change). */
export function rebuildPhysicsWorld(): void {
    // Preserve active apple bodies
    const savedBodies = appleBodies.slice();

    world = new World();
    world.gravity.set(0, physicsConfig.gravity, 0);
    world.broadphase = new SAPBroadphase(world);
    (world.solver as GSSolver).iterations = 20;
    world.allowSleep = true;

    contactMaterial = new ContactMaterial(groundMat, appleMat, {
        friction: physicsConfig.friction,
        restitution: physicsConfig.restitution,
    });
    world.addContactMaterial(contactMaterial);

    // Island + tree trunk + extra static trimesh colliders
    for (const mesh of _islandMeshes) addStaticTrimesh(mesh);
    for (const mesh of _treeMeshes)   addStaticTrimesh(mesh, physicsConfig.treeTrunkMaxY);
    for (const mesh of _extraStaticMeshes) addStaticTrimesh(mesh);

    // Re-add any active apple bodies
    for (const body of savedBodies) world.addBody(body);

    // Re-create debugger if it was active so it points at the new world
    if (debugEnabled && _debugScene) {
        // Remove old debug group
        if (_debugGroup) _debugScene.remove(_debugGroup);
        _debugGroup = new Group();
        _debugGroup.name = '__cannonDebug';
        _debugScene.add(_debugGroup);
        debugger_ = CannonDebugger(_debugGroup as any, world, { color: 0x00ff00, scale: 1 });
    } else {
        debugger_ = null;
    }
}

export function getWorld(): World | null { return world; }

// ── Static trimesh from a Three.js Mesh ──────────────────────────────────────
function addStaticTrimesh(mesh: Mesh, maxY?: number): void {
    if (!world) return;
    const geom = mesh.geometry as BufferGeometry;
    if (!geom || !geom.attributes.position) return;

    mesh.updateMatrixWorld(true);
    const mat4 = mesh.matrixWorld;

    const posAttr = geom.attributes.position;
    const vertexCount = posAttr.count;
    const allVerts = new Float64Array(vertexCount * 3);
    const v = new Vector3();

    for (let i = 0; i < vertexCount; i++) {
        v.fromBufferAttribute(posAttr, i);
        v.applyMatrix4(mat4);
        allVerts[i * 3]     = v.x;
        allVerts[i * 3 + 1] = v.y;
        allVerts[i * 3 + 2] = v.z;
    }

    let srcIndices: number[];
    if (geom.index) {
        const idxArr = geom.index.array;
        srcIndices = new Array(idxArr.length);
        for (let i = 0; i < idxArr.length; i++) srcIndices[i] = idxArr[i];
    } else {
        srcIndices = new Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) srcIndices[i] = i;
    }

    // Optional Y filter — only keep triangles where ALL 3 vertices are below maxY
    if (maxY !== undefined) {
        const filteredIndices: number[] = [];
        for (let i = 0; i < srcIndices.length; i += 3) {
            const a = srcIndices[i], b = srcIndices[i + 1], c = srcIndices[i + 2];
            if (allVerts[a * 3 + 1] <= maxY &&
                allVerts[b * 3 + 1] <= maxY &&
                allVerts[c * 3 + 1] <= maxY) {
                filteredIndices.push(a, b, c);
            }
        }
        if (filteredIndices.length === 0) return; // nothing below cutoff
        srcIndices = filteredIndices;
    }

    const shape = new Trimesh(Array.from(allVerts), srcIndices);
    shape.updateNormals();
    shape.updateEdges();
    shape.updateTree();
    const body = new Body({ mass: 0, material: groundMat });
    body.addShape(shape);
    body.updateAABB();
    body.updateBoundingRadius();
    world.addBody(body);
}

// ── Add dynamic apple body ───────────────────────────────────────────────────
function createAppleBody(worldPos: Vector3): Body {
    const body = new Body({
        mass: physicsConfig.appleMass,
        material: appleMat,
        position: new Vec3(worldPos.x, worldPos.y + physicsConfig.appleBodyYOffset, worldPos.z),
        linearDamping: physicsConfig.linearDamping,
        angularDamping: physicsConfig.angularDamping,
    });
    const r = physicsConfig.sphereRadius;
    const s = physicsConfig.sphereSpread;
    const yT = physicsConfig.sphereYTop;
    const yB = physicsConfig.sphereYBottom;
    // 4 corners: top-front-left, top-back-right, bottom-front-right, bottom-back-left
    body.addShape(new Sphere(r), new Vec3(-s, yT, -s));
    body.addShape(new Sphere(r), new Vec3( s, yT,  s));
    body.addShape(new Sphere(r), new Vec3( s, yB, -s));
    body.addShape(new Sphere(r), new Vec3(-s, yB,  s));

    body.sleepSpeedLimit = physicsConfig.sleepSpeedLimit;
    body.sleepTimeLimit  = physicsConfig.sleepTimeLimit;
    body.addEventListener('collide', () => {
        const owner = (body as any).__groundApple as { landed: boolean } | null | undefined;
        if (owner) owner.landed = true;
    });
    return body;
}

function resetAppleBody(body: Body, worldPos: Vector3): void {
    body.mass = physicsConfig.appleMass;
    body.material = appleMat;
    body.position.set(worldPos.x, worldPos.y + physicsConfig.appleBodyYOffset, worldPos.z);
    body.quaternion.set(0, 0, 0, 1);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.force.setZero();
    body.torque.setZero();
    body.linearDamping = physicsConfig.linearDamping;
    body.angularDamping = physicsConfig.angularDamping;
    body.sleepSpeedLimit = physicsConfig.sleepSpeedLimit;
    body.sleepTimeLimit = physicsConfig.sleepTimeLimit;
    body.wakeUp();
    body.updateAABB();
    body.updateBoundingRadius();
}

export function initAppleBodyPool(size: number): void {
    while (pooledAppleBodies.length < size) {
        const body = createAppleBody(new Vector3(0, physicsConfig.safetyPlaneY, 0));
        body.sleep();
        pooledAppleBodies.push(body);
    }
}

export function acquireAppleBody(worldPos: Vector3): Body {
    if (!world) throw new Error('Physics world not initialized');

    const body = pooledAppleBodies.pop() ?? createAppleBody(worldPos);
    resetAppleBody(body, worldPos);

    world.addBody(body);
    appleBodies.push(body);
    activeCount++;
    return body;
}

export function addAppleBody(worldPos: Vector3): Body {
    return acquireAppleBody(worldPos);
}

// ── Remove an apple body ─────────────────────────────────────────────────────
export function removeAppleBody(body: Body): void {
    if (!world) return;
    world.removeBody(body);
    const idx = appleBodies.indexOf(body);
    if (idx >= 0) { appleBodies.splice(idx, 1); activeCount--; }
    (body as any).__groundApple = null;
    body.sleep();
    pooledAppleBodies.push(body);
}

// ── Step ─────────────────────────────────────────────────────────────────────
export function stepPhysics(dt: number): void {
    if (!world || activeCount <= 0) return;
    world.gravity.set(0, physicsConfig.gravity, 0);
    world.step(1 / 120, dt, physicsConfig.substeps);

    // Safety catch: if any apple falls below safetyPlaneY, freeze it in place
    for (const body of appleBodies) {
        if (body.position.y < physicsConfig.safetyPlaneY) {
            body.velocity.setZero();
            body.angularVelocity.setZero();
            body.position.y = physicsConfig.safetyPlaneY;
            body.sleep();
        }
    }
}

// ── Query ────────────────────────────────────────────────────────────────────
export function hasActiveBodies(): boolean { return activeCount > 0; }

// ── Live-update contact material from config ─────────────────────────────────
export function refreshContactMaterial(): void {
    if (!contactMaterial) return;
    contactMaterial.friction = physicsConfig.friction;
    contactMaterial.restitution = physicsConfig.restitution;
}

// -- Contact normals for a specific body (from the most recent step) ----------
/**
 * Returns outward-pointing surface normals that are pushing against `body`.
 * Uses `world.contacts` which are populated after each `world.step()`.
 * The returned normals point AWAY from the colliding surface, toward the body.
 */
export function getBodyContactNormals(body: Body): { nx: number; ny: number; nz: number }[] {
    if (!world) return [];
    const normals: { nx: number; ny: number; nz: number }[] = [];
    for (const eq of world.contacts) {
        if (eq.bi === body) {
            // ni points from bi (apple) to bj (surface) -- outward normal is -ni
            normals.push({ nx: -eq.ni.x, ny: -eq.ni.y, nz: -eq.ni.z });
        } else if (eq.bj === body) {
            // ni points from bi (surface) to bj (apple) -- outward normal is +ni
            normals.push({ nx: eq.ni.x, ny: eq.ni.y, nz: eq.ni.z });
        }
    }
    return normals;
}

// -- Inspect a body's deepest overlap and average outward normal --------------
const _penPi = new Vec3();
const _penPj = new Vec3();
const _penDiff = new Vec3();
/**
 * Scans `world.contacts` for any contact where `body` is interpenetrating with
 * the other body and returns the deepest overlap, plus a unit vector pointing
 * AWAY from the surfaces (averaged across all such contacts).
 * Returns null if the body is not overlapping anything.
 *
 * The caller decides what to do — nothing for transient overlaps that cannon-es
 * will resolve on its own, or a fling for sustained overlaps that mean the body
 * is genuinely stuck.
 */
export function getBodyMaxPenetration(body: Body): {
    depth: number; nx: number; ny: number; nz: number;
} | null {
    if (!world) return null;
    let maxDepth = 0;
    let avgX = 0, avgY = 0, avgZ = 0;
    let count = 0;
    for (const eq of world.contacts) {
        const isI = eq.bi === body;
        const isJ = eq.bj === body;
        if (!isI && !isJ) continue;
        eq.bi.position.vadd(eq.ri, _penPi);
        eq.bj.position.vadd(eq.rj, _penPj);
        _penPj.vsub(_penPi, _penDiff);
        const gap = _penDiff.dot(eq.ni);  // ni points from bi to bj
        if (gap >= 0) continue;
        const d = -gap;
        if (d > maxDepth) maxDepth = d;
        // Outward normal for `body` (away from the surface).
        const ox = isI ? -eq.ni.x : eq.ni.x;
        const oy = isI ? -eq.ni.y : eq.ni.y;
        const oz = isI ? -eq.ni.z : eq.ni.z;
        avgX += ox; avgY += oy; avgZ += oz;
        count++;
    }
    if (count === 0) return null;
    const len = Math.sqrt(avgX * avgX + avgY * avgY + avgZ * avgZ) || 1;
    return { depth: maxDepth, nx: avgX / len, ny: avgY / len, nz: avgZ / len };
}
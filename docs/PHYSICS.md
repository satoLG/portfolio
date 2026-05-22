# Physics

cannon-es physics world. Single concern: apples falling from the tree onto the island.
Everything else (pug walk, fish swimming, fire flicker) is procedural — no physics.

Source: [src/scene/Physics.ts](src/scene/Physics.ts). Config: [src/scene/config/Physics/AppleConfig.ts](src/scene/config/Physics/AppleConfig.ts).

---

## World

```
World
  ├─ gravity (0, -9.82, 0)               configurable via debug GUI
  ├─ broadphase: SAPBroadphase
  ├─ solver: GSSolver, 20 iterations
  ├─ allowSleep: true
  ├─ contactMaterial(ground ↔ apple)     friction + restitution from config
  ├─ Static bodies (mass=0, Trimesh)
  │     ├─ island meshes                 (full mesh, no Y filter)
  │     ├─ tree trunk meshes             (Y-filtered to ≤ TREE_TRUNK_MAX_Y)
  │     └─ extra static (radio, sword)
  └─ Dynamic bodies (mass=APPLE_MASS, compound 4 spheres)
        ├─ pooled                        — sleep when removed, reused on next acquire
        └─ active                        — counted via activeCount
```

**Step gate:** `stepPhysics()` returns immediately if `activeCount === 0`. Idle scenes pay zero physics cost.

**Safety plane:** apples that fall through (numerical error) get frozen at `safetyPlaneY` and put to sleep.

---

## Collider strategy

| Body | Shape | Why |
|---|---|---|
| Island | `Trimesh` from full island mesh, transformed to world space | One-time cost, exact shape. Trimesh-vs-Sphere is valid. |
| Tree trunk | `Trimesh` filtered to vertices below `TREE_TRUNK_MAX_Y` | Canopy collision would trap apples mid-leaf. Filter keeps only trunk geometry. |
| Apple | Compound of 4 `Sphere` shapes at corners | Single sphere rolls forever (smooth → no rolling friction grip); 4-sphere "cube of spheres" tumbles realistically without the cost of a Trimesh. |

**Trimesh-vs-Trimesh is invalid in cannon-es.** Don't ever give the apple a Trimesh shape — apple-vs-island would silently miss collisions.

---

## Lifecycle

```
GLB loads
  ↓
initPhysicsWorld(islandMeshes)         called from Island.ts on island load
  ↓
registerTreeMeshes(treeTrunkMeshes)    triggers rebuild
  ↓
registerExtraStaticMeshes(...)         triggers rebuild
  ↓
initAppleBodyPool(N)                   pre-creates N sleeping bodies
  ↓
acquireAppleBody(worldPos)             pops from pool (or creates), wakes, adds to world
  ↓                                    activeCount++
... per-frame stepPhysics(dt) ...
  ↓
removeAppleBody(body)                  removes from world, sleeps, returns to pool
                                       activeCount--
```

`rebuildPhysicsWorld()` tears down and recreates the world from cached `_islandMeshes` / `_treeMeshes` / `_extraStaticMeshes`. Preserves active apple bodies by saving + re-adding. Called by:
- Initial mesh registration (after each `registerX`)
- Debug GUI changes to friction / restitution / gravity / collider params

**Expensive** — `Trimesh` rebuild is O(verts). Never call per-frame.

---

## Apple body shape

```
4 spheres at (±s, yT/yB, ±s):
  (-s, yT, -s)  top-front-left
  ( s, yT,  s)  top-back-right
  ( s, yB, -s)  bottom-front-right
  (-s, yB,  s)  bottom-back-left
```

Yields tumbling behavior with cheap collision math. Sphere radius, spread, and Y-offsets are all tunable from the debug GUI.

---

## Debugging

```ts
import { setDebugEnabled, updateDebugger } from './scene/Physics';

setDebugEnabled(true, scene);  // adds green wireframes
// in your Update loop:
updateDebugger();
```

Available from the IslandDebug "Physics" panel (press H). Toggling the checkbox rebuilds the cannon-es-debugger against the current world.

---

## Contact normal queries

Two helpers exposed for the apple landing/wobble logic:
- `getBodyContactNormals(body)` — outward normals of all current contacts.
- `getBodyMaxPenetration(body)` — deepest interpenetration depth + averaged outward direction. Returns null when not penetrating.

Used by Island.ts to:
- Detect "landed" state (collide event sets `__groundApple.landed = true`)
- Unstick apples wedged in geometry (sustained overlap → applied fling)

---

## Performance notes

- **Pooling matters.** `createAppleBody` allocates Three.js `Vec3`, `Sphere`s, contact callbacks. Pool keeps GC quiet.
- **Sleep aggressively.** Lower `sleepSpeedLimit` / `sleepTimeLimit` → faster park. Sleeping bodies are skipped entirely by the solver.
- **20 solver iterations** is high. Could be lowered (5-10) if you don't care about stable stacking — but the falling apple needs decent contact resolution against the island Trimesh, so it's worth the cost.
- **Substeps:** `world.step(1/120, dt, SUBSTEPS)` — fixed timestep 1/120s with `SUBSTEPS` clamping makes physics frame-rate-independent.

---

## When to rebuild vs patch

- **Rebuild** (entire world recreated): collider params change, friction change, tree mesh re-registered.
- **Don't try to "patch" individual static bodies.** The codebase never removes a single static body — always full rebuild. Trying to do otherwise risks stale references in the SAPBroadphase tree.

# Portfolio — Claude Briefing

A Three.js WebGL portfolio rendered as a floating island scene. Everything lives in one WebGL canvas — no React, no UI framework. The "UI" is DOM elements positioned over the canvas.

---

## Stack

| Tool | Version | Role |
|------|---------|------|
| Three.js | 0.183 | 3D rendering |
| TypeScript | 5.2 | Language |
| Vite | 5 | Build + HMR (port 3000) |
| cannon-es | 0.20 | Physics (apple falling) |
| lil-gui | 0.21 | Runtime debug panel (press H) |
| wavesurfer.js | 7 | Audio visualization (radio) |
| vite-plugin-glsl | 1.5 | Import `.glsl`/`.vert`/`.frag` as strings |

**Build:** `tsc && vite build` — typechecks first, then bundles.
**Dev:** `npm run dev` — HMR on port 3000.

---

## Source layout

```
src/
  main.ts               ← entry point, wires up all modules
  scripts/              ← engine modules (Scene, Time, Input, Control, Audio, Dialog, UI, Debug, IslandDebug, i18n, MediaPlayer, PhoneScreen, CoinTooltip)
  scene/                ← 3D scene components (Island, Ocean, Fire, Fish, Skybox, ProceduralGrass, ApplePhysics, SeaFloor, SeaFloorDecor)
  scene/config/         ← generated config files (IslandConfig.ts, OceanConfig.ts, CameraConfig.ts, Physics/AppleConfig.ts)
  materials/            ← custom ShaderMaterial definitions (OceanMaterial.ts, SkyboxMaterial.ts)
  effects/              ← post-processing & FX (PostProcess, Bubbles, Clouds, WindLines, UnderwaterParticles, FoamMask)
  shaders/              ← raw GLSL exported as TS strings (OceanShaders.ts, SkyboxShader.ts, Settings.ts)
  types/                ← TypeScript .d.ts (shaders.d.ts)

public/
  models/surface/       ← GLB models placed on the island
  models/underwater/    ← coral, fish, kelp GLBs
  models/character/     ← pug.glb (has animation clips), seagull.glb
  models/overall/       ← chest, coin, heart, phone, etc.
  audio/                ← Web Audio assets (character/, music/, nature/, overall/, ui/)
  images/               ← textures (.webp) — water normals, sand, noise, music icons
```

---

## Main loop

```
main.ts
  └─ requestAnimationFrame(UpdateFrame)
       TIME.Update()      ← clock tick, deltaTime, timeUniform
       SCENE.Update()     ← render + subsystem updates
       INPUT.Update()     ← keyboard/mouse/touch
       CONTROL.Update()   ← camera state
       UI.Update()        ← DOM sync
       DEBUG.Update()     ← perf stats
```

**Time:** `src/scripts/Time.ts` — exports `time` (elapsed seconds), `deltaTime` (seconds/frame), `timeUniform` (Three.js `Uniform`, shared into shaders directly).

---

## Scene architecture

`src/scripts/Scene.ts` creates the renderer, camera, and lights, then calls `Update()` on all major subsystems each frame.

**Renderer:** `WebGLRenderer` + `CSS3DRenderer` side by side (CSS3D is for the phone overlay only).

**Lights:** `AmbientLight` + `DirectionalLight`. The directional light position is synced each frame to the skybox sun direction via `lightUniform` (a `Uniform<Vector3>` shared into shaders).

**Visibility gating:** Every frame, the scene checks if the camera is underwater. If yes, surface objects hide and underwater objects show — and vice versa. This is the main performance gate.

**Shadow maps:** VSMShadowMap by default. Resolution: 512px mobile, 1024px desktop. Configurable at runtime via IslandDebug.

**Post-processing:** Not EffectComposer. Main scene renders to a `FramebufferTexture`, then a second pass draws it through a custom fullscreen ShaderMaterial (underwater distortion + optional pixelation). Lives in `src/effects/PostProcess.ts`.

---

## Island.ts — the main scene file

`src/scene/Island.ts` is the largest file. It:
- Exports all scene Group objects: `island`, `firecamp`, `tree`, `radio`, `sword`, `pug`, `tent`, `dogBed`, `littleRocks`, `phone`, `chest`, `apple1/2/3`, `proceduralGrassMesh`, `grassShadowMesh`
- Exports `clusterMainPatches`, `clusterTreePatches`, `clusterCloverPatches` (foliage patch lists)
- Exports `exclRadii` (live exclusion radii, mutated by debug GUI)
- `Start()` — loads all GLB models via GLTFLoader, inits physics, spawns grass
- `Update(isUnderwater: boolean)` — per-frame: apple sway, physics sync, pug animations, music notes, chest, radio bounce, wind uniforms

**Model loading pattern:**
```ts
loader.load('models/surface/foo.glb', (gltf) => {
    applyOceanLightingToModel(gltf.scene);  // or applyTreeWindShader
    gltf.scene.traverse(child => { child.castShadow = true; });
    fooGroup.add(gltf.scene);
    fooGroup.position.set(...);
    fooGroup.scale.setScalar(fooScale);
}, undefined, (err) => console.error(err));
```

---

## Config system

Config values are **not hardcoded in Island.ts** — they live in generated files:

| File | What's in it |
|------|-------------|
| `src/scene/config/IslandConfig.ts` | Positions, scales, rotations, foliage params, exclusion radii, fire light, phone screen settings |
| `src/scene/config/Physics/AppleConfig.ts` | Gravity, apple mass, friction, restitution, sleep limits, tree trunk Y cutoff |
| `src/scene/config/OceanConfig.ts` | Wave velocities, normal map scale, foam params |
| `src/scene/config/CameraConfig.ts` | FOV, zoom distances, transition speeds |

**Workflow:** Adjust a slider in the debug GUI (press H) → values update live → press "Copy Config" button → paste the generated file content back into the config file. Never hardcode magic numbers in scene files.

---

## Shader patterns

### onBeforeCompile injection

All island models use `MeshStandardMaterial` with `onBeforeCompile` to inject custom vertex and fragment code without writing a full custom shader:

```ts
mat.customProgramCacheKey = () => 'unique_key';  // REQUIRED — prevents cache collision
mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMyUniform = myUniform;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
        #include <common>
        uniform float uMyUniform;
        varying vec3 vWorldPosition;
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `
        #include <worldpos_vertex>
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('...', '...');
};
mat.needsUpdate = true;
```

**`customProgramCacheKey` is mandatory** whenever using `onBeforeCompile`. Without it, Three.js may reuse a cached shader program from another material, silently breaking both.

### Shared uniforms

Uniforms are defined once in a central place and passed by reference into shaders:

```ts
// In OceanMaterial.ts:
export const oceanAbsorptionUniform = new Uniform(new Vector3(...));

// In Island.ts shader injection:
shader.uniforms.uAbsorption = oceanAbsorptionUniform;  // same object, no copy
```

Updating `oceanAbsorptionUniform.value` from anywhere propagates to all materials that reference it — no `material.uniforms.x.value` scattered everywhere.

### Wind shader (tree)

`applyTreeWindShader()` in Island.ts — injected into every mesh of the tree model. Key uniforms:
- `treeWindTimeUniform` — accumulated time (driven by `time * TREE_WIND_SPEED` or breeze system)
- `treeWindStrengthUniform` — amplitude (0 = no sway, ~0.03 normal)
- `treeLeafStartYUniform` / `treeLeafFullYUniform` — Y range where sway kicks in (local coords)

Cache key: `'tree_wind'`. The shader uses `smoothstep(uLeafStartY, uLeafFullY, position.y)` so only the upper canopy sways.

### Full custom ShaderMaterial

Used for Ocean and Skybox — written from scratch, not injected into PBR:

```ts
new ShaderMaterial({
    uniforms: { uTime: timeUniform, ... },
    vertexShader: oceanVertShader,    // imported from src/shaders/
    fragmentShader: oceanFragShader,
    transparent: true,
    depthWrite: false,
});
```

---

## Physics (cannon-es)

`src/scene/ApplePhysics.ts`:

- **World:** gravity -9.82, SAPBroadphase, GSSolver 20 iterations, `allowSleep = true`
- **Island collider:** static `Trimesh` built from island mesh vertices (transformed to world space)
- **Tree collider:** optional static Trimesh, filtered to geometry below `TREE_TRUNK_MAX_Y` (so only the trunk has collision, not the whole canopy)
- **Apple body:** 4 corner spheres (compound shape), mass 0.15 kg
- **Step gate:** `stepPhysics()` returns early if `activeCount === 0` — zero overhead when idle
- **Debug:** `CannonDebugger` renders green wireframes when toggled in IslandDebug

**Rebuilding:** `rebuildPhysicsWorld()` tears down and recreates the entire world. Called when apple/friction params change in the debug GUI. Existing apple bodies are preserved and re-added.

**Registration order:**
1. `initPhysicsWorld(islandMeshes)` — called when island GLB finishes loading
2. `registerTreeMeshes(treeTrunkMeshes)` — called when tree GLB finishes loading (triggers rebuild)
3. `registerExtraStaticMeshes(meshes)` — for radio, sword, etc.

---

## Procedural grass

`src/scene/ProceduralGrass.ts` — generates all grass in **one draw call** using a merged BufferGeometry.

- Spawn points are raycasted onto the island surface mesh to get correct Y
- Each blade gets a random rotation, scale, and edge-falloff factor baked into its vertices
- Wind animation via Perlin noise `DataTexture` + vertex shader injection
- Mouse interaction: raycasts per frame → `mouseWorldPos` uniform → blades near mouse tip toward camera
- Shadow floor: a separate flat disc geometry (one draw call) renders a dark AO shadow below all grass
- Exclusion zones: each island object has an `exclRadii` entry — blades too close to an object are discarded at spawn time

---

## Naming conventions

**Variables:**
- `_prefixedWithUnderscore` — module-private, not exported
- `SCREAMING_SNAKE_CASE` — constants (config values, physics params, shader thresholds)
- `camelCase` — everything else (uniforms, groups, functions, state)

**Uniforms:** always a Three.js `Uniform` instance, named `xyzUniform` (e.g. `timeUniform`, `oceanAbsorptionUniform`)

**Config exports:** match the variable name used in Island.ts exactly — they're imported directly. E.g. `export const treeOffset = ...` → `import { treeOffset } from './config/IslandConfig'`.

**Files:** PascalCase for major scene/script modules (`Island.ts`, `OceanMaterial.ts`), lowercase for small utilities (`Time.ts`, `Audio.ts`). Config files go in `scene/config/`.

---

## Debug GUI (IslandDebug.ts)

Press **H** to toggle. Panels:
- **Island Objects** — position/scale/rotation per model (updates live)
- **Foliage** — grass count, exclusion radii, wind, shadow floor, edge falloff
- **Ocean** — wave velocity, foam, ripple params
- **Underwater Effects** — distortion, FOV
- **Physics** — gravity, apple params, debug wireframe
- **Lighting** — shadow type/resolution/bias, light intensity
- **Camera** — FOV, zoom speeds
- **Copy IslandConfig.ts / Copy AppleConfig.ts** buttons — generates and copies the full config file to clipboard for pasting back in

---

## Mobile

- Detected via `userAgent + window.innerWidth < 768`
- Lower defaults: no shadows, no antialias, no pixelation, DPR capped at 1.5
- Touch input in `Input.ts` — 2-finger scroll tracked separately to prevent accidental ripples

---

## Key gotchas

- **Always set `customProgramCacheKey`** when using `onBeforeCompile`. Skipping it causes random shader corruption across materials.
- **Config files are generated** — don't hand-edit magic numbers in `IslandConfig.ts` or `AppleConfig.ts`. Use the debug GUI sliders and copy the output.
- **`rebuildPhysicsWorld()` is expensive** — only call it in response to GUI changes, never per-frame.
- **`mat.needsUpdate = true`** must be set after changing `onBeforeCompile` or `customProgramCacheKey`, otherwise Three.js won't recompile.
- **Uniform sharing** — always pass uniforms by reference (`shader.uniforms.x = sharedUniform`), not by value. Copying breaks the live-update chain.
- **`alphaTest` vs `transparent`** — tree leaves use `alphaTest = 0.5` + `transparent = false` so they write to the depth buffer and don't get occluded by the ocean surface when viewed from underwater.
- **`DoubleSide`** on ocean and grass — always, or backfaces disappear when camera is below the island.
- **Physics world is rebuilt, not patched** — all static colliders are re-added from scratch on rebuild. Don't try to remove individual bodies; just rebuild.
- **`clusterTreePatches` / `clusterMainPatches`** — kept only for IslandDebug backward compat. They're Group arrays that used to hold foliage clusters; now procedural grass replaced them but the exports remain.

# Portfolio — Claude Briefing

A Three.js WebGL portfolio rendered as a floating island scene. Everything lives in one WebGL canvas — no React, no UI framework. The "UI" is DOM elements positioned over the canvas.

## Further reading

This file is the high-level map. Topic-specific docs (load only when relevant):
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module graph, render pipeline, visibility gating, prewarm
- [docs/SHADERS.md](docs/SHADERS.md) — onBeforeCompile contract, cache-key registry, uniform sharing rules
- [docs/PHYSICS.md](docs/PHYSICS.md) — cannon-es world, collider strategy, body lifecycle
- [docs/ASSETS.md](docs/ASSETS.md) — model/texture loading patterns, optimization plan
- [src/UNIFORMS.md](src/UNIFORMS.md) — every shared Uniform, who owns it, who reads it
- [public/models/MANIFEST.md](public/models/MANIFEST.md) — per-GLB table: path, role, size, load site

Folder-scoped guidance auto-loads when you touch files in that folder:
- [src/core/CLAUDE.md](src/core/CLAUDE.md), [src/scene/CLAUDE.md](src/scene/CLAUDE.md),
  [src/effects/CLAUDE.md](src/effects/CLAUDE.md), [src/materials/CLAUDE.md](src/materials/CLAUDE.md)

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
  core/                 ← engine modules (Scene, Time, Input, Control, Audio, Dialog, UI, Debug,
  |                        i18n, MediaPlayer, PhoneScreen, CoinTooltip)
  scene/                ← 3D scene components (Island, Ocean, Fire, Fish, Skybox, ProceduralGrass,
  |                        Physics, SeaFloor, SeaFloorDecor)
  scene/config/         ← generated config files (IslandConfig.ts, OceanConfig.ts, CameraConfig.ts,
  |                        PhoneConfig.ts, SeaFloorConfig.ts, SkyConfig.ts, Physics/AppleConfig.ts)
  materials/            ← custom ShaderMaterial definitions (OceanMaterial.ts, SkyboxMaterial.ts)
  effects/              ← post-processing & FX (PostProcess, Bubbles, CloudSprites, WindLines,
  |                        UnderwaterParticles, FoamMask, WelcomeText)
  shaders/              ← raw GLSL exported as TS strings (OceanShaders.ts, SkyboxShader.ts, Settings.ts)
  types/                ← TypeScript .d.ts (shaders.d.ts)
  utils/                ← shared utilities (Random.ts — Perlin noise + seeded random)

public/
  models/surface/       ← GLB models placed on the island
  models/underwater/    ← coral, fish, kelp GLBs
  models/character/     ← pug.glb (animation clips), seagull.glb
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

**Time:** `src/core/Time.ts` — exports `time` (elapsed seconds), `deltaTime` (seconds/frame), `timeUniform` (Three.js `Uniform`, shared into shaders directly).

Do not add new `requestAnimationFrame` chains. Hook into the nearest existing `Update()`.

---

## Scene architecture

`src/core/Scene.ts` creates the renderer, camera, and lights, then calls `Update()` on all major subsystems each frame.

**Renderer:** `WebGLRenderer` + `CSS3DRenderer` running in parallel with separate scenes and cameras. CSS3D handles the phone iframe overlay only.

**Lights:** `AmbientLight` + `DirectionalLight`. The directional light is driven each frame by `lightUniform` (a `Uniform<Vector3>`) exported from `SkyboxMaterial.ts` — it tracks the analytical sun position. A separate shadow-casting spotlight lives above the campfire.

**Visibility gating:** Every frame, the scene checks `isUnderwater`. Surface objects hide underwater, underwater objects hide above — this halves GPU work in either mode. Every new scene object must be wired into the gate at `Scene.ts:606-658`.

**Shadow maps:** VSMShadowMap by default. Resolution: 512px mobile, 1024px desktop. Configurable at runtime via IslandDebug. Settings persist via `localStorage` (keys prefixed `portfolio-*`).

**Post-processing:** Not EffectComposer. Main scene renders to a `FramebufferTexture`, then a second pass draws it through a custom fullscreen ShaderMaterial (underwater distortion + optional pixelation). Lives in `src/effects/PostProcess.ts`. Skipped entirely when above water with `pixelSize == 0`.

**Render pass order (must not change):**
1. `renderer.render(scene, camera)` — main pass
2. `Ocean.RenderSurface` — samples sceneColor FBO; runs after main render
3. Underwater transparents re-render (fish, bubbles, particles)
4. `PostProcess.renderScene()` — if underwater or pixelated
5. `CloudSprites.Render()` — additive, own scene
6. Debug axes
7. CSS3D / PhoneScreen

---

## Island.ts — the main scene file

`src/scene/Island.ts` is the largest file (~2700 lines). It:

- Exports all scene Groups: `island`, `firecamp`, `tree`, `bush`, `bushRadio`, `bushRadio2`, `bushPug`, `radio`, `sword`, `pug`, `tent`, `dogBed`, `littleRocks`, `phone`, `chest`, `apple1/2/3`, `dock`, `robin1`, `robin2`, `foldingTrayTable`, `tentDogBed`, `rugRound`, `lantern`, `dogBowl`, `dogBiscuit`, `mossRock1/2/3a/3b/3c`
- Exports `proceduralGrassMesh`, `grassShadowMesh`
- Exports `clusterMainPatches`, `clusterTreePatches`, `clusterCloverPatches` (kept for IslandDebug backward compat only — procedural grass replaced them)
- Exports `exclRadii` (live exclusion radii, mutated by debug GUI)
- `Start()` — loads all GLB models via GLTFLoader, inits physics, spawns grass
- `Update(isUnderwater: boolean)` — per-frame: apple sway, physics sync, pug/robin animations, music notes, chest, radio bounce, wind uniforms

**Model loading pattern:**
```ts
loader.load('models/surface/foo.glb', (gltf) => {
    applyOceanLightingToModel(gltf.scene);  // or applyTreeWindShader / applyBushWindShader
    gltf.scene.traverse(child => { child.castShadow = true; });
    fooGroup.add(gltf.scene);
    fooGroup.position.set(...);
    fooGroup.scale.setScalar(fooScale);
}, undefined, (err) => console.error(err));
```

**Shader injection picker:**

| Object type | Use |
|---|---|
| Surface prop (rock, dock, furniture, etc.) | `applyOceanLightingToModel(gltf.scene)` |
| Tree | `applyTreeWindShader` — cache key `'tree_wind'` |
| Bush / clover | `applyBushWindShader` — cache keys `'bush_wind'` / `'bush_wind_flower'` |
| Apple | `_applyAppleWaterlineToMaterial` AFTER ocean lighting (composed cache key) |

Skipping ocean lighting on an island prop means it will look wrong underwater (no fog, no caustics tint).

**Robin animations:** loaded via `SkeletonUtils.clone()` so two robins share one GLB. Each has its own `AnimationMixer`. Clip playback driven in `Update()`.

---

## Config system

Config values are **not hardcoded in Island.ts** — they live in generated files:

| File | What's in it |
|------|-------------|
| `src/scene/config/IslandConfig.ts` | Positions, scales, rotations, foliage params, exclusion radii, fire light settings |
| `src/scene/config/Physics/AppleConfig.ts` | Gravity, apple mass, friction, restitution, sleep limits, tree trunk Y cutoff |
| `src/scene/config/OceanConfig.ts` | Wave velocities, normal map scale, foam params |
| `src/scene/config/CameraConfig.ts` | FOV, zoom distances, transition speeds, dead zone thresholds |
| `src/scene/config/PhoneConfig.ts` | Phone screen dimensions, offset, overlay settings, zoom target |
| `src/scene/config/SeaFloorConfig.ts` | Coral rocks, kelp, chest, coins, anemone, scattered prop config |
| `src/scene/config/SkyConfig.ts` | Sky color bands, star density, day/night transition curve |

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

Updating `oceanAbsorptionUniform.value` from anywhere propagates to all materials that reference it. Never copy a uniform by value — it breaks the live-update chain.

### Wind shaders

- **Tree:** `applyTreeWindShader()` in Island.ts. Cache key `'tree_wind'`. Uses `smoothstep(uLeafStartY, uLeafFullY, position.y)` so only the upper canopy sways. Uniforms: `treeWindTimeUniform`, `treeWindStrengthUniform`, `treeLeafStartYUniform`, `treeLeafFullYUniform`.
- **Bush:** `applyBushWindShader()`. Cache keys `'bush_wind'` / `'bush_wind_flower'` depending on mesh type.
- **Grass:** `'procedural_grass'` cache key. Wind via Perlin noise DataTexture + mouse interaction uniform.

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

No `customProgramCacheKey` needed here — full `ShaderMaterial`s have isolated programs by construction.

---

## Physics (cannon-es)

`src/scene/Physics.ts`:

- **World:** gravity -9.82, SAPBroadphase, GSSolver 20 iterations, `allowSleep = true`
- **Island collider:** static `Trimesh` built from island mesh vertices (transformed to world space)
- **Tree collider:** optional static Trimesh, filtered to geometry below `TREE_TRUNK_MAX_Y` (trunk only, not canopy)
- **Apple body:** compound shape of 4 corner spheres, mass 0.15 kg
- **Step gate:** `stepPhysics()` returns early if `activeCount === 0` — zero overhead when idle
- **Debug:** `CannonDebugger` renders green wireframes when toggled in IslandDebug

**Rebuilding:** `rebuildPhysicsWorld()` tears down and recreates the entire world. Called when apple/friction params change in the debug GUI. Existing apple bodies survive the rebuild.

**Registration order:**
1. `initPhysicsWorld(islandMeshes)` — called when island GLB finishes loading
2. `registerTreeMeshes(treeTrunkMeshes)` — called when tree GLB finishes loading (triggers rebuild)
3. `registerExtraStaticMeshes(meshes)` — for radio, sword, and other props apples can land on

---

## Procedural grass

`src/scene/ProceduralGrass.ts` — generates all grass in **one draw call** using a merged BufferGeometry.

- Spawn points raycasted onto the island surface mesh for correct Y
- Each blade gets random rotation, scale, and edge-falloff factor baked into its vertices
- Wind animation via Perlin noise `DataTexture` + vertex shader injection
- Mouse interaction: raycasts per frame → `mouseWorldPos` uniform → blades near mouse tip toward camera
- Shadow floor: a separate flat disc geometry (`grassShadowMesh`) renders fake AO below all grass
- Exclusion zones: `exclRadii` entries — blades within radius of any prop are discarded at spawn time

---

## SeaFloorDecor.ts

`src/scene/SeaFloorDecor.ts` — all underwater decorations. Owns its own `GLTFLoader` and loading state tracked separately from Island's `LoadingManager`; prewarm waits on `SeaFloorDecor.isLoaded()`.

Loaded assets: coral rocks, corals, kelp, anemones, starfish, crabs, a chest with coins.

- **Kelp:** uses `kelpTimeUniform` (separate from `timeUniform`) updated only when the scene is underwater — preserves sway pose when the camera is above water.
- **Anemone uniforms** are module-private; promote to exports + log in UNIFORMS.md if another module needs them.
- Configured entirely via `src/scene/config/SeaFloorConfig.ts`.

---

## Day/night system

`src/scene/Skybox.ts` owns the day/night state. `getDayNightBlend()` returns a 0–1 value (0 = day, 1 = night) consumed by:
- `CloudSprites.ts` — cloud opacity layers
- `Audio.ts` — night crickets vs. day bird tweets
- `UI.ts` — theme toggle appearance

The directional light direction and color follow the analytical sun via `lightUniform` and `sunVisibilityUniform` (exported from `SkyboxMaterial.ts`), updated every frame in Scene.ts.

---

## Phone overlay (CSS3D + WebGL hole)

`src/core/PhoneScreen.ts` renders a live iframe on the phone model using the "henryjeff pattern":

1. A `NoBlending` occluder mesh (invisible but writes depth) punches a transparent hole in the WebGL canvas at the phone screen's screen-space location.
2. A CSS3D div sits in that exact hole, behind the canvas, containing the iframe.
3. The WebGLRenderer and CSS3DRenderer share the same DOM parent and camera so the overlay tracks perfectly.

This lets a live web page appear "inside" the phone GLB without any render target. `zoomToPhone()` in Control.ts moves the camera to the configured phone zoom target from `PhoneConfig.ts`.

---

## Audio system

`src/core/Audio.ts` — 100% Web Audio API, no HTML audio tags.

- All audio buffers are pre-fetched as `ArrayBuffer` during the loading screen.
- 4-track volume mixing: nature, music, interface, character.
- **Intro sequence:** piano + breeze plays during the camera descent animation; both fade out as descent completes.
- **Day/night audio:** night mode adds crickets; daytime has bird tweets on click.
- **UI sounds:** switch, button, bubble pop, spin — triggered by UI events.
- **Character sounds:** pug snore, dialog woofs — triggered by interaction.
- `MediaPlayer.ts` handles radio playlist + wavesurfer visualization separately from the ambient audio bus.

---

## Camera system

`src/core/Control.ts` — camera state machine with several modes:

| Mode | Trigger | Behavior |
|------|---------|---------|
| Web page scroll | Default | Free Y-scroll between `aboveWaterTopY` and `underwaterBottomY` |
| Radio zoom | `zoomToRadio()` | Smooth lerp to radio target; audio ramps |
| Pug zoom | `zoomToPug()` | Pug cutscene camera offset; dialog triggers |
| Phone zoom | `zoomToPhone()` | Aligns camera to phone screen; CSS3D overlay activates |
| Chest zoom | `zoomToChest()` | Moves underwater to chest position |

**Intro descent:** Cinematic fall from `introStartY` (8.5) down to scene entry height, with ease-out + pitch damping. `onDescentComplete(cb)` fires when animation settles.

**Dead zone:** Camera avoids resting between `aboveWaterBottomY` (-1) and `underwaterTopY`; snaps to nearest edge when scroll stops.

**Responsive FOV:** Desktop and mobile variants selected on resize.

---

## Naming conventions

**Variables:**
- `_prefixedWithUnderscore` — module-private, not exported
- `SCREAMING_SNAKE_CASE` — constants (config values, physics params, shader thresholds)
- `camelCase` — everything else (uniforms, groups, functions, state)

**Uniforms:** always a Three.js `Uniform` instance, named `xyzUniform` (e.g. `timeUniform`, `oceanAbsorptionUniform`).

**Config exports:** match the variable name used in Island.ts exactly — they're imported directly. E.g. `export const treeOffset = ...` → `import { treeOffset } from './config/IslandConfig'`.

**Files:** PascalCase for major scene/script modules (`Island.ts`, `OceanMaterial.ts`), camelCase for small utilities (`Time.ts`, `Audio.ts`). Config files go in `scene/config/`.

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

Debug state (shadow type, DPR, antialias, pixelation) is persisted via `localStorage` keys prefixed `portfolio-*`.

---

## Mobile

- Detected via `userAgent + window.innerWidth < 768`
- Lower defaults: DPR capped at 1.5, reduced shadow resolution, antialias off, pixelation off
- Settings are user-overridable at runtime and stored in `localStorage` — device-aware defaults, not hard locks
- Touch input in `Input.ts` — 2-finger scroll tracked separately to prevent accidental ripples
- Ripple interaction blocked during 2-finger scroll

---

## Performance notes

- **One draw call for all grass** — merged `BufferGeometry`, never split
- **Module-scope scratch vectors** — `Vector3`/`Quaternion` pre-allocated at top of every hot module; no per-frame `new`
- **Shared `Raycaster`** — never `new Raycaster()` in a hot path
- **Step gate in physics** — `stepPhysics()` is a no-op when all apple bodies are sleeping
- **Visibility gating** — halves GPU work by hiding irrelevant geometry each frame
- **Prewarm** — all shader programs compiled + textures uploaded before first user interaction to avoid hitches

`renderer.info.render.calls` > 150 (desktop) or > 80 (mobile) is a red flag. `renderer.info.programs.length` should plateau after prewarm; any growth at runtime means an unexpected on-demand shader compile.

---

## Key gotchas

- **Always set `customProgramCacheKey`** when using `onBeforeCompile`. Skipping causes random shader corruption across materials sharing the same PBR base.
- **Config files are generated** — don't hand-edit magic numbers in `IslandConfig.ts` or `AppleConfig.ts`. Use the debug GUI sliders and copy the output.
- **`rebuildPhysicsWorld()` is expensive** — only call it in response to GUI changes, never per-frame.
- **`mat.needsUpdate = true`** must be set after changing `onBeforeCompile` or `customProgramCacheKey`, otherwise Three.js won't recompile.
- **Uniform sharing** — always pass uniforms by reference (`shader.uniforms.x = sharedUniform`), not by value. Copying breaks the live-update chain.
- **`alphaTest` vs `transparent`** — tree leaves use `alphaTest = 0.5` + `transparent = false` so they write to the depth buffer and don't get occluded by the ocean surface when viewed from underwater.
- **`DoubleSide`** on ocean and grass — always, or backfaces disappear when camera is below the island.
- **Physics world is rebuilt, not patched** — all static colliders are re-added from scratch on rebuild. Don't try to remove individual bodies; just rebuild.
- **`clusterTreePatches` / `clusterMainPatches`** — kept only for IslandDebug backward compat. They're Group arrays that used to hold foliage clusters; now procedural grass replaced them but the exports remain.
- **Material cloning in `.traverse()`** — many GLBs share material instances across meshes; cloning them in a traverse explodes draw-call count. Prefer `userData` + a uniform for per-instance variation.
- **New scene groups need two lines** — `export const x = new Group()` in Island.ts AND `scene.add(Island.x)` in Scene.ts, plus a visibility gate entry at Scene.ts:606.
- **CSS3D and WebGL camera parity** — both renderers share the same camera. Never set `cssCamera` independently; update only the main camera.
- **`toggling castShadow` per frame** — pipeline stall. Set once at load; fade light intensity instead.

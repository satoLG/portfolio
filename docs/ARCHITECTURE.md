# Architecture

High-level data flow, module boundaries, and rendering pipeline.
For per-folder gotchas see the `CLAUDE.md` inside each subdirectory.

---

## Module graph

```
main.ts
  ├─ core/Time         ── clock + timeUniform (shared into every animated shader)
  ├─ core/Scene        ── owns renderer, scene, camera; per-frame visibility gate
  │    ├─ scene/Skybox        (sun direction, day/night blend)
  │    ├─ scene/Ocean         (full custom ShaderMaterial)
  │    ├─ scene/SeaFloor      (tiled ground under island)
  │    ├─ scene/SeaFloorDecor (corals, kelp, anglerfish, chest, whale)
  │    ├─ scene/Island        (largest: tree, props, foliage, apples)
  │    ├─ scene/Fire          (point light + sprite flame on bonfire)
  │    ├─ scene/Fish          (instanced shoals)
  │    ├─ scene/ProceduralGrass (single-draw merged blade mesh)
  │    ├─ scene/Physics       (cannon-es world)
  │    └─ effects/*           (PostProcess, Bubbles, UnderwaterParticles,
  │                            WindLines, CloudSprites, FoamMask, WelcomeText)
  ├─ core/Input        ── keyboard / mouse / touch
  ├─ core/Control      ── camera state machine (page-mode positions, underwater detection)
  ├─ core/UI           ── DOM overlay sync
  ├─ core/Debug        ── lil-gui panel (H to toggle), perf stats
  ├─ core/Audio        ── Web Audio assets, fades, breeze coupling
  ├─ core/MediaPlayer  ── radio playback + wavesurfer visualizer
  ├─ core/PhoneScreen  ── CSS3D overlay quad on the phone GLB
  ├─ core/Dialog       ── speech-bubble UI
  ├─ core/CoinTooltip  ── coin label
  └─ core/i18n         ── localized strings
```

Per-frame call order (from [main.ts](src/main.ts)):
1. `TIME.Update()` — sets `time`, `deltaTime`, `timeUniform.value`
2. `SCENE.Update()` — visibility gate → render
3. `INPUT.Update()` — raw input snapshot
4. `CONTROL.Update()` — camera transform
5. `UI.Update()` — DOM sync
6. `DEBUG.Update()` — stats

---

## Render pipeline

```
Scene.Update()
  ├─ Skybox.Update             (sun rotation, day/night blend)
  ├─ Ocean.Update              (foam, ripple decay)
  ├─ Audio.Update / UI.Update / MediaPlayer.Update
  ├─ PostProcess.updateUnderwaterAmount(camera.y)
  ├─ Visibility gate (isUnderwater = getIsUnderwater())
  │     toggles SeaFloor / Fish / WindLines / underwater particles
  │     Island groups stay visible (extend below waterline)
  ├─ Sync directional light to skybox sun direction
  ├─ PhoneScreen.preRender (CSS3D occluder transforms)
  ├─ PostProcess.renderScene(renderer, scene, camera, afterBaseRender)
  │     ├─ renderer.render(scene, camera)         ← main pass
  │     ├─ afterBaseRender() callback:
  │     │     ├─ Ocean.RenderSurface              ← ocean drawn AFTER scene
  │     │     │                                      (depthWrite=false, uses sceneColor FBO)
  │     │     └─ underwater-only transparents (fish, bubbles, particles)
  │     │         re-rendered last so blending is correct
  │     └─ if (underwaterAmount > 0 || pixelSize > 0):
  │           copyFramebufferToTexture → fullscreen quad with distortion+pixelation
  ├─ CloudSprites.Render        (separate scene, additive into same target)
  ├─ Debug axes                 (autoClearColor = false trick)
  ├─ PhoneScreen.render         (CSS3D overlay)
  ├─ cssRenderer.render         (single shared CSS3D pass)
  └─ WindLines.Update           (3D ribbon mesh positions)
```

**Critical:** the ocean is drawn *after* the rest of the scene with `depthWrite=false`, sampling `sceneColorUniform` (a FramebufferTexture copy) for refraction. Don't reorder.

---

## Visibility gating — the main perf gate

[Scene.ts:588](src/core/Scene.ts#L588) — every frame asks `getIsUnderwater()`. Two branches:

| | Surface | Underwater |
|---|---|---|
| SeaFloor | hidden | visible |
| SeaFloorDecor group | hidden | visible |
| WindLines group | visible | hidden |
| Island groups | **always visible** (extend below waterline) | |
| Fish | culled by camera Y | culled by camera Y |
| Bubbles / particles | spawn-gated | spawn-gated |
| `Island.Update(isUnderwater)` | full | chest+coin+pug only — skips wind, radio, music notes |

Adding a new scene object: decide which branch it belongs to and add the visibility toggle to *both* branches (not just one — leaving a stale `visible=false` from the other branch causes invisible-but-still-allocated geometry).

---

## State persistence

- **localStorage**: `portfolio-antialias`, `portfolio-shadows`, `portfolio-pixel-size`, `portfolio-color-filter`. Read once in [Scene.ts:41-55](src/core/Scene.ts#L41). Antialias change requires reload (WebGL context attribute).
- **No server / no backend.** Everything is client-side static.
- **Service worker** registered at [main.ts:11](src/main.ts#L11) for PWA / offline caching.

---

## Loading & GPU prewarm

[Scene.ts:434 `prewarmGPU()`](src/core/Scene.ts#L434) runs after `Island.setOnLoadCallback`. Sequence:
1. Wait for SeaFloorDecor + Fish + audio preload.
2. `renderer.compile(scene, camera)` + `compileAsync` for every program.
3. `initTexture()` for every map on every material (forces upload, not just compile).
4. Warm renders: sky-only, island-facing, underwater jellyfish, chest corridor — covers every shader permutation and FBO path.
5. Restore camera + visibility.

The loading overlay stays up until prewarm finishes. After this, first scroll and first dive are stutter-free. **Do not break this:** new shader variants (anything with a unique `customProgramCacheKey`) must render at least once during prewarm or they hitch on first use.

---

## DPR + resolution

- DPR capped at `min(window.devicePixelRatio, isMobile ? 1.5 : 2)`.
- `PostProcess.onResize` uses **drawing-buffer size** (`renderer.getDrawingBufferSize`), not CSS size — critical for the FramebufferTexture to match.
- `sortObjects = false` on the renderer — explicit `renderOrder` on key meshes instead.

---

## Build

```
npm run dev   → vite dev server on :3000 with HMR
npm run build → tsc (typecheck) && vite build
```

`vite-plugin-glsl` lets `.glsl` / `.vert` / `.frag` be imported as strings.

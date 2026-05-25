# `src/core/` — gotchas

Engine modules wired together by [src/main.ts](src/main.ts). Each one exports `Start()` (init) and most also export `Update()` (per-frame). For the call order see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).


## Main loop contract

```ts
TIME.Start();       SETTINGS.Start();   SCENE.Start();
INPUT.Start();      CONTROL.Start();    UI.Start();      DEBUG.Start();

// requestAnimationFrame:
TIME.Update();      // deltaTime, time, timeUniform.value
SCENE.Update();     // render + per-frame subsystem updates
INPUT.Update();
CONTROL.Update();
UI.Update();
DEBUG.Update();
```

Anything new that needs to tick must hook into the existing `Update()` of the closest-fit module — don't add a new `requestAnimationFrame` chain.

## Per-module responsibility

| File | Role | Touches |
|---|---|---|
| `Time.ts` | Clock; exports `time`, `deltaTime`, `timeUniform` | Read everywhere; written here |
| `Scene.ts` | Renderer, scene graph, camera, lights, visibility gate, prewarm | Everything renders here |
| `Input.ts` | Keyboard, mouse, touch normalization | Read by Control + UI |
| `Control.ts` | Camera state machine, underwater detection, page-mode transitions | Reads Input, drives camera |
| `UI.ts` | DOM overlay sync (positions over WebGL canvas) | Reads scene; writes DOM |
| `Debug.ts` | lil-gui panel, stats, debug axes | Mutates almost everything |
| `Audio.ts` | Web Audio assets, fades, breeze | Reads camera + scene state |
| `MediaPlayer.ts` | Radio playback + wavesurfer | Reads play state |
| `PhoneScreen.ts` | CSS3D overlay on the phone GLB | Reads camera, writes DOM |
| `Dialog.ts` | Speech bubble UI | DOM only |
| `CoinTooltip.ts` | Coin tooltip near phone | DOM only |
| `i18n.ts` | Localized strings | DOM only |

## Rules

- **No allocations in `Update()`.** Pre-allocate scratch `Vector3`/`Quaternion` at module scope (see [Scene.ts:82-88](src/core/Scene.ts#L82) for examples).
- **Reuse the shared `Raycaster`** — never `new Raycaster()` in a hot path.
- **localStorage keys** are prefixed `portfolio-*`. Read once in `Start()`, write via setter that also updates the live value.
- **State machine changes in Control.ts** drive everything downstream (underwater fish visibility, post-process underwater amount, scene visibility gate). Don't bypass it.

## Adding a new core module

1. Create `src/core/MyModule.ts`. Export `Start()` and (if it ticks) `Update()`.
2. Import + call from [main.ts](src/main.ts) in the right slot.
3. If it owns a shared uniform, export the `Uniform` and add to [UNIFORMS.md](src/UNIFORMS.md).
4. If it allocates GPU resources, hook into `prewarmGPU` in [Scene.ts:434](src/core/Scene.ts#L434).

## Debugging tips

- `renderer.info.render.calls` — the single most useful number. Surface it in Debug.ts to spot regressions (>150 desktop / >80 mobile is a red flag).
- `renderer.info.programs.length` — number of unique GLSL programs. Should plateau after prewarm; any growth at runtime means a new shader variant compiled on demand (= first-use hitch).
- Press **H** to toggle the IslandDebug GUI. Every section has live sliders + "Copy Config" button.

## What NOT to put here

- Scene-specific behaviors (apple physics, pug animations, fire flicker) → `src/scene/`
- Visual effects (bubbles, clouds, distortion) → `src/effects/`
- Shader source / materials → `src/materials/` and `src/shaders/`
- DOM-only widgets that don't touch the WebGL scene at all → fine here, see Dialog/CoinTooltip

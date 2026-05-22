# `src/effects/` — gotchas

Visual effects layered on top of the main scene. Each has its own `Start()` + `Update()` and is wired in [core/Scene.ts](src/core/Scene.ts).

## Pass order matters

```
1. renderer.render(scene, camera)          ← main pass
2. Ocean.RenderSurface                     ← ocean drawn AFTER scene (samples sceneColor FBO)
3. underwater transparents re-render       ← fish, bubbles, particles last so blending right
4. PostProcess fullscreen quad             ← if underwaterAmount > 0 || pixelSize > 0
5. CloudSprites.Render                     ← additive, separate scene, into same target
6. Debug axes (autoClearColor=false hack)
7. PhoneScreen / CSS3D
```

Don't reorder. PostProcess copies the framebuffer **before** clouds, so clouds aren't distorted underwater (correct — clouds are sky-only). Adding a new full-screen effect: decide whether it runs before or after the copy.

## PostProcess.ts

- Single fullscreen quad doing **both** underwater distortion **and** pixelation.
- `framebufferTexture` is a `FramebufferTexture` (not `WebGLRenderTarget`) — copied via `renderer.copyFramebufferToTexture`.
- **Resize uses drawing-buffer size** (`renderer.getDrawingBufferSize`), not CSS size. Critical for DPR != 1.
- Activated by `updateUnderwaterAmount(cameraY)` setting `underwaterAmount > 0`. When fully above water with `pixelSize == 0`, the post-process pass is skipped entirely.

## Bubbles.ts

- `InstancedMesh` of `BUBBLE_COUNT` sprites. Per-instance opacity via `InstancedBufferAttribute`.
- Pooled — `bubbles[]` array, no allocations per spawn.
- Two spawn sources: ambient timer + entry burst when crossing waterline. Mouse position drives directional spawning.

## UnderwaterParticles.ts

- `Points` with custom shader. Box volume around camera; recycles particles that exit the box.
- Opacity fades over distance + has near-clip fade (`PARTICLE_MIN_DIST`).
- Drift speed is intentionally tiny (`PARTICLE_DRIFT_SPEED = 0.01`).

## CloudSprites.ts

- 3 chunks × ~2200 instanced sprites each.
- Has its own `Scene` (`cloudSpritesScene`) — `Render()` is called separately from the main `renderer.render`.
- Day/night blend: opacity ramps via `LAYER_*` constants, driven by `Skybox.getDayNightBlend()`.
- "Lift" descent animation kicks in when user transitions from intro to scene.

## WindLines.ts

- 3D ribbon meshes in the main scene, not a 2D overlay.
- Spawned around camera using FOV-aware bounds — increases on faster wind, but the **scene's** wind audio drives `intensity`.
- Hidden underwater (set by Scene.ts visibility gate).

## FoamMask.ts

- Generated **once** at runtime: orthographic render of the island silhouette from above + a 2D Euclidean distance transform → SDF.
- Result fed into `foamMaskUniform` on Ocean material. Ocean shader reads SDF distance to draw foam around island edge.
- Regeneration only needed if island geometry changes — not per-frame.

## WelcomeText.ts

- Tegaki + patrick-hand font for the handwritten welcome animation.
- Plays a "writing pen" audio loop synchronized to the path animation.

## Common mistakes

- **Adding an effect to the main scene without a visibility gate.** Anything sky-only or surface-only must be hidden underwater (and vice versa) in [core/Scene.ts:606](src/core/Scene.ts#L606).
- **Allocating per-frame** in `Update()`. All effect files maintain module-scope scratch vectors (`_forward`, `_dummy`, etc.). Follow the pattern.
- **Skipping `setOnLoadCallback` integration**. Anything with async asset loading should be added to the prewarm sequence in [Scene.ts:434](src/core/Scene.ts#L434) so first use doesn't hitch.

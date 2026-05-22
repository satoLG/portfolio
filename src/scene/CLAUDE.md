# `src/scene/` — gotchas

For high-level architecture see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Folder rules

- **`Island.ts` is the largest file by far** (~2700 lines). Don't be afraid of it — it's split into clearly named regions. Use Grep to jump.
- **Never hardcode positions/scales/rotations.** Add to `config/IslandConfig.ts` instead, then tweak via debug GUI (press H) → "Copy IslandConfig.ts" button → paste the output back.
- **Group exports** (`island`, `tree`, `radio`, etc.) are added to the scene in [core/Scene.ts:362](src/core/Scene.ts#L362). A new scene group needs both: the `export const x = new Group()` AND `scene.add(Island.x)` in Scene.ts.

## Visibility gating

Every new scene object MUST be assigned to the surface or underwater visibility branch in [core/Scene.ts:606-658](src/core/Scene.ts#L606). Leaving an object outside both branches means it's always rendered — both surface and underwater — wasting GPU.

Surface-only group → set `visible = true` in the `else` branch (line ~641) and `false` in the `if (isUnderwater)` branch.

Underwater-only → opposite.

Always-on (like Island groups that extend below waterline) → `true` in both. Already handled for the existing groups; only relevant if you add a new always-visible mesh.

## Physics registration

Static props that apples might land on → call `Physics.registerExtraStaticMeshes([mesh1, mesh2])` *after* the GLB finishes loading. This triggers a world rebuild; the apple bodies survive it. Don't try to be clever — just rebuild.

## Shader injection picker

| You're loading | Use |
|---|---|
| A surface prop (rock, prop, anything on island) | `applyOceanLightingToModel(gltf.scene)` |
| The tree | `applyTreeWindShader` — uses `tree_wind` cache key |
| A bush / clover / grass | `applyBushWindShader` |
| An apple | `_applyAppleWaterlineToMaterial` AFTER ocean lighting (composed cache key) |

If you skip ocean lighting on an island prop, it will look wrong underwater (no fog, no caustics tint).

## ProceduralGrass.ts

- One merged BufferGeometry → one draw call. Don't split.
- Spawn points raycasted against island mesh in `Start()` for correct Y.
- Exclusion: each entry in `exclRadii` removes blades within radius of that prop. Live-tweakable from debug GUI.
- Mouse interaction: `mouseWorldPos` uniform updated per frame; shader gives nearby blades a forward tilt.
- Shadow floor: separate flat disc mesh (`grassShadowMesh`) renders below grass as fake AO.

## SeaFloorDecor.ts

- Owns its own GLTFLoader → tracked separately from Island's LoadingManager. Prewarm waits via `SeaFloorDecor.isLoaded()`.
- Kelp uses its own time uniform (`kelpTimeUniform`), updated only when scene is underwater — preserves sway pose when scene is paused.
- Anemone uniforms are module-private; if another module needs them, promote to exports and add to UNIFORMS.md.

## Common mistakes

- **Forgetting `mat.needsUpdate = true`** after setting `onBeforeCompile`. The injection is set but no recompile triggers. Symptom: shader looks unchanged on first frame.
- **Cloning materials in a `.traverse()`**. Many GLBs share material instances across meshes; cloning explodes the draw-call count. If you need per-instance variation, prefer `userData` + a uniform, not `clone()`.
- **Toggling `castShadow` per frame**. Pipeline stall. Set once at load; fade light intensity to 0 instead (see [Scene.ts:676](src/core/Scene.ts#L676)).
- **Editing magic numbers in `config/`**. Always GUI → "Copy" button → paste back. Otherwise the next person who tweaks via GUI overwrites your manual edit.

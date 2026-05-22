# Shaders

Three shader styles coexist in this project. Pick the right one.

| Style | When | Examples |
|---|---|---|
| `MeshStandardMaterial` + `onBeforeCompile` injection | Imported GLB models that need wind, waterline, ocean lighting, or grass-tint | Tree wind, bush wind, apple waterline, island surface grass-blend, ocean lighting on every prop, kelp/anemone sway |
| Full custom `ShaderMaterial` | When PBR lighting is irrelevant and you want a hand-rolled vert+frag | Ocean surface, Skybox, PostProcess, Bubbles, UnderwaterParticles, WindLines, CloudSprites |
| Raw `RawShaderMaterial` | Avoid — none used currently. Prefer ShaderMaterial. | |

For the live inventory of every shared uniform, see [src/UNIFORMS.md](src/UNIFORMS.md).

---

## The `onBeforeCompile` contract

Every injection follows this exact pattern. Skip any step → silent breakage.

```ts
mat.customProgramCacheKey = () => 'unique_key';   // STEP 1 — mandatory
mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMyUniform = myUniform;       // STEP 2 — share by reference
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
        #include <common>
        uniform float uMyUniform;
        varying vec3 vWorldPosition;
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `
        #include <worldpos_vertex>
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    `);
    // ... fragment replacements
};
mat.needsUpdate = true;                            // STEP 3 — force recompile
```

**Why each step matters:**
- Without `customProgramCacheKey`: Three.js reuses a cached program from another `MeshStandardMaterial` and silently ignores your injection.
- Without sharing uniforms by reference: `material.uniforms.x.value = ...` updates one material; nothing else sees it.
- Without `needsUpdate`: the hook is set but the program isn't recompiled. First frame still uses the old shader.

---

## Cache-key registry

Every active `customProgramCacheKey` in the codebase. If you add another, append it here.

| Key | File | Material(s) |
|---|---|---|
| `tree_wind` | [Island.ts:2331](src/scene/Island.ts#L2331) | every mesh of `tree.glb` |
| `bush_wind` / `bush_wind_flower` | [Island.ts:2446](src/scene/Island.ts#L2446) | bushes — flower variant has per-instance color uniform |
| `procedural_grass` | [ProceduralGrass.ts:427](src/scene/ProceduralGrass.ts#L427) | merged grass mesh — wind + mouse interaction |
| `island_surface_grass_filter` | [Island.ts:1963](src/scene/Island.ts#L1963) | island ground mesh — painted-grass tint + campfire glow |
| `ocean_lighting` | [Island.ts:2090](src/scene/Island.ts#L2090) | every island prop (radio, sword, chest, etc.) — fog + caustics |
| `ocean_lighting_sf<suffix>` | [SeaFloorDecor.ts:197](src/scene/SeaFloorDecor.ts#L197) | seafloor decor variants (suffix carries kelp/anemone sway opt-in) |
| `golden-apple-local-y-mask-v1` | [Island.ts:1086](src/scene/Island.ts#L1086) | golden apple variant |
| `${prev}-apple-waterline-v1` | [Island.ts:1048](src/scene/Island.ts#L1048) | regular apples — preserves prior cache key by composition |

**Composed keys:** when injecting on top of an already-injected material (e.g. apple waterline on top of ocean lighting), capture the previous key and prepend it. The pattern at [Island.ts:1047-1048](src/scene/Island.ts#L1047) is the reference.

---

## Custom ShaderMaterial — when

Use a full `ShaderMaterial` when:
- You don't need Three.js PBR lighting (no `normalMap` PBR chain, no `roughness`/`metalness`).
- You're writing both vert and frag from scratch.
- You want guaranteed shader-program isolation (no cache collision risk).

Examples in repo:
- [materials/OceanMaterial.ts](src/materials/OceanMaterial.ts) — `surface`, `volume`, `object`, `triplanar`
- [materials/SkyboxMaterial.ts](src/materials/SkyboxMaterial.ts)
- [effects/PostProcess.ts:50-101](src/effects/PostProcess.ts#L50) — inlined vert+frag strings
- [effects/Bubbles.ts:62-105](src/effects/Bubbles.ts#L62) — particle sprite shader

GLSL larger than ~30 lines belongs in [src/shaders/](src/shaders/) imported via `vite-plugin-glsl` (`.glsl` files become string exports — see [shaders/OceanShaders.ts](src/shaders/OceanShaders.ts)).

---

## Uniform sharing rules

1. **Define once.** The owning module exports a single `Uniform` instance (`export const xyzUniform = new Uniform(...)`).
2. **Inject by reference.** `shader.uniforms.uX = xyzUniform` — same object, no clone.
3. **Update via `.value`.** Mutating from anywhere propagates to every material that references the same `Uniform`.
4. **Listed in UNIFORMS.md.** If it's exported, add a row.

Anti-pattern: `shader.uniforms.uX = new Uniform(xyzUniform.value)`. This *copies* the value — subsequent updates to `xyzUniform` won't propagate to this material.

---

## Common pitfalls

- **`transparent: true` + tree leaves** breaks depth sorting against the ocean. Tree leaves use `alphaTest = 0.5 + transparent = false` so they write to the depth buffer.
- **`DoubleSide`** on ocean and grass — always, or backfaces disappear when the camera tilts below.
- **Shadow recompile after `setShadowsEnabled`**: every material's `needsUpdate = true` AND every light's `shadow.map` / `shadow.mapPass` must be disposed. VSM uses two render targets — clearing only one causes silent breakage. See [Scene.ts:194-234](src/core/Scene.ts#L194).
- **`renderer.compile()` doesn't upload textures**, only compiles programs. Canvas textures and dynamic textures need explicit `renderer.initTexture(tex)`. See prewarm path in [Scene.ts:458-465](src/core/Scene.ts#L458).
- **Adding new cache keys post-launch**: must render at least once during `prewarmGPU` or first use will hitch (compile + GPU upload).

---

## Debugging shader bugs

1. Check the browser console for GLSL compile errors (Three.js logs them with line numbers).
2. If a material looks like another material — cache-key collision. Verify the key is unique.
3. If a uniform "doesn't update" — you copied instead of referencing. Search for `new Uniform(xyzUniform.value)`.
4. If shadows disappear after a setting change — shadow render targets weren't fully disposed. See [Scene.setShadowsEnabled](src/core/Scene.ts#L194).

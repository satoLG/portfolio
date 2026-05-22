# Assets

Models, textures, audio. Where they come from, what they're for, optimization notes.

---

## Models — see [public/models/MANIFEST.md](public/models/MANIFEST.md)

That manifest has the per-file table (path, role, size category, load site). This doc covers the cross-cutting rules.

### Loading pattern

All GLBs use `GLTFLoader`. Most island props go through the shared `LoadingManager` in [Island.ts](src/scene/Island.ts) so the loading overlay tracks them. Seafloor decor uses its own loader (separate progress).

```ts
loader.load('models/surface/foo.glb', (gltf) => {
    applyOceanLightingToModel(gltf.scene);   // OR applyTreeWindShader, etc.
    gltf.scene.traverse(child => { child.castShadow = true; });
    fooGroup.add(gltf.scene);
    fooGroup.position.set(...);
    fooGroup.scale.setScalar(...);
}, undefined, err => console.error(err));
```

### Shader injection picker

| Model type | Apply |
|---|---|
| Generic surface prop (radio, sword, chest, rocks) | `applyOceanLightingToModel` — fog + sun + caustics, plays nice underwater |
| Tree | `applyTreeWindShader` — `tree_wind` cache key, smoothstep canopy sway |
| Bushes / clover / grass GLB | `applyBushWindShader` — `bush_wind` / `bush_wind_flower` |
| Apples | both ocean lighting **and** the apple waterline injection (composed key) |
| Seafloor decor (corals, kelp) | injected by `SeaFloorDecor.ts` directly — kelp variant adds sway |

### Optimization (todo)

Run all GLBs through `gltf-transform optimize`:
```
npx gltf-transform optimize public/models/surface/tree.glb tree.opt.glb
```
Typical savings: 60–80% file size, no visual change. Includes dedupe, weld, draco compression. Add a `prebuild` npm script when adopting.

Strip unused animation tracks from `pug.glb` — animations are evaluated per frame even when not actively played. Use `gltf-transform` `prune` for this.

### Textures inside GLBs

GLBs ship with embedded PNG/JPEG textures. To convert to KTX2/Basis (half the VRAM, GPU-decoded):
```
npx gltf-transform uastc model.glb model.ktx2.glb --slots "baseColor*,normal*"
```
Requires registering `KTX2Loader` on the `GLTFLoader` at runtime.

---

## Textures (loose, under `public/images/`)

| File | Role | Notes |
|---|---|---|
| `waterNormal1.webp` / `waterNormal2.webp` | Ocean normal maps | RepeatWrapping, scrolled in opposite directions |
| `sand.webp` | Triplanar sand for underwater object refraction | RepeatWrapping |
| `basicChecker.png` | Triplanar object debug texture | RepeatWrapping |
| `noise*.webp` | Various procedural texturing inputs | |
| Music icons | UI assets | served via CSS, not loaded into WebGL |

Conversion path for runtime texture optimization: `.webp` → `.ktx2` (Basis-compressed). Half VRAM. Critical for the ocean normal maps, which are sampled multiple times per frame and at high anisotropy.

---

## Audio — `public/audio/`

Four buckets:
- `character/` — pug barks
- `music/` — radio tracks (HTMLAudioElement, streamed)
- `nature/` — ambient (surface birds, crickets; underwater bubbles)
- `overall/` — UI clicks, swipes
- `ui/` — interaction feedback (writing pen for welcome text, etc.)

Loading: [core/Audio.ts](src/core/Audio.ts). Critical clips are preloaded during `Audio.preloadAudioBytes()` in the prewarm sequence so first interaction has zero latency.

The radio uses **wavesurfer.js** for waveform display; everything else is plain Web Audio / `HTMLAudioElement`.

---

## Asset checklist for new additions

When adding a model:
1. Drop in `public/models/{surface|underwater|overall|character}/`.
2. Add a row in [public/models/MANIFEST.md](public/models/MANIFEST.md).
3. Pick the right shader injection (table above).
4. If it's a physics-relevant static prop (apples can land on it), register via `registerExtraStaticMeshes`.
5. Decide whether it should cast shadows. Small props (<10cm screen size at typical zoom) usually shouldn't — invisible cost, saves shadow-map fill.
6. If it adds a new shader cache key (rare — usually you reuse `ocean_lighting`), ensure prewarm renders it once.

When adding a texture:
1. WebP for fixed-resolution loose textures.
2. KTX2/Basis for anything sampled in a hot shader (ocean, sky, grass).
3. Power-of-two dimensions if tiled — otherwise mipmaps disable on WebGL1 fallback paths.
4. `wrapS / wrapT = RepeatWrapping` if used with tiled UVs.
5. Set `anisotropy` for surfaces viewed at grazing angles (ocean).

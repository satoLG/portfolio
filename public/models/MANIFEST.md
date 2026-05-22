# Models Manifest

Single source of truth for every GLB shipped in `public/models/`.
Sizes are raw file sizes — see [docs/ASSETS.md](docs/ASSETS.md) for optimization plan.

For shader-injection guidance per model, see [src/scene/CLAUDE.md](src/scene/CLAUDE.md#shader-injection-picker).

---

## Surface (`models/surface/`)

| File | Size | Loaded by | Role |
|---|---|---|---|
| `floating_island.glb` | 934 KB | [Island.ts:2521](src/scene/Island.ts#L2521) | Main island — also source of physics collider |
| `tree.glb` | 2.5 MB | [Island.ts:2591](src/scene/Island.ts#L2591) | Palm tree — wind shader (`tree_wind`), trunk = physics collider |
| `bush.glb` | 810 KB | [Island.ts:2671](src/scene/Island.ts#L2671) | Bushes — wind shader (`bush_wind` / `bush_wind_flower`) |
| `clover.glb` | 703 KB | (loaded via bush variants) | Clover ground cover |
| `bonfire.glb` | 29 KB | [Island.ts:2563](src/scene/Island.ts#L2563) | Firepit base under [Fire.ts](src/scene/Fire.ts) |
| `radio.glb` | 28 KB | [Island.ts:2763](src/scene/Island.ts#L2763) | Radio prop — MediaPlayer click target |
| `sword.glb` | 46 KB | [Island.ts:2799](src/scene/Island.ts#L2799) | Sword prop |
| `custom_tent.glb` | 40 KB | [Island.ts:2872](src/scene/Island.ts#L2872) | Tent (replaces older `tent.glb`) |
| `little_rocks.glb` | 5 KB | [Island.ts:2897](src/scene/Island.ts#L2897) | Small accent rocks |
| `moss_rock1.glb` | 1.1 MB | [Island.ts:2924](src/scene/Island.ts#L2924) | Mossy rock (1 instance) |
| `moss_rock2.glb` | 1.1 MB | [Island.ts:2925-2926](src/scene/Island.ts#L2925) | Mossy rock (2 instances: a, b) |
| `moss_rock3.glb` | 814 KB | [Island.ts:2927-2929](src/scene/Island.ts#L2927) | Mossy rock (3 instances: a, b, c) |
| `dock.glb` | 86 KB | [Island.ts:2932](src/scene/Island.ts#L2932) | Wooden dock |
| `folding_tray_table.glb` | 435 KB | [Island.ts:2933](src/scene/Island.ts#L2933) | Camp table |
| `dog_bed.glb` | 212 KB | [Island.ts:2934](src/scene/Island.ts#L2934) | Pug bed |
| `lantern.glb` | 72 KB | [Island.ts:2936](src/scene/Island.ts#L2936) | Lantern prop |
| `rug_round.glb` | 22 KB | [Island.ts:2935](src/scene/Island.ts#L2935) | Round rug |
| `dog_bowl.glb` | 6 KB | [Island.ts:2937](src/scene/Island.ts#L2937) | Dog bowl |
| `dog_biscuit.glb` | 62 KB | [Island.ts:2938](src/scene/Island.ts#L2938) | Dog biscuit |
| `robin_bird.glb` | **37 MB** | [Island.ts:2939-2940](src/scene/Island.ts#L2939) | Robin (2 instances, animated) — **HUGE, prime optimization target** |
| `apple.glb` | 8 KB | [Island.ts:3062](src/scene/Island.ts#L3062) | Apple — physics dynamic body, waterline shader |
| `grass.glb` | 79 KB | **UNUSED** | Replaced by procedural grass — safe to delete |
| `tent.glb` | 16 KB | **UNUSED** | Replaced by `custom_tent.glb` — safe to delete |
| `lowpoly_bird_robin.glb` | 1.2 MB | **UNUSED** | Earlier robin variant — safe to delete |

## Underwater (`models/underwater/`)

| File | Size | Loaded by | Role |
|---|---|---|---|
| `kelp.glb` | 266 KB | [SeaFloorDecor.ts:545](src/scene/SeaFloorDecor.ts#L545) | Instanced kelp — sway shader, custom time uniform |
| `coral.glb` | 228 KB | [SeaFloorDecor.ts:544](src/scene/SeaFloorDecor.ts#L544) | Main coral template |
| `coral1.glb` | 42 KB | [SeaFloorDecor.ts:546](src/scene/SeaFloorDecor.ts#L546) | Coral variant 1 |
| `coral2.glb` | 54 KB | [SeaFloorDecor.ts:547](src/scene/SeaFloorDecor.ts#L547) | Coral variant 2 |
| `coral_rock1.glb` | 473 KB | [SeaFloorDecor.ts:541](src/scene/SeaFloorDecor.ts#L541) | Coral-encrusted rock |
| `coral_rock2.glb` | 456 KB | [SeaFloorDecor.ts:542](src/scene/SeaFloorDecor.ts#L542) | Coral-encrusted rock |
| `coral_rock3.glb` | 208 KB | [SeaFloorDecor.ts:543](src/scene/SeaFloorDecor.ts#L543) | Coral-encrusted rock |
| `anemone.glb` | 239 KB | [SeaFloorDecor.ts:548](src/scene/SeaFloorDecor.ts#L548) | Anemone — own sway uniforms (module-private) |
| `starfish.glb` | **3.5 MB** | [SeaFloorDecor.ts:549](src/scene/SeaFloorDecor.ts#L549) | Starfish — **large, optimization target** |
| `crab.glb` | 119 KB | [SeaFloorDecor.ts:550](src/scene/SeaFloorDecor.ts#L550) | Crab — has animations |
| `clownfish.glb` | 79 KB | [Fish.ts:409](src/scene/Fish.ts#L409) + [SeaFloorDecor.ts:551](src/scene/SeaFloorDecor.ts#L551) | Clownfish — animated |
| `dorifish.glb` | 60 KB | [Fish.ts:423](src/scene/Fish.ts#L423) | Blue tang |
| `genericfish.glb` | 67 KB | [Fish.ts:437](src/scene/Fish.ts#L437) | Generic fish (used as instanced shoal) |
| `jellyfish.glb` | 78 KB | [Fish.ts:448](src/scene/Fish.ts#L448) | Jellyfish — transparent variant, needs prewarm |
| `anglerfish.glb` | 182 KB | _(not currently loaded)_ | Available for future use |
| `seahorse.glb` | 37 KB | _(not currently loaded)_ | Available for future use |
| `whale.glb` | 69 KB | _(not currently loaded)_ | Available for future use |

## Character (`models/character/`)

| File | Size | Loaded by | Role |
|---|---|---|---|
| `pug.glb` | 422 KB | [Island.ts:2827](src/scene/Island.ts#L2827) | Pug — has multiple animation clips, `pugMixer` drives them |
| `seagull.glb` | 77 KB | **UNUSED** | Available for future use |

## Overall (`models/overall/`)

| File | Size | Loaded by | Role |
|---|---|---|---|
| `phone.glb` | 14 KB | [Island.ts:2944](src/scene/Island.ts#L2944) | Phone — has CSS3D screen overlay via [PhoneScreen.ts](src/core/PhoneScreen.ts) |
| `gold_chest.glb` | 390 KB | [Island.ts:2974](src/scene/Island.ts#L2974) | Chest — opens/closes on interaction, spawns coins |
| `coin.glb` | 13 KB | [Island.ts:3029](src/scene/Island.ts#L3029) | Coin — spawned from chest, springs into UI tooltip |
| `chest.glb` | 28 KB | **UNUSED** | Plain chest — replaced by `gold_chest.glb` |
| `heart.glb` | 14 KB | **UNUSED** | Available for future use |
| `beach_ball.glb` | 14 KB | **UNUSED** | Available for future use |
| `pipe.glb` | 30 KB | **UNUSED** | Available for future use |

---

## Optimization priorities (in order)

1. **`robin_bird.glb` (37 MB)** — runs through `gltf-transform optimize` should drop this to ~3-5 MB. Single biggest download win.
2. **`starfish.glb` (3.5 MB)** — likely high-poly. Decimate + draco.
3. **`tree.glb` (2.5 MB)** — canopy alpha texture is probably large. Resize / KTX2.
4. **Moss rocks (~1 MB each × 6 instances)** — share material across instances; resize textures.
5. **Delete unused models** above (`grass.glb`, old `tent.glb`, `lowpoly_bird_robin.glb`, plain `chest.glb`, `heart.glb`, `beach_ball.glb`, `pipe.glb`) — they ship to clients today and serve nothing.

After optimization, add an `npm run prebuild` script that runs `gltf-transform optimize` over `public/models/**/*.glb` into a build output dir, so source files stay editable.

## Maintenance

When you add or remove a GLB:
1. Update the table above (add row, set size, link to load site).
2. If unused, mark `UNUSED` — don't delete in the same PR as the addition; let a cleanup pass batch the removals.
3. If it loads via the shared Island LoadingManager, no extra wiring. If it has its own loader (like SeaFloorDecor), make sure prewarm waits on it via the `isLoaded()` pattern.

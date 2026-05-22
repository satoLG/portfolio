# Uniforms Registry

Single source of truth for every shared `Uniform` instance in the project.
A uniform listed here is referenced *by object*, not by value — mutating
`.value` from any reader propagates everywhere.

Conventions:
- **Owner** = file that constructs the `new Uniform(...)`.
- **Readers** = other files that import and inject it (`shader.uniforms.x = sharedUniform`).
- Anything `const _foo = new Uniform(...)` (no `export`) is module-private and not listed.

---

## Global

| Uniform | Owner | Readers | Purpose |
|---|---|---|---|
| `timeUniform` | [core/Time.ts:5](src/core/Time.ts#L5) | OceanMaterial, SkyboxMaterial, ProceduralGrass, SeaFloorDecor, effects | Elapsed seconds. Updated once per frame in `Time.Update()`. |
| `lightUniform` | [materials/SkyboxMaterial.ts:33](src/materials/SkyboxMaterial.ts#L33) | core/Scene.ts (drives DirectionalLight intensity), OceanMaterial readers | Sun color/intensity from skybox. |
| `sunVisibilityUniform` | [materials/SkyboxMaterial.ts:34](src/materials/SkyboxMaterial.ts#L34) | core/Scene.ts | 0..1 — sun occlusion factor. Multiplies directional light intensity. |
| `rotationMatrix` | [scene/Skybox.ts:8](src/scene/Skybox.ts#L8) | OceanMaterial (sky reflection), Skybox shader | Skybox orientation matrix for analytical sky sampling. |

## Ocean — [materials/OceanMaterial.ts](src/materials/OceanMaterial.ts)

All uniforms here are shared with island objects that need ocean-aware lighting (via `applyOceanLightingToModel` in [scene/Island.ts](src/scene/Island.ts)) and seafloor decor (via [scene/SeaFloorDecor.ts](src/scene/SeaFloorDecor.ts)).

### Lighting & fog
| Uniform | Line | Purpose |
|---|---|---|
| `oceanAbsorptionUniform` | [36](src/materials/OceanMaterial.ts#L36) | RGB absorption coefficients (Beer-Lambert depth tint). |
| `underwaterFogDistUniform` | [37](src/materials/OceanMaterial.ts#L37) | Fog falloff distance underwater. |
| `spotLightDistanceUniform` | [23](src/materials/OceanMaterial.ts#L23) | Caustic spotlight reach. |

### Waves
| Uniform | Line | Purpose |
|---|---|---|
| `normalMapScaleUniform` | [39](src/materials/OceanMaterial.ts#L39) | UV scale for water normal maps. |
| `normalMapStrengthUniform` | [40](src/materials/OceanMaterial.ts#L40) | Normal perturbation strength. |
| `waveVelocity1Uniform` / `waveVelocity2Uniform` | [41-42](src/materials/OceanMaterial.ts#L41) | Two scrolling layers, different directions. |
| `edgeFadeDistanceUniform` | [44](src/materials/OceanMaterial.ts#L44) | Distance over which ocean alpha fades to 0 at horizon. |

### Foam (island silhouette mask + animated lines)
`foamMaskUniform`, `foamMaskCenterUniform`, `foamMaskSizeUniform` — texture + UV window. The mask itself is generated at runtime by [effects/FoamMask.ts](src/effects/FoamMask.ts).
Lines [47-65](src/materials/OceanMaterial.ts#L47). All other `foam*Uniform` entries are runtime-tweakable foam appearance.

### Sky reflection
`reflectionFresnelPowerUniform`, `reflectionFloorUniform`, `skyReflectionBrightnessUniform`, `skyReflFalloffUniform` — lines [72-75](src/materials/OceanMaterial.ts#L72). Analytical (no render target).

### Surface look
`surfaceColorUniform`, `surfaceOpacityUniform`, `waterBlurStrengthUniform`, `waterBlurRadiusUniform`, `waterBlurOpacityUniform`, `waterlineCompositeOpacityUniform` — lines [78-83](src/materials/OceanMaterial.ts#L78).

### Scene capture (for refraction)
| Uniform | Line | Purpose |
|---|---|---|
| `sceneColorUniform` | [87](src/materials/OceanMaterial.ts#L87) | `FramebufferTexture` of the main scene render — sampled by ocean fragment for refraction/blur. |
| `sceneResolutionUniform` | [88](src/materials/OceanMaterial.ts#L88) | Pixel size of the captured framebuffer. |

### Waterline (shared with grass + apple)
`waterlineYUniform`, `waterlineThicknessUniform`, `waterlineSoftnessUniform`, `waterlineColorUniform`, `waterlineIntensityUniform` — lines [93-97](src/materials/OceanMaterial.ts#L93).
**Also imported by [ProceduralGrass.ts](src/scene/ProceduralGrass.ts) and Island.ts apple waterline injection** so all three (grass tips, apples bobbing, ocean surface) share one wet-line.

### Ripples (mouse + apple impact)
`ripplesUniform`, `rippleCountUniform`, `rippleSpeedUniform`, `rippleLifetimeUniform`, `rippleWidthUniform`, `rippleNormalStrengthUniform` — lines [148-153](src/materials/OceanMaterial.ts#L148).

## SeaFloorDecor — [scene/SeaFloorDecor.ts](src/scene/SeaFloorDecor.ts)

| Uniform | Line | Purpose |
|---|---|---|
| `kelpTimeUniform` | [96](src/scene/SeaFloorDecor.ts#L96) | Driven by underwater-only update loop, not `timeUniform` (kelp sways when scene paused). |
| `kelpSwayUniform` / `kelpFreqUniform` / `kelpTopYUniform` | [97-99](src/scene/SeaFloorDecor.ts#L97) | Sway strength, frequency, top Y mask threshold. |

## Tree / bush / foliage wind (Island.ts module-private but used by all foliage)

These are not exported but are reused across every tree+bush onBeforeCompile hook. Listed here so the next person who touches foliage wind doesn't redeclare them.

| Uniform | Line | Cache key |
|---|---|---|
| `treeWindTimeUniform` | [Island.ts:1778](src/scene/Island.ts#L1778) | `tree_wind` |
| `treeWindStrengthUniform` | [Island.ts:1779](src/scene/Island.ts#L1779) | `tree_wind` |
| `treeLeafStartYUniform` / `treeLeafFullYUniform` | [Island.ts:1780-1781](src/scene/Island.ts#L1780) | `tree_wind` (smoothstep range) |
| `bushWindStrengthUniform` | [Island.ts:1782](src/scene/Island.ts#L1782) | `bush_wind` / `bush_wind_flower` |
| `foliageWindStrengthUniform` | [Island.ts:1795](src/scene/Island.ts#L1795) | `procedural_grass` |
| `grassWobbleStrengthUniform` | [Island.ts:1796](src/scene/Island.ts#L1796) | `procedural_grass` |
| `mouseWorldPos`, `mouseInfluenceRadius`, `mouseInfluenceStrength` | [Island.ts:1801-1803](src/scene/Island.ts#L1801) | `procedural_grass` — cursor sway |

## Island surface grass-blend + campfire ground glow

All module-private, defined [Island.ts:1876-1889](src/scene/Island.ts#L1876). Cache key `island_surface_grass_filter`. Drive the painted-grass effect on the island ground mesh + the orange firepit floor tint.

---

## Adding a new shared uniform

1. Construct it **once** in the most natural owning file (ocean params → OceanMaterial; time-based → Time; foliage → Island wind block).
2. `export const xyzUniform = new Uniform(...)` — always name `xyzUniform`.
3. In every reader: `shader.uniforms.uXyz = xyzUniform;` — pass the *object*, never `.value`.
4. **Set `customProgramCacheKey`** on every material that injects it; otherwise Three.js may serve a cached program from a sibling material with different uniforms.
5. Add a row above.

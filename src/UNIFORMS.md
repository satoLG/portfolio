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

### Surface vertex displacement (near-camera swell)
Real geometry waves applied only to the strip ahead of the camera (vertex shader); amplitude fades to flat with distance + behind the camera. Read by the `surface` material's vertex shader. `_CameraForward` reuses the shared `cameraForward` Vector3 from [core/Scene.ts](src/core/Scene.ts).
| Uniform | Line | Purpose |
|---|---|---|
| `surfaceWaveAmplitudeUniform` | [47](src/materials/OceanMaterial.ts#L47) | Max vertical vertex displacement near the camera. |
| `surfaceWaveLengthUniform` | [48](src/materials/OceanMaterial.ts#L48) | Wavelength (world units) of the displacement. |
| `surfaceWaveSpeedUniform` | [49](src/materials/OceanMaterial.ts#L49) | Animation speed of the swell. |
| `surfaceWaveRangeUniform` | [50](src/materials/OceanMaterial.ts#L50) | XZ distance from camera over which displacement fades to flat. |
| `surfaceWaveForwardBiasUniform` | [51](src/materials/OceanMaterial.ts#L51) | 0 = radial ring around camera, 1 = only ahead of camera heading. |
| `surfaceWaveSteepnessUniform` | [52](src/materials/OceanMaterial.ts#L52) | Cross-wave layer blend — adds choppiness. |

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

### Waterline Y (apple buoyancy)
`waterlineYUniform` — the canonical sea level. Read by `_applyAppleBuoyancy` in [Island.ts](src/scene/Island.ts) to position floating apples. The visible foam at the water-object intersection is now drawn by the ocean shader's depth-intersection pass (see Edge Foam below) — no per-object waterline glow.

### Edge foam (depth-intersection foam on the ocean side)
`sceneDepthUniform`, `cameraNearUniform`, `cameraFarUniform`, `edgeFoamWidthUniform`, `edgeFoamIntensityUniform`, `edgeFoamColorUniform` — declared in [OceanMaterial.ts](src/materials/OceanMaterial.ts). The depth texture is filled each frame by [SceneDepth.ts](src/effects/SceneDepth.ts) via a `MeshDepthMaterial` override pass; the ocean fragment shader linearizes both `gl_FragCoord.z` and the sampled scene depth and brightens fragments where the difference is below `edgeFoamWidth`.

`edgeFoamFadeStartZUniform`, `edgeFoamFadeEndZUniform` — declared in [OceanMaterial.ts](src/materials/OceanMaterial.ts). Fade the edge foam out by **world Z** (not camera distance) so the contact line stays fixed while the foam vanishes toward the back of the scene. Foam is full strength at/above `FadeStartZ` and fully gone at/below `FadeEndZ` (Z decreases toward the back). Values are picked per-device at module load from `OceanConfig` (`edgeFoamFadeStartZDesktop`/`Mobile` + `…EndZDesktop`/`Mobile`): desktop pushes the fade far behind the scene (keeps all foam, no visible cut); mobile fades the foam out in front of the flicker-prone back rocks. The depth linearization in `calcEdgeFoam` was also refactored to `far*(1-depth)+depth*near` (algebraically identical, but avoids catastrophic cancellation on iOS mediump).

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

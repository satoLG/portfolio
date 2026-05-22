# `src/materials/` — gotchas

Authoritative home for full-custom `ShaderMaterial` definitions and the shared uniforms they expose.

For the uniform map see [src/UNIFORMS.md](src/UNIFORMS.md). For the broader shader contract see [docs/SHADERS.md](docs/SHADERS.md).

## What lives here

- **OceanMaterial.ts** — `surface` (ocean top), `volume` (caustics), `object` (underwater object lighting), `triplanar` (sand). Owns ~50 exported uniforms shared with island props and seafloor decor.
- **SkyboxMaterial.ts** — analytical sky + stars + sun visibility, exposes `lightUniform` and `sunVisibilityUniform` that drive the directional light in Scene.ts.

## Rules for this folder

1. **No business logic.** Materials hold uniforms + shader code. Scene-specific behavior (where the apple is, what the radio is doing) lives in `scene/`, not here.
2. **Every shared uniform is exported.** If a value needs to be tweaked from elsewhere, export it. Anything `const _foo = new Uniform(...)` is intentional encapsulation.
3. **Add new exports to [src/UNIFORMS.md](src/UNIFORMS.md).** Mandatory.
4. **No `customProgramCacheKey` needed** in this folder — these are full `ShaderMaterial`s with isolated programs by construction. Cache keys are only needed for `onBeforeCompile` injection on `MeshStandardMaterial` (lives in `scene/`).

## Ocean lighting injection helper

`applyOceanLightingToModel(group)` is defined in [scene/Island.ts](src/scene/Island.ts), not here — even though it injects this folder's uniforms. That's because the helper is scene-aware (knows about the campfire ground glow, point light influence, etc.). If you need to add more ocean-lit objects, call the existing helper rather than re-implementing the injection.

## Adding a new full-custom material

Pattern (see OceanMaterial as reference):

```ts
import { ShaderMaterial, Uniform, Vector3 } from 'three';
import { timeUniform } from '../core/Time';

export const myUniform = new Uniform(new Vector3(...));   // export — log in UNIFORMS.md

export const material = new ShaderMaterial({
    uniforms: {
        uTime: timeUniform,    // shared, by reference
        uMy: myUniform,
    },
    vertexShader: /* glsl */`...`,
    fragmentShader: /* glsl */`...`,
    transparent: true,         // be deliberate; affects depth sort
    depthWrite: false,         // if transparent + needs to not occlude
    side: DoubleSide,          // if visible from both sides
});
```

If the shader gets large (>30 lines), move it to [src/shaders/](src/shaders/) and import via `vite-plugin-glsl`.

## Scene-color capture flow (refraction)

Ocean refraction works because:
1. Main scene renders into the default framebuffer.
2. `captureSceneColor(renderer)` (in OceanMaterial.ts) does `renderer.copyFramebufferToTexture(_fbOffset, sceneColorTexture)`.
3. `Ocean.RenderSurface` runs *after* the main render, sampling `sceneColorUniform` for what's behind the water.

This means: if you add a transparent surface that needs to be visible *under* the water, it must render before `Ocean.RenderSurface`. Underwater transparents (fish, bubbles) re-render *after* in a special pass — see [core/Scene.ts:177](src/core/Scene.ts#L177).

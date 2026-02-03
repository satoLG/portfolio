import { Group, TextureLoader, RepeatWrapping, SRGBColorSpace, MeshStandardMaterial, Material, Texture, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { oceanAbsorptionUniform } from "../materials/OceanMaterial";
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial";
import { deltaTime } from "../scripts/Time";

export const island = new Group();
export const firecamp = new Group();
export const palmtree = new Group();
export const radio = new Group();
export const grassPatches: Group[] = [];

// Store palm tree leaves for wind animation
const palmLeaves: Object3D[] = [];

const loader = new GLTFLoader();
const textureLoader = new TextureLoader();

const SAND_TEXTURE_PATH = 'textures/sand_04_2k/';
const CONCRETE_TEXTURE_PATH = 'textures/concrete_wall_01_2k/';
const ROCKS_TEXTURE_PATH = 'textures/ground_with_rocks_01_1k/';
const GRASS_TEXTURE_PATH = 'textures/rocky_terrain_02_2k/';

const sandColorMap = textureLoader.load(SAND_TEXTURE_PATH + 'sand_04_color_2k.png');
const sandNormalMap = textureLoader.load(SAND_TEXTURE_PATH + 'sand_04_normal_gl_2k.png');
const sandRoughnessMap = textureLoader.load(SAND_TEXTURE_PATH + 'sand_04_roughness_2k.png');
const sandAOMap = textureLoader.load(SAND_TEXTURE_PATH + 'sand_04_ambient_occlusion_2k.png');
const sandDisplacementMap = textureLoader.load(SAND_TEXTURE_PATH + 'sand_04_height_2k.png');

const concreteColorMap = textureLoader.load(CONCRETE_TEXTURE_PATH + 'concrete_wall_01_color_2k.png');
const concreteNormalMap = textureLoader.load(CONCRETE_TEXTURE_PATH + 'concrete_wall_01_normal_gl_2k.png');
const concreteRoughnessMap = textureLoader.load(CONCRETE_TEXTURE_PATH + 'concrete_wall_01_roughness_2k.png');
const concreteAOMap = textureLoader.load(CONCRETE_TEXTURE_PATH + 'concrete_wall_01_ambient_occlusion_2k.png');
const concreteDisplacementMap = textureLoader.load(CONCRETE_TEXTURE_PATH + 'concrete_wall_01_height_2k.png');

const rocksColorMap = textureLoader.load(ROCKS_TEXTURE_PATH + 'ground_with_rocks_01_color_1k.png');

const grassColorMap = textureLoader.load(GRASS_TEXTURE_PATH + 'rocky_terrain_02_diff_2k.jpg');

const allTextures: Texture[] = [
    sandColorMap, sandNormalMap, sandRoughnessMap, sandAOMap, sandDisplacementMap,
    concreteColorMap, concreteNormalMap, concreteRoughnessMap, concreteAOMap, concreteDisplacementMap,
    rocksColorMap,
    grassColorMap
];

allTextures.forEach(texture => {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(4, 4);
});

sandColorMap.colorSpace = SRGBColorSpace;
concreteColorMap.colorSpace = SRGBColorSpace;
rocksColorMap.colorSpace = SRGBColorSpace;
grassColorMap.colorSpace = SRGBColorSpace;

// Height blend settings - tweak these to control texture layers
// These are WORLD Y coordinates (not local model coordinates)
// Island is at Y=-0.115, scaled 1.8x
//
// ROCKS: solid below START, blends to sand until END
// GRASS: starts blending in at START, fully grass above END
export let ROCKS_BLEND_START = -0.1;   // Start fading out rocks just below ocean
export let ROCKS_BLEND_END = 0.05;     // Fully sand just above ocean level
export let GRASS_BLEND_START = 0.07;   // Grass starts just above sand transition
export let GRASS_BLEND_END = 0.10;     // Fully grass at peak

// Grass color adjustments
export let GRASS_SATURATION = 2.5;  // >1 = more saturated, <1 = less
export let GRASS_BRIGHTNESS = 1.2;  // >1 = brighter, <1 = darker

let currentTexture = 'sand';
let textureBlend = 0.0;
let targetBlend = 0.0;
const blendSpeed = 2.0;

interface BlendableMaterial {
    material: Material;
    blendUniform: { value: number };
}

const blendableMaterials: BlendableMaterial[] = [];

export function toggleIslandTexture(): string {
    if (currentTexture === 'sand') {
        currentTexture = 'concrete';
        targetBlend = 1.0;
    } else {
        currentTexture = 'sand';
        targetBlend = 0.0;
    }
    return currentTexture;
}

export function getCurrentTexture(): string {
    return currentTexture;
}

const islandPosition = { x: 0, y: -0.115, z: -3.3 };
const firecampOffset = { x: 0, y: 0.2, z: 0.4 };
const palmtreeOffset = { x: -0.35, y: 0.1, z: -0.3 };
const radioOffset = { x: -0.65, y: 0.2, z: 0.15 };  // In front of firecamp, left of center

const islandScale = 1.5;
const firecampScale = 0.4;
const palmtreeScale = 0.75;
const radioScale = 0.22;

// GRASS SETTINGS - easily tweakable
const GRASS_COUNT = 8;  // Number of grass patches
const grassScale = 0.22;
const grassSpread = 0.85;  // How far grass spreads from palm tree
const grassBaseOffset = { x: 0.0, y: 0.05, z: 0.68 };  // Base position near palm tree

// WIND SETTINGS - easily tweakable
const WIND_STRENGTH = 0.0;      // How far things sway (rotation in radians)
const WIND_SPEED = 0.0;          // Base speed of wind oscillation
const WIND_GUST_INTERVAL = 0.0;  // Seconds between wind gusts
const WIND_GUST_DURATION = 0.0;  // How long a gust lasts
let windTime = 0;
let gustTimer = 0;
let gustActive = false;
let gustStrength = 0;

const oceanLightingPars = /*glsl*/`
    uniform vec3 uLight;
    uniform vec3 uAbsorption;
    uniform float uSunVisibility;
    
    const float MAX_VIEW_DEPTH = 80.0;
    const float DENSITY = 0.35;
    const float FOG_DISTANCE = 600.0;
`;

const oceanLightingFragment = /*glsl*/`
    vec3 worldPos = vWorldPosition;
    vec3 viewVec = worldPos - cameraPosition;
    float viewLen = length(viewVec);
    vec3 viewDir = viewVec / viewLen;
    
    if (worldPos.y > 0.0) {
        float fogStartLen = viewLen;
        if (cameraPosition.y < 0.0) {
            fogStartLen -= cameraPosition.y / -viewDir.y;
        }
        float fog = clamp(fogStartLen / FOG_DISTANCE, 0.0, 1.0);
        fog = fog * fog;
        vec3 horizonColor = mix(vec3(0.07, 0.13, 0.18), vec3(0.7, 0.85, 0.95), uSunVisibility);
        outgoingLight = mix(outgoingLight, horizonColor, fog);
    }
    else {
        float uwLen = viewLen;
        float originY = cameraPosition.y;
        if (cameraPosition.y > 0.0) {
            uwLen -= cameraPosition.y / -viewDir.y;
            originY = 0.0;
        }
        uwLen = min(uwLen, MAX_VIEW_DEPTH);
        float sampleY = originY + viewDir.y * uwLen;
        vec3 underwaterLight = exp((sampleY - uwLen * DENSITY) * uAbsorption) * uLight;
        outgoingLight *= underwaterLight;
        float uwFog = min(uwLen / MAX_VIEW_DEPTH, 1.0);
        outgoingLight = mix(outgoingLight, underwaterLight * 0.3, uwFog);
    }
`;

function applyIslandMaterial(material: MeshStandardMaterial, blendUniform: { value: number }): void {
    if (!material.isMeshStandardMaterial && !(material as any).isMeshPhysicalMaterial && !(material as any).isMeshBasicMaterial) {
        console.log('Skipping material:', material.type);
        return;
    }
    
    console.log('Applying island material to:', material.type, material.name);
    
    material.customProgramCacheKey = () => {
        return 'island_blend_ocean_' + material.uuid;
    };
    
    material.onBeforeCompile = (shader) => {
        console.log('onBeforeCompile triggered for:', material.type);
        
        shader.uniforms.uLight = lightUniform;
        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
        shader.uniforms.uSunVisibility = sunVisibilityUniform;
        
        shader.uniforms.uTextureBlend = blendUniform;
        shader.uniforms.uSandMap = { value: sandColorMap };
        shader.uniforms.uConcreteMap = { value: concreteColorMap };
        shader.uniforms.uRocksMap = { value: rocksColorMap };
        shader.uniforms.uGrassMap = { value: grassColorMap };
        shader.uniforms.uTextureScale = { value: 0.5 };
        shader.uniforms.uRocksBlendStart = { value: ROCKS_BLEND_START };
        shader.uniforms.uRocksBlendEnd = { value: ROCKS_BLEND_END };
        shader.uniforms.uGrassBlendStart = { value: GRASS_BLEND_START };
        shader.uniforms.uGrassBlendEnd = { value: GRASS_BLEND_END };
        shader.uniforms.uGrassSaturation = { value: GRASS_SATURATION };
        shader.uniforms.uGrassBrightness = { value: GRASS_BRIGHTNESS };
        
        (material as any).userData.oceanUniforms = shader.uniforms;
        
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vWorldPosition;
            varying vec3 vWorldNormal;`
        );
        
        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);`
        );
        
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vWorldPosition;
            varying vec3 vWorldNormal;
            
            uniform float uTextureBlend;
            uniform sampler2D uSandMap;
            uniform sampler2D uConcreteMap;
            uniform sampler2D uRocksMap;
            uniform sampler2D uGrassMap;
            uniform float uTextureScale;
            uniform float uRocksBlendStart;
            uniform float uRocksBlendEnd;
            uniform float uGrassBlendStart;
            uniform float uGrassBlendEnd;
            uniform float uGrassSaturation;
            uniform float uGrassBrightness;
            
            vec3 adjustSaturation(vec3 color, float saturation) {
                float grey = dot(color, vec3(0.299, 0.587, 0.114));
                return mix(vec3(grey), color, saturation);
            }
            
            vec4 triplanarSample(sampler2D tex, vec3 worldPos, vec3 worldNormal, float scale) {
                vec3 blendWeights = abs(worldNormal);
                blendWeights = pow(blendWeights, vec3(4.0));
                blendWeights = blendWeights / (blendWeights.x + blendWeights.y + blendWeights.z);
                
                vec3 scaledPos = worldPos * scale;
                vec4 xProj = texture2D(tex, scaledPos.yz);
                vec4 yProj = texture2D(tex, scaledPos.xz);
                vec4 zProj = texture2D(tex, scaledPos.xy);
                
                return xProj * blendWeights.x + yProj * blendWeights.y + zProj * blendWeights.z;
            }
            
            ${oceanLightingPars}`
        );
        
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `vec4 sandColor = triplanarSample(uSandMap, vWorldPosition, vWorldNormal, uTextureScale);
            vec4 concreteColor = triplanarSample(uConcreteMap, vWorldPosition, vWorldNormal, uTextureScale);
            vec4 rocksColor = triplanarSample(uRocksMap, vWorldPosition, vWorldNormal, uTextureScale);
            vec4 grassColor = triplanarSample(uGrassMap, vWorldPosition, vWorldNormal, uTextureScale);
            
            // Boost grass color saturation and brightness
            grassColor.rgb = adjustSaturation(grassColor.rgb, uGrassSaturation) * uGrassBrightness;
            
            // Middle layer: blend between sand and concrete based on button toggle
            vec4 middleTexture = mix(sandColor, concreteColor, uTextureBlend);
            
            // Bottom blend: rocks -> middle texture
            float rocksBlend = smoothstep(uRocksBlendStart, uRocksBlendEnd, vWorldPosition.y);
            vec4 bottomToMiddle = mix(rocksColor, middleTexture, rocksBlend);
            
            // Top blend: middle texture -> grass
            float grassBlend = smoothstep(uGrassBlendStart, uGrassBlendEnd, vWorldPosition.y);
            vec4 blendedTexture = mix(bottomToMiddle, grassColor, grassBlend);
            
            diffuseColor *= blendedTexture;`
        );
        
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `${oceanLightingFragment}
            #include <dithering_fragment>`
        );
        
        console.log('Island shader modified with triplanar blending and ocean lighting');
    };
    
    material.needsUpdate = true;
}

function applyOceanLightingToModel(model: Group): void {
    model.traverse((child) => {
        if ((child as any).isMesh && (child as any).material) {
            const mesh = child as any;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat: any) => {
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshBasicMaterial) {
                    mat.customProgramCacheKey = () => 'ocean_' + mat.uuid;
                    mat.onBeforeCompile = (shader: any) => {
                        shader.uniforms.uLight = lightUniform;
                        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
                        shader.uniforms.uSunVisibility = sunVisibilityUniform;
                        
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <common>',
                            `#include <common>
                            varying vec3 vWorldPosition;`
                        );
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <worldpos_vertex>',
                            `#include <worldpos_vertex>
                            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`
                        );
                        shader.fragmentShader = shader.fragmentShader.replace(
                            '#include <common>',
                            `#include <common>
                            varying vec3 vWorldPosition;
                            ${oceanLightingPars}`
                        );
                        shader.fragmentShader = shader.fragmentShader.replace(
                            '#include <dithering_fragment>',
                            `${oceanLightingFragment}
                            #include <dithering_fragment>`
                        );
                    };
                    mat.needsUpdate = true;
                }
            });
        }
    });
}

function applyIslandTextures(model: Group): void {
    model.traverse((child) => {
        if ((child as any).isMesh && (child as any).material) {
            const mesh = child as any;
            // Enable shadow receiving on the mesh itself
            mesh.receiveShadow = true;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            
            materials.forEach((material: any) => {
                if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
                    console.log('Setting up island material for:', mesh.name);
                    
                    material.map = null;
                    material.normalMap = null;
                    material.roughnessMap = null;
                    material.aoMap = null;
                    material.displacementMap = null;
                    
                    material.roughness = 0.9;
                    material.metalness = 0.0;
                    
                    const blendUniform = { value: 0.0 };
                    blendableMaterials.push({ material, blendUniform });
                    
                    applyIslandMaterial(material, blendUniform);
                }
            });
        }
    });
}

export function Start(): void {
    loader.load(
        'models/island.glb',
        (gltf) => {
            applyIslandTextures(gltf.scene);
            island.add(gltf.scene);
            island.position.set(islandPosition.x, islandPosition.y, islandPosition.z);
            island.scale.setScalar(islandScale);
            console.log('Island loaded with texture blending and ocean lighting');
        },
        (progress) => {
            console.log('Island loading:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => {
            console.error('Error loading island:', error);
        }
    );

    loader.load(
        'models/firecamp.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            firecamp.add(gltf.scene);
            firecamp.position.set(
                islandPosition.x + firecampOffset.x,
                islandPosition.y + firecampOffset.y,
                islandPosition.z + firecampOffset.z
            );
            firecamp.scale.setScalar(firecampScale);
            console.log('Firecamp loaded with ocean lighting');
        },
        (progress) => {
            console.log('Firecamp loading:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => {
            console.error('Error loading firecamp:', error);
        }
    );

    loader.load(
        'models/palmtree.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            // Enable shadow casting and find leaves
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    // Try to identify leaves by name (common naming conventions)
                    const name = child.name.toLowerCase();
                    if (name.includes('leaf') || name.includes('leaves') || name.includes('frond') || name.includes('palm') && !name.includes('trunk')) {
                        palmLeaves.push(child);
                        console.log('Found palm leaf:', child.name);
                    }
                }
            });
            // If no leaves found by name, use all meshes except the lowest one (trunk)
            if (palmLeaves.length === 0) {
                const meshes: Object3D[] = [];
                gltf.scene.traverse((child) => {
                    if ((child as any).isMesh) {
                        meshes.push(child);
                    }
                });
                // Sort by Y position, take upper meshes as leaves
                meshes.sort((a, b) => a.position.y - b.position.y);
                if (meshes.length > 1) {
                    // Skip the bottom mesh (trunk), add rest as leaves
                    for (let i = 1; i < meshes.length; i++) {
                        palmLeaves.push(meshes[i]);
                    }
                    console.log('Auto-detected', palmLeaves.length, 'palm leaf meshes');
                } else if (meshes.length === 1) {
                    // Only one mesh, animate the whole thing
                    palmLeaves.push(meshes[0]);
                    console.log('Single mesh palm tree, animating entire model');
                }
            }
            palmtree.add(gltf.scene);
            palmtree.position.set(
                islandPosition.x + palmtreeOffset.x,
                islandPosition.y + palmtreeOffset.y,
                islandPosition.z + palmtreeOffset.z
            );
            palmtree.scale.setScalar(palmtreeScale);
            console.log('Palm tree loaded with ocean lighting');
        },
        (progress) => {
            console.log('Palm tree loading:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => {
            console.error('Error loading palm tree:', error);
        }
    );

    // Load grass patches around the palm tree
    loader.load(
        'models/grass.glb',
        (gltf) => {
            for (let i = 0; i < GRASS_COUNT; i++) {
                const grassPatch = new Group();
                const grassModel = gltf.scene.clone();
                applyOceanLightingToModel(grassModel);
                grassPatch.add(grassModel);
                
                // Spread grass around palm tree in a semicircle
                const angle = (i / GRASS_COUNT) * Math.PI - Math.PI / 2;
                const spreadX = Math.cos(angle) * grassSpread;
                const spreadZ = Math.sin(angle) * grassSpread * 0.5;
                
                grassPatch.position.set(
                    islandPosition.x + palmtreeOffset.x + grassBaseOffset.x + spreadX,
                    islandPosition.y + grassBaseOffset.y,
                    islandPosition.z + palmtreeOffset.z + grassBaseOffset.z + spreadZ
                );
                grassPatch.scale.setScalar(grassScale);
                grassPatch.rotation.y = Math.random() * Math.PI * 2;  // Random rotation
                grassPatches.push(grassPatch);
            }
            console.log(`${GRASS_COUNT} grass patches loaded`);
        },
        undefined,
        (error) => {
            console.error('Error loading grass:', error);
        }
    );

    // Load radio in front of firecamp
    loader.load(
        'models/radio.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            radio.add(gltf.scene);
            radio.position.set(
                islandPosition.x + radioOffset.x,
                islandPosition.y + radioOffset.y,
                islandPosition.z + radioOffset.z
            );
            radio.scale.setScalar(radioScale);
            radio.rotation.y = 0.3;  // Angle it slightly
            console.log('Radio loaded with ocean lighting');
        },
        undefined,
        (error) => {
            console.error('Error loading radio:', error);
        }
    );
}

export function Update(): void {
    // Texture blend animation
    if (textureBlend !== targetBlend) {
        const diff = targetBlend - textureBlend;
        const step = blendSpeed * deltaTime;
        
        if (Math.abs(diff) < step) {
            textureBlend = targetBlend;
        } else {
            textureBlend += Math.sign(diff) * step;
        }
        
        blendableMaterials.forEach(({ blendUniform }) => {
            blendUniform.value = textureBlend;
        });
    }
    
    // Wind animation for grass and palm tree
    windTime += deltaTime;
    gustTimer += deltaTime;
    
    // Trigger gusts periodically
    if (!gustActive && gustTimer > WIND_GUST_INTERVAL) {
        gustActive = true;
        gustTimer = 0;
    }
    
    // Gust strength ramps up and down
    if (gustActive) {
        const gustProgress = gustTimer / WIND_GUST_DURATION;
        if (gustProgress < 0.3) {
            gustStrength = gustProgress / 0.3;  // Ramp up
        } else if (gustProgress < 0.7) {
            gustStrength = 1.0;  // Hold
        } else if (gustProgress < 1.0) {
            gustStrength = (1.0 - gustProgress) / 0.3;  // Ramp down
        } else {
            gustActive = false;
            gustStrength = 0;
            gustTimer = 0;
        }
    }
    
    // Calculate wind sway (to the left = negative X rotation from camera view = positive Z rotation)
    const baseWind = Math.sin(windTime * WIND_SPEED) * 0.3;  // Subtle constant sway
    const gustWind = gustStrength * Math.sin(windTime * WIND_SPEED * 2) * 1.0;  // Stronger during gusts
    const totalWind = (baseWind + gustWind) * WIND_STRENGTH;
    
    // Apply to grass patches
    grassPatches.forEach((patch, i) => {
        // Each grass patch has slightly different phase
        const phase = i * 0.5;
        const patchWind = Math.sin(windTime * WIND_SPEED + phase) * 0.3 + gustWind;
        patch.rotation.z = patchWind * WIND_STRENGTH;
        patch.rotation.x = patchWind * WIND_STRENGTH * 0.3;  // Slight forward/back
    });
    
    // Apply to palm tree leaves only (not the trunk)
    palmLeaves.forEach((leaf, i) => {
        const phase = i * 0.3;
        const leafWind = Math.sin(windTime * WIND_SPEED + phase) * 0.3 + gustWind;
        leaf.rotation.z = leafWind * WIND_STRENGTH * 0.5;
        leaf.rotation.x = leafWind * WIND_STRENGTH * 0.15;
    });
}

import { Group, TextureLoader, RepeatWrapping, SRGBColorSpace, MeshStandardMaterial, Texture, Object3D, LoadingManager, RingGeometry, MeshBasicMaterial, Mesh, DoubleSide, Uniform, Vector2, Vector3, Raycaster } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { oceanAbsorptionUniform } from "../materials/OceanMaterial";
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial";
import { deltaTime, time } from "../scripts/Time";
import { getIsPlaying } from "../scripts/MediaPlayer";
import { isBreezeActive } from "../scripts/Audio";
import { camera } from "../scripts/Scene";

export const island = new Group();
export const firecamp = new Group();
export const palmtree = new Group();
export const radio = new Group();
export const sword = new Group();
export const grassPatches: Group[] = [];

// Store palm tree leaves for wind animation
const palmLeaves: Object3D[] = [];

// Sound wave arcs for radio
interface SoundWave {
    mesh: Mesh;
    progress: number;  // 0 to 1
    side: 'left' | 'right';
    isTrailing: boolean;  // Is this the second wave in a pair
}
const soundWaves: SoundWave[] = [];
const WAVE_COUNT = 8;  // Max waves at a time (pairs of 2 on each side)
let lastBounceUp = false;  // Track bounce direction to spawn on peaks

// Loading manager for progress tracking
const loadingManager = new LoadingManager();
let loadingProgress = 0;
let onLoadingProgress: ((progress: number) => void) | null = null;

loadingManager.onProgress = (_url, loaded, total) => {
    // Update progress based on items loaded
    loadingProgress = loaded / total;
    if (onLoadingProgress) {
        onLoadingProgress(loadingProgress);
    }
};

loadingManager.onLoad = () => {
    loadingProgress = 1;
    if (onLoadingProgress) {
        onLoadingProgress(1);
    }
};

// Export function to set loading callback
export function setLoadingCallback(callback: (progress: number) => void): void {
    onLoadingProgress = callback;
}

// Export to get current loading progress
export function getLoadingProgress(): number {
    return loadingProgress;
}

const loader = new GLTFLoader(loadingManager);
const textureLoader = new TextureLoader();

const SAND_TEXTURE_PATH = 'textures/concrete_wall_01_2k/';
const ROCKS_TEXTURE_PATH = 'textures/ground_with_rocks_01_1k/';
const GRASS_TEXTURE_PATH = 'textures/rocky_terrain_02_2k/';


// Only load color maps — normal/roughness/AO/height were never used by shaders (~64MB saved)
const sandColorMap = textureLoader.load(SAND_TEXTURE_PATH + 'concrete_wall_01_color_2k.png');
const rocksColorMap = textureLoader.load(ROCKS_TEXTURE_PATH + 'ground_with_rocks_01_color_1k.png');
const grassColorMap = textureLoader.load(GRASS_TEXTURE_PATH + 'rocky_terrain_02_diff_2k.jpg');

const allTextures: Texture[] = [
    sandColorMap,
    rocksColorMap,
    grassColorMap
];

allTextures.forEach(texture => {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(4, 4);
});

sandColorMap.colorSpace = SRGBColorSpace;
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

const islandPosition = { x: 0, y: -0.115, z: -3.3 };
const firecampOffset = { x: 0, y: 0.25, z: 0.4 };
const palmtreeOffset = { x: -0.35, y: 0.1, z: -0.3 };
const radioOffset = { x: -0.65, y: 0.23, z: 0.20 };  // In front of firecamp, left of center
const swordOffset = { x: 0.08, y: 0.58, z: 0.4 };  // Stuck in the middle of the bonfire

const islandScale = 1.5;
const firecampScale = 1.4;
const palmtreeScale = 0.75;
const radioScale = 0.22;
const swordScale = 0.25;

// Radio vibration settings
let radioTime = 0;
const radioBaseY = islandPosition.y + radioOffset.y;
const radioVibeStrength = 0.003;  // Very subtle bounce
const radioVibeSpeed = 12;  // Quick vibration

// GRASS/CLOVER SPAWN SETTINGS
const MIN_DISTANCE_FROM_CENTER = 0.35;  // TWEAK: Minimum distance to avoid bonfire
const MAX_DISTANCE = 0.65;  // TWEAK: Maximum spread distance

// GRASS SETTINGS - easily tweakable
const GRASS_COUNT = 32;  // Number of grass patches
const grassScale = 0.22;
const grassBaseOffset = { x: 0.4, y: 0.07, z: 0.6 };  // Base position near palm tree

// CLOVER SETTINGS
const CLOVER_COUNT = 10;  // Number of clover patches
const cloverScale = 0.15;
const cloverBaseOffset = { x: 0.4, y: 0.14, z: 0.6 };  // Same Y as grass for consistency

// PALM TREE WIND SETTINGS - easily tweakable
const PALM_WIND_STRENGTH = 0.03;    // TWEAK: How much leaves sway (0.05-0.3)
const PALM_WIND_SPEED = 0.5;       // TWEAK: Speed of wind oscillation (0.5-3.0)
const PALM_LEAF_START_Y = 0.015;     // TWEAK: Y height where leaves start swaying (local coords)
const PALM_LEAF_FULL_Y = 0.30;      // TWEAK: Y height where full sway happens

// Wind uniforms for shader
const palmWindTimeUniform = new Uniform(0.0);
const palmWindStrengthUniform = new Uniform(PALM_WIND_STRENGTH);
const palmLeafStartYUniform = new Uniform(PALM_LEAF_START_Y);
const palmLeafFullYUniform = new Uniform(PALM_LEAF_FULL_Y);

// FOLIAGE (GRASS/CLOVER) WIND SETTINGS - independent from palm
const FOLIAGE_WIND_STRENGTH = 0.035;  // TWEAK: Very subtle sway
// const FOLIAGE_WIND_SPEED = 0.8;       // TWEAK: Slow gentle movement
const foliageWindStrengthUniform = new Uniform(FOLIAGE_WIND_STRENGTH);

// Mouse interaction for grass
const raycaster = new Raycaster();
const mouse = new Vector2();
const mouseWorldPos = new Uniform(new Vector3(0, -100, 0));  // Far away by default
const mouseInfluenceRadius = new Uniform(0.25);  // TWEAK: Small area
const mouseInfluenceStrength = new Uniform(0.025);  // TWEAK: Very subtle bend
// let isMouseOverGrass = false;

// BREEZE-DRIVEN WIND SETTINGS
const BREEZE_RAMP_UP = 1.0;           // Seconds to ramp up wind when breeze starts
const BREEZE_RAMP_DOWN = 4.0;         // Seconds to fade out wind after breeze ends
const BREEZE_GRASS_STRENGTH = 0.08;   // How far grass patches sway (rotation radians)
let windTime = 0;
let breezeIntensity = 0;              // 0-1 smoothed breeze envelope

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

function applyIslandMaterial(material: MeshStandardMaterial): void {
    if (!material.isMeshStandardMaterial && !(material as any).isMeshPhysicalMaterial && !(material as any).isMeshBasicMaterial) {
        console.log('Skipping material:', material.type);
        return;
    }
    
    console.log('Applying island material to:', material.type, material.name);
    
    material.customProgramCacheKey = () => {
        return 'island_ocean_' + material.uuid;
    };
    
    material.onBeforeCompile = (shader) => {
        console.log('onBeforeCompile triggered for:', material.type);
        
        shader.uniforms.uLight = lightUniform;
        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
        shader.uniforms.uSunVisibility = sunVisibilityUniform;
        
        shader.uniforms.uSandMap = { value: sandColorMap };
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
            
            uniform sampler2D uSandMap;
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
            vec4 rocksColor = triplanarSample(uRocksMap, vWorldPosition, vWorldNormal, uTextureScale);
            vec4 grassColor = triplanarSample(uGrassMap, vWorldPosition, vWorldNormal, uTextureScale);
            
            // Boost grass color saturation and brightness
            grassColor.rgb = adjustSaturation(grassColor.rgb, uGrassSaturation) * uGrassBrightness;
            
            // Bottom blend: rocks -> sand
            float rocksBlend = smoothstep(uRocksBlendStart, uRocksBlendEnd, vWorldPosition.y);
            vec4 bottomToMiddle = mix(rocksColor, sandColor, rocksBlend);
            
            // Top blend: sand -> grass
            float grassBlend = smoothstep(uGrassBlendStart, uGrassBlendEnd, vWorldPosition.y);
            vec4 blendedTexture = mix(bottomToMiddle, grassColor, grassBlend);
            
            diffuseColor *= blendedTexture;`
        );
        
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `${oceanLightingFragment}
            #include <dithering_fragment>`
        );
        
        console.log('Island shader modified with triplanar blending (rocks->sand->grass) and ocean lighting');
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
                    mat.customProgramCacheKey = () => 'ocean_lighting';
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

// Apply wind animation shader to palm tree
function applyPalmWindShader(model: Group): void {
    model.traverse((child) => {
        if ((child as any).isMesh && (child as any).material) {
            const mesh = child as any;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat: any) => {
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshBasicMaterial) {
                    mat.customProgramCacheKey = () => 'palm_wind';
                    mat.onBeforeCompile = (shader: any) => {
                        console.log('🌴 Palm wind shader compiling!');
                        // Add ocean lighting uniforms
                        shader.uniforms.uLight = lightUniform;
                        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
                        shader.uniforms.uSunVisibility = sunVisibilityUniform;
                        // Add wind uniforms
                        shader.uniforms.uWindTime = palmWindTimeUniform;
                        shader.uniforms.uWindStrength = palmWindStrengthUniform;
                        shader.uniforms.uLeafStartY = palmLeafStartYUniform;
                        shader.uniforms.uLeafFullY = palmLeafFullYUniform;
                        
                        // Vertex shader - add wind sway
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <common>',
                            `#include <common>
                            uniform float uWindTime;
                            uniform float uWindStrength;
                            uniform float uLeafStartY;
                            uniform float uLeafFullY;
                            varying vec3 vWorldPosition;`
                        );
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <begin_vertex>',
                            `#include <begin_vertex>
                            // Only leaves sway — smoothstep filters by vertex Y
                            float heightFactor = smoothstep(uLeafStartY, uLeafFullY, position.y);
                            // Multi-frequency flickering for natural chaotic wind
                            float flicker = sin(uWindTime * 2.5 + position.x * 2.0) * 0.5
                                          + sin(uWindTime * 5.8 + position.z * 1.5) * 0.3
                                          + sin(uWindTime * 9.2 + position.x * 0.8 + position.z) * 0.15;
                            float windSway = flicker * uWindStrength * heightFactor;
                            float windSwayZ = flicker * uWindStrength * 0.4 * heightFactor
                                            * cos(uWindTime * 3.1 + position.z * 1.8);
                            transformed.x += windSway;
                            transformed.z += windSwayZ;`
                        );
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <worldpos_vertex>',
                            `#include <worldpos_vertex>
                            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`
                        );
                        
                        // Fragment shader - ocean lighting
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

// Apply wind animation shader to grass/clover with mouse interaction
function applyFoliageWindShader(model: Group): void {
    model.traverse((child) => {
        if ((child as any).isMesh && (child as any).material) {
            const mesh = child as any;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat: any) => {
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshBasicMaterial) {
                    // Fix transparency/depth issues
                    mat.depthWrite = true;
                    mat.alphaTest = 0.5;
                    mat.transparent = false;  // Disable transparency to fix flickering
                    mesh.renderOrder = 1;  // Render after ground
                    
                    mat.customProgramCacheKey = () => 'foliage_wind';
                    mat.onBeforeCompile = (shader: any) => {
                        // Add ocean lighting uniforms
                        shader.uniforms.uLight = lightUniform;
                        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
                        shader.uniforms.uSunVisibility = sunVisibilityUniform;
                        // Add wind uniforms - independent for foliage
                        shader.uniforms.uWindTime = palmWindTimeUniform;
                        shader.uniforms.uWindStrength = foliageWindStrengthUniform;
                        // Add mouse interaction uniforms
                        shader.uniforms.uMouseWorldPos = mouseWorldPos;
                        shader.uniforms.uMouseRadius = mouseInfluenceRadius;
                        shader.uniforms.uMouseStrength = mouseInfluenceStrength;
                        
                        // Vertex shader - add wind sway with mouse interaction
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <common>',
                            `#include <common>
                            uniform float uWindTime;
                            uniform float uWindStrength;
                            uniform vec3 uMouseWorldPos;
                            uniform float uMouseRadius;
                            uniform float uMouseStrength;
                            varying vec3 vWorldPosition;`
                        );
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <begin_vertex>',
                            `#include <begin_vertex>
                            // Subtle wind sway - gentle tilt left/right only
                            float heightFactor = smoothstep(0.0, 0.15, position.y);  // Gradual height influence
                            float windSway = sin(uWindTime * 1.5 + position.x * 3.0) * uWindStrength * heightFactor;
                            transformed.x += windSway;
                            
                            // Mouse interaction - very subtle push away from cursor
                            vec4 worldPos = modelMatrix * vec4(position, 1.0);
                            vec2 toMouse = worldPos.xz - uMouseWorldPos.xz;
                            float mouseDist = length(toMouse);
                            float mouseInfluence = smoothstep(uMouseRadius, 0.0, mouseDist) * heightFactor;
                            vec2 pushDir = normalize(toMouse + vec2(0.001));
                            transformed.x += pushDir.x * mouseInfluence * uMouseStrength;`
                        );
                        shader.vertexShader = shader.vertexShader.replace(
                            '#include <worldpos_vertex>',
                            `#include <worldpos_vertex>
                            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`
                        );
                        
                        // Fragment shader - ocean lighting
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
                    
                    applyIslandMaterial(material);
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
        'models/bonfire.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            // Enable shadow casting for firecamp
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                }
            });
            firecamp.add(gltf.scene);
            firecamp.position.set(
                islandPosition.x + firecampOffset.x,
                islandPosition.y + firecampOffset.y,
                islandPosition.z + firecampOffset.z
            );
            firecamp.scale.setScalar(firecampScale);
            console.log('Firecamp loaded with ocean lighting and shadow casting');
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
            // Apply wind shader instead of just ocean lighting
            applyPalmWindShader(gltf.scene);
            // Enable shadow casting
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    const mesh = child as any;
                    // Compute bounding box to see vertex Y range
                    mesh.geometry.computeBoundingBox();
                    const bbox = mesh.geometry.boundingBox;
                    // Log all mesh info for debugging
                    console.log('🌴 Palm mesh found:', {
                        name: child.name,
                        position: { x: mesh.position.x.toFixed(2), y: mesh.position.y.toFixed(2), z: mesh.position.z.toFixed(2) },
                        materialName: mesh.material?.name || 'unnamed',
                        vertexCount: mesh.geometry?.attributes?.position?.count || 0,
                        boundingBoxY: bbox ? { min: bbox.min.y.toFixed(2), max: bbox.max.y.toFixed(2) } : 'N/A'
                    });
                    // Try to identify leaves by name (common naming conventions)
                    const name = child.name.toLowerCase();
                    if (name.includes('leaf') || name.includes('leaves') || name.includes('frond') || name.includes('palm') && !name.includes('trunk')) {
                        palmLeaves.push(child);
                        console.log('  ↳ Identified as LEAF');
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
                applyFoliageWindShader(grassModel);  // Wind shader synced with palm
                grassPatch.add(grassModel);
                
                // Spread grass in full circle with min/max distance from center
                const angle = Math.random() * Math.PI * 2;  // Random angle around full circle
                const distance = MIN_DISTANCE_FROM_CENTER + Math.random() * (MAX_DISTANCE - MIN_DISTANCE_FROM_CENTER);
                const spreadX = Math.cos(angle) * distance;
                const spreadZ = Math.sin(angle) * distance;
                
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

    // Load clover patches alongside grass
    loader.load(
        'models/clover.glb',
        (gltf) => {
            for (let i = 0; i < CLOVER_COUNT; i++) {
                const cloverPatch = new Group();
                const cloverModel = gltf.scene.clone();
                applyFoliageWindShader(cloverModel);  // Wind shader synced with palm
                cloverPatch.add(cloverModel);
                
                // Spread clover in full circle with min/max distance from center
                const angle = Math.random() * Math.PI * 2;  // Random angle around full circle
                const distance = MIN_DISTANCE_FROM_CENTER + Math.random() * (MAX_DISTANCE - MIN_DISTANCE_FROM_CENTER);
                const spreadX = Math.cos(angle) * distance;
                const spreadZ = Math.sin(angle) * distance;
                
                cloverPatch.position.set(
                    islandPosition.x + palmtreeOffset.x + cloverBaseOffset.x + spreadX,
                    islandPosition.y + cloverBaseOffset.y,
                    islandPosition.z + palmtreeOffset.z + cloverBaseOffset.z + spreadZ
                );
                cloverPatch.scale.setScalar(cloverScale);
                cloverPatch.rotation.y = Math.random() * Math.PI * 2;  // Random rotation
                grassPatches.push(cloverPatch);  // Add to same array for scene management
            }
            console.log(`${CLOVER_COUNT} clover patches loaded`);
        },
        undefined,
        (error) => {
            console.error('Error loading clover:', error);
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
            radio.rotation.y = 0.0;
            console.log('Radio loaded with ocean lighting');
        },
        undefined,
        (error) => {
            console.error('Error loading radio:', error);
        }
    );

    // Load sword stuck in the middle of the bonfire
    loader.load(
        'models/sword.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            // Enable shadow casting for sword
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                }
            });
            sword.add(gltf.scene);
            sword.position.set(
                islandPosition.x + swordOffset.x,
                islandPosition.y + swordOffset.y,
                islandPosition.z + swordOffset.z
            );
            sword.scale.setScalar(swordScale);
            // Upside down and tilted diagonally towards the bonfire
            sword.rotation.set(
                Math.PI + 0.3,  // Upside down + tilt forward
                0.2,            // Slight rotation on Y axis
                -0.15           // Tilt to the side
            );
            console.log('Sword loaded with ocean lighting and shadow casting');
        },
        undefined,
        (error) => {
            console.error('Error loading sword:', error);
        }
    );

    // Setup mouse/touch event listeners for grass interaction
    setupGrassInteraction();
}

// Setup mouse and touch events for grass interaction
function setupGrassInteraction(): void {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    // Mouse move handler
    const onMouseMove = (event: MouseEvent) => {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        updateMouseWorldPosition();
    };

    // Touch move handler
    const onTouchMove = (event: TouchEvent) => {
        if (event.touches.length > 0) {
            const touch = event.touches[0];
            mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
            updateMouseWorldPosition();
        }
    };

    // Mouse leave handler - reset position to far away
    const onMouseLeave = () => {
        mouseWorldPos.value.set(0, -100, 0);
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('touchmove', onTouchMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('touchend', onMouseLeave);
}

// Raycast to find mouse position on island/grass
function updateMouseWorldPosition(): void {
    if (!camera) return;
    
    raycaster.setFromCamera(mouse, camera);
    
    // Raycast against island and grass patches
    const targets: Object3D[] = [island, ...grassPatches];
    const intersects = raycaster.intersectObjects(targets, true);
    
    if (intersects.length > 0) {
        const hit = intersects[0];
        mouseWorldPos.value.copy(hit.point);
    } else {
        // If not hitting anything, move mouse position far away
        mouseWorldPos.value.set(0, -100, 0);
    }
}

export function Update(): void {
    // Update palm tree wind shader time
    palmWindTimeUniform.value = time * PALM_WIND_SPEED;
    
    // Breeze-driven wind animation for grass and palm tree
    windTime += deltaTime;
    
    // Smooth breeze intensity envelope — ramps up when breeze audio plays, fades out after
    const breezeActive = isBreezeActive();
    if (breezeActive) {
        breezeIntensity = Math.min(1.0, breezeIntensity + deltaTime / BREEZE_RAMP_UP);
    } else {
        breezeIntensity = Math.max(0.0, breezeIntensity - deltaTime / BREEZE_RAMP_DOWN);
    }
    
    // Update shader uniforms so vertex wind also syncs with breeze
    palmWindTimeUniform.value = windTime;
    palmWindStrengthUniform.value = PALM_WIND_STRENGTH * breezeIntensity;
    foliageWindStrengthUniform.value = FOLIAGE_WIND_STRENGTH * breezeIntensity;
    
    // Flickering wind: overlapping inharmonic sine waves for chaotic, natural feel
    // Apply to grass patches
    grassPatches.forEach((patch, i) => {
        const phase = i * 0.5;
        const flicker = Math.sin(windTime * 3.7 + phase) * 0.4
                       + Math.sin(windTime * 7.3 + phase * 1.3) * 0.25
                       + Math.sin(windTime * 11.1 + phase * 0.7) * 0.15
                       + Math.sin(windTime * 17.0 + phase * 2.1) * 0.1;
        const patchWind = flicker * breezeIntensity;
        patch.rotation.z = patchWind * BREEZE_GRASS_STRENGTH;
        patch.rotation.x = patchWind * BREEZE_GRASS_STRENGTH * 0.3;
    });
    
    // Palm tree wind is handled entirely by the vertex shader (applyPalmWindShader)
    // which uses smoothstep(uLeafStartY, uLeafFullY, position.y) to only move leaves,
    // not the trunk. No JS rotation needed here.
    
    // Radio vibration when music is playing
    if (radio.children.length > 0) {
        if (getIsPlaying()) {
            radioTime += deltaTime;
            // Multi-frequency vibration for more organic feel
            const vibe1 = Math.sin(radioTime * radioVibeSpeed) * radioVibeStrength;
            const vibe2 = Math.sin(radioTime * radioVibeSpeed * 1.7) * radioVibeStrength * 0.5;
            const vibe3 = Math.abs(Math.sin(radioTime * radioVibeSpeed * 0.5)) * radioVibeStrength * 0.3;
            const totalVibe = vibe1 + vibe2 + vibe3;
            radio.position.y = radioBaseY + totalVibe;
            // Subtle rotation wobble
            radio.rotation.z = Math.sin(radioTime * radioVibeSpeed * 0.8) * 0.015;
            
            // Spawn waves on bounce peaks (when going up and crossing threshold)
            const bounceUp = totalVibe > radioVibeStrength * 0.5;
            if (bounceUp && !lastBounceUp && soundWaves.length < WAVE_COUNT) {
                spawnSoundWave('left');
                spawnSoundWave('right');
            }
            lastBounceUp = bounceUp;
        } else {
            // Smoothly return to base position
            radio.position.y += (radioBaseY - radio.position.y) * 0.1;
            radio.rotation.z *= 0.9;
            lastBounceUp = false;
        }
    }
    
    // Update sound waves
    updateSoundWaves();
}

// Create a sound wave arc (symmetric half rings)
function spawnSoundWave(side: 'left' | 'right', isTrailing: boolean = false): void {
    // Both arcs point UPWARD at ~45 degree angles
    const thetaLength = Math.PI * 0.55;  // ~100 degree arc
    // Left: arc in upper-left quadrant, Right: arc in upper-right quadrant
    const thetaStart = side === 'left' 
        ? Math.PI * 0.45   // Starts at ~80°, spans to ~180° (upper-left)
        : -Math.PI * 0.1;  // Starts at ~-18°, spans to ~80° (upper-right)
    
    // Thin ring, always white
    const geometry = new RingGeometry(0.02, 0.024, 24, 1, thetaStart, thetaLength);
    const material = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1.0,  // Max opacity
        side: DoubleSide,
        depthWrite: false
    });
    const arc = new Mesh(geometry, material);
    arc.castShadow = false;
    arc.receiveShadow = false;
    
    // Position further from radio (spawn point)
    const sideOffset = side === 'left' ? -0.1 : 0.1;
    arc.position.copy(radio.position);
    arc.position.y += 0.18;
    arc.position.x += sideOffset;
    
    // Face camera
    arc.rotation.x = -Math.PI * 0.1;
    
    radio.parent?.add(arc);
    soundWaves.push({ mesh: arc, progress: isTrailing ? -0.15 : 0, side: side, isTrailing: isTrailing });
    
    // Spawn trailing wave after main wave (only if this is the main wave)
    if (!isTrailing) {
        spawnSoundWave(side, true);
    }
}

// Update all sound waves
function updateSoundWaves(): void {
    const WAVE_DURATION = 1.0;  // seconds for wave to complete
    const MAX_SCALE = 5;  // How much the arc grows
    const MOVE_DISTANCE = 0.04;  // Shorter travel distance
    
    for (let i = soundWaves.length - 1; i >= 0; i--) {
        const wave = soundWaves[i];
        wave.progress += deltaTime / WAVE_DURATION;
        
        if (wave.progress >= 1) {
            // Remove completed wave
            wave.mesh.parent?.remove(wave.mesh);
            wave.mesh.geometry.dispose();
            (wave.mesh.material as MeshBasicMaterial).dispose();
            soundWaves.splice(i, 1);
        } else if (wave.progress < 0) {
            // Trailing wave waiting to start - keep hidden
            wave.mesh.visible = false;
        } else {
            // Wave is active
            wave.mesh.visible = true;
            
            // Scale up and fade out
            const scale = 1 + wave.progress * MAX_SCALE;
            wave.mesh.scale.setScalar(scale);
            (wave.mesh.material as MeshBasicMaterial).opacity = 1.0 * (1 - wave.progress);
            
            // Move outward and upward (shorter distance)
            const sideOffset = wave.side === 'left' ? -0.1 : 0.1;
            const moveOffset = wave.progress * MOVE_DISTANCE * (wave.side === 'left' ? -1 : 1);
            wave.mesh.position.copy(radio.position);
            wave.mesh.position.y += 0.18 + wave.progress * 0.03;
            wave.mesh.position.x += sideOffset + moveOffset;
        }
    }
}

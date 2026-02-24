import { Group, Object3D, LoadingManager, Uniform, Vector2, Vector3, Raycaster, SpriteMaterial, Sprite, CanvasTexture, AdditiveBlending, AnimationMixer, LoopRepeat } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { oceanAbsorptionUniform, setFoamMask } from "../materials/OceanMaterial";
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial";
import { deltaTime, time } from "../scripts/Time";
import { getIsPlaying, expandPlayer, getIsExpanded, getMusicIntensity, getBeatKick } from "../scripts/MediaPlayer";
import { zoomToPug, zoomOutFromPug, isPugZoomActive } from "../scripts/Control";
import { isBreezeActive } from "../scripts/Audio";
import { camera, renderer } from "../scripts/Scene";
import { generateFoamMask, getMaskTexture, getMaskCenter, getMaskSize } from "../effects/FoamMask";

export const island = new Group();
export const firecamp = new Group();
export const palmtree = new Group();
export const radio = new Group();
export const sword = new Group();
export const pug = new Group();
export const tent = new Group();
export const dogBed = new Group();
export const dogBowl = new Group();
export const grassPatches: Group[] = [];

// Store palm tree leaves for wind animation
const palmLeaves: Object3D[] = [];

// Pug animation mixer
let pugMixer: AnimationMixer | null = null;

// Music note particles for radio
interface MusicNote {
    sprite: Sprite;
    age: number;       // seconds alive
    lifetime: number;  // total seconds before removed
    vx: number;        // velocity X
    vy: number;        // velocity Y
    vz: number;        // velocity Z
    baseOpacity: number;
}
const musicNotes: MusicNote[] = [];
let noteSpawnTimer = 0;
let lastBeatKick = 0;  // Track previous beat kick to detect rising edge

// Pre-built note textures (3 variants, created once)
let noteTextures: CanvasTexture[] = [];

function buildNoteTextures(): void {
    if (noteTextures.length > 0) return;
    const symbols = ['\u266A', '\u266B', '\u2669'];  // ♪ ♫ ♩
    for (const sym of symbols) {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, size, size);
        ctx.font = `bold ${size * 0.7}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(sym, size / 2, size / 2);
        const tex = new CanvasTexture(canvas);
        tex.needsUpdate = true;
        noteTextures.push(tex);
    }
}

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

// FLOATING ISLAND SETTINGS — tweak position/scale here
const islandPosition = { x: 0, y: -0.8, z: -3.3 };
const firecampOffset = { x: 0, y: 1.0, z: 0.4 };
const palmtreeOffset = { x: -0.35, y: 1.0, z: -0.3 };
const radioOffset = { x: -0.65, y: 1.0, z: 0.20 };  // In front of firecamp, left of center
const swordOffset = { x: 0.08, y: 1.3, z: 0.4 };  // Stuck in the middle of the bonfire
const pugOffset = { x: 0.65, y: 1.0, z: 1 };  // Opposite side of radio relative to firecamp
const tentOffset = { x: 0.48, y: 0.97, z: -0.35 };  // Right of palm tree (camera view)
const dogBedOffset = { x: 0.38, y: 0.97, z: -0.35 };  // Centered inside tent, flush to ground
const dogBowlOffset = { x: 0.52, y: 1.1, z: -0.5 };  // Slightly to the side of bed

const islandScale = 0.25;
const firecampScale = 1.4;
// const palmtreeScale = 0.75;
const palmtreeScale = 0.5;
const radioScale = 0.22;
const swordScale = 0.25;
const pugScale = 0.45;
const tentScale = 1.8;
const dogBedScale = 0.3;
const dogBowlScale = 0.5;

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
const grassBaseOffset = { x: 0.4, y: 0.93, z: 0.6 };  // Base position near palm tree

// CLOVER SETTINGS
const CLOVER_COUNT = 10;  // Number of clover patches
const cloverScale = 0.15;
const cloverBaseOffset = { x: 0.4, y: 0.93, z: 0.6 };  // Same Y as grass for consistency

// PALM TREE WIND SETTINGS - easily tweakable
const PALM_WIND_STRENGTH = 0.03;    // TWEAK: How much leaves sway (0.05-0.3)
const PALM_WIND_SPEED = 0.5;       // TWEAK: Speed of wind oscillation (0.5-3.0)
const PALM_LEAF_START_Y = 3.0;     // TWEAK: Y height where leaves start swaying (local coords)
const PALM_LEAF_FULL_Y = 3.25;      // TWEAK: Y height where full sway happens

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
                    // Force leaves into opaque pass (alpha-test) so they render
                    // at the same depth/visibility as the trunk — not blocked
                    // by the ocean surface when viewed from underwater
                    if (mat.transparent || mat.alphaMap || mat.map?.image) {
                        mat.transparent = false;
                        mat.depthWrite = true;
                        mat.alphaTest = 0.5;
                    }
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

export function Start(): void {
    loader.load(
        'models/surface/floating_island.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            // Enable shadow receiving on island meshes
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    (child as any).receiveShadow = true;
                    (child as any).castShadow = true;
                }
            });
            island.add(gltf.scene);
            island.position.set(islandPosition.x, islandPosition.y, islandPosition.z);
            island.scale.setScalar(islandScale);
            
            // Generate foam mask from island silhouette (must happen after position/scale are set)
            // Use requestAnimationFrame to ensure the world matrices are up to date
            requestAnimationFrame(() => {
                island.updateMatrixWorld(true);
                generateFoamMask(renderer, island);
                const tex = getMaskTexture();
                if (tex) {
                    setFoamMask(tex.texture, getMaskCenter(), getMaskSize());
                }
            });
            
            console.log('Floating island loaded with ocean lighting');
        },
        (progress) => {
            console.log('Island loading:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => {
            console.error('Error loading floating island:', error);
        }
    );

    loader.load(
        'models/surface/bonfire.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            // Enable shadow casting and receiving for firecamp
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
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
        'models/surface/tree.glb',
        (gltf) => {
            // Apply wind shader instead of just ocean lighting
            applyPalmWindShader(gltf.scene);
            // Enable shadow casting and receiving
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
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
        'models/surface/grass.glb',
        (gltf) => {
            for (let i = 0; i < GRASS_COUNT; i++) {
                const grassPatch = new Group();
                const grassModel = gltf.scene.clone();
                applyFoliageWindShader(grassModel);  // Wind shader synced with palm
                // Enable shadow casting and receiving for grass
                grassModel.traverse((child) => {
                    if ((child as any).isMesh) {
                        child.castShadow = true;
                        (child as any).receiveShadow = true;
                    }
                });
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
        'models/surface/clover.glb',
        (gltf) => {
            for (let i = 0; i < CLOVER_COUNT; i++) {
                const cloverPatch = new Group();
                const cloverModel = gltf.scene.clone();
                applyFoliageWindShader(cloverModel);  // Wind shader synced with palm
                // Enable shadow casting and receiving for clover
                cloverModel.traverse((child) => {
                    if ((child as any).isMesh) {
                        child.castShadow = true;
                        (child as any).receiveShadow = true;
                    }
                });
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
        'models/surface/radio.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            // Enable shadow casting and receiving for radio
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
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
        'models/surface/sword.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            // Enable shadow casting and receiving for sword
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
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

    // Load pug on the island (opposite side of radio)
    loader.load(
        'models/character/pug.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            // Enable shadow casting and receiving for pug
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            pug.add(gltf.scene);
            pug.position.set(
                islandPosition.x + pugOffset.x,
                islandPosition.y + pugOffset.y,
                islandPosition.z + pugOffset.z
            );
            pug.scale.setScalar(pugScale);
            // Face to the right of the island (positive X)
            pug.rotation.y = Math.PI / 2;

            // Setup idle animation (index 4)
            if (gltf.animations && gltf.animations.length > 4) {
                pugMixer = new AnimationMixer(gltf.scene);
                const idleClip = gltf.animations[4];
                const action = pugMixer.clipAction(idleClip);
                action.setLoop(LoopRepeat, Infinity);
                action.play();
                console.log(`Pug loaded with animation: ${idleClip.name || 'index 4'} (${gltf.animations.length} total animations)`);
            } else {
                console.warn(`Pug model has ${gltf.animations?.length ?? 0} animations, expected at least 5`);
            }
        },
        undefined,
        (error) => {
            console.error('Error loading pug:', error);
        }
    );

    // Load tent to the right of the palm tree
    loader.load(
        'models/surface/tent.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            tent.add(gltf.scene);
            tent.position.set(
                islandPosition.x + tentOffset.x,
                islandPosition.y + tentOffset.y,
                islandPosition.z + tentOffset.z
            );
            tent.scale.setScalar(tentScale);
            // Face camera with slight left-angle offset (from camera's perspective)
            tent.rotation.y = -0.4;
            console.log('Tent loaded');
        },
        undefined,
        (error) => { console.error('Error loading tent:', error); }
    );

    // Load dog bed inside the tent
    loader.load(
        'models/surface/dog_bed.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            dogBed.add(gltf.scene);
            dogBed.position.set(
                islandPosition.x + dogBedOffset.x,
                islandPosition.y + dogBedOffset.y,
                islandPosition.z + dogBedOffset.z
            );
            dogBed.scale.setScalar(dogBedScale);
            dogBed.rotation.y = -1.5;
            console.log('Dog bed loaded');
        },
        undefined,
        (error) => { console.error('Error loading dog bed:', error); }
    );

    // Load dog bowl beside the dog bed
    loader.load(
        'models/surface/dog_bowl.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    child.castShadow = true;
                    (child as any).receiveShadow = true;
                }
            });
            dogBowl.add(gltf.scene);
            dogBowl.position.set(
                islandPosition.x + dogBowlOffset.x,
                islandPosition.y + dogBowlOffset.y,
                islandPosition.z + dogBowlOffset.z
            );
            dogBowl.scale.setScalar(dogBowlScale);
            dogBowl.rotation.y = -0.4;
            console.log('Dog bowl loaded');
        },
        undefined,
        (error) => { console.error('Error loading dog bowl:', error); }
    );

    // Setup mouse/touch event listeners for grass interaction
    setupGrassInteraction();

    // Setup radio click/hover interaction
    setupRadioInteraction();

    // Setup pug click/hover interaction
    setupPugInteraction();
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

// ============================================
// PUG CLICK/HOVER INTERACTION
// ============================================
const pugRaycaster = new Raycaster();
const pugMouse = new Vector2();
let isPugHovered = false;

function setupPugInteraction(): void {
    const canvas = renderer.domElement;
    if (!canvas) return;

    const onPugClick = (clientX: number, clientY: number) => {
        // If already zoomed into pug, any click zooms out
        if (isPugZoomActive()) {
            zoomOutFromPug();
            return;
        }
        if (pug.children.length === 0) return;

        pugMouse.x = (clientX / window.innerWidth) * 2 - 1;
        pugMouse.y = -(clientY / window.innerHeight) * 2 + 1;
        pugRaycaster.setFromCamera(pugMouse, camera);
        const intersects = pugRaycaster.intersectObjects(pug.children, true);
        if (intersects.length > 0) {
            zoomToPug();
        }
    };

    canvas.addEventListener('click', (e: MouseEvent) => {
        onPugClick(e.clientX, e.clientY);
    });

    canvas.addEventListener('touchend', (e: TouchEvent) => {
        if (e.changedTouches.length > 0) {
            const touch = e.changedTouches[0];
            onPugClick(touch.clientX, touch.clientY);
        }
    });

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        if (pug.children.length === 0 || isPugZoomActive()) {
            if (isPugHovered) { isPugHovered = false; canvas.style.cursor = ''; }
            return;
        }
        pugMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        pugMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        pugRaycaster.setFromCamera(pugMouse, camera);
        const intersects = pugRaycaster.intersectObjects(pug.children, true);
        if (intersects.length > 0) {
            if (!isPugHovered) { isPugHovered = true; canvas.style.cursor = 'pointer'; }
        } else {
            if (isPugHovered) { isPugHovered = false; canvas.style.cursor = ''; }
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isPugHovered) { isPugHovered = false; canvas.style.cursor = ''; }
    });
}

// ============================================
// RADIO CLICK/HOVER INTERACTION
// ============================================
const radioRaycaster = new Raycaster();
const radioMouse = new Vector2();
const RADIO_HOVER_SCALE = 1.15;  // Scale multiplier on hover
const radioBaseScale = radioScale;
let isRadioHovered = false;

function setupRadioInteraction(): void {
    const canvas = renderer.domElement;
    if (!canvas) return;

    // Click handler — open media player when clicking on radio
    const onRadioClick = (clientX: number, clientY: number) => {
        if (getIsExpanded()) return;  // Already open
        if (radio.children.length === 0) return;  // Not loaded yet
        if (!document.body.classList.contains('music-visible')) return;  // Not ready yet

        radioMouse.x = (clientX / window.innerWidth) * 2 - 1;
        radioMouse.y = -(clientY / window.innerHeight) * 2 + 1;

        radioRaycaster.setFromCamera(radioMouse, camera);
        const intersects = radioRaycaster.intersectObjects(radio.children, true);
        if (intersects.length > 0) {
            expandPlayer();
        }
    };

    canvas.addEventListener('click', (e: MouseEvent) => {
        onRadioClick(e.clientX, e.clientY);
    });

    canvas.addEventListener('touchend', (e: TouchEvent) => {
        if (e.changedTouches.length > 0) {
            const touch = e.changedTouches[0];
            onRadioClick(touch.clientX, touch.clientY);
        }
    });

    // Hover handler — scale radio and change cursor
    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        if (radio.children.length === 0 || getIsExpanded()) {
            if (isRadioHovered) {
                isRadioHovered = false;
                canvas.style.cursor = '';
            }
            return;
        }

        radioMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        radioMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

        radioRaycaster.setFromCamera(radioMouse, camera);
        const intersects = radioRaycaster.intersectObjects(radio.children, true);

        if (intersects.length > 0) {
            if (!isRadioHovered) {
                isRadioHovered = true;
                canvas.style.cursor = 'pointer';
            }
        } else {
            if (isRadioHovered) {
                isRadioHovered = false;
                canvas.style.cursor = '';
            }
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isRadioHovered) {
            isRadioHovered = false;
            canvas.style.cursor = '';
        }
    });
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
        // Smooth hover scale
        const targetScale = isRadioHovered ? radioBaseScale * RADIO_HOVER_SCALE : radioBaseScale;
        const currentScale = radio.scale.x;
        const newScale = currentScale + (targetScale - currentScale) * Math.min(1, deltaTime * 10);
        radio.scale.setScalar(newScale);

        if (getIsPlaying()) {
            radioTime += deltaTime;
            
            // Music intensity (0-1) from the Web Audio analyser
            const intensity = getMusicIntensity();
            
            // Real music rarely exceeds ~0.45 raw intensity, so remap to use full range.
            // Clamp to 0-1 after stretching so 0.45 raw → 1.0 effective.
            const normalized = Math.min(1, intensity / 0.4);
            // Exponential curve for wider dynamic range:
            // Near 0 → almost no bounce, near 1 → very strong bounce
            const curved = normalized * normalized;
            // Map: 0.05 at silence → ~3.5 at max
            const intensityScale = 0.05 + curved * 3.45;
            
            // Multi-frequency vibration scaled by music energy
            const vibe1 = Math.sin(radioTime * radioVibeSpeed) * radioVibeStrength * intensityScale;
            const vibe2 = Math.sin(radioTime * radioVibeSpeed * 1.7) * radioVibeStrength * 0.5 * intensityScale;
            const vibe3 = Math.abs(Math.sin(radioTime * radioVibeSpeed * 0.5)) * radioVibeStrength * 0.3 * intensityScale;
            const totalVibe = vibe1 + vibe2 + vibe3;
            radio.position.y = radioBaseY + totalVibe;
            // Subtle rotation wobble
            radio.rotation.z = Math.sin(radioTime * radioVibeSpeed * 0.8) * 0.015 * intensityScale;
            
            // Spawn music note particles
            buildNoteTextures();
            const kick = getBeatKick();
            
            // Use same normalized intensity as bounce (real music tops ~0.4 raw)
            const normIntensity = Math.min(1, intensity / 0.4);
            
            // Base spawn rate: calm, steady output (every ~1.0s quiet, ~0.3s loud)
            const spawnInterval = 1.0 - normIntensity * 0.7;
            // Max particles: 4 at silence, 24 at max
            const maxNotes = Math.round(4 + normIntensity * 20);
            
            noteSpawnTimer += deltaTime;
            
            // Detect beat: rising edge of kick (crosses threshold from below)
            const beatHit = kick > 0.3 && lastBeatKick <= 0.3;
            lastBeatKick = kick;
            
            // Regular calm spawning on timer
            if (noteSpawnTimer >= spawnInterval && musicNotes.length < maxNotes) {
                noteSpawnTimer = 0;
                spawnMusicNote(normIntensity);
            }
            
            // Beat-triggered burst: spawn extra notes on detected beats
            if (beatHit && musicNotes.length < maxNotes) {
                // Number of burst notes scales with beat strength (2-5)
                const burstCount = Math.min(5, Math.round(2 + kick * 3));
                for (let b = 0; b < burstCount && musicNotes.length < maxNotes; b++) {
                    spawnMusicNote(Math.min(1, normIntensity + kick * 0.2));
                }
                // Reset timer so we don't double-spawn right after a beat
                noteSpawnTimer = 0;
            }
        } else {
            // Smoothly return to base position
            radio.position.y += (radioBaseY - radio.position.y) * 0.1;
            radio.rotation.z *= 0.9;
            noteSpawnTimer = 0;
        }
    }
    
    // Update pug animation mixer
    if (pugMixer) {
        pugMixer.update(deltaTime);
    }

    // Update music note particles
    updateMusicNotes();
}

// Spawn a music note particle along an invisible arch above the radio
function spawnMusicNote(intensity: number): void {
    if (noteTextures.length === 0) return;
    
    // Pick random note texture
    const tex = noteTextures[Math.floor(Math.random() * noteTextures.length)];
    
    const mat = new SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,  // starts invisible, fades in
        depthWrite: false,
        blending: AdditiveBlending,
    });
    const sprite = new Sprite(mat);
    
    // Size: 0.07 - 0.12
    const noteSize = 0.07 + Math.random() * 0.05;
    sprite.scale.set(noteSize, noteSize, 1);
    
    // Spawn position: along a wider arch above the radio, spread in X and Z
    // archAngle sweeps the XY arch, zAngle adds depth variation
    const archAngle = Math.random() * Math.PI;  // 0 to PI (left to right)
    const zAngle = (Math.random() - 0.5) * Math.PI * 0.6;  // ±54° depth spread
    const archRadius = 0.12 + Math.random() * 0.06;
    const spawnX = radio.position.x + Math.cos(archAngle) * archRadius;
    const spawnY = radio.position.y + 0.15 + Math.sin(archAngle) * archRadius * 0.6;
    const spawnZ = radio.position.z + Math.sin(zAngle) * archRadius * 0.5;
    sprite.position.set(spawnX, spawnY, spawnZ);
    
    // Velocity: fast initial launch, deceleration handled in update
    const speed = (0.12 + intensity * 0.18) * (0.8 + Math.random() * 0.4);
    const vx = Math.cos(archAngle) * speed * 0.8;  // outward to sides
    const vy = (0.5 + Math.sin(archAngle) * 0.5) * speed;  // always upward
    const vz = Math.sin(zAngle) * speed * 0.4;  // outward in depth
    
    // Lifetime: longer so notes travel further before fading
    const lifetime = 2.0 + (1 - intensity) * 1.0 + Math.random() * 0.5;
    
    // Base opacity scales with intensity: 0.4 at silence, 0.9 at max
    const baseOpacity = 0.4 + intensity * 0.5;
    
    radio.parent?.add(sprite);
    musicNotes.push({ sprite, age: 0, lifetime, vx, vy, vz, baseOpacity });
}

// Update all music note particles
function updateMusicNotes(): void {
    for (let i = musicNotes.length - 1; i >= 0; i--) {
        const note = musicNotes[i];
        note.age += deltaTime;
        
        if (note.age >= note.lifetime) {
            note.sprite.parent?.remove(note.sprite);
            (note.sprite.material as SpriteMaterial).dispose();
            musicNotes.splice(i, 1);
            continue;
        }
        
        const t = note.age / note.lifetime;  // 0 to 1
        
        // Move
        note.sprite.position.x += note.vx * deltaTime;
        note.sprite.position.y += note.vy * deltaTime;
        note.sprite.position.z += note.vz * deltaTime;
        
        // Deceleration curve: light drag early, heavy braking in last 40%
        // This keeps the fast launch feeling while notes slow to a float before fading
        const drag = t < 0.6 ? 0.998 : 0.96;
        note.vx *= drag;
        note.vy *= drag;
        note.vz *= drag;
        
        // Opacity: fade in quickly (first 10%), then fade out
        let opacity: number;
        if (t < 0.1) {
            opacity = note.baseOpacity * (t / 0.1);
        } else {
            opacity = note.baseOpacity * (1 - (t - 0.1) / 0.9);
        }
        (note.sprite.material as SpriteMaterial).opacity = opacity;
        
        // Gentle rotation for visual variety
        note.sprite.material.rotation += deltaTime * (i % 2 === 0 ? 0.5 : -0.5);
    }
}

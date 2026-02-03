import { Group, AnimationMixer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { deltaTime } from "../scripts/Time";

// Clown & Dori fish settings (circling the island)
const CIRCLE_FISH_SCALE = 0.03;
const CIRCLE_RADIUS = 1.2;
const CIRCLE_SPEED = 0.3;
const CIRCLE_Y_LEVEL = -0.7;
const FISH_SEPARATION = 0.3;
const CIRCLE_FISH_ROTATION_OFFSET = Math.PI * 2;

const loader = new GLTFLoader();

// Circle fish
export const clownFish = new Group();
export const doriFish = new Group();
let clownMixer: AnimationMixer | null = null;
let doriMixer: AnimationMixer | null = null;
let circleAngle = 0;
const islandCenter = { x: 0, z: -3.3 };

export function Start(): void {
    // Load clown fish
    loader.load(
        'models/clownfish.glb',
        (gltf) => {
            clownFish.add(gltf.scene);
            clownFish.scale.setScalar(CIRCLE_FISH_SCALE);
            clownMixer = new AnimationMixer(gltf.scene);
            if (gltf.animations.length > 0) {
                clownMixer.clipAction(gltf.animations[0]).play();
            }
        }
    );
    
    // Load dori fish
    loader.load(
        'models/dorifish.glb',
        (gltf) => {
            doriFish.add(gltf.scene);
            doriFish.scale.setScalar(CIRCLE_FISH_SCALE);
            doriMixer = new AnimationMixer(gltf.scene);
            if (gltf.animations.length > 0) {
                doriMixer.clipAction(gltf.animations[0]).play();
            }
        }
    );
}

export function Update(): void {
    // Update animations
    if (clownMixer) clownMixer.update(deltaTime);
    if (doriMixer) doriMixer.update(deltaTime);
    
    // Circle fish movement
    circleAngle += CIRCLE_SPEED * deltaTime;
    
    const clownAngle = circleAngle;
    clownFish.position.set(
        islandCenter.x + Math.cos(clownAngle) * CIRCLE_RADIUS,
        CIRCLE_Y_LEVEL,
        islandCenter.z + Math.sin(clownAngle) * CIRCLE_RADIUS
    );
    clownFish.rotation.y = -clownAngle + CIRCLE_FISH_ROTATION_OFFSET;
    
    const doriAngle = circleAngle - FISH_SEPARATION;
    doriFish.position.set(
        islandCenter.x + Math.cos(doriAngle) * (CIRCLE_RADIUS + 0.08),
        CIRCLE_Y_LEVEL - 0.03,
        islandCenter.z + Math.sin(doriAngle) * (CIRCLE_RADIUS + 0.08)
    );
    doriFish.rotation.y = -doriAngle + CIRCLE_FISH_ROTATION_OFFSET;
}

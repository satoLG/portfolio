// src/scene/SeaFloorConfig.ts
// Explicit placement for every seafloor decoration.
// All rotations are in radians.

// -- Coral Rocks ---------------------------------------------------------------
export const rock1 = { x: -1.6500, y: -10.0000, z: -2.8000, scale: 0.3000, rx: 0.0000, ry: 0.0000, rz: 0.0000 };
export const rock2 = { x: 1.7500, y: -10.0000, z: -3.9500, scale: 0.3000, rx: 0.0000, ry: 1.0500, rz: 0.0000 };
export const rock3 = { x: 1.2000, y: -10.0000, z: -2.8000, scale: 0.2200, rx: 0.0000, ry: 2.0900, rz: 0.0000 };

// -- Corals --------------------------------------------------------------------
export const coral1 = { x: -1.1000, y: -9.4000, z: -2.8000, scale: 0.1000, rx: 0.0000, ry: 0.0000, rz: -0.2300, r: 1.0000, g: 0.2800, b: 0.2200 };
export const coral2 = { x: 0.7500, y: -10.0000, z: -2.2500, scale: 0.0600, rx: 0.0000, ry: 2.4600, rz: 0.0000, r: 1.0000, g: 0.5500, b: 0.0800 };
export const coral3 = { x: 0.6500, y: -9.6500, z: -3.4500, scale: 0.1200, rx: 0.0000, ry: 2.5500, rz: 0.0000, r: 0.2200, g: 0.8800, b: 0.4800 };

// -- Kelps ---------------------------------------------------------------------
export const kelp1 = { x: -0.7500, y: -9.8500, z: -2.3500, scale: 0.3000, rx: 0.0000, ry: 0.0000, rz: 0.0000 };
export const kelp2 = { x: 0.4000, y: -9.7000, z: -3.0500, scale: 0.3000, rx: 0.0000, ry: 3.1400, rz: 0.0000 };
export const kelp3 = { x: 0.6000, y: -9.7000, z: -2.9500, scale: 0.4000, rx: 0.0000, ry: 0.2800, rz: 0.0000 };

// -- Kelp Sway (underwater current) -------------------------------------------
export const kelpTopY          = 0.5000;
export const kelpSwayStrength  = 0.1350;
export const kelpSwaySpeed     = 0.9200;
export const kelpSwayFrequency = 5.2000;
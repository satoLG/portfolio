// src/scene/config/SeaFloorConfig.ts
// Explicit placement for every seafloor decoration.
// All rotations are in radians.

// -- Coral Rocks ---------------------------------------------------------------
export const rock1 = { x: -1.6500, y: -14.0000, z: -2.8000, scale: 0.3000, rx: 0.0000, ry: 0.0000, rz: 0.0000 };
export const rock2 = { x: 1.7500, y: -14.0000, z: -3.9500, scale: 0.3000, rx: 0.0000, ry: 1.0500, rz: 0.0000 };
export const rock3 = { x: 1.2000, y: -14.0000, z: -2.8000, scale: 0.2200, rx: 0.0000, ry: 2.0900, rz: 0.0000 };

// -- Corals --------------------------------------------------------------------
export const coral1 = { x: -1.1000, y: -13.4000, z: -2.8000, scale: 0.1000, rx: 0.0000, ry: 0.0000, rz: -0.2300, r: 1.0000, g: 0.2800, b: 0.2200 };
export const coral2 = { x: 0.7500, y: -14.0000, z: -2.2500, scale: 0.0600, rx: 0.0000, ry: 2.4600, rz: 0.0000, r: 1.0000, g: 0.5500, b: 0.0800 };
export const coral3 = { x: 0.6500, y: -13.6500, z: -3.4500, scale: 0.1200, rx: 0.0000, ry: 2.5500, rz: 0.0000, r: 0.2200, g: 0.8800, b: 0.4800 };

// -- Kelps ---------------------------------------------------------------------
export const kelp1 = { x: -0.7500, y: -13.8500, z: -2.3500, scale: 0.3000, rx: 0.0000, ry: 0.0000, rz: 0.0000 };
export const kelp2 = { x: 0.4000, y: -13.7000, z: -3.0500, scale: 0.3000, rx: 0.0000, ry: 3.1400, rz: 0.0000 };
export const kelp3 = { x: 0.6000, y: -13.7000, z: -2.9500, scale: 0.4000, rx: 0.0000, ry: 0.2800, rz: 0.0000 };

// -- Kelp Sway (underwater current) -------------------------------------------
export const kelpTopY          = 0.5000;
export const kelpSwayStrength  = 0.1350;
export const kelpSwaySpeed     = 0.9200;
export const kelpSwayFrequency = 5.2000;

// -- Chest ---------------------------------------------------------------------
export const chest = { x: -0.2000, y: -14.0000, z: -3.2000, scale: 0.3100, rx: 0.0000, ry: 0.2800, rz: 0.0000 };

// -- Chest Zoom ----------------------------------------------------------------
export const chestZoomDist       = 1.5500;
export const chestZoomHeight     = 1.2500;
export const chestZoomFov        = 27.0000;
export const chestZoomMobileFov  = 38.0000;
export const chestZoomPitch      = -0.5308;
// Camera pitch while zoomed (radians, negative = look down)

// -- Chest Glow ---------------------------------------------------------------
export const chestGlowX         = 1.0500;
export const chestGlowY         = 3.1000;
export const chestGlowZ         = 0.4500;
export const chestGlowIntensity = 10.8000;
export const chestGlowDistance  = 4.2000;

// -- Chest Rays ---------------------------------------------------------------
export const chestRayRadius     = 1.2900;
export const chestRayMaxOpacity = 0.0000;

// -- Chest Coins (placed inside chest, in chest-group local space) -------------
export const chestCoinRevealDelay = 1.0500;
export const chestCoinHideDelay   = 0.1500;
export const chestCoin1 = { x: -0.5000, y: 1.1000, z: -0.5000, scale: 0.7000, rx: 0.0000, ry: 0.1300, rz: -0.3000 };
export const chestCoin2 = { x: -0.6000, y: 1.0500, z: 0.4500, scale: 0.6500, rx: -0.6700, ry: 0.0100, rz: -0.1800 };
export const chestCoin3 = { x: 0.5000, y: 1.2000, z: 0.6500, scale: 0.6000, rx: -0.6900, ry: -0.3000, rz: -0.4800 };

// -- Chest Coin Colors (bodyR/G/B = ring+star, circleR/G/B = inner disc) ------
export const chestCoin1Color = { bodyR: 0.0000, bodyG: 0.1500, bodyB: 1.0000, circleR: 1.0000, circleG: 1.0000, circleB: 1.0000 };
export const chestCoin2Color = { bodyR: 0.0800, bodyG: 0.0800, bodyB: 0.1000, circleR: 1.0000, circleG: 1.0000, circleB: 1.0000 };
export const chestCoin3Color = { bodyR: 0.9000, bodyG: 0.9200, bodyB: 0.9500, circleR: 0.8500, circleG: 0.0500, circleB: 0.0500 };

// -- Extra corals scattered around the coral rocks ----------------------------
export const coral1Left  = { x: -1.5500, y: -13.3000, z: -2.0500, scale: 0.1200, rx: 0.7600, ry: 0.4800, rz: 0.0200, r: 0.1500, g: 0.4700, b: 1.0000 };
export const coral1Right = { x: 1.5000, y: -12.5000, z: -3.7500, scale: 0.2200, rx: 0.0500, ry: -1.0000, rz: -0.0500, r: 1.0000, g: 0.5000, b: 0.2200 };
export const coral2Left  = { x: -1.6000, y: -13.8000, z: -2.0500, scale: 0.2000, rx: 0.4200, ry: 3.1400, rz: 0.0000, r: 1.0000, g: 0.0000, b: 0.0000 };
export const coral2Right = { x: 1.1000, y: -13.5000, z: -2.7000, scale: 0.1800, rx: 0.1900, ry: 1.6300, rz: 0.0000, r: 0.3500, g: 0.9400, b: 0.1300 };

// -- Anemone (left of the coral rocks) ----------------------------------------
export const anemone           = { x: -2.6000, y: -14.0000, z: -3.0000, scale: 0.1200, rx: -0.1000, ry: 0.0000, rz: 0.1900 };
export const anemoneTopY       = 2.5100;
export const anemoneSwayStrength  = 0.1400;
export const anemoneSwaySpeed     = 2.8700;
export const anemoneSwayFrequency = 10.9000;

// -- Mini clownfish swimming around the anemone -------------------------------
export const anemoneFish1 = { x: -2.6000, y: -13.7000, z: -2.9000, scale: 0.0200, swimRadius: 0.3500, period: 4.5000, phase: 0.0000 };
export const anemoneFish2 = { x: -2.6000, y: -13.6000, z: -3.1000, scale: 0.0180, swimRadius: 0.4200, period: 5.3000, phase: 2.1000 };

// -- Starfish on the seafloor near the chest -----------------------------------
export const starfish = { x: -0.4000, y: -14.0000, z: -2.7000, scale: 0.0400, rx: 0.0000, ry: 0.6500, rz: 0.0000 };

// -- Crab behind the chest, slightly to the right ------------------------------
export const crab = { x: 0.3000, y: -14.0000, z: -3.3000, scale: 0.6200, rx: 0.0000, ry: -0.9200, rz: 0.0000 };

// -- Anglerfish, LEFT station (behind rock1), facing the chest -----------------
// This is the DAY pose: fully tucked out of sight behind the rock. `scale` here
// is the anglerfish's scale at BOTH stations.
export const anglerfish = { x: -1.4500, y: -13.7500, z: -3.6500, scale: 0.2500, rx: 0.0000, ry: 1.1700, rz: 0.0000 };
// Night pose, expressed as deltas on top of the hidden one — the motion is
// authored as "edge out a little", so deltas are what you actually tune.
export const anglerfishPeek = { dx: 0.1900, dy: 0.5000, dz: 0.3400, dry: 0.5300 };

// -- Anglerfish, RIGHT station (behind rock2/rock3) ----------------------------
// Where it settles after being tapped on the bulb. Same shape as the left pair:
// a fully-hidden day pose plus the night peek deltas. Roughly mirrored, so the
// fish faces back toward the chest from the other side.
export const anglerfishRight     = { x: 1.5500, y: -13.7500, z: -3.7000, rx: 0.0000, ry: -1.3000, rz: 0.0000 };
export const anglerfishRightPeek = { dx: -0.1900, dy: 0.5000, dz: 0.3400, dry: -0.5300 };

export const anglerfishPeekDuration = 1.1500;  // seconds for the full emerge / retreat
export const anglerfishSwimSpeed    = 0.3500;  // idle clip timeScale — it barely moves

// -- Anglerfish side-to-side swim (triggered by tapping the lit bulb) ----------
// The fish arcs out from behind its rock, crosses in front, and tucks in on the
// far side. The path is a quadratic curve whose control point is pushed toward
// the camera and upward — these are the CONTROL-POINT offsets, so the curve
// actually peaks at about half of each value.
export const anglerfishTravelDuration = 3.4000;  // seconds for the whole crossing
export const anglerfishTravelArcZ     = 3.0000;  // toward the camera — keeps it clear of the rocks
export const anglerfishTravelArcY     = 1.6000;  // upward — lifts it over the rock tops
export const anglerfishTravelAnimSpeed = 1.0000; // clip timeScale while crossing (it's working now)

// -- Anglerfish lure light (own PointLight, aimed at the chest) ----------------
export const anglerfishLightIntensity = 9.9000;
export const anglerfishLightDistance  = 2.2500;
export const anglerfishLightColor     = { r: 0.5500, g: 0.8800, b: 1.0000 };
export const anglerfishLureGlow       = 4.4500;  // emissive intensity on the lure bulb at full night
// Nudge for the light relative to the bulb mesh, in the FISH's own frame
// (x = its right, y = up, z = the way it faces) so the offset keeps pointing
// the same way after it turns around at the other station. World units.
export const anglerfishLightOffset    = { x: 0.0000, y: 0.0000, z: 0.0000 };

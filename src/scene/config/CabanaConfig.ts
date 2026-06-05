// src/scene/config/CabanaConfig.ts
// Cabana (tent) interior zoom + entrance shade — tweakable from IslandDebug
// (Surface → Cabana). Generated/copied like the other config files: adjust the
// sliders in the debug GUI (press H), then paste the values back here.

// ── Cabana zoom ───────────────────────────────────────────────────────────────
// Camera lands just inside the tent entrance, looking in, with a very narrow FOV
// so it reads as "stepping into" the cabana. Absolute world-space target so it's
// straightforward to dial in with sliders. (FOV can't be a literal 0 — that's a
// degenerate perspective projection; ~6° gives the strong tunnel-in feel.)
export const cabanaCamX   = 0.29;
export const cabanaCamY   = 0.62;
export const cabanaCamZ   = -3.22;
export const cabanaPhi    = 6.68;   // yaw ≈ 2π − tentRotY → look into the tent
export const cabanaPitch  = -0.49;  // slight downward pitch toward the table/phone
export const cabanaFov    = 51.5;        // narrow telephoto FOV (must be > 0)

// ── Entrance shade ──────────────────────────────────────────────────────────
// A dark, unlit plane covering the tent opening so the interior (phone + props)
// can't be seen from outside, day or night. Fades out while zoomed in.
// Position is an OFFSET added to islandPosition (same convention as tentOffset).
export const cabanaShadeX       = 0.34;
export const cabanaShadeY       = 0.4;
export const cabanaShadeZ       = -3.26;
export const cabanaShadeRotY    = -0.4000;   // align the plane normal with the tent face
export const cabanaShadeWidth   = 0.7000;    // world units
export const cabanaShadeHeight  = 0.7000;    // world units
export const cabanaShadeColor   = 0x05060a;  // near-black
export const cabanaShadeOpacity = 0.9200;    // max opacity (faded to 0 inside)
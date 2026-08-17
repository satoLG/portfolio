// ============================================
// ACHIEVEMENT ART — the six badges, as inline SVG
// ============================================
//
// Drawn rather than shipped as images. They are pinned to a paper panel that is
// scaled by the board, so a raster badge would either be soft when the camera
// flies in or oversized for how small it sits when it does not; a path is right
// at every distance and costs nothing to download.
//
// They share the notice board's palette (the warm woods and the burnt red of
// its border) so a completed sheet reads as one object rather than six stickers.
//
// Each is authored on a 64×64 viewBox, centred, and drawn in FULL colour — the
// locked state is a CSS filter over the whole badge (see .ach-badge), never a
// second drawing, so there is exactly one thing to keep in step per achievement.

export const ACHIEVEMENT_ART: Record<string, string> = {
    // A fallen apple — the first one you knock out of the tree.
    apple: `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <path d="M32 20c-9 0-15 6-15 15s7 17 15 17 15-9 15-17-6-15-15-15z" fill="#c5372c"/>
  <path d="M32 20c-5 0-9 3-11 8 3 12 9 20 11 24 2-4 8-12 11-24-2-5-6-8-11-8z" fill="#e0574a" opacity="0.75"/>
  <path d="M32 20c0-5 1-8 3-11" fill="none" stroke="#6b4326" stroke-width="3" stroke-linecap="round"/>
  <path d="M34 12c4-4 9-4 12-3 0 5-4 9-9 9-2 0-3-3-3-6z" fill="#5a8f3a"/>
</svg>`,

    // The golden one. Same silhouette on purpose — the point is that you
    // recognise it as the apple you already have, in another metal.
    goldenApple: `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <path d="M32 20c-9 0-15 6-15 15s7 17 15 17 15-9 15-17-6-15-15-15z" fill="#c8a820"/>
  <path d="M32 20c-5 0-9 3-11 8 3 12 9 20 11 24 2-4 8-12 11-24-2-5-6-8-11-8z" fill="#e8cf5c" opacity="0.8"/>
  <path d="M24 28c1-3 3-5 6-6" fill="none" stroke="#fff6cf" stroke-width="3" stroke-linecap="round" opacity="0.85"/>
  <path d="M32 20c0-5 1-8 3-11" fill="none" stroke="#7a5a1e" stroke-width="3" stroke-linecap="round"/>
  <path d="M34 12c4-4 9-4 12-3 0 5-4 9-9 9-2 0-3-3-3-6z" fill="#b79a2c"/>
</svg>`,

    // Coral — the three-branch shape from the sea floor, one lobe per coral you
    // had to strike.
    coral: `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <path d="M32 54V34" fill="none" stroke="#c2496f" stroke-width="6" stroke-linecap="round"/>
  <path d="M32 40 20 28" fill="none" stroke="#c2496f" stroke-width="6" stroke-linecap="round"/>
  <path d="M32 40 44 28" fill="none" stroke="#c2496f" stroke-width="6" stroke-linecap="round"/>
  <path d="M32 34V18" fill="none" stroke="#d9648a" stroke-width="6" stroke-linecap="round"/>
  <circle cx="20" cy="26" r="5" fill="#f090ac"/>
  <circle cx="44" cy="26" r="5" fill="#f090ac"/>
  <circle cx="32" cy="16" r="5.5" fill="#f090ac"/>
  <path d="M22 56h20" fill="none" stroke="#8d6a3a" stroke-width="4" stroke-linecap="round" opacity="0.6"/>
</svg>`,

    // A lit campfire — night.
    bonfire: `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <path d="M18 50 46 42" fill="none" stroke="#7a4c2b" stroke-width="6" stroke-linecap="round"/>
  <path d="M18 42 46 50" fill="none" stroke="#633d22" stroke-width="6" stroke-linecap="round"/>
  <path d="M32 8c6 8 11 12 11 20 0 7-5 12-11 12s-11-5-11-12c0-5 3-8 5-12 1 4 3 6 4 6 2 0 2-9 2-14z" fill="#e0703a"/>
  <path d="M32 20c3 5 5 8 5 12 0 4-2 7-5 7s-5-3-5-7c0-3 2-6 5-12z" fill="#f6c04a"/>
</svg>`,

    // A note — the radio.
    music: `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <path d="M26 44V16l20-5v28" fill="none" stroke="#3f6f8f" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
  <ellipse cx="20" cy="45" rx="8" ry="6.5" fill="#3f6f8f"/>
  <ellipse cx="40" cy="39" rx="8" ry="6.5" fill="#3f6f8f"/>
  <path d="M26 24l20-5" fill="none" stroke="#3f6f8f" stroke-width="4" stroke-linecap="round"/>
</svg>`,

    // A speech bubble — every branch of the pug's conversation.
    dialog: `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <path d="M10 18a6 6 0 0 1 6-6h32a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6H30l-12 10v-10h-2a6 6 0 0 1-6-6z" fill="#f3e7c9" stroke="#6b4326" stroke-width="4" stroke-linejoin="round"/>
  <circle cx="23" cy="28" r="3.2" fill="#6b4326"/>
  <circle cx="32" cy="28" r="3.2" fill="#6b4326"/>
  <circle cx="41" cy="28" r="3.2" fill="#6b4326"/>
</svg>`,
};

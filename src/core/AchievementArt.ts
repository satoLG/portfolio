// ============================================
// ACHIEVEMENT ART — the six badges, as inline SVG
// ============================================
//
// FOUR OF THEM ARE RENDERS OF THE SCENE'S OWN MODELS. The apple you knocked out
// of the tree, the same mesh tinted gold, the coral you struck, the campfire —
// each is a toon-shaded render of the actual GLB, produced by
// scripts/render-achievement-badges.cjs and committed under
// public/images/achievements/. A badge is then a picture of the thing rather
// than a separate drawing of it that drifts as the models change; re-run the
// script when a source model does.
//
// The bonfire's flame is composited from the scene's own fire sprite sheet,
// because the fire is not a model — an unlit pile of logs is the wrong picture
// for "stayed until the campfire was lit".
//
// TWO ARE STILL DRAWN, because they have no model to render: the musical note
// (a canvas sprite in Island) and the speech bubble (DOM). They use the notice
// board's palette so they sit with the rest.
//
// Every badge is FULL COLOUR here — the locked state is a CSS filter over the
// whole thing (see .ach-badge), never a second asset, so there is exactly one
// artwork to keep in step per achievement.

export const ACHIEVEMENT_ART: Record<string, string> = {
    // ── Rendered from the scene's models ────────────────────────────────────
    apple:       `<img src="images/achievements/apple.png" alt="" draggable="false">`,
    goldenApple: `<img src="images/achievements/goldenApple.png" alt="" draggable="false">`,
    coral:       `<img src="images/achievements/coral.png" alt="" draggable="false">`,
    bonfire:     `<img src="images/achievements/bonfire.png" alt="" draggable="false">`,

    // ── Drawn: no model exists for these ────────────────────────────────────
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

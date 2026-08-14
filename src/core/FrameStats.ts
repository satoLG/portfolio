/**
 * TEMP — diagnostic for the 60 FPS cap in main.ts.
 *
 * `raw` counts every requestAnimationFrame callback; `gated` counts only the
 * ones that get past the cap and actually drive an update. The settings FPS
 * readout shows both, which separates "the cap is not holding" (gated is high)
 * from "something else drives the readout" (gated is 60 but the number shown
 * is not). Remove this module, its two call sites in main.ts, and the raw
 * suffix in UI.ts once the cap is confirmed on-device.
 */
export const frameStats = { raw: 0, gated: 0 };

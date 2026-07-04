/**
 * WaterLine — projects the ocean's y=waterlineY plane to a screen-space row
 * each frame, so the underwater post-process mask and bubble clipping can
 * agree on exactly where "above the ocean's line" ends and "below" begins.
 *
 * The camera in this scene never rolls and is pitch-locked to 0 during
 * normal scroll (see Control.ts — tetha is only mutated in blocks gated by
 * !webPageMode). For a level, roll-free camera, a point on an infinite flat
 * plane FAR from the camera always projects to the screen's vertical
 * center regardless of camera height — that row would never move as you
 * scroll. Projecting a point at a finite, small forward distance instead is
 * what makes the row track camera height: it sits low in frame while above
 * water and rises off the top of frame once the camera sinks below the line.
 */
import { Vector3, MathUtils } from "three";
import { camera, cameraForward } from "../core/Scene";
import {
    waterlineY, underwaterMaskProbeDistance,
    underwaterFullCoverageDepthStart, underwaterFullCoverageDepthEnd,
} from "../scene/config/OceanConfig";

const _probe = new Vector3();

let waterLineNdcY = 0;   // -1 (bottom of screen) .. 1 (top)
let waterLineUv = 0.5;   // 0 (bottom) .. 1 (top) — matches PostProcess's vUv convention

export function Update(): void {
    const fx = cameraForward.x, fz = cameraForward.z;
    const flen = Math.hypot(fx, fz) || 1e-5;
    _probe.set(
        camera.position.x + (fx / flen) * underwaterMaskProbeDistance,
        waterlineY,
        camera.position.z + (fz / flen) * underwaterMaskProbeDistance
    );
    _probe.project(camera);
    const probeNdcY = _probe.y;

    // The probe angle flattens out (rather than steepening) as the camera
    // goes deeper, so it alone never confidently reaches "fully underwater"
    // — most of a deep view is open water with nothing for the depth-based
    // mask to grab either. Blend in a guaranteed full-coverage ramp once the
    // camera is unambiguously deep, so open-water pixels still saturate to
    // 100% at a reasonable depth instead of stalling partway up the screen.
    const depth = -camera.position.y; // positive once below the waterline
    const depthRamp = MathUtils.smoothstep(depth, underwaterFullCoverageDepthStart, underwaterFullCoverageDepthEnd);
    const depthRampNdcY = MathUtils.lerp(-1, 1, depthRamp);

    waterLineNdcY = MathUtils.clamp(Math.max(probeNdcY, depthRampNdcY), -1, 1);
    waterLineUv = waterLineNdcY * 0.5 + 0.5;
}

export function getWaterLineUv(): number { return waterLineUv; }
export function getWaterLineNdcY(): number { return waterLineNdcY; }

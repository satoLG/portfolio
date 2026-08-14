import { Clock, Uniform } from "three";

export let time = 0;
export let deltaTime = 0;
export const timeUniform = new Uniform(time);

// The one frame-rate measurement in the app. Anything that displays FPS reads
// this rather than counting for itself: the settings readout used to count its
// own invocations and silently reported double once something called it twice
// per frame, and the debug panel derived its number from the clamped deltaTime
// below, which floored it at 30 and hid every real drop under that.
export let fps = 0;

// Refresh window for the readout. Long enough that one slow frame doesn't make
// the number jump, short enough to still feel live.
const FPS_WINDOW = 0.25;
let fpsWindow = 0;
let fpsFrames = 0;

const clock = new Clock();

export function Start(): void
{
    clock.start();
    time = clock.elapsedTime;
    timeUniform.value = time;
}

// Max per-frame delta. When the tab is hidden, requestAnimationFrame pauses
// and clock.getDelta() returns a multi-second jump on resume. Letting that
// propagate causes spawn/despawn bursts (fish all reset to the spawn edge at
// once) and physics tunneling. Clamping keeps the world advancing at a
// steady pace from where it was when the tab regained focus.
const MAX_DELTA = 1 / 30;

export function Update(): void
{
    const rawDelta = clock.getDelta();
    deltaTime = Math.min(rawDelta, MAX_DELTA);
    time += deltaTime;
    timeUniform.value = time;

    // Measured from the unclamped delta, deliberately: the clamp above exists
    // to keep the world advancing steadily, not to describe how fast frames
    // actually arrived.
    if (rawDelta > FPS_WINDOW) {
        // A tab regaining focus arrives as one multi-second frame. Counting it
        // would drag the average down across several windows, so drop the
        // sample and start the next window clean.
        fpsWindow = 0;
        fpsFrames = 0;
        return;
    }
    fpsWindow += rawDelta;
    fpsFrames++;
    if (fpsWindow >= FPS_WINDOW) {
        fps = fpsFrames / fpsWindow;
        fpsWindow = 0;
        fpsFrames = 0;
    }
}

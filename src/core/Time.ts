import { Clock, Uniform } from "three";

export let time = 0;
export let deltaTime = 0;
export const timeUniform = new Uniform(time);

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
    deltaTime = Math.min(clock.getDelta(), MAX_DELTA);
    time += deltaTime;
    timeUniform.value = time;
}

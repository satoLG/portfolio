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

export function Update(): void
{
    time = clock.elapsedTime;
    deltaTime = clock.getDelta();
    timeUniform.value = time;
}

import { BufferGeometry, Group, Line, LineBasicMaterial, Vector3 } from "three";
import { body, camera, cameraForward } from "./Scene";
import { deltaTime } from "./Time";

export const debugging = false;
const axesSize = 0.06;

let showPanel = debugging;
export let showAll = debugging;
export let showFps = debugging;
export let showCpu = debugging;
export let showMem = debugging;
export let showPos = debugging;
export let showAxes = debugging;
export const axes = new Group();
axes.visible = debugging;

export function changeShowAll(value: boolean): void
{
    showAll = value;
}
export function allVisible(value: boolean): void
{
    showAll = value;
    fpsVisible(showAll);
    cpuVisible(showAll);
    memVisible(showAll);
    posVisible(showAll);
    axesVisible(showAll);
}
export function fpsVisible(value: boolean): void
{
    showFps = value;
    showPanel = showFps || showCpu || showMem || showPos;
    debugPanel.style.display = showPanel ? "block" : "none";
    fpsDiv.style.display = showFps ? "block" : "none";
}
export function cpuVisible(value: boolean): void
{
    showCpu = value;
    showPanel = showFps || showCpu || showMem || showPos;
    debugPanel.style.display = showPanel ? "block" : "none";
    cpuDiv.style.display = showCpu ? "block" : "none";
}
export function memVisible(value: boolean): void
{
    showMem = value;
    showPanel = showFps || showCpu || showMem || showPos;
    debugPanel.style.display = showPanel ? "block" : "none";
    memDiv.style.display = showMem ? "block" : "none";
}
export function posVisible(value: boolean): void
{
    showPos = value;
    showPanel = showFps || showCpu || showMem || showPos;
    debugPanel.style.display = showPanel ? "block" : "none";
    posDiv.style.display = showPos ? "block" : "none";
}
export function axesVisible(value: boolean): void
{
    showAxes = value;
    axes.visible = showAxes;
}

const debugPanel = document.createElement("debug") as HTMLElement;
const fpsDiv = document.createElement("div");
const cpuDiv = document.createElement("div");
const memDiv = document.createElement("div");
const posDiv = document.createElement("div");

let fps = 0;
let frameTime = 0;
let deltaTimeSum = 0;
let cpuTime = 0;
let cpuUsage = 0;
let mem: Performance["memory"] | undefined = undefined;
let lastRefresh = 0;
let frameCount = 0;
let cpuSum = 0;
let cpuDeltaSum = 0;
let lastFrame = 0;

let now: number, a: Vector3;

declare global {
    interface Performance {
        memory?: {
            usedJSHeapSize: number;
            jsHeapSizeLimit: number;
        };
    }
}

export function Start(): void
{   
    debugPanel.style.display = showPanel ? "block" : "none";
    fpsDiv.style.display = showFps ? "block" : "none";
    cpuDiv.style.display = showCpu ? "block" : "none";
    memDiv.style.display = showMem ? "block" : "none";
    posDiv.style.display = showPos ? "block" : "none";

    debugPanel.appendChild(fpsDiv);
    debugPanel.appendChild(cpuDiv);
    debugPanel.appendChild(memDiv);
    debugPanel.appendChild(posDiv);

    body.appendChild(debugPanel);

    function AxisLine(a: Vector3, b: Vector3, color: number): Line
    {
        const material = new LineBasicMaterial( { color: color } );
        const geometry = new BufferGeometry().setFromPoints([a, b]);

        return new Line(geometry, material);
    }

    axes.add(AxisLine(new Vector3(0, 0, 0), new Vector3(axesSize, 0, 0), 0xff0000));
    axes.add(AxisLine(new Vector3(0, 0, 0), new Vector3(0, axesSize, 0), 0x00ff00));
    axes.add(AxisLine(new Vector3(0, 0, 0), new Vector3(0, 0, axesSize), 0x0000ff));

    allVisible(showAll);

    lastRefresh = performance.now();
}

export function Update(): void
{   
    frameCount++;
    deltaTimeSum += deltaTime;
    now = performance.now();
    cpuDeltaSum += now - lastFrame;
    lastFrame = now;

    if (lastRefresh + 500 <= now)
    {
        frameTime = deltaTimeSum / frameCount;
        fps = Math.round(1 / frameTime * 10) / 10;
        frameTime = Math.round(frameTime * 10000) / 10;
        cpuTime = Math.round(cpuSum / frameCount * 10) / 10;
        cpuUsage = Math.round(cpuTime / (cpuDeltaSum / frameCount) * 1000) / 10;

        frameCount = 0;
        deltaTimeSum = 0;
        cpuSum = 0;
        cpuDeltaSum = 0;

        mem = performance.memory;

        lastRefresh = now;
    }

    fpsDiv.textContent = "FPS: " + fps + " (" + frameTime + " MS)";
    cpuDiv.textContent = "CPU: " + cpuTime + " MS (" + cpuUsage + "%)";

    if (mem)
    {
        memDiv.textContent = "Memory: " + Math.round(mem.usedJSHeapSize / 1048576 * 10) / 10 + " MB / " + Math.round(mem.jsHeapSizeLimit / 104857.6) / 10 + " MB";
    }
    else
    {
        memDiv.textContent = "Memory: cannot measure";
    }

    posDiv.textContent = "Position: " + Math.round(camera.position.x * 10) / 10 + ", " + Math.round(camera.position.y * 10) / 10 + ", " + Math.round(camera.position.z * 10) / 10;

    a = new Vector3().copy(cameraForward);
    axes.position.set(a.x, a.y, a.z);
}

let beginTime = 0;

export function Begin(): void
{
    beginTime = performance.now();
}

export function End(): void
{
    cpuSum += performance.now() - beginTime;
}

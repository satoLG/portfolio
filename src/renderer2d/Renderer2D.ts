import { draw as drawIsland } from "./ToonIsland";
import { draw as drawOcean } from "./ToonOcean";
import { draw as drawClouds } from "./ToonClouds";
import { draw as drawFish } from "./ToonFish";
import { draw as drawUI } from "./ToonUI";

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let active = false;
let rAFId = 0;

const SKY_TOP = "#87CEEB";
const SKY_BOTTOM = "#E0F0FF";
const GROUND_COLOR = "#7CCD7C";

const ISLAND_Y = 0.52;	// fraction of canvas height — ground line

function resizeCanvas(): void
{
	if (!canvas) return;
	const parent = canvas.parentElement;
	if (!parent) return;
	const dpr = window.devicePixelRatio || 1;
	const w = parent.clientWidth;
	const h = parent.clientHeight;
	canvas.width = w * dpr;
	canvas.height = h * dpr;
	canvas.style.width = `${w}px`;
	canvas.style.height = `${h}px`;
	ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function toggle(newActive: boolean): void
{
	if (newActive === active) return;
	active = newActive;
	if (canvas) {
		canvas.style.display = active ? "block" : "none";
	}
	if (active) {
		cancelAnimationFrame(rAFId);
		resizeCanvas();
		loop(0);
	} else {
		cancelAnimationFrame(rAFId);
	}
}

export function start(): void
{
	if (canvas) return;

	const container = document.querySelector("#webgl");
	if (!container) {
		console.warn("[Renderer2D] #webgl container not found");
		return;
	}

	canvas = document.createElement("canvas");
	canvas.id = "renderer2d-canvas";
	canvas.style.position = "absolute";
	canvas.style.top = "0";
	canvas.style.left = "0";
	canvas.style.width = "100%";
	canvas.style.height = "100%";
	canvas.style.display = "none";
	canvas.style.pointerEvents = "none";
	canvas.style.zIndex = "10";
	container.appendChild(canvas);

	ctx = canvas.getContext("2d")!;

	window.addEventListener("resize", resizeCanvas);
}

export function stop(): void
{
	if (canvas) {
		canvas.remove();
		canvas = null;
		ctx = null;
	}
	active = false;
	cancelAnimationFrame(rAFId);
	window.removeEventListener("resize", resizeCanvas);
}

function loop(time: number): void
{
	if (!active || !ctx || !canvas) return;
	rAFId = requestAnimationFrame(loop);

	const w = canvas.width / (window.devicePixelRatio || 1);
	const h = canvas.height / (window.devicePixelRatio || 1);

	// --- Sky gradient ---
	const skyGrad = ctx.createLinearGradient(0, 0, 0, h * ISLAND_Y);
	skyGrad.addColorStop(0, SKY_TOP);
	skyGrad.addColorStop(1, SKY_BOTTOM);
	ctx.fillStyle = skyGrad;
	ctx.fillRect(0, 0, w, h * ISLAND_Y);

	// --- Ground ---
	ctx.fillStyle = GROUND_COLOR;
	ctx.fillRect(0, h * ISLAND_Y, w, h * (1 - ISLAND_Y));

	// --- Subsystems ---
	drawClouds(ctx, w, h, time, 0);
	drawIsland(ctx, w, h, time, 1);
	drawOcean(ctx, w, h, time);
	drawFish(ctx, w, h, time);
	drawUI(ctx, w, h, time);
}
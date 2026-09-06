import { renderer, webglContainer } from "./Scene";
import * as ToonIsland from "../renderer2d/ToonIsland";
import * as ToonOcean from "../renderer2d/ToonOcean";
import * as ToonClouds from "../renderer2d/ToonClouds";
import * as ToonFish from "../renderer2d/ToonFish";
import * as ToonUI from "../renderer2d/ToonUI";

const STORAGE_KEY = "portfolio-mode-2d";
const CANVAS_ID = "renderer-2d-canvas";

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let _active = false;
let _rafId = 0;
let _time = 0;

// Track camera Y so clouds reposition the same as 3D view
let _cameraY = 0;

function initCanvas(): void {
	if (canvas) {
		return;
	}

	canvas = document.createElement("canvas");
	canvas.id = CANVAS_ID;
	canvas.style.position = "absolute";
	canvas.style.top = "0";
	canvas.style.left = "0";
	canvas.style.width = "100%";
	canvas.style.height = "100%";
	canvas.style.display = "none";
	canvas.style.pointerEvents = "none";
	canvas.style.zIndex = "2";

	ctx = canvas.getContext("2d");

	webglContainer.appendChild(canvas);

	const resize = (): void => {
		if (!canvas) {
			return;
		}
		const w = webglContainer.clientWidth;
		const h = webglContainer.clientHeight;
		canvas.width = w;
		canvas.height = h;
	};

	resize();
	window.addEventListener("resize", resize);
}

function drawFrame(): void {
	if (!canvas || !ctx) {
		return;
	}

	const w = canvas.width;
	const h = canvas.height;

	// --- Cartoon sky gradient ---
	const gradient = ctx.createLinearGradient(0, 0, 0, h * 0.58);
	gradient.addColorStop(0, "#87CEEB");
	gradient.addColorStop(0.6, "#E0F0FF");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, w, h * 0.58);

	// --- Sky / land divide ---
	ctx.fillStyle = "#7CCD7C";
	ctx.fillRect(0, h * 0.48, w, h * 0.1);

	// --- Clouds (behind island) ---
	ToonClouds.draw(ctx, w, h, _time * 0.001, _cameraY);

	// --- Island (center, cartoon) ---
	ToonIsland.draw(ctx, w, h, _time * 0.001, 1.0);

	// --- Ocean ---
	ToonOcean.draw(ctx, w, h, _time * 0.001);

	// --- Fish ---
	ToonFish.draw(ctx, w, h, _time * 0.001);

	// --- UI Cards (project carousel replica) ---
	ToonUI.draw(ctx, w, h, _time * 0.001);

	// Small frame counter
	_time++;

	_rafId = requestAnimationFrame(drawFrame);
}

export function setCameraY(y: number): void {
	_cameraY = y;
}

export function init(): void {
	initCanvas();

	const saved = localStorage.getItem(STORAGE_KEY);
	if (saved === "true") {
		start();
	}
}

export function start(): void {
	if (_active) {
		return;
	}
	_active = true;
	localStorage.setItem(STORAGE_KEY, "true");

	if (canvas) {
		canvas.style.display = "block";
	}

	renderer.domElement.style.display = "none";

	_time = 0;
	_rafId = requestAnimationFrame(drawFrame);
}

export function stop(): void {
	if (!_active) {
		return;
	}
	_active = false;
	localStorage.setItem(STORAGE_KEY, "false");

	cancelAnimationFrame(_rafId);

	if (canvas) {
		canvas.style.display = "none";
	}

	renderer.domElement.style.display = "block";
}

export function toggle(): void {
	if (_active) {
		stop();
	} else {
		start();
	}
}

export function isActive(): boolean {
	return _active;
}
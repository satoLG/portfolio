import { renderer } from "./Scene";

const STORAGE_KEY = "portfolio-mode-2d";

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let _active = false;
let _rafId = 0;
let _time = 0;

function initCanvas(): void {
	if (canvas) return;
	canvas = document.createElement("canvas");
	canvas.id = "renderer2d";
	canvas.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;display:none;z-index:10;pointer-events:none";
	document.body.appendChild(canvas);
	ctx = canvas.getContext("2d")!;

	const resize = () => {
		if (!canvas) return;
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
	};
	resize();
	window.addEventListener("resize", resize);
}

function drawFrame(): void {
	_rafId = requestAnimationFrame(drawFrame);
	if (!canvas || !ctx || !_active) return;
	const w = canvas.width, h = canvas.height;
	if (w === 0 || h === 0) return;

	// ── sky ──
	const grad = ctx.createLinearGradient(0, 0, 0, h * 0.55);
	grad.addColorStop(0, "#87CEEB");
	grad.addColorStop(0.6, "#B0E0FF");
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, w, h * 0.55);

	// ── ground (sand) ──
	ctx.fillStyle = "#E8C88A";
	ctx.fillRect(0, h * 0.55, w, h * 0.08);
	ctx.strokeStyle = "#8B7355";
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(0, h * 0.55);
	ctx.lineTo(w, h * 0.55);
	ctx.stroke();

	// ── clouds ──
	const cloudData: number[][] = [
		[0.2, 0.10, 35, 28, -8, 28, 55, 2, 30],
		[0.5, 0.06, 30, 24, -6, 24, 48, 0, 26],
		[0.78, 0.12, 25, 20, -5, 20, 40, 2, 22],
	];
	ctx.fillStyle = "#FFFFFF";
	ctx.strokeStyle = "#B0B0B0";
	ctx.lineWidth = 2.5;
	for (const d of cloudData) {
		const cx = (w * d[0] + _time * d[2] * 0.05) % (w + 200) - 100;
		const cy = h * d[1];
		ctx.beginPath(); ctx.arc(cx, cy, d[2], 0, Math.PI * 2); ctx.fill(); ctx.stroke();
		ctx.beginPath(); ctx.arc(cx + d[3], cy + d[4], d[5], 0, Math.PI * 2); ctx.fill(); ctx.stroke();
		ctx.beginPath(); ctx.arc(cx + d[6], cy + d[7], d[8], 0, Math.PI * 2); ctx.fill(); ctx.stroke();
	}

	// ── island ──
	const islandCy = h * 0.55;
	const islandCx = w / 2;
	// island base
	ctx.fillStyle = "#7CCD7C";
	ctx.strokeStyle = "#2D5A2D";
	ctx.lineWidth = 3.5;
	ctx.beginPath();
	ctx.ellipse(islandCx, islandCy + 8, 160, 44, 0, 0, Math.PI * 2);
	ctx.fill(); ctx.stroke();
	// palm trunk
	ctx.strokeStyle = "#4A2E1A";
	ctx.lineWidth = 12;
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.moveTo(islandCx - 50, islandCy);
	ctx.quadraticCurveTo(islandCx - 62, islandCy - 90, islandCx - 45, islandCy - 140);
	ctx.stroke();
	ctx.strokeStyle = "#8B5E3C";
	ctx.lineWidth = 9;
	ctx.beginPath();
	ctx.moveTo(islandCx - 50, islandCy);
	ctx.quadraticCurveTo(islandCx - 62, islandCy - 90, islandCx - 45, islandCy - 140);
	ctx.stroke();
	// palm leaves
	const lx = islandCx - 45, ly = islandCy - 142;
	for (let i = 0; i < 7; i++) {
		const a = -Math.PI / 2 + (i / 6 - 0.5) * 2.0;
		const ex = lx + Math.cos(a) * 65, ey = ly + Math.sin(a) * 65;
		ctx.fillStyle = "#2E8B2E";
		ctx.strokeStyle = "#1A4A1A";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(lx, ly);
		ctx.quadraticCurveTo(lx + Math.cos(a - 0.2) * 35, ly + Math.sin(a - 0.2) * 35, ex, ey);
		ctx.quadraticCurveTo(lx + Math.cos(a + 0.2) * 35, ly + Math.sin(a + 0.2) * 35, lx, ly);
		ctx.fill(); ctx.stroke();
	}
	// hut
	const hx = islandCx + 55, hy = islandCy - 5;
	ctx.fillStyle = "#F5DEB3";
	ctx.strokeStyle = "#8B7355";
	ctx.lineWidth = 3;
	ctx.fillRect(hx - 28, hy - 40, 56, 40);
	ctx.strokeRect(hx - 28, hy - 40, 56, 40);
	ctx.fillStyle = "#FF8C00";
	ctx.strokeStyle = "#8B4500";
	ctx.beginPath();
	ctx.moveTo(hx - 34, hy - 40);
	ctx.lineTo(hx, hy - 75);
	ctx.lineTo(hx + 34, hy - 40);
	ctx.closePath();
	ctx.fill(); ctx.stroke();
	// door
	ctx.fillStyle = "#8B4513";
	ctx.fillRect(hx - 8, hy - 22, 16, 22);
	ctx.strokeStyle = "#4A2E1A";
	ctx.lineWidth = 2;
	ctx.strokeRect(hx - 8, hy - 22, 16, 22);

	// ── ocean ──
	const oceanTop = h * 0.63;
	ctx.fillStyle = "#1E90FF";
	ctx.fillRect(0, oceanTop, w, h - oceanTop);
	// wave line
	ctx.strokeStyle = "#0A4A8A";
	ctx.lineWidth = 3;
	ctx.beginPath();
	for (let x = 0; x <= w; x += 20) {
		const y = oceanTop + Math.sin((x + _time * 2) * 0.025) * 5;
		x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
	}
	ctx.lineTo(w, oceanTop + 6);
	ctx.stroke();
	// bubbles
	for (let i = 0; i < 6; i++) {
		const bx = w * 0.1 + i * w * 0.16;
		const by = oceanTop + 30 + (_time * 2 + i * 70) % (h - oceanTop - 40);
		ctx.beginPath();
		ctx.arc(bx + Math.sin(i) * 20, by, 4 + i % 3 * 2, 0, Math.PI * 2);
		ctx.fillStyle = "rgba(255,255,255,0.35)";
		ctx.fill();
		ctx.strokeStyle = "rgba(255,255,255,0.6)";
		ctx.lineWidth = 1;
		ctx.stroke();
	}

	// ── fish ──
	for (let i = 0; i < 5; i++) {
		const fx = (w * 0.1 + i * w * 0.2 + _time * 1.0 + i * 30) % (w + 40) - 20;
		const fy = oceanTop + 30 + i * 25 + Math.sin(_time * 0.05 + i) * 6;
		const s = 10 + i * 2;
		const fishColorId = i % 5;
		const fishColors = ["#FF6347","#FFD700","#FF69B4","#00CED1","#98FB98"];
		const fishOutline = ["#8B2500","#8B6914","#8B3A62","#00688B","#4A8B4A"];
		ctx.fillStyle = fishColors[fishColorId];
		ctx.strokeStyle = fishOutline[fishColorId];
		ctx.lineWidth = 1.5;
		// tail
		ctx.beginPath();
		ctx.moveTo(fx - s * 0.3, fy);
		ctx.lineTo(fx - s * 0.9, fy - s * 0.4);
		ctx.lineTo(fx - s * 0.9, fy + s * 0.4);
		ctx.closePath();
		ctx.fill(); ctx.stroke();
		// body
		ctx.beginPath();
		ctx.ellipse(fx + s * 0.3, fy, s * 0.65, s * 0.35, 0, 0, Math.PI * 2);
		ctx.fill(); ctx.stroke();
		// eye
		ctx.fillStyle = "#FFF";
		ctx.beginPath();
		ctx.arc(fx + s * 0.6, fy - s * 0.12, s * 0.12, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "#000";
		ctx.beginPath();
		ctx.arc(fx + s * 0.63, fy - s * 0.12, s * 0.06, 0, Math.PI * 2);
		ctx.fill();
	}

	// ── project cards ──
	const cardY = h * 0.30;
	const cardGap = 200;
	const totalW = 3 * cardGap - 30;
	const startX = (w - totalW) / 2;
	for (let i = 0; i < 3; i++) {
		const cx = startX + i * cardGap;
		ctx.fillStyle = "#FFFFFF";
		ctx.strokeStyle = "#333";
		ctx.lineWidth = 3;
		ctx.shadowColor = "rgba(0,0,0,0.1)";
		ctx.shadowOffsetX = 4;
		ctx.shadowOffsetY = 4;
		ctx.beginPath();
		ctx.roundRect(cx, cardY, 170, 220, 6);
		ctx.fill();
		ctx.stroke();
		ctx.shadowColor = "transparent";
		ctx.fillStyle = "#1971c2";
		ctx.beginPath();
		ctx.roundRect(cx + 6, cardY + 6, 158, 6, 2);
		ctx.fill();
		ctx.fillStyle = "#444";
		ctx.font = "bold 14px 'Wotfard', sans-serif";
		ctx.textAlign = "left";
		ctx.fillText("Project " + (i + 1), cx + 14, cardY + 34);
		ctx.fillStyle = "#888";
		ctx.font = "11px 'Wotfard', sans-serif";
		ctx.fillText("Cartoon portfolio item", cx + 14, cardY + 52);
		ctx.fillStyle = "#E0E0E0";
		ctx.strokeStyle = "#CCC";
		ctx.lineWidth = 1.5;
		ctx.fillRect(cx + 14, cardY + 66, 142, 70);
		ctx.strokeRect(cx + 14, cardY + 66, 142, 70);
		// View button
		ctx.fillStyle = "#1971c2";
		ctx.beginPath();
		ctx.roundRect(cx + 14, cardY + 185, 142, 22, 4);
		ctx.fill();
		ctx.fillStyle = "#FFF";
		ctx.font = "bold 11px 'Wotfard', sans-serif";
		ctx.textAlign = "center";
		ctx.fillText("View Project", cx + 85, cardY + 200);
	}

	_time++;
}

export function init(): void {
	initCanvas();
	if (localStorage.getItem(STORAGE_KEY) === "true") start();
}

export function start(): void {
	if (_active) return;
	_active = true;
	localStorage.setItem(STORAGE_KEY, "true");
	if (canvas) canvas.style.display = "block";
	renderer.domElement.style.display = "none";
	_time = 0;
	_rafId = requestAnimationFrame(drawFrame);
}

export function stop(): void {
	if (!_active) return;
	_active = false;
	localStorage.setItem(STORAGE_KEY, "false");
	cancelAnimationFrame(_rafId);
	if (canvas) canvas.style.display = "none";
	renderer.domElement.style.display = "block";
}

export function toggle(): void { _active ? stop() : start(); }
export function isActive(): boolean { return _active; }
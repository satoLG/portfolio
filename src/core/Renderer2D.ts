import { renderer } from "./Scene";

const STORAGE_KEY = "portfolio-mode-2d";

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let _active = false;
let _rafId = 0;
let _time = 0;
let _scrollY = 0; // 0 = top (above water), 1.0 = bottom (sea floor)

// ── Sky palette (from shader Settings.ts) ──
const SKY_TOP = "#29578A";
const SKY_HORIZON = "#6699B2";
const OCEAN_SURFACE_COLOR = "#40B0B0";
const OCEAN_DEEP = "#0A2A4A";
const SAND_COLOR = "#C2A66D";
const GROUND_GREEN = "#5A8C5A";

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

	ctx.clearRect(0, 0, w, h);

	// ── Scene layout ──
	// Camera at default: island at center, ocean at ~55% height
	const horizonY = h * 0.55;
	const islandCx = w / 2;
	const islandCy = horizonY + 8;

	// ── Sky gradient ──
	const grad = ctx.createLinearGradient(0, 0, 0, horizonY);
	grad.addColorStop(0, SKY_TOP);
	grad.addColorStop(0.7, SKY_HORIZON);
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, w, horizonY);

	// ── Ocean surface (behind island) ──
	ctx.fillStyle = OCEAN_SURFACE_COLOR;
	ctx.fillRect(0, horizonY, w, h - horizonY);

	// ── Ocean waves ──
	ctx.strokeStyle = "rgba(255,255,255,0.3)";
	ctx.lineWidth = 1.5;
	for (let row = 0; row < 3; row++) {
		ctx.beginPath();
		const baseY = horizonY + 8 + row * 20;
		for (let x = 0; x <= w; x += 10) {
			const y = baseY + Math.sin((x + _time * 2 + row * 50) * 0.02) * 4;
			x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
		}
		ctx.stroke();
	}

	// ── Island body ──
	ctx.fillStyle = GROUND_GREEN;
	ctx.strokeStyle = "#2D5A2D";
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.ellipse(islandCx, islandCy + 6, 140, 38, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();

	// ── Sand beach ──
	ctx.fillStyle = SAND_COLOR;
	ctx.beginPath();
	ctx.ellipse(islandCx + 30, islandCy + 10, 60, 16, 0.2, 0, Math.PI * 2);
	ctx.fill();

	// ── Palm tree ──
	const treeX = islandCx - 60;
	const treeY = islandCy - 5;
	ctx.strokeStyle = "#5C3A1E";
	ctx.lineWidth = 8;
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.moveTo(treeX, treeY);
	ctx.quadraticCurveTo(treeX - 10, treeY - 70, treeX - 5, treeY - 110);
	ctx.stroke();
	// Leaves
	const leafColors = ["#2D8A2D", "#3A9A3A", "#228B22"];
	for (let i = 0; i < 6; i++) {
		const a = -Math.PI / 2 + (i / 5 - 0.5) * 1.8;
		const lx = treeX - 5;
		const ly = treeY - 112;
		const ex = lx + Math.cos(a) * 50, ey = ly + Math.sin(a) * 50;
		ctx.fillStyle = leafColors[i % 3];
		ctx.strokeStyle = "#1A5A1A";
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(lx, ly);
		ctx.quadraticCurveTo(lx + Math.cos(a - 0.2) * 25, ly + Math.sin(a - 0.2) * 25, ex, ey);
		ctx.quadraticCurveTo(lx + Math.cos(a + 0.2) * 25, ly + Math.sin(a + 0.2) * 25, lx, ly);
		ctx.fill();
		ctx.stroke();
	}

	// ── Tent ──
	const tentX = islandCx + 40;
	const tentY = islandCy - 2;
	ctx.fillStyle = "#D4A76A";
	ctx.strokeStyle = "#8B6914";
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(tentX - 28, tentY);
	ctx.lineTo(tentX, tentY - 35);
	ctx.lineTo(tentX + 28, tentY);
	ctx.closePath();
	ctx.fill();
	ctx.stroke();
	ctx.fillStyle = "#C4955A";
	ctx.beginPath();
	ctx.rect(tentX - 18, tentY - 12, 36, 12);
	ctx.fill();
	ctx.stroke();

	// ── Campfire ──
	const fireX = islandCx - 20;
	const fireY = islandCy - 5;
	ctx.fillStyle = "#8B4513";
	ctx.beginPath();
	for (let i = 0; i < 5; i++) {
		const a = (i / 5) * Math.PI * 2;
		const r = 6 + Math.sin(_time * 0.1 + i) * 2;
		ctx.arc(fireX + Math.cos(a) * 5, fireY + Math.sin(a) * 3, r, 0, Math.PI * 2);
	}
	ctx.fill();
	ctx.fillStyle = "#FF6600";
	ctx.beginPath();
	ctx.arc(fireX, fireY - 8, 8 + Math.sin(_time * 0.15) * 3, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = "#FFCC00";
	ctx.beginPath();
	ctx.arc(fireX, fireY - 10, 4 + Math.sin(_time * 0.2) * 2, 0, Math.PI * 2);
	ctx.fill();

	// ── Waterline foam ──
	ctx.strokeStyle = "rgba(255,255,255,0.5)";
	ctx.lineWidth = 2;
	ctx.beginPath();
	for (let x = 0; x <= w; x += 8) {
		const y = horizonY + Math.sin(x * 0.03 + _time * 0.05) * 3;
		x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
	}
	ctx.stroke();

	// ── Underwater area ──
	const underwaterY = horizonY + 50;
	ctx.fillStyle = OCEAN_DEEP;
	ctx.globalAlpha = 0.3;
	ctx.fillRect(0, underwaterY, w, h - underwaterY);
	ctx.globalAlpha = 1;

	// ── Fish ──
	for (let i = 0; i < 6; i++) {
		const fx = ((w * 0.1 + i * w * 0.15 + _time * 0.8 * (0.5 + i * 0.2)) % (w + 60) - 30);
		const fy = underwaterY + 30 + i * 25 + Math.sin(_time * 0.03 + i) * 8;
		const s = 8 + i * 2;
		const colors = ["#FF6347", "#FFD700", "#FF69B4", "#00CED1", "#98FB98", "#DDA0DD"];
		const outlines = ["#8B2500", "#8B6914", "#8B3A62", "#00688B", "#4A8B4A", "#6B426B"];
		ctx.fillStyle = colors[i];
		ctx.strokeStyle = outlines[i];
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.ellipse(fx, fy, s * 0.7, s * 0.35, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(fx - s * 0.4, fy);
		ctx.lineTo(fx - s, fy - s * 0.35);
		ctx.lineTo(fx - s, fy + s * 0.35);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "#FFF";
		ctx.beginPath();
		ctx.arc(fx + s * 0.4, fy - s * 0.15, s * 0.12, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "#000";
		ctx.beginPath();
		ctx.arc(fx + s * 0.42, fy - s * 0.15, s * 0.06, 0, Math.PI * 2);
		ctx.fill();
	}

	// ── Bubbles ──
	for (let i = 0; i < 8; i++) {
		const bx = w * 0.05 + i * w * 0.12 + Math.sin(i * 2.3) * 15;
		const by = underwaterY + 20 + (_time * 1.5 + i * 60) % (h - underwaterY - 30);
		ctx.beginPath();
		ctx.arc(bx, by, 3 + i % 3 * 2, 0, Math.PI * 2);
		ctx.fillStyle = "rgba(255,255,255,0.25)";
		ctx.fill();
		ctx.strokeStyle = "rgba(255,255,255,0.4)";
		ctx.lineWidth = 1;
		ctx.stroke();
	}

	// ── Carousel cards (underwater, center) ──
	const cardY = underwaterY + 60;
	const cardW = 160;
	const cardH = 200;
	const gap = 20;
	const totalW = 3 * cardW + 2 * gap;
	const startX = (w - totalW) / 2;

	const titles = ["Experiência", "Projetos", "Estudos"];
	for (let i = 0; i < 3; i++) {
		const cx = startX + i * (cardW + gap);

		// Card shadow
		ctx.fillStyle = "rgba(0,0,0,0.15)";
		ctx.beginPath();
		ctx.roundRect(cx + 3, cardY + 3, cardW, cardH, 8);
		ctx.fill();

		// Card body
		ctx.fillStyle = "#FFFFFF";
		ctx.strokeStyle = "#333";
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		ctx.roundRect(cx, cardY, cardW, cardH, 8);
		ctx.fill();
		ctx.stroke();

		// Accent bar
		ctx.fillStyle = "#1971c2";
		ctx.beginPath();
		ctx.roundRect(cx + 10, cardY + 10, cardW - 20, 5, 2);
		ctx.fill();

		// Title
		ctx.fillStyle = "#333";
		ctx.font = "bold 13px 'Wotfard', sans-serif";
		ctx.textAlign = "center";
		ctx.fillText(titles[i], cx + cardW / 2, cardY + 35);

		// Placeholder content
		ctx.fillStyle = "#E8E8E8";
		ctx.beginPath();
		ctx.roundRect(cx + 12, cardY + 48, cardW - 24, 60, 4);
		ctx.fill();
		ctx.strokeStyle = "#CCC";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.roundRect(cx + 12, cardY + 48, cardW - 24, 60, 4);
		ctx.stroke();

		// Text lines
		ctx.fillStyle = "#AAA";
		ctx.font = "10px 'Wotfard', sans-serif";
		ctx.textAlign = "left";
		ctx.fillText("Card content here", cx + 20, cardY + 70);
		ctx.fillText("Tap to expand", cx + 20, cardY + 85);

		// View button
		ctx.fillStyle = "#1971c2";
		ctx.beginPath();
		ctx.roundRect(cx + 15, cardY + cardH - 35, cardW - 30, 24, 4);
		ctx.fill();
		ctx.fillStyle = "#FFF";
		ctx.font = "bold 11px 'Wotfard', sans-serif";
		ctx.textAlign = "center";
		ctx.fillText("Ver mais", cx + cardW / 2, cardY + cardH - 19);
	}

	// ── Header (leosato. title, theme toggle) ──
	ctx.fillStyle = "rgba(255,255,255,0.85)";
	ctx.font = "bold 16px 'Wotfard', sans-serif";
	ctx.textAlign = "left";
	ctx.fillText("leosato.", 20, 30);

	// Theme toggle circle
	ctx.fillStyle = "#FFD700";
	ctx.beginPath();
	ctx.arc(w - 50, 30, 12, 0, Math.PI * 2);
	ctx.fill();
	ctx.strokeStyle = "#333";
	ctx.lineWidth = 1.5;
	ctx.stroke();

	// ── Settings gear ──
	ctx.strokeStyle = "#555";
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(w - 25, 30, 8, 0, Math.PI * 2);
	ctx.stroke();
	ctx.beginPath();
	ctx.arc(w - 25, 30, 4, 0, Math.PI * 2);
	ctx.stroke();

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
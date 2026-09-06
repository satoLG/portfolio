const OCEAN_COLOR = "#1E90FF";
const OCEAN_OUTLINE = "#0A4A8A";
const WAVE_COLOR = "#FFFFFF";
const BUBBLE_COLOR = "rgba(255, 255, 255, 0.4)";
const FISH_COLOR = "#FF6347";
const FISH_OUTLINE = "#8B2500";

export function draw(
	ctx: CanvasRenderingContext2D,
	w: number, h: number,
	time: number
): void
{
	const oceanTop = h * 0.58;

	// --- Ocean body ---
	ctx.fillStyle = OCEAN_COLOR;
	ctx.fillRect(0, oceanTop, w, h - oceanTop);

	// --- Wave line (bezier curves) ---
	ctx.beginPath();
	ctx.moveTo(0, oceanTop);
	for (let x = 0; x <= w; x += 30) {
		const y = oceanTop + Math.sin((x + time * 60) * 0.02) * 5
			+ Math.sin((x + time * 40) * 0.04) * 3;
		ctx.lineTo(x, y);
	}
	ctx.lineTo(w, oceanTop);
	ctx.closePath();
	ctx.strokeStyle = OCEAN_OUTLINE;
	ctx.lineWidth = 3;
	ctx.stroke();

	// --- Wave crest highlights ---
	for (let x = 0; x < w; x += 40) {
		const crestY = oceanTop + Math.sin((x + time * 60) * 0.02) * 5
			+ Math.sin((x + time * 40) * 0.04) * 3;
		if (Math.sin((x + time * 60) * 0.02) > 0.3) {
			ctx.beginPath();
			ctx.arc(x, crestY - 2, 4, 0, Math.PI * 2);
			ctx.fillStyle = WAVE_COLOR;
			ctx.fill();
		}
	}

	// --- Stylized fish ( > shape ) ---
	const fishCount = 4;
	for (let i = 0; i < fishCount; i++) {
		const fx = (w * 0.15 + i * w * 0.22 + Math.sin(time + i * 2) * 15) % w;
		const fy = oceanTop + 30 + i * 20 + Math.sin(time * 0.8 + i) * 8;
		const fSize = 10 + i * 2;

		ctx.beginPath();
		ctx.moveTo(fx, fy);
		ctx.lineTo(fx + fSize, fy - fSize * 0.4);
		ctx.lineTo(fx + fSize, fy + fSize * 0.4);
		ctx.closePath();
		ctx.fillStyle = FISH_COLOR;
		ctx.fill();
		ctx.strokeStyle = FISH_OUTLINE;
		ctx.lineWidth = 2;
		ctx.stroke();

		// Fish body oval
		ctx.beginPath();
		ctx.ellipse(fx + fSize * 0.6, fy, fSize * 0.6, fSize * 0.35, 0, 0, Math.PI * 2);
		ctx.fillStyle = FISH_COLOR;
		ctx.fill();
		ctx.strokeStyle = FISH_OUTLINE;
		ctx.lineWidth = 2;
		ctx.stroke();

		// Eye
		ctx.beginPath();
		ctx.arc(fx + fSize * 1.0, fy - 2, 2, 0, Math.PI * 2);
		ctx.fillStyle = "#FFFFFF";
		ctx.fill();
		ctx.beginPath();
		ctx.arc(fx + fSize * 1.0, fy - 2, 1, 0, Math.PI * 2);
		ctx.fillStyle = "#000000";
		ctx.fill();
	}

	// --- Bubbles ---
	for (let i = 0; i < 8; i++) {
		const bx = w * 0.1 + i * w * 0.12 + Math.sin(i * 3.7) * 20;
		const by = oceanTop + 60 + Math.sin(time * 0.5 + i * 1.3) * 15
			+ (time * 15 + i * 50) % (h - oceanTop - 60);
		const br = 3 + (i % 3) * 2;
		ctx.beginPath();
		ctx.arc(bx, by, br, 0, Math.PI * 2);
		ctx.fillStyle = BUBBLE_COLOR;
		ctx.fill();
		ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
		ctx.lineWidth = 1;
		ctx.stroke();
	}

	// --- Ocean outline top ---
	ctx.beginPath();
	ctx.moveTo(0, oceanTop);
	for (let x = 0; x <= w; x += 30) {
		const y = oceanTop + Math.sin((x + time * 60) * 0.02) * 5
			+ Math.sin((x + time * 40) * 0.04) * 3;
		ctx.lineTo(x, y);
	}
	ctx.strokeStyle = OCEAN_OUTLINE;
	ctx.lineWidth = 4;
	ctx.stroke();
}
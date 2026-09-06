const FISH_COLORS = [
	{ body: "#FF6347", outline: "#8B2500" },
	{ body: "#FFD700", outline: "#8B6914" },
	{ body: "#FF69B4", outline: "#8B3A62" },
	{ body: "#00CED1", outline: "#00688B" },
	{ body: "#98FB98", outline: "#4A8B4A" },
	{ body: "#DDA0DD", outline: "#6B426B" },
	{ body: "#F0E68C", outline: "#8B8132" },
];

const fish: Array<{
	x: number;
	y: number;
	size: number;
	colorIdx: number;
	speed: number;
	phase: number;
}> = [];

function ensureFish(): void
{
	if (fish.length > 0) return;
	for (let i = 0; i < 7; i++) {
		fish.push({
			x: Math.random(),
			y: 0.62 + Math.random() * 0.25,
			size: 6 + Math.random() * 8,
			colorIdx: i % FISH_COLORS.length,
			speed: 0.5 + Math.random() * 1.5,
			phase: Math.random() * Math.PI * 2,
		});
	}
}

export function draw(
	ctx: CanvasRenderingContext2D,
	w: number, h: number,
	time: number
): void
{
	ensureFish();

	for (const f of fish) {
		// Horizontal movement with wrap
		const fx = (f.x * w + time * f.speed * 30 + f.phase * 50) % (w + 60) - 30;
		// Vertical sine bob
		const fy = f.y * h + Math.sin(time * 0.8 + f.phase) * 5;
		const s = f.size;
		const color = FISH_COLORS[f.colorIdx];

		// Tail (triangle)
		ctx.beginPath();
		ctx.moveTo(fx - s * 0.4, fy);
		ctx.lineTo(fx - s * 1.0, fy - s * 0.5);
		ctx.lineTo(fx - s * 1.0, fy + s * 0.5);
		ctx.closePath();
		ctx.fillStyle = color.body;
		ctx.fill();
		ctx.strokeStyle = color.outline;
		ctx.lineWidth = 1.5;
		ctx.stroke();

		// Body (oval)
		ctx.beginPath();
		ctx.ellipse(fx + s * 0.2, fy, s * 0.7, s * 0.4, 0, 0, Math.PI * 2);
		ctx.fillStyle = color.body;
		ctx.fill();
		ctx.strokeStyle = color.outline;
		ctx.lineWidth = 1.5;
		ctx.stroke();

		// Eye
		ctx.beginPath();
		ctx.arc(fx + s * 0.5, fy - s * 0.1, s * 0.15, 0, Math.PI * 2);
		ctx.fillStyle = "#FFFFFF";
		ctx.fill();
		ctx.beginPath();
		ctx.arc(fx + s * 0.55, fy - s * 0.1, s * 0.08, 0, Math.PI * 2);
		ctx.fillStyle = "#000000";
		ctx.fill();
	}
}
const CLOUD_COLOR = "#FFFFFF";
const CLOUD_OUTLINE = "#B0B0B0";
const SPEED = 5; // px/s

interface Cloud {
	x: number;
	y: number;
	scale: number;
	circles: Array<{ dx: number; dy: number; r: number }>;
}

const clouds: Cloud[] = [
	{
		x: 0.15, y: 0.10, scale: 1,
		circles: [
			{ dx: 0, dy: 0, r: 35 },
			{ dx: 28, dy: -8, r: 28 },
			{ dx: 55, dy: 2, r: 30 },
			{ dx: 30, dy: 10, r: 22 },
		],
	},
	{
		x: 0.50, y: 0.06, scale: 0.85,
		circles: [
			{ dx: 0, dy: 0, r: 30 },
			{ dx: 24, dy: -6, r: 24 },
			{ dx: 48, dy: 0, r: 26 },
			{ dx: 22, dy: 8, r: 18 },
		],
	},
	{
		x: 0.78, y: 0.12, scale: 0.7,
		circles: [
			{ dx: 0, dy: 0, r: 25 },
			{ dx: 20, dy: -5, r: 20 },
			{ dx: 40, dy: 2, r: 22 },
		],
	},
	{
		x: 0.35, y: 0.18, scale: 0.55,
		circles: [
			{ dx: 0, dy: 0, r: 20 },
			{ dx: 16, dy: -4, r: 16 },
			{ dx: 32, dy: 0, r: 18 },
		],
	},
];

export function draw(
	ctx: CanvasRenderingContext2D,
	w: number, h: number,
	time: number,
	_cameraY: number
): void
{
	for (const cloud of clouds) {
		// Move horizontally, wrap around
		let cx = (cloud.x * w + time * SPEED * cloud.scale) % (w + 200);
		cx -= 100; // start off-screen left
		const cy = cloud.y * h;
		const s = cloud.scale;

		for (const c of cloud.circles) {
			ctx.beginPath();
			ctx.arc(cx + c.dx * s, cy + c.dy * s, c.r * s, 0, Math.PI * 2);
			ctx.fillStyle = CLOUD_COLOR;
			ctx.fill();
			ctx.strokeStyle = CLOUD_OUTLINE;
			ctx.lineWidth = 2.5 * s;
			ctx.stroke();
		}
	}
}
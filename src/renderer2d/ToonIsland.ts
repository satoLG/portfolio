const ISLAND_COLOR = "#7CCD7C";
const ISLAND_OUTLINE = "#2D5A2D";
const TRUNK_COLOR = "#8B5E3C";
const TRUNK_OUTLINE = "#4A2E1A";
const LEAF_COLOR = "#2E8B2E";
const LEAF_OUTLINE = "#1A4A1A";
const HUT_WALL = "#F5DEB3";
const HUT_WALL_OUTLINE = "#8B7355";
const HUT_ROOF = "#FF8C00";
const HUT_ROOF_OUTLINE = "#8B4500";

export function draw(
	ctx: CanvasRenderingContext2D,
	w: number, h: number,
	_time: number,
	zoom: number
): void
{
	const cx = w / 2;
	const islandY = h * 0.52;
	const scale = zoom;

	// --- Island oval ---
	const rx = 140 * scale;
	const ry = 40 * scale;
	ctx.beginPath();
	ctx.ellipse(cx, islandY + ry * 0.3, rx, ry, 0, 0, Math.PI * 2);
	ctx.fillStyle = ISLAND_COLOR;
	ctx.fill();
	ctx.strokeStyle = ISLAND_OUTLINE;
	ctx.lineWidth = 3.5 * scale;
	ctx.stroke();

	// --- Palm trunk (curved) ---
	const trunkBaseX = cx - 50 * scale;
	const trunkBaseY = islandY + ry * 0.1;
	ctx.beginPath();
	ctx.moveTo(trunkBaseX, trunkBaseY);
	ctx.quadraticCurveTo(
		trunkBaseX - 10 * scale,
		trunkBaseY - 80 * scale,
		trunkBaseX + 5 * scale,
		trunkBaseY - 130 * scale
	);
	ctx.lineWidth = 10 * scale;
	ctx.strokeStyle = TRUNK_COLOR;
	ctx.lineCap = "round";
	ctx.stroke();
	ctx.strokeStyle = TRUNK_OUTLINE;
	ctx.lineWidth = 13 * scale;
	ctx.beginPath();
	ctx.moveTo(trunkBaseX, trunkBaseY);
	ctx.quadraticCurveTo(
		trunkBaseX - 10 * scale,
		trunkBaseY - 80 * scale,
		trunkBaseX + 5 * scale,
		trunkBaseY - 130 * scale
	);
	ctx.stroke();
	// Inner trunk to give outline effect
	ctx.strokeStyle = TRUNK_COLOR;
	ctx.lineWidth = 10 * scale;
	ctx.beginPath();
	ctx.moveTo(trunkBaseX, trunkBaseY);
	ctx.quadraticCurveTo(
		trunkBaseX - 10 * scale,
		trunkBaseY - 80 * scale,
		trunkBaseX + 5 * scale,
		trunkBaseY - 130 * scale
	);
	ctx.stroke();

	// --- Palm leaves (fan shape) ---
	const leafCx = trunkBaseX + 5 * scale;
	const leafCy = trunkBaseY - 135 * scale;
	const leafCount = 6;
	for (let i = 0; i < leafCount; i++) {
		const angle = -Math.PI / 2 + (i / (leafCount - 1) - 0.5) * Math.PI * 0.8;
		const leafLen = 55 * scale;
		const endX = leafCx + Math.cos(angle) * leafLen;
		const endY = leafCy + Math.sin(angle) * leafLen;
		// Leaf blade
		ctx.beginPath();
		ctx.moveTo(leafCx, leafCy);
		ctx.quadraticCurveTo(
			leafCx + Math.cos(angle - 0.15) * leafLen * 0.5,
			leafCy + Math.sin(angle - 0.15) * leafLen * 0.5,
			endX,
			endY
		);
		ctx.quadraticCurveTo(
			leafCx + Math.cos(angle + 0.15) * leafLen * 0.5,
			leafCy + Math.sin(angle + 0.15) * leafLen * 0.5,
			leafCx,
			leafCy
		);
		ctx.fillStyle = LEAF_COLOR;
		ctx.fill();
		ctx.strokeStyle = LEAF_OUTLINE;
		ctx.lineWidth = 2 * scale;
		ctx.stroke();
	}

	// --- Small hut ---
	const hutCx = cx + 45 * scale;
	const hutCy = islandY + ry * 0.05;
	const hutW = 50 * scale;
	const hutH = 35 * scale;

	// Walls
	ctx.fillStyle = HUT_WALL;
	ctx.fillRect(hutCx - hutW / 2, hutCy - hutH, hutW, hutH);
	ctx.strokeStyle = HUT_WALL_OUTLINE;
	ctx.lineWidth = 3 * scale;
	ctx.strokeRect(hutCx - hutW / 2, hutCy - hutH, hutW, hutH);

	// Roof (triangle)
	ctx.beginPath();
	ctx.moveTo(hutCx - hutW / 2 - 5 * scale, hutCy - hutH);
	ctx.lineTo(hutCx, hutCy - hutH - 30 * scale);
	ctx.lineTo(hutCx + hutW / 2 + 5 * scale, hutCy - hutH);
	ctx.closePath();
	ctx.fillStyle = HUT_ROOF;
	ctx.fill();
	ctx.strokeStyle = HUT_ROOF_OUTLINE;
	ctx.lineWidth = 3 * scale;
	ctx.stroke();

	// Door
	const doorW = 12 * scale;
	const doorH = 20 * scale;
	ctx.fillStyle = "#8B4513";
	ctx.fillRect(hutCx - doorW / 2, hutCy - doorH, doorW, doorH);
	ctx.strokeStyle = "#4A2E1A";
	ctx.lineWidth = 2 * scale;
	ctx.strokeRect(hutCx - doorW / 2, hutCy - doorH, doorW, doorH);
}
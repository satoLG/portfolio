const CARD_W = 180;
const CARD_H = 240;
const CARD_OUTLINE = "#333333";
const CARD_FILL = "#FFFFFF";
const TEXT_COLOR = "#444444";
const ACCENT_BLUE = "#1971c2";

export function draw(
	ctx: CanvasRenderingContext2D,
	w: number, h: number,
	_time: number
): void
{
	const cardCount = 3;
	const spacing = CARD_W + 30;
	const totalWidth = cardCount * spacing - 30;
	const startX = (w - totalWidth) / 2;
	const cardY = h * 0.35 - CARD_H / 2;

	for (let i = 0; i < cardCount; i++) {
		const cx = startX + i * spacing;
		const cy = cardY;

		// Card shadow (offset for cartoon style)
		ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
		ctx.fillRect(cx + 4, cy + 4, CARD_W, CARD_H);

		// Card body
		ctx.fillStyle = CARD_FILL;
		ctx.fillRect(cx, cy, CARD_W, CARD_H);
		ctx.strokeStyle = CARD_OUTLINE;
		ctx.lineWidth = 3;
		ctx.strokeRect(cx, cy, CARD_W, CARD_H);

		// Accent stripe at top
		ctx.fillStyle = ACCENT_BLUE;
		ctx.fillRect(cx, cy, CARD_W, 8);

		// Placeholder text lines
		ctx.fillStyle = TEXT_COLOR;
		ctx.font = "bold 14px 'Wotfard', sans-serif";
		ctx.textAlign = "left";
		ctx.fillText(`Project ${i + 1}`, cx + 14, cy + 36);

		ctx.fillStyle = "#888888";
		ctx.font = "11px 'Wotfard', sans-serif";
		ctx.fillText("A cartoon portfolio", cx + 14, cy + 56);
		ctx.fillText("item description", cx + 14, cy + 70);

		// Thumbnail placeholder
		ctx.fillStyle = "#E0E0E0";
		ctx.fillRect(cx + 14, cy + 84, CARD_W - 28, 80);
		ctx.strokeStyle = "#CCCCCC";
		ctx.lineWidth = 1.5;
		ctx.strokeRect(cx + 14, cy + 84, CARD_W - 28, 80);

		// "View" button
		const btnX = cx + 14;
		const btnY = cy + CARD_H - 36;
		const btnW = CARD_W - 28;
		const btnH = 24;
		ctx.fillStyle = ACCENT_BLUE;
		ctx.beginPath();
		ctx.roundRect(btnX, btnY, btnW, btnH, 4);
		ctx.fill();
		ctx.strokeStyle = "#0F4A7A";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.roundRect(btnX, btnY, btnW, btnH, 4);
		ctx.stroke();

		ctx.fillStyle = "#FFFFFF";
		ctx.font = "bold 12px 'Wotfard', sans-serif";
		ctx.textAlign = "center";
		ctx.fillText("View Project", cx + CARD_W / 2, btnY + 16);
	}
}
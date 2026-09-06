import puppeteer from "puppeteer";

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", err => errors.push(err.message));

await page.goto("http://localhost:5199", { waitUntil: "load", timeout: 15000 });
await page.waitForTimeout(3000);

// Check what's rendering
const info = await page.evaluate(() => {
	const webglCanvas = document.querySelector("#webgl canvas");
	const webglDisplay = webglCanvas ? webglCanvas.style.display : "no canvas";
	
	const btn = document.getElementById("mode-toggle-btn");
	const btnText = btn ? btn.textContent : "no button";
	
	// Get canvas size
	const webglContainerEl = document.getElementById("webgl");
	const w = webglContainerEl ? webglContainerEl.clientWidth : 0;
	const h = webglContainerEl ? webglContainerEl.clientHeight : 0;
	
	return { webglDisplay, btnText, containerW: w, containerH: h };
});
console.log("Initial:", JSON.stringify(info));

// Click the 2D button
await page.evaluate(() => {
	const btn = document.getElementById("mode-toggle-btn");
	if (btn) btn.click();
});
await page.waitForTimeout(1000);

const afterClick = await page.evaluate(() => {
	const webglCanvas = document.querySelector("#webgl canvas");
	const webglDisplay = webglCanvas ? webglCanvas.style.display : "no canvas";
	
	const r2dCanvas = document.getElementById("renderer2d");
	const r2dInfo = r2dCanvas ? { 
		display: r2dCanvas.style.display, 
		width: r2dCanvas.width, 
		height: r2dCanvas.height,
		clientWidth: r2dCanvas.clientWidth,
		clientHeight: r2dCanvas.clientHeight,
	} : null;
	
	const btn = document.getElementById("mode-toggle-btn");
	const btnText = btn ? btn.textContent : "no button";
	
	// Check if Renderer2D module exists
	const hasRenderer = typeof window !== 'undefined';
	
	return { webglDisplay, r2dInfo, btnText };
});
console.log("After click:", JSON.stringify(afterClick));
console.log("Errors:", errors);

await browser.close();
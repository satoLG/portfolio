/**
 * Icon Generator Script
 * 
 * This script generates PNG icons from favicon.svg for PWA compatibility.
 * 
 * Prerequisites:
 *   npm install sharp
 * 
 * Usage:
 *   node scripts/generate-icons.js
 * 
 * Or you can use online tools like:
 *   - https://realfavicongenerator.net/
 *   - https://www.pwabuilder.com/imageGenerator
 *   - https://favicon.io/favicon-converter/
 * 
 * Upload your favicon.svg and download the generated icon pack.
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ICON_SIZES = [
  16, 32, 72, 96, 128, 144, 152, 180, 192, 384, 512
];

const SOURCE_SVG = path.join(__dirname, '..', 'favicon.svg');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'icons');

async function generateIcons() {
  // Create output directory if it doesn't exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Read the SVG file
  const svgBuffer = fs.readFileSync(SOURCE_SVG);

  // Generate each icon size
  for (const size of ICON_SIZES) {
    const outputPath = path.join(OUTPUT_DIR, `icon-${size}x${size}.png`);
    
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    
    console.log(`Generated: icon-${size}x${size}.png`);
  }

  // Generate apple-touch-icon (180x180)
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile(path.join(OUTPUT_DIR, 'apple-touch-icon.png'));
  console.log('Generated: apple-touch-icon.png');

  // Generate OG image (1200x630 with the icon centered)
  const ogWidth = 1200;
  const ogHeight = 630;
  const iconSize = 300;
  
  // Create a background and composite the icon in the center
  await sharp({
    create: {
      width: ogWidth,
      height: ogHeight,
      channels: 4,
      background: { r: 10, g: 22, b: 40, alpha: 1 } // #0a1628
    }
  })
    .composite([{
      input: await sharp(svgBuffer)
        .resize(iconSize, iconSize)
        .png()
        .toBuffer(),
      gravity: 'center'
    }])
    .png()
    .toFile(path.join(OUTPUT_DIR, 'og-image.png'));
  console.log('Generated: og-image.png');

  console.log('\nAll icons generated successfully!');
}

generateIcons().catch(console.error);

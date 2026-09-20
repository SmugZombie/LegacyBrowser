// Renders the home-screen icons with the Chromium that Playwright already
// installs, so the PNGs in public/icons stay reproducible.
//   node tools/make-icons.mjs
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/icons");

// iOS 9 picks by size: 76 is the non-retina iPad (mini 1), 152 the retina iPad,
// 167 the iPad Pro, 120/180 iPhone. 192/512 are for the Android manifest.
const SIZES = [76, 120, 152, 167, 180, 192, 512];

const GLOBE = `
  <g fill="none" stroke="#6ea8ff" stroke-width="5.5" stroke-linecap="round">
    <circle cx="50" cy="50" r="29"/>
    <ellipse cx="50" cy="50" rx="12.5" ry="29"/>
    <line x1="21.5" y1="50" x2="78.5" y2="50"/>
    <line x1="27" y1="35" x2="73" y2="35"/>
    <line x1="27" y1="65" x2="73" y2="65"/>
  </g>`;

function svg(size, withPlate) {
  // Full-bleed square: iOS applies its own rounded mask.
  const plate = withPlate
    ? `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0" stop-color="#22304a"/><stop offset="1" stop-color="#0d1118"/>
       </linearGradient></defs><rect width="100" height="100" fill="url(#bg)"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">${plate}${GLOBE}</svg>`;
}

// iOS 9 only accepts a startup image whose pixel dimensions match the device
// exactly. These two are the non-retina iPad (mini 1, iPad 2), minus the 20px
// status bar.
const SPLASHES = [
  { name: "splash-768x1004.png", width: 768, height: 1004 },
  { name: "splash-1024x748.png", width: 1024, height: 748 },
];

function splashHtml(width, height) {
  const glyph = Math.round(Math.min(width, height) * 0.28);
  return `<html><body style="margin:0;width:${width}px;height:${height}px;overflow:hidden;
      background:linear-gradient(#22304a,#0d1118);display:flex;flex-direction:column;
      align-items:center;justify-content:center;font:400 ${Math.round(glyph * 0.19)}px/1.4 -apple-system,Helvetica,sans-serif;color:#9fb0c7">
    ${svg(glyph, false)}
    <div style="margin-top:${Math.round(glyph * 0.18)}px;letter-spacing:.08em">LegacyBrowse</div>
  </body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
for (const shot of SPLASHES) {
  await page.setViewportSize({ width: shot.width, height: shot.height });
  await page.setContent(splashHtml(shot.width, shot.height));
  await page.screenshot({ path: path.join(OUT, shot.name) });
  console.log(shot.name);
}
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden">` +
    svg(size, true) +
    `</body></html>`
  );
  await page.screenshot({ path: path.join(OUT, `icon-${size}.png`), omitBackground: false });
  console.log("icon-" + size + ".png");
}
await browser.close();

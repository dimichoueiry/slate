// Verify the expanded icon library: categories render, search works, icons place cleanly.
import { chromium } from 'playwright';
import fs from 'node:fs';

const SHOTS = 'scripts/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

await page.goto('http://localhost:5180/');
await page.waitForSelector('text=New board');
await page.click('text=New board');
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(400);

await page.click('.toolbar button[title="Icon library (I)"]');
try {
  await page.waitForSelector('.icon-cat-label', { timeout: 8000 });
} catch (e) {
  await page.screenshot({ path: `${SHOTS}/iconland-fail.png` });
  console.log('TRAY FAIL — errors:\n' + errors.join('\n'));
  throw e;
}
const catCount = await page.locator('.icon-cat-label').count();
const iconCount = await page.locator('.icon-cell').count();
console.log(`categories: ${catCount}, icons rendered: ${iconCount}`);
await page.screenshot({ path: `${SHOTS}/iconland-1-tray.png` });

// scroll to the geometric section
await page.locator('.icon-cat-label:has-text("Geometric")').scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/iconland-2-geometric.png` });

// place a spread of icons from different categories
const picks = [
  ['Hexagon', 320, 250], ['Burst', 480, 250], ['Spiral', 640, 250], ['Star eight', 800, 250], ['Infinity', 960, 250],
  ['Atom', 320, 420], ['Brain', 480, 420], ['Coffee', 640, 420], ['Sun', 800, 420], ['Lightning', 960, 420],
  ['Launch', 320, 590], ['Gamepad', 480, 590], ['Bike', 640, 590], ['Heartbeat', 800, 590], ['Compass', 960, 590],
];
for (const [title, x, y] of picks) {
  await page.fill('.icon-tray-header input', String(title).toLowerCase());
  const cell = page.locator(`.icon-cell[title="${title}"]`).first();
  await cell.click();
  await page.waitForTimeout(80);
  await page.mouse.move(700, 450); // icons land at viewport center
  await page.mouse.down();
  await page.mouse.move(Number(x), Number(y), { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/iconland-3-canvas.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

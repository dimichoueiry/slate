// Verify: quick-connect chips, connector labels, ⌘K palette jump, auto-shape recognition.
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

// --- quick-connect: shape, click right chip → connected copy spawns ---
await page.keyboard.press('r');
await page.click('.stylebar label:has-text("Fill") .swatch:nth-of-type(5)'); // fill so it's grabbable
await page.mouse.move(300, 300);
await page.mouse.down();
await page.mouse.move(440, 390, { steps: 3 });
await page.mouse.up();
// shape is selected; right chip sits 34px right of its right-edge midpoint
await page.mouse.click(440 + 34, 345);
await page.waitForTimeout(250);
// spawned copy should now be selected; drag-from-chip too: use its bottom chip
await page.mouse.click(660, 390 + 45 + 34); // bottom chip of spawned box (~at 590..730 x, 300..390 y)
await page.waitForTimeout(250);
await page.screenshot({ path: `${SHOTS}/p3-1-quickconnect.png` });

// --- connector label: dblclick the first connector, type ---
await page.keyboard.press('Escape');
await page.dblclick('.overlay-canvas', { position: { x: 480, y: 345 } }); // midpoint of first connector
await page.waitForSelector('.text-editor');
await page.keyboard.type('calls');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// --- auto-shape: enable, draw a rough circle and a rough rect ---
await page.keyboard.press('p');
await page.click('.stylebar .seg button:has-text("Auto-shape")');
// rough circle (start on the circle itself so the stroke closes)
await page.mouse.move(1080, 330);
await page.mouse.down();
for (let i = 0; i <= 40; i++) {
  const a = (i / 40) * Math.PI * 2;
  await page.mouse.move(1000 + 80 * Math.cos(a) + (Math.random() * 8 - 4), 330 + 80 * Math.sin(a) + (Math.random() * 8 - 4));
}
await page.mouse.up();
await page.waitForTimeout(200);
// rough rectangle
await page.mouse.move(900, 520);
await page.mouse.down();
for (let x = 900; x <= 1130; x += 12) await page.mouse.move(x, 520 + (Math.random() * 6 - 3));
for (let y = 520; y <= 660; y += 12) await page.mouse.move(1130 + (Math.random() * 6 - 3), y);
for (let x = 1130; x >= 900; x -= 12) await page.mouse.move(x, 660 + (Math.random() * 6 - 3));
for (let y = 660; y >= 522; y -= 12) await page.mouse.move(900 + (Math.random() * 6 - 3), y);
await page.mouse.up();
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/p3-2-autoshape.png` });

// --- ⌘K: search the connector label and jump ---
await page.keyboard.press('v');
await page.keyboard.press('Meta+k');
await page.waitForSelector('.palette input');
await page.keyboard.type('calls');
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOTS}/p3-3-palette.png` });
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/p3-4-jumped.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

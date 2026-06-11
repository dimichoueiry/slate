// Verify: with Attach off, lines drawn inside a shape stay free (grid use case).
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

// big square
await page.keyboard.press('r');
await page.mouse.move(400, 250);
await page.mouse.down();
await page.mouse.move(800, 650, { steps: 4 });
await page.mouse.up();
await page.keyboard.press('Escape');

// line tool, Attach OFF → draw a 2x2 grid inside the square
await page.keyboard.press('l');
await page.click('.stylebar .seg button:has-text("Free")');
const gridLines = [
  [400, 383, 800, 383], // horizontal thirds
  [400, 517, 800, 517],
  [533, 250, 533, 650], // vertical thirds
  [667, 250, 667, 650],
];
for (const [x1, y1, x2, y2] of gridLines) {
  await page.keyboard.press('l');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/attach-1-grid.png` });

// move the square: grid lines must NOT follow (they're free, unattached)
await page.keyboard.press('v');
await page.mouse.move(600, 252); // top edge of square
await page.mouse.down();
await page.mouse.move(1050, 400, { steps: 8 });
await page.mouse.up();
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/attach-2-moved.png` });

// sanity: Attach back ON still attaches
await page.keyboard.press('l');
await page.click('.stylebar .seg button:has-text("Attach")');
await page.mouse.move(300, 700);
await page.mouse.down();
await page.mouse.move(1000, 480, { steps: 8 }); // ends inside the moved square
await page.mouse.up();
await page.keyboard.press('Escape');
// move square again; the new line should follow
await page.mouse.move(1050, 302);
await page.mouse.down();
await page.mouse.move(1100, 200, { steps: 6 });
await page.mouse.up();
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/attach-3-on-again.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

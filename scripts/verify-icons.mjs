// Verify: icon tray opens, search filters, icons place on canvas, recolor, connect, persist.
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

// open tray, place a server icon
await page.click('.toolbar button[title="Icon library (I)"]');
await page.waitForSelector('.icon-grid');
await page.fill('.icon-tray-header input', 'server');
await page.click('.icon-cell[title="Server"]');
await page.waitForTimeout(150);
// move it left
await page.mouse.move(700, 450);
await page.mouse.down();
await page.mouse.move(450, 350, { steps: 8 });
await page.mouse.up();

// place a database icon, recolor it blue
await page.fill('.icon-tray-header input', 'data');
await page.click('.icon-cell[title="Database"]');
await page.waitForTimeout(150);
await page.click('.stylebar .swatch:nth-of-type(6)'); // blue
// move it right
await page.mouse.move(700, 450);
await page.mouse.down();
await page.mouse.move(950, 550, { steps: 8 });
await page.mouse.up();
await page.keyboard.press('Escape');

// connect the two icons
await page.keyboard.press('c');
await page.mouse.move(460, 360);
await page.mouse.down();
await page.mouse.move(940, 545, { steps: 8 });
await page.mouse.up();
await page.keyboard.press('Escape');

// a couple more icons for the showcase
for (const [name, title, x, y] of [['rocket', 'Launch', 500, 650], ['idea', 'Idea', 700, 250], ['kanban', 'Kanban', 1100, 300]]) {
  await page.fill('.icon-tray-header input', name);
  await page.click(`.icon-cell[title="${title}"]`);
  await page.waitForTimeout(120);
  await page.mouse.move(700, 450);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/icons-1-board.png` });

// persistence
await page.reload();
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/icons-2-reload.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

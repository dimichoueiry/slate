// Smoke test: home → new board → draw → shape → connector → sticky → reload persistence.
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = 'http://localhost:5180/';
const SHOTS = 'scripts/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto(URL);
await page.waitForSelector('text=New board', { timeout: 15000 });
await page.screenshot({ path: `${SHOTS}/1-home.png` });

// create a board
await page.click('text=New board');
await page.waitForSelector('.board-root canvas', { timeout: 15000 });
await page.waitForTimeout(600);

const canvas = page.locator('.overlay-canvas');

// draw a freehand stroke with the pen tool
await page.keyboard.press('p');
await page.mouse.move(500, 400);
await page.mouse.down();
for (let i = 0; i <= 30; i++) {
  const t = i / 30;
  await page.mouse.move(500 + 200 * t, 400 + 60 * Math.sin(t * Math.PI * 2));
}
await page.mouse.up();

// rectangle
await page.keyboard.press('r');
await page.mouse.move(420, 550);
await page.mouse.down();
await page.mouse.move(580, 650);
await page.mouse.up();

// second rectangle
await page.keyboard.press('r');
await page.mouse.move(760, 550);
await page.mouse.down();
await page.mouse.move(920, 660);
await page.mouse.up();

// connector between the rectangles
await page.keyboard.press('c');
await page.mouse.move(575, 600);
await page.mouse.down();
await page.mouse.move(700, 600);
await page.mouse.move(765, 600);
await page.mouse.up();

// sticky note + text
await page.keyboard.press('s');
await page.mouse.click(1050, 350);
try {
  await page.waitForSelector('.text-editor', { timeout: 5000 });
} catch (e) {
  await page.screenshot({ path: `${SHOTS}/fail-sticky.png` });
  console.log('STICKY FAIL — errors so far:\n' + errors.join('\n'));
  throw e;
}
await page.keyboard.type('Slate works!');
await page.keyboard.press('Escape');

await page.waitForTimeout(800); // let autosave flush
await page.screenshot({ path: `${SHOTS}/2-board.png` });

// persistence: reload and confirm objects survive
await page.reload();
await page.waitForSelector('.board-root canvas', { timeout: 15000 });
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/3-reload.png` });

// undo a couple of times to exercise history
await page.keyboard.press('Meta+z');
await page.keyboard.press('Meta+z');
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/4-undo.png` });

// back home: thumbnail should appear
await page.click('.topbar .chrome-btn');
await page.waitForSelector('.board-grid', { timeout: 10000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${SHOTS}/5-home-thumb.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

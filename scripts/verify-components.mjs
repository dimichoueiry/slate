// Verify reusable components: sketch → save as component → place from tray → persists across boards.
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
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Server box' : undefined));

await page.goto('http://localhost:5180/');
await page.waitForSelector('text=New board');
await page.click('text=New board');
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(400);

// --- build a small "sketch": filled rounded rect + a pen squiggle + a label ---
await page.keyboard.press('r');
await page.click('.stylebar button[title="Rounded corners"]');
await page.click('.stylebar label:has-text("Fill") .swatch:nth-of-type(5)');
await page.mouse.move(400, 300);
await page.mouse.down();
await page.mouse.move(560, 400);
await page.mouse.up();
await page.keyboard.press('Escape');
await page.keyboard.press('p');
await page.mouse.move(410, 290);
await page.mouse.down();
for (let i = 0; i <= 16; i++) await page.mouse.move(410 + i * 10, 285 + 8 * Math.sin(i / 1.6));
await page.mouse.up();
await page.keyboard.press('v');
await page.dblclick('.overlay-canvas', { position: { x: 480, y: 350 } });
await page.waitForSelector('.text-editor');
await page.keyboard.type('API');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// select all three and save as component (prompt auto-accepts "Server box")
await page.keyboard.press('Meta+a');
await page.click('.stylebar button:has-text("Save")');
try {
  await page.waitForSelector('.comp-cell', { timeout: 8000 });
} catch (e) {
  await page.screenshot({ path: `${SHOTS}/comp-fail.png` });
  console.log('SAVE FAIL — errors:\n' + errors.join('\n'));
  throw e;
}
await page.screenshot({ path: `${SHOTS}/comp-1-saved.png` });

// place two instances
await page.click('.comp-cell');
await page.waitForTimeout(150);
// move first instance away
await page.mouse.move(700, 450);
await page.mouse.down();
await page.mouse.move(950, 300, { steps: 5 });
await page.mouse.up();
await page.keyboard.press('Escape');
await page.click('.comp-cell');
await page.waitForTimeout(150);
await page.mouse.move(700, 450);
await page.mouse.down();
await page.mouse.move(950, 600, { steps: 5 });
await page.mouse.up();
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/comp-2-placed.png` });

// --- components are global: new board should still list it ---
await page.click('.topbar .chrome-btn'); // back home
await page.waitForSelector('.board-grid');
await page.click('text=New board');
await page.waitForSelector('.overlay-canvas');
if ((await page.locator('.icon-tray').count()) === 0) await page.keyboard.press('i');
await page.waitForSelector('.comp-cell', { timeout: 8000 });
console.log('COMPONENT VISIBLE ON NEW BOARD');
await page.click('.comp-cell');
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/comp-3-newboard.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

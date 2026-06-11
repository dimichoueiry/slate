// Verify: icon stroke-width slider, movable toolbar, plain line tool, text size hierarchy.
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

// --- text hierarchy: three sizes ---
for (const [size, text, y] of [['56px', 'Big title', 200], ['24px', 'Subheading here', 290], ['14px', 'small body text for details', 350]]) {
  await page.keyboard.press('t');
  await page.locator('.stylebar select.font-select').nth(1).selectOption({ label: String(size) });
  await page.mouse.click(380, Number(y));
  await page.waitForSelector('.text-editor');
  await page.keyboard.type(String(text));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
}

// --- plain line (no arrowheads) ---
await page.keyboard.press('l');
await page.mouse.move(380, 420);
await page.mouse.down();
await page.mouse.move(800, 420, { steps: 5 });
await page.mouse.up();
await page.keyboard.press('Escape');

// --- icon with thick stroke ---
await page.click('.toolbar button[title="Icon library (I)"]');
await page.waitForSelector('.icon-tray-header input');
await page.fill('.icon-tray-header input', 'idea');
await page.click('.icon-cell[title="Idea"]');
await page.waitForTimeout(150);
// drag width slider to max
const slider = page.locator('.stylebar label:has-text("Width") input');
await slider.fill('4.5');
await page.waitForTimeout(150);
// move icon into view spot
await page.mouse.move(700, 450);
await page.mouse.down();
await page.mouse.move(950, 280, { steps: 5 });
await page.mouse.up();
await page.keyboard.press('Escape');
await page.click('.icon-tray-header ~ * , .icon-tray .chrome-btn'); // close tray (✕)

// --- move the toolbar ---
const grip = page.locator('.toolbar-grip');
const gb = await grip.boundingBox();
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
await page.mouse.down();
await page.mouse.move(600, 760, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/controls-1.png` });

// toolbar position persists after reload
await page.reload();
await page.waitForSelector('.toolbar-grip');
await page.waitForTimeout(500);
const tb = await page.locator('.toolbar').boundingBox();
console.log(tb.y > 400 ? 'TOOLBAR POSITION PERSISTED' : `TOOLBAR RESET (y=${tb.y})`);
await page.screenshot({ path: `${SHOTS}/controls-2-reload.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

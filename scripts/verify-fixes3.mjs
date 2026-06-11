// Verify: sketchy shapes, rounded rects, edge-precise + magnetic connector snapping,
// font picker, StyleBar reactivity, markdown notes panel.
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
await page.waitForTimeout(500);

// --- sketchy + rounded rect with fill ---
await page.keyboard.press('r');
await page.click('.stylebar .seg button:has-text("Sketchy")');
await page.click('.stylebar button[title="Rounded corners"]');
await page.click('.stylebar label:has-text("Fill") .swatch:nth-of-type(5)');
await page.mouse.move(250, 250);
await page.mouse.down();
await page.mouse.move(470, 390);
await page.mouse.up();
await page.keyboard.press('Escape');

// sketchy ellipse, no fill
await page.keyboard.press('o');
await page.mouse.move(700, 500);
await page.mouse.down();
await page.mouse.move(880, 640);
await page.mouse.up();
await page.keyboard.press('Escape');

// --- edge snapping: connector from sketchy rect to ellipse (diagonal) ---
// release ~25px BELOW the ellipse to prove magnetic snap
await page.keyboard.press('c');
await page.mouse.move(360, 320); // inside rect
await page.mouse.down();
await page.mouse.move(600, 450);
await page.mouse.move(790, 665, { steps: 5 }); // ~25px below ellipse bottom
await page.mouse.up();
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/v3-1-sketchy-edge-snap.png` });

// --- StyleBar reactivity: select rect, toggle dashed, confirm button activates ---
await page.keyboard.press('v');
await page.mouse.click(360, 320);
await page.waitForTimeout(150);
await page.click('.stylebar .seg button:has-text("┄")');
await page.waitForTimeout(150);
const dashedActive = await page
  .locator('.stylebar .seg button:has-text("┄")')
  .first()
  .evaluate((el) => el.classList.contains('active'));
console.log(dashedActive ? 'STYLEBAR REACTIVE' : 'STYLEBAR STILL FROZEN');
await page.keyboard.press('Escape');

// --- font picker: hand font text ---
await page.keyboard.press('t');
await page.locator('.stylebar select.font-select').selectOption('hand');
await page.mouse.click(900, 250);
await page.waitForSelector('.text-editor');
await page.keyboard.type('hand-drawn vibes');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// --- notes panel ---
await page.click('button:has-text("Notes")');
await page.waitForSelector('.notes-editor');
await page.fill('.notes-editor', '# Plan\n\n- draw **everything**\n- ship it\n\n> stay local-first');
await page.click('.notes-header button:has-text("Preview")');
await page.waitForSelector('.notes-preview h1');
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/v3-2-fonts-notes.png` });

// notes persist across reload
await page.reload();
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(400);
await page.click('button:has-text("Notes")');
await page.waitForSelector('.notes-editor');
const notesVal = await page.locator('.notes-editor').inputValue();
console.log(notesVal.includes('ship it') ? 'NOTES PERSISTED' : 'NOTES LOST');

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

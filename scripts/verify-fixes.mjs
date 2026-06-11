// Verify: (1) click on one item of a multi-selection selects just it (duplicate bug),
// (2) custom color picker adds persistent swatches.
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
await page.click('text=New board'); // fresh board
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(500);

// --- scenario 1: duplicate then move ONE ---
// two filled rects side by side (filled so they're grabbable anywhere)
await page.keyboard.press('r');
// pick a fill color so hit-testing works on the body
await page.click('.stylebar label:has-text("Fill") .swatch:nth-of-type(4)'); // a palette color
await page.mouse.move(400, 400);
await page.mouse.down();
await page.mouse.move(500, 470);
await page.mouse.up();
await page.keyboard.press('r');
await page.mouse.move(600, 400);
await page.mouse.down();
await page.mouse.move(700, 470);
await page.mouse.up();

// marquee-select both
await page.keyboard.press('v');
await page.mouse.move(350, 350);
await page.mouse.down();
await page.mouse.move(750, 520);
await page.mouse.up();

// duplicate (clones land +24,+24 and are selected)
await page.keyboard.press('Meta+d');
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/fix-1-duplicated.png` });

// click once on the LEFT clone (no drag) → should select just it
await page.mouse.click(474, 459); // inside left clone body
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOTS}/fix-2-single-selected.png` });

// now drag it far away → only this one should move
await page.mouse.move(474, 459);
await page.mouse.down();
await page.mouse.move(474, 700, { steps: 10 });
await page.mouse.up();
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOTS}/fix-3-moved-one.png` });

// --- scenario 2: custom colors ---
await page.keyboard.press('p');
await page.locator('.stylebar input[type=color]').first().fill('#ff5500');
await page.waitForTimeout(200);
// draw with it
await page.mouse.move(900, 300);
await page.mouse.down();
await page.mouse.move(1100, 380, { steps: 15 });
await page.mouse.up();
await page.screenshot({ path: `${SHOTS}/fix-4-custom-color.png` });

// custom color persists across reload
await page.reload();
await page.waitForSelector('.overlay-canvas');
await page.keyboard.press('p');
await page.waitForTimeout(300);
const swatches = await page.locator('.stylebar .swatch').evaluateAll((els) =>
  els.map((e) => e.style.background || e.style.backgroundColor)
);
const hasCustom = swatches.some((c) => c.includes('255, 85, 0') || c.includes('#ff5500'));
console.log(hasCustom ? 'CUSTOM COLOR PERSISTED' : `CUSTOM COLOR MISSING: ${JSON.stringify(swatches)}`);

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

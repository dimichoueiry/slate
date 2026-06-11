// Drive Slate like a user: open the saved board, draw with different pens,
// build a small diagram with snapping connectors, move a box to prove
// connectors re-route, zoom out, screenshot each stage.
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
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

await page.goto(URL);
await page.waitForSelector('text=New board', { timeout: 15000 });
await page.screenshot({ path: `${SHOTS}/run-1-home.png` });

// open the existing board (or create one if none)
const card = page.locator('.board-card').first();
if (await card.count()) await card.click();
else await page.click('text=New board');
await page.waitForSelector('.overlay-canvas', { timeout: 15000 });
await page.waitForTimeout(700);

// marker doodle
await page.keyboard.press('p');
await page.click('.stylebar .seg button:has-text("Marker")');
await page.mouse.move(300, 250);
await page.mouse.down();
for (let i = 0; i <= 40; i++) {
  const t = (i / 40) * Math.PI * 2;
  await page.mouse.move(360 + 70 * Math.cos(t), 250 + 50 * Math.sin(t));
}
await page.mouse.up();

// brush squiggle
await page.click('.stylebar .seg button:has-text("Brush")');
await page.mouse.move(250, 420);
await page.mouse.down();
for (let i = 0; i <= 50; i++) {
  await page.mouse.move(250 + i * 4, 420 + 35 * Math.sin(i / 4));
}
await page.mouse.up();
await page.screenshot({ path: `${SHOTS}/run-2-ink.png` });

// diamond + ellipse, connected
await page.keyboard.press('d');
await page.mouse.move(900, 620);
await page.mouse.down();
await page.mouse.move(1040, 720);
await page.mouse.up();

await page.keyboard.press('o');
await page.mouse.move(1180, 430);
await page.mouse.down();
await page.mouse.move(1330, 530);
await page.mouse.up();

await page.keyboard.press('c');
await page.mouse.move(1035, 670); // right anchor of diamond
await page.mouse.down();
await page.mouse.move(1150, 550);
await page.mouse.move(1182, 481); // left rim of ellipse → attaches to left anchor
await page.mouse.up();

// label the ellipse
await page.keyboard.press('v');
await page.dblclick('.overlay-canvas', { position: { x: 1326, y: 480 } }); // ellipse rim (hollow shapes hit on the rim)
try {
  await page.waitForSelector('.text-editor', { timeout: 5000 });
} catch (e) {
  await page.screenshot({ path: `${SHOTS}/run-fail.png` });
  console.log('DBLCLICK FAIL — errors:\n' + errors.join('\n'));
  throw e;
}
await page.keyboard.type('idea');
await page.keyboard.press('Escape');
await page.screenshot({ path: `${SHOTS}/run-3-diagram.png` });

// drag the diamond by its edge — connector must follow
await page.mouse.move(902, 670);
await page.mouse.down();
await page.mouse.move(820, 780, { steps: 12 });
await page.mouse.up();
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/run-4-rerouted.png` });

// zoom to fit to see the whole board
await page.keyboard.press('Shift+!');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/run-5-fit.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

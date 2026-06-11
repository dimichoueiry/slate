// Verify: a line's endpoints can be dragged to re-angle it (incl. shift 15° snap).
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

// horizontal line
await page.keyboard.press('l');
await page.mouse.move(400, 450);
await page.mouse.down();
await page.mouse.move(900, 450, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(200);
// line tool auto-selects the line — endpoint handles should be visible
await page.screenshot({ path: `${SHOTS}/ep-1-line.png` });

// drag the right endpoint upward to angle the line
await page.mouse.move(900, 450);
await page.mouse.down();
await page.mouse.move(850, 220, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/ep-2-angled.png` });

// shift-drag the same endpoint: snaps to 15° increments
await page.keyboard.down('Shift');
await page.mouse.move(850, 220);
await page.mouse.down();
await page.mouse.move(880, 300, { steps: 6 });
await page.mouse.up();
await page.keyboard.up('Shift');
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/ep-3-snapped.png` });

// drag endpoint onto a rect: should attach
await page.keyboard.press('r');
await page.mouse.move(1000, 600);
await page.mouse.down();
await page.mouse.move(1150, 700);
await page.mouse.up();
await page.keyboard.press('v');
// reselect line by clicking near its left endpoint segment
await page.mouse.click(500, 430);
await page.waitForTimeout(150);
const sel = await page.evaluate(() => document.querySelector('.stylebar')?.textContent ?? '');
// drag its free end into the rect (endpoint snapped to 15° → it sits at ~(886,320))
await page.mouse.move(886, 320);
await page.mouse.down();
await page.mouse.move(1075, 650, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(200);
// move the rect — the line should follow
await page.keyboard.press('Escape');
await page.mouse.move(1075, 602); // rect top edge
await page.mouse.down();
await page.mouse.move(1150, 780, { steps: 8 });
await page.mouse.up();
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/ep-4-attached.png` });

console.log('stylebar at reselect:', sel.slice(0, 40));
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

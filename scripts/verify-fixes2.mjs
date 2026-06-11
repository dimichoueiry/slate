// Verify: (1) connector attaches to the END shape anywhere in its area (even unfilled),
// and follows when that shape moves; (2) pasting an image creates an image object.
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

// two UNFILLED rectangles
await page.keyboard.press('r');
await page.mouse.move(300, 400);
await page.mouse.down();
await page.mouse.move(450, 500);
await page.mouse.up();
await page.keyboard.press('r');
await page.mouse.move(800, 400);
await page.mouse.down();
await page.mouse.move(950, 500);
await page.mouse.up();

// connector: start INSIDE rect A body, release INSIDE rect B body
await page.keyboard.press('c');
await page.mouse.move(375, 450); // center of A
await page.mouse.down();
await page.mouse.move(600, 450);
await page.mouse.move(875, 450, { steps: 5 }); // center of B
await page.mouse.up();
await page.keyboard.press('Escape');
await page.screenshot({ path: `${SHOTS}/fix2-1-connected.png` });

// move rect B far away by its edge — arrow must follow its anchor
await page.keyboard.press('v');
await page.mouse.move(800, 402); // top edge of B
await page.mouse.down();
await page.mouse.move(1000, 700, { steps: 12 });
await page.mouse.up();
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/fix2-2-followed.png` });

// --- image paste: dispatch a synthetic paste event with an image file ---
const imageCount = await page.evaluate(async () => {
  // make a small red PNG in-page
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = 80;
  const g = c.getContext('2d');
  g.fillStyle = '#e03131';
  g.fillRect(0, 0, 120, 80);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'paste.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true });
  window.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 800));
  return 'ok';
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/fix2-3-pasted-image.png` });
console.log('paste dispatch:', imageCount);

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

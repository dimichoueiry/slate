// Verify the AI & ML icon category renders and places on canvas.
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

await page.click('.toolbar button[title="Icon library (I)"]');
await page.waitForSelector('.icon-cat-label');
await page.locator('.icon-cat-label:has-text("AI & ML")').scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/ai-1-tray.png` });

const picks = [
  ['Neural network', 330, 230], ['Deep learning', 520, 230], ['Computer vision', 710, 230], ['Object detection', 900, 230], ['Face recognition', 1090, 230],
  ['Gen AI', 330, 430], ['AI chat', 520, 430], ['Training', 710, 430], ['GPU', 900, 430], ['Matrix', 1090, 430],
  ['Embeddings', 330, 630], ['Clustering', 520, 630], ['Decision tree', 710, 630], ['Regression', 900, 630], ['Pipeline', 1090, 630],
];
for (const [title, x, y] of picks) {
  await page.fill('.icon-tray-header input', String(title).toLowerCase().slice(0, 8));
  await page.locator(`.icon-cell[title="${title}"]`).first().click();
  await page.waitForTimeout(60);
  await page.mouse.move(700, 450);
  await page.mouse.down();
  await page.mouse.move(Number(x), Number(y), { steps: 3 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/ai-2-canvas.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

// Verify: text color of a shape's label can be changed from the style bar.
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

// shape, labeled via dblclick on its border (hollow shapes hit on the rim)
await page.keyboard.press('r');
await page.mouse.move(450, 350);
await page.mouse.down();
await page.mouse.move(750, 520, { steps: 4 });
await page.mouse.up();
await page.keyboard.press('v');
await page.dblclick('.overlay-canvas', { position: { x: 600, y: 352 } });
await page.waitForSelector('.text-editor');
await page.keyboard.type('Colored label');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// select the shape (labeled shapes hit anywhere) and pick the red Text swatch
await page.mouse.click(600, 437);
await page.waitForTimeout(150);
const textRow = page.locator('.stylebar label[title*="text inside"]');
if ((await textRow.count()) === 0) {
  console.log('TEXT ROW MISSING');
} else {
  await textRow.locator('.swatch').nth(1).click(); // #e03131
  await page.waitForTimeout(600);
}
const stored = await page.evaluate(
  () =>
    new Promise((res) => {
      const req = indexedDB.open('slate');
      req.onsuccess = () => {
        const all = req.result.transaction('objects').objectStore('objects').getAll();
        all.onsuccess = () =>
          res(
            all.result
              .map((r) => r.data)
              .filter((o) => o.type === 'shape')
              .map((o) => ({ textColor: o.textColor, text: o.text }))
          );
      };
    })
);
console.log('stored:', JSON.stringify(stored));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/textcolor.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

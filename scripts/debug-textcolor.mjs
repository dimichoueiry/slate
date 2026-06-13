import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:5180/');
await page.waitForSelector('text=New board');
await page.click('text=New board');
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(400);
await page.keyboard.press('r');
await page.mouse.move(450, 350); await page.mouse.down(); await page.mouse.move(750, 520); await page.mouse.up();
await page.keyboard.press('v');
await page.dblclick('.overlay-canvas', { position: { x: 600, y: 437 } });
await page.waitForSelector('.text-editor');
await page.keyboard.type('Colored label');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.mouse.click(600, 437);
await page.waitForTimeout(200);
const rowCount = await page.locator('.stylebar label[title*="text inside"]').count();
const selCount = await page.evaluate(() => document.querySelectorAll('.stylebar').length);
console.log('stylebar present:', selCount, 'text row:', rowCount);
if (rowCount) {
  const sw = page.locator('.stylebar label[title*="text inside"] .swatch').nth(1);
  console.log('swatch bg:', await sw.evaluate((el) => el.style.background));
  await sw.click();
  await page.waitForTimeout(600); // let autosave flush
}
const stored = await page.evaluate(
  () =>
    new Promise((res) => {
      const req = indexedDB.open('slate');
      req.onsuccess = () => {
        const tx = req.result.transaction('objects');
        const all = tx.objectStore('objects').getAll();
        all.onsuccess = () =>
          res(all.result.map((r) => r.data).filter((o) => o.type === 'shape').map((o) => ({ textColor: o.textColor, text: o.text })));
      };
    })
);
console.log('stored shapes:', JSON.stringify(stored));
await browser.close();

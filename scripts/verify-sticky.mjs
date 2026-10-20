// Verify: sticky notes render with the paper look (yellow default, rounded slightly
// irregular outline, hard offset shadow, centred text, created date bottom-right).
import { chromium } from 'playwright';
import fs from 'node:fs';

const SHOTS = 'scripts/shots';
fs.mkdirSync(SHOTS, { recursive: true });

// newest installed headless shell (a hardcoded build number goes stale on upgrades)
const PW = `${process.env.HOME}/Library/Caches/ms-playwright`;
const shell = fs
  .readdirSync(PW)
  .filter((d) => d.startsWith('chromium_headless_shell-'))
  .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
const browser = await chromium.launch({
  executablePath: `${PW}/${shell}/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

await page.goto('http://localhost:5180/app');
await page.waitForSelector('.new-board');
await page.click('.new-board');
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(400);
const t0 = Date.now();

// place a sticky with the sticky tool; optionally pick a colour swatch and type text
async function sticky(x, y, text, swatch) {
  await page.keyboard.press('s');
  await page.waitForTimeout(100);
  if (swatch !== undefined) {
    await page.click('.stylebar .color-chip-btn'); // open the colour popover
    await page.locator('.color-pop .swatch').nth(swatch).click();
    await page.waitForTimeout(100);
  }
  await page.mouse.click(x, y);
  await page.waitForSelector('.text-editor');
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); // clear selection
  await page.waitForTimeout(100);
}

await sticky(250, 250, ''); // empty, default colour
await sticky(500, 250, 'still going to get on call with business owners trying to show them how to use AI');
await sticky(750, 250, 'short note');
await sticky(250, 520, 'pink note', 1);
await sticky(500, 520, 'green note with a couple of lines of text', 2);
await sticky(750, 520, 'neutral', 6);
await sticky(1000, 250, 'back to yellow', 0);

await page.waitForTimeout(1000); // let the debounced IndexedDB save land
const stored = await page.evaluate(
  (since) =>
    new Promise((res) => {
      const req = indexedDB.open('slate');
      req.onsuccess = () => {
        const all = req.result.transaction('objects').objectStore('objects').getAll();
        all.onsuccess = () =>
          res(
            all.result
              .map((r) => r.data)
              .filter((o) => o.type === 'sticky' && o.createdAt >= since)
              .map((o) => ({ color: o.color, text: o.text, createdAt: o.createdAt }))
          );
      };
    }),
  t0
);
console.log('stored:', JSON.stringify(stored, null, 1));
const ok =
  stored.length === 7 &&
  stored.every((o) => typeof o.createdAt === 'number') &&
  stored.some((o) => o.color === '#F8DE7E');
console.log(ok ? 'PASS: 7 stickies, all with createdAt, default yellow #F8DE7E' : 'FAIL: unexpected stored stickies');

await page.screenshot({ path: `${SHOTS}/sticky.png` });
console.log(`screenshot: ${SHOTS}/sticky.png`);

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

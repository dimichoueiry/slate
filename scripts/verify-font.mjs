// Verify: new text, shape labels and stickies default to Excalifont, the font is
// loaded before measuring/painting, and PNG/SVG exports render it.
// Usage: node scripts/verify-font.mjs  (SLATE_URL overrides http://localhost:5180/,
// PW_CHROMIUM overrides the headless-shell binary)
import { chromium } from 'playwright';
import fs from 'node:fs';

const SHOTS = 'scripts/shots';
const URL = process.env.SLATE_URL ?? 'http://localhost:5180/';
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath:
    process.env.PW_CHROMIUM ??
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

await page.goto(new globalThis.URL('app', URL).href); // '/' is the landing page
await page.waitForSelector('button.new-board');
console.log('font loaded at boot:', await page.evaluate(() => document.fonts.check("16px 'Excalifont'")));
// fresh origins show the brand-voice onboarding first
const skip = page.locator('text=Skip for now');
if (await skip.count()) await skip.click();
await page.locator('button.new-board').first().click();
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(400);

// free text
await page.keyboard.press('t');
await page.mouse.click(200, 160);
await page.waitForSelector('.text-editor');
await page.keyboard.type('part of growing a business is marketing, and AI helps');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// shape, labeled via dblclick on its border (hollow shapes hit on the rim)
await page.keyboard.press('r');
await page.mouse.move(200, 300);
await page.mouse.down();
await page.mouse.move(700, 400, { steps: 4 });
await page.mouse.up();
await page.keyboard.press('v');
await page.dblclick('.overlay-canvas', { position: { x: 450, y: 302 } });
await page.waitForSelector('.text-editor');
await page.keyboard.type('You are touching on business problems');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// sticky
await page.keyboard.press('s');
await page.mouse.click(900, 300);
await page.waitForTimeout(150);
await page.waitForSelector('.text-editor'); // a new sticky opens its editor
await page.keyboard.type('Transformation coaching and AI coaching');
await page.keyboard.press('Escape');
await page.mouse.click(1200, 800);
await page.waitForTimeout(500);

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
              .filter((o) => ['text', 'shape', 'sticky'].includes(o.type))
              .map((o) => ({ type: o.type, fontFamily: o.fontFamily, text: o.text, w: Math.round(o.w) }))
          );
      };
    })
);
console.log('stored:', JSON.stringify(stored));

// stored auto-width text must match a measurement made with the real font
const measured = await page.evaluate((text) => {
  const c = document.createElement('canvas').getContext('2d');
  c.font = "400 20px 'Excalifont'";
  const real = c.measureText(text).width;
  c.font = '400 20px cursive';
  return { real: Math.round(real), fallback: Math.round(c.measureText(text).width) };
}, 'part of growing a business is marketing, and AI helps');
console.log('measure 20px excalifont vs fallback:', JSON.stringify(measured));

await page.screenshot({ path: `${SHOTS}/font.png` });

// PNG + SVG export (render_board uses exportPng)
const exp = await page.evaluate(async () => {
  const { exportPng, exportSvg, exportBounds } = await import('/src/export/export.ts');
  const ctl = window.__slateCtl;
  const box = exportBounds(ctl.doc);
  const png = await exportPng(ctl.doc, box, 2, false);
  const svg = await exportSvg(ctl.doc, box, false);
  const buf = new Uint8Array(await png.arrayBuffer());
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return { png: btoa(bin), svg };
});
fs.writeFileSync(`${SHOTS}/font-export.png`, Buffer.from(exp.png, 'base64'));
fs.writeFileSync(`${SHOTS}/font-export.svg`, exp.svg);
console.log('svg embeds Excalifont @font-face:', /@font-face\{font-family:'Excalifont'.*data:/.test(exp.svg));

// render the exported SVG as an <img> (no app fonts) to prove the embed works standalone
const imgPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await imgPage.setContent(
  `<body style="margin:0;background:#fff"><img id="i" src="data:image/svg+xml;base64,${Buffer.from(exp.svg).toString('base64')}"></body>`
);
await imgPage.waitForFunction(() => document.getElementById('i').complete);
await imgPage.waitForTimeout(300);
await imgPage.screenshot({ path: `${SHOTS}/font-export-svg.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();

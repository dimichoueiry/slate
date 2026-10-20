// Verify: Excalidraw-style sketchy rendering for shapes, lines and arrows (sketchy is the default).
import { chromium } from 'playwright';
import fs from 'node:fs';

const SHOTS = 'scripts/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const PORT = process.env.PORT ?? '5180';
const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

await page.goto(`http://localhost:${PORT}/app`);
await page.click('button.new-board');
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(400);

async function drag(key, a, b) {
  await page.keyboard.press(key);
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  await page.mouse.move(b[0], b[1], { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

// shapes — no style changes: sketchy must be the default for new objects
await drag('r', [180, 180], [420, 300]); // rect
await drag('o', [560, 150], [760, 330]); // ellipse
await drag('d', [900, 160], [1100, 320]); // diamond

// line (no arrowheads)
await drag('l', [180, 450], [480, 520]);

// straight arrow
await page.keyboard.press('c');
await page.click('.stylebar button:has-text("╱")');
await page.mouse.move(600, 600);
await page.mouse.down();
await page.mouse.move(850, 470, { steps: 6 });
await page.mouse.up();
await page.keyboard.press('Escape');

// curved arrow between the rect's bottom and the diamond (anchored, so it bends)
await page.keyboard.press('c');
await page.click('.stylebar button:has-text("∿")');
await page.mouse.move(300, 301);
await page.mouse.down();
await page.mouse.move(1000, 600, { steps: 8 });
await page.mouse.move(1000, 322, { steps: 8 });
await page.mouse.up();
await page.keyboard.press('Escape');

// free curved arrow off to the side
await page.keyboard.press('c');
await page.mouse.move(1150, 750);
await page.mouse.down();
await page.mouse.move(950, 820, { steps: 6 });
await page.mouse.up();
await page.keyboard.press('Escape');
await page.keyboard.press('v');
await page.mouse.click(1300, 120);
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/sketchy-1-all.png` });

// stability: the same scene must render identically frame to frame (stable seeds)
const a = await page.screenshot();
// pan away and back: forces fresh frames without hovering anything
await page.mouse.move(1300, 120);
await page.mouse.wheel(0, 200);
await page.waitForTimeout(200);
await page.mouse.wheel(0, -200);
await page.waitForTimeout(400);
const b = await page.screenshot();
console.log(Buffer.compare(a, b) === 0 ? 'STABLE' : 'JITTER: frames differ');

// every new shape/connector is sketchy
const flags = await page.evaluate(() => {
  const ctl = window.__slateCtl ?? null;
  return ctl ? ctl.doc.all().filter((o) => o.type === 'shape' || o.type === 'connector').map((o) => !!o.sketchy) : null;
});
if (flags) console.log(flags.every(Boolean) ? `ALL SKETCHY (${flags.length})` : `NOT ALL SKETCHY: ${flags}`);

// SVG export uses the same roughjs paths as the canvas
const svg = await page.evaluate(async () => {
  const ex = await import('/src/export/export.ts');
  const doc = window.__slateCtl.doc;
  return ex.exportSvg(doc, ex.exportBounds(doc), false);
});
fs.writeFileSync(`${SHOTS}/sketchy-export.svg`, svg);
const svgPage = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await svgPage.setContent(`<body style="margin:0;background:#fff">${svg.replace('<svg', '<svg style="max-width:100%;height:auto"')}</body>`);
await svgPage.screenshot({ path: `${SHOTS}/sketchy-2-export-svg.png`, fullPage: true });
console.log(`SVG EXPORT: ${(svg.match(/<path /g) ?? []).length} paths`);

console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
await browser.close();

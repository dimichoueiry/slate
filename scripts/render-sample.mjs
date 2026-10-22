// Render a fixed sample board (every shape kind, connector routing, dash, fill,
// sticky, text) through the three output paths — live canvas, PNG export (the
// same path MCP render_board uses) and SVG export — and write them to OUT.
// Run it on two builds and pass COMPARE=<other OUT dir> to prove the output is
// byte-identical (e.g. that the 'sketch' style didn't change).
// Usage: OUT=/tmp/a PORT=5181 node scripts/render-sample.mjs
//        OUT=/tmp/b COMPARE=/tmp/a PORT=5181 node scripts/render-sample.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.OUT ?? 'scripts/shots/sample';
fs.mkdirSync(OUT, { recursive: true });

const PW = `${process.env.HOME}/Library/Caches/ms-playwright`;
const shell = fs
  .readdirSync(PW)
  .filter((d) => d.startsWith('chromium_headless_shell-'))
  .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? `${PW}/${shell}/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
});
const BASE = process.env.SLATE_URL ?? `http://localhost:${process.env.PORT ?? '5180'}/`;
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

await page.goto(new URL('app', BASE).href);
await page.waitForSelector('.new-board');
const skip = page.locator('text=Skip for now');
if (await skip.count()) await skip.click();
await page.locator('button.new-board').first().click();
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(400);

const out = await page.evaluate(async () => {
  const ctl = window.__slateCtl;
  const ex = await import('/src/export/export.ts');
  let z = 1;
  const base = (id, extra) => ({ id, x: 0, y: 0, rotation: 0, z: z++, ...extra });
  const shape = (id, shape, x, y, extra = {}) =>
    base(id, { type: 'shape', shape, x, y, w: 170, h: 100, fill: 'transparent', stroke: '#1a1a1a', strokeWidth: 3, dash: 'solid', radius: 12, opacity: 1, text: id, textColor: '#1a1a1a', fontSize: 18, fontFamily: 'excalifont', ...extra });
  const conn = (id, from, to, routing, extra = {}) =>
    base(id, { type: 'connector', from, to, routing, stroke: '#1a1a1a', strokeWidth: 2, dash: 'solid', startArrow: 'none', endArrow: 'triangle', opacity: 1, ...extra });
  const objs = [
    shape('rect', 'rect', 0, 0),
    shape('rrect', 'roundedRect', 260, 0, { adaptiveRadius: true, fill: '#a5d8ff' }),
    shape('ell', 'ellipse', 520, 0, { fill: '#ffd43b', seed: 12345 }),
    shape('tri', 'triangle', 780, 0, { dash: 'dashed' }),
    shape('dia', 'diamond', 0, 200, { dash: 'dotted', stroke: '#e03131' }),
    shape('para', 'parallelogram', 260, 200, { strokeWidth: 1.5 }),
    shape('tiny', 'rect', 560, 230, { w: 14, h: 12, text: '' }),
    shape('clean', 'roundedRect', 780, 200, { sketchy: false, fill: '#b5ead7' }),
    shape('rot', 'rect', 1040, 100, { rotation: 0.3, sketchy: true, seed: 777 }),
    conn('c-straight', { objectId: 'rect' }, { objectId: 'rrect' }, 'straight', { label: 'calls' }),
    conn('c-curved', { objectId: 'rrect', anchor: 'bottom' }, { objectId: 'para', anchor: 'right' }, 'curved'),
    conn('c-elbow', { objectId: 'dia', anchor: 'right' }, { objectId: 'tiny', anchor: 'left' }, 'elbow', { startArrow: 'triangle' }),
    conn('c-free', { point: { x: 40, y: 420 } }, { point: { x: 520, y: 470 } }, 'curved', { dash: 'dashed', stroke: '#868e96' }),
    conn('c-short', { point: { x: 600, y: 420 } }, { point: { x: 630, y: 432 } }, 'straight'),
    conn('c-clean', { point: { x: 700, y: 420 } }, { point: { x: 980, y: 470 } }, 'straight', { sketchy: false, startArrow: 'chevron' }),
    base('note', { type: 'sticky', x: 0, y: 540, w: 200, h: 180, color: '#F8DE7E', text: 'a sticky note with some text', fontSize: 18, fontFamily: 'excalifont', createdAt: Date.UTC(2026, 9, 20, 12) }),
    base('note2', { type: 'sticky', x: 260, y: 540, w: 200, h: 180, color: '#A8D8EA', text: 'sans note', fontSize: 18, fontFamily: 'sans', seed: 99 }),
    base('txt', { type: 'text', x: 520, y: 560, text: 'Free text label', color: '#1a1a1a', fontSize: 24, fontFamily: 'excalifont', w: 300, h: 40, fixedWidth: false }),
    base('txt2', { type: 'text', x: 520, y: 620, text: 'Wrapped text box that goes onto more than one line for sure', color: '#1971c2', fontSize: 18, fontFamily: 'sans', w: 220, h: 80, fixedWidth: true }),
  ];
  // load = how a saved board comes back (objects without a seed are old objects)
  ctl.doc.load(objs);
  ctl.doc.dirty.clear();
  ctl.zoomToFit();
  ctl.markSceneDirty?.();
  const box = ex.exportBounds(ctl.doc);
  const png = await ex.exportPng(ctl.doc, box, 2, false);
  const pngB64 = await new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.readAsDataURL(png);
  });
  const svg = await ex.exportSvg(ctl.doc, box, false);
  return { pngB64, svg };
});
await page.waitForTimeout(500);
// hide UI chrome so the canvas shot holds only what the renderer drew
await page.evaluate(() => {
  for (const el of document.querySelectorAll('body *')) {
    if (el.tagName !== 'CANVAS' && !el.querySelector('canvas')) el.style.visibility = 'hidden';
  }
});
await page.waitForTimeout(100);
fs.writeFileSync(path.join(OUT, 'export.png'), Buffer.from(out.pngB64, 'base64'));
fs.writeFileSync(path.join(OUT, 'export.svg'), out.svg);
await page.locator('canvas').first().screenshot({ path: path.join(OUT, 'canvas.png') });
console.log(`wrote ${OUT}/{canvas.png,export.png,export.svg}`);

if (process.env.COMPARE) {
  let same = true;
  for (const f of ['canvas.png', 'export.png', 'export.svg']) {
    const a = fs.readFileSync(path.join(process.env.COMPARE, f));
    const b = fs.readFileSync(path.join(OUT, f));
    const eq = Buffer.compare(a, b) === 0;
    same &&= eq;
    console.log(`${f}: ${eq ? 'IDENTICAL' : 'DIFFERENT'} (${a.length} vs ${b.length} bytes)`);
  }
  console.log(same ? 'SKETCH OUTPUT UNCHANGED' : 'SKETCH OUTPUT CHANGED');
  if (!same) process.exitCode = 1;
}
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
await browser.close();

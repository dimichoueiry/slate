// Pan-performance check for the 'messy' style: a 300-object board, most of it
// hatched, panned frame by frame. Reports (1) the cold first draw (every drawable
// generated), (2) per-frame drawScene cost while panning with a warm cache, and
// (3) the real rAF frame interval while panning, at a mid and a zoomed-out view.
// Usage: PORT=5181 node scripts/perf-messy.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';

const PW = `${process.env.HOME}/Library/Caches/ms-playwright`;
const shell = fs
  .readdirSync(PW)
  .filter((d) => d.startsWith('chromium_headless_shell-'))
  .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? `${PW}/${shell}/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
});
const BASE = process.env.SLATE_URL ?? `http://localhost:${process.env.PORT ?? '5180'}/`;
const STYLE = process.env.STYLE ?? 'messy';
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(new URL('app', BASE).href);
await page.waitForSelector('.new-board');
const skip = page.locator('text=Skip for now');
if (await skip.count()) await skip.click();
await page.locator('button.new-board').first().click();
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(400);
await page.selectOption('.board-style-select', STYLE);

const result = await page.evaluate(async () => {
  const ctl = window.__slateCtl;
  const { drawScene } = await import('/src/engine/renderer.ts');
  const { clearDrawables } = await import('/src/engine/styles/index.ts');
  const COLORS = ['#1971c2', '#e8590c', '#2f9e44', '#868e96'];
  const FILLS = ['hachure', 'hachure', 'hachure', 'hachure', 'hachure', 'hachure', 'cross-hatch', 'zigzag', 'dots', 'solid'];
  const KINDS = ['rect', 'roundedRect', 'ellipse', 'diamond', 'triangle', 'parallelogram'];
  const objs = [];
  let z = 1;
  let seed = 1;
  // 240 shapes in a 20 x 12 grid; 220 filled (all but every 12th), mostly hachure
  for (let i = 0; i < 240; i++) {
    const c = i % 20;
    const r = Math.floor(i / 20);
    objs.push({
      id: `s${i}`, type: 'shape', shape: KINDS[i % KINDS.length], x: c * 220, y: r * 170, w: 170, h: 110, rotation: 0, z: z++, seed: seed++,
      fill: i % 12 === 11 ? 'transparent' : COLORS[i % 4], fillStyle: FILLS[i % FILLS.length], stroke: '#1a1a1a', strokeWidth: 2,
      dash: 'solid', radius: 12, adaptiveRadius: true, opacity: 1, text: i % 3 === 0 ? `item ${i}` : '', textColor: '#1a1a1a', fontSize: 22,
    });
  }
  // 40 connectors between horizontal neighbours, mixed routing
  for (let i = 0; i < 40; i++) {
    const a = i * 6;
    objs.push({
      id: `c${i}`, type: 'connector', from: { objectId: `s${a}` }, to: { objectId: `s${a + 1}` }, routing: ['straight', 'curved', 'elbow'][i % 3],
      rotation: 0, x: 0, y: 0, z: z++, seed: seed++, stroke: '#1a1a1a', strokeWidth: 2, dash: i % 5 === 0 ? 'dashed' : 'solid',
      startArrow: 'none', endArrow: 'triangle', opacity: 1,
    });
  }
  // 20 text labels
  for (let i = 0; i < 20; i++) {
    objs.push({ id: `t${i}`, type: 'text', x: i * 220, y: 12 * 170 + 20, text: i % 4 === 0 ? '$4.2M' : `label ${i}`, color: '#1a1a1a', fontSize: i % 4 === 0 ? 32 : 21, w: 120, h: 30, fixedWidth: false, rotation: 0, z: z++, seed: seed++ });
  }
  ctl.doc.setMany(objs);
  await document.fonts.ready;

  const filled = objs.filter((o) => o.type === 'shape' && o.fill !== 'transparent').length;
  const hatched = objs.filter((o) => o.type === 'shape' && o.fill !== 'transparent' && o.fillStyle !== 'solid').length;
  const draw = (cam) => {
    const t0 = performance.now();
    drawScene(ctl.sceneCtx, ctl.doc, cam, ctl.viewW, ctl.viewH, ctl.dpr, { mode: 'dots' }, null, null);
    return performance.now() - t0;
  };
  const stats = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { frames: s.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2), mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2) };
  };
  const out = { objects: objs.length, shapes: 240, filled, hatched, dpr: ctl.dpr, view: [ctl.viewW, ctl.viewH] };
  for (const zoom of [0.6, 0.3]) {
    const start = { x: -100, y: -100, zoom };
    clearDrawables();
    const cold = draw(start);
    // pan 240 frames to the right and back down, warm cache
    const span = 4400 - ctl.viewW / zoom;
    const cams = Array.from({ length: 240 }, (_, i) => ({ x: -100 + (Math.max(span, 400) * i) / 239, y: -100 + 200 * Math.sin(i / 30), zoom }));
    const warm = cams.map((c) => draw(c));
    // same, but force the raster to finish each frame (canvas 2D defers it, so the JS time above hides it)
    const flushed = cams.map((c) => {
      const t0 = performance.now();
      drawScene(ctl.sceneCtx, ctl.doc, c, ctl.viewW, ctl.viewH, ctl.dpr, { mode: 'dots' }, null, null);
      ctl.sceneCtx.getImageData(0, 0, 1, 1);
      return performance.now() - t0;
    });
    // real frames: pan through the app's own loop, time rAF to rAF
    const intervals = await new Promise((resolve) => {
      const ts = [];
      let i = 0;
      const step = (t) => {
        ts.push(t);
        if (i < cams.length) {
          ctl.setCamera(cams[i++]);
          requestAnimationFrame(step);
        } else resolve(ts.slice(2).map((x, k) => x - ts[k + 1]));
      };
      requestAnimationFrame(step);
    });
    out[`zoom ${zoom}`] = { coldFirstDrawMs: +cold.toFixed(2), drawSceneMs: stats(warm), drawPlusRasterMs: stats(flushed), rafIntervalMs: stats(intervals) };
  }
  return out;
});
console.log(JSON.stringify(result, null, 2));
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
await browser.close();

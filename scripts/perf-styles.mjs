// Frame times while panning a 300-object board (100 shapes, 100 connectors,
// 50 stickies, 50 text), all on screen, in each drawing style. The camera moves
// a few px every animation frame; we record the rAF-to-rAF intervals.
// Usage: PORT=5181 node scripts/perf-styles.mjs   (STYLES=sketch,handdrawn FRAMES=240)
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
const STYLES = (process.env.STYLES ?? 'sketch,handdrawn').split(',');
const FRAMES = Number(process.env.FRAMES ?? 240);
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

await page.evaluate(() => {
  const ctl = window.__slateCtl;
  const kinds = ['rect', 'roundedRect', 'ellipse', 'diamond', 'triangle', 'parallelogram'];
  const routings = ['straight', 'elbow', 'curved'];
  const objs = [];
  let z = 1;
  for (let i = 0; i < 100; i++) {
    objs.push({ id: `s${i}`, type: 'shape', shape: kinds[i % kinds.length], x: (i % 10) * 220, y: Math.floor(i / 10) * 160, w: 150, h: 90, rotation: 0, z: z++,
      fill: i % 3 ? 'transparent' : '#a5d8ff', stroke: '#1a1a1a', strokeWidth: 2, dash: i % 7 ? 'solid' : 'dashed', radius: 12, opacity: 1,
      text: `node ${i}`, textColor: '#1a1a1a', fontSize: 16, fontFamily: 'excalifont' });
  }
  for (let i = 0; i < 100; i++) {
    objs.push({ id: `c${i}`, type: 'connector', x: 0, y: 0, rotation: 0, z: z++, from: { objectId: `s${i}` }, to: { objectId: `s${(i * 7 + 1) % 100}` },
      routing: routings[i % 3], stroke: '#1971c2', strokeWidth: 2, dash: 'solid', startArrow: 'none', endArrow: 'triangle', opacity: 1, ...(i % 5 ? {} : { label: `edge ${i}` }) });
  }
  for (let i = 0; i < 50; i++) {
    objs.push({ id: `n${i}`, type: 'sticky', x: 2300 + (i % 5) * 230, y: Math.floor(i / 5) * 210, w: 200, h: 180, rotation: 0, z: z++,
      color: '#F8DE7E', text: `sticky ${i} with a few words to wrap`, fontSize: 18, fontFamily: 'excalifont' });
  }
  for (let i = 0; i < 50; i++) {
    objs.push({ id: `t${i}`, type: 'text', x: (i % 10) * 220, y: 1700 + Math.floor(i / 10) * 50, rotation: 0, z: z++,
      text: `label ${i}`, color: '#1a1a1a', fontSize: 20, fontFamily: 'excalifont', w: 120, h: 30, fixedWidth: false });
  }
  ctl.doc.setMany(objs);
  ctl.zoomToFit();
});

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, mean: xs.reduce((a, b) => a + b, 0) / xs.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1] };
};
const fmt = (o) => `p50 ${o.p50.toFixed(2)}  p95 ${o.p95.toFixed(2)}  p99 ${o.p99.toFixed(2)}  max ${o.max.toFixed(2)}  mean ${o.mean.toFixed(2)} ms (n=${o.n})`;

for (const style of STYLES) {
  await page.selectOption('.board-style-select', style);
  await page.waitForTimeout(500);
  const r = await page.evaluate(async (frames) => {
    const ctl = window.__slateCtl;
    const st = await import('/src/engine/styles/index.ts');
    // cold: cost of generating every drawable once for this style
    st.clearDrawables();
    const t0 = performance.now();
    ctl.markSceneDirty();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const cold = performance.now() - t0;
    const start = { ...ctl.camera };
    const deltas = [];
    let last = performance.now();
    for (let f = 0; f < frames; f++) {
      await new Promise((res) =>
        requestAnimationFrame(() => {
          const now = performance.now();
          deltas.push(now - last);
          last = now;
          const k = f / frames;
          ctl.camera = { ...start, x: start.x + Math.sin(k * Math.PI * 2) * 300 / start.zoom, y: start.y + k * 200 / start.zoom };
          ctl.markSceneDirty();
          res();
        })
      );
    }
    ctl.camera = start;
    return { cold, deltas: deltas.slice(2), objects: ctl.doc.all().length, cached: st.drawableCache.size };
  }, FRAMES);
  console.log(`${style.padEnd(10)} ${r.objects} objects, ${r.cached} cached drawables, first frame after cache clear ${r.cold.toFixed(1)} ms`);
  console.log(`${''.padEnd(10)} pan frame interval: ${fmt(stats(r.deltas))}`);
}
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
await browser.close();

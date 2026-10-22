// Verify the 'handdrawn' style end to end in the real app: switching a board to
// it restyles every shape, connector and label; a reload renders identically;
// and the live canvas, PNG export and SVG export draw the same picture.
// Usage: PORT=5181 node scripts/verify-handdrawn.mjs   (OUT=dir keeps the images)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.OUT ?? 'scripts/shots/handdrawn';
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/status of 403/.test(m.text()) && errors.push(`console: ${m.text()}`));
let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failed++;
};

await page.goto(new URL('app', BASE).href);
await page.waitForSelector('.new-board');
const skip = page.locator('text=Skip for now');
if (await skip.count()) await skip.click();
await page.locator('button.new-board').first().click();
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(400);
const boardUrl = page.url();

// a sample board: every shape kind, connector routing, dash, fill, sticky, text and label
await page.evaluate(async () => {
  (await import('/src/store/ui.ts')).useUI.getState().set({ gridMode: 'none' });
  const ctl = window.__slateCtl;
  let z = 1;
  const base = (id, extra) => ({ id, x: 0, y: 0, rotation: 0, z: z++, ...extra });
  const shape = (id, shape, x, y, extra = {}) =>
    base(id, { type: 'shape', shape, x, y, w: 170, h: 100, fill: 'transparent', stroke: '#1a1a1a', strokeWidth: 2, dash: 'solid', radius: 12, opacity: 1, text: id, textColor: '#1a1a1a', fontSize: 18, fontFamily: 'excalifont', ...extra });
  const conn = (id, from, to, routing, extra = {}) =>
    base(id, { type: 'connector', from, to, routing, stroke: '#1a1a1a', strokeWidth: 2, dash: 'solid', startArrow: 'none', endArrow: 'triangle', opacity: 1, ...extra });
  ctl.doc.setMany([
    shape('rect', 'rect', 0, 0),
    shape('rrect', 'roundedRect', 260, 0, { adaptiveRadius: true, fill: '#a5d8ff' }),
    shape('ell', 'ellipse', 520, 0, { fill: '#a5d8ff' }),
    shape('tri', 'triangle', 780, 0, { dash: 'dashed' }),
    shape('dia', 'diamond', 0, 200, { dash: 'dotted', stroke: '#e8590c' }),
    shape('para', 'parallelogram', 260, 200, { strokeWidth: 1 }),
    shape('mark', 'ellipse', 560, 230, { w: 30, h: 30, text: '', strokeWidth: 4 }),
    shape('bold', 'rect', 780, 200, { strokeWidth: 5, stroke: '#1971c2' }),
    conn('c-straight', { objectId: 'rect' }, { objectId: 'rrect' }, 'straight', { label: 'calls' }),
    conn('c-curved', { objectId: 'rrect', anchor: 'bottom' }, { objectId: 'para', anchor: 'right' }, 'curved'),
    conn('c-elbow', { objectId: 'dia', anchor: 'right' }, { objectId: 'mark', anchor: 'left' }, 'elbow', { startArrow: 'triangle' }),
    conn('c-free', { point: { x: 40, y: 420 } }, { point: { x: 520, y: 470 } }, 'curved', { dash: 'dashed', stroke: '#868e96' }),
    conn('c-ref', { point: { x: 600, y: 420 } }, { point: { x: 960, y: 420 } }, 'straight', { dash: 'dashed', stroke: '#2f9e44', endArrow: 'chevron' }),
    base('note', { type: 'sticky', x: 0, y: 540, w: 200, h: 180, color: '#F8DE7E', text: 'a sticky note with enough words to wrap a few lines', fontSize: 18, fontFamily: 'excalifont', createdAt: Date.UTC(2026, 9, 20, 12) }),
    base('note2', { type: 'sticky', x: 260, y: 540, w: 200, h: 180, color: '#A8D8EA', text: 'legacy note, no font set', fontSize: 18 }),
    base('txt', { type: 'text', x: 520, y: 560, text: 'Free text label', color: '#1a1a1a', fontSize: 20, fontFamily: 'excalifont', w: 300, h: 40, fixedWidth: false }),
    base('txt2', { type: 'text', x: 520, y: 620, text: 'Wrapped text box that goes onto more than one line for sure', color: '#1971c2', fontSize: 18, fontFamily: 'excalifont', w: 220, h: 80, fixedWidth: true }),
    base('num', { type: 'text', x: 800, y: 560, text: '42%', color: '#e8590c', fontSize: 26, fontFamily: 'excalifont', w: 80, h: 40, fixedWidth: false }),
  ]);
  ctl.markSceneDirty();
});

/** Everything the renderer draws per object in the board's current style. */
const snapshot = () =>
  page.evaluate(async () => {
    const st = await import('/src/engine/styles/index.ts');
    const { routeConnector } = await import('/src/engine/geometry.ts');
    const doc = window.__slateCtl.doc;
    const out = {};
    for (const o of doc.all()) {
      const paths =
        o.type === 'shape' ? st.shapeDrawable(o, doc.style) : o.type === 'connector' ? st.connectorDrawable(o, routeConnector(o, doc.resolve), doc.style) : [];
      const text = o.type === 'connector' ? o.label : o.text;
      out[o.id] = {
        type: o.type,
        paths: paths.map((p) => ({ d: p.d, fill: p.fill, stroke: p.stroke, w: p.strokeWidth, border: p.isBorder, dash: p.dash })),
        font: text ? st.drawFontId(o, doc.style) : null,
        paper: o.type === 'sticky' ? st.styleRendererFor(o, doc.style).stickyPaper(o) : null,
      };
    }
    return out;
  });

/** Camera at a fixed spot, UI chrome hidden, then a viewport screenshot of what the renderer drew. */
async function canvasShot(file) {
  const box = await page.evaluate(async () => {
    const ctl = window.__slateCtl;
    const ex = await import('/src/export/export.ts');
    const b = ex.exportBounds(ctl.doc);
    const zoom = Math.min(1, 1360 / b.w, 860 / b.h);
    ctl.camera = { x: b.x - 10 / zoom, y: b.y - 10 / zoom, zoom };
    ctl.markSceneDirty();
    // keep only the full-size scene canvases (small widget canvases, e.g. the minimap, are UI)
    const scene = (el) => el.tagName === 'CANVAS' && el.getBoundingClientRect().width >= innerWidth / 2;
    for (const el of document.querySelectorAll('body *')) {
      if (!scene(el) && ![...el.querySelectorAll('canvas')].some(scene)) el.style.visibility = 'hidden';
    }
    await document.fonts.ready;
    return { ...b, zoom };
  });
  await page.waitForTimeout(300);
  const clip = { x: 10, y: 10, width: Math.floor(box.w * box.zoom), height: Math.floor(box.h * box.zoom) };
  await page.screenshot({ path: path.join(OUT, file), clip });
  return { box, buf: fs.readFileSync(path.join(OUT, file)) };
}

const sketch = await snapshot();
const sketchShot = await canvasShot('1-sketch.png');

// ---- switch the board to hand-drawn through the top-bar picker ----
await page.evaluate(() => {
  for (const el of document.querySelectorAll('body *')) el.style.visibility = '';
});
await page.selectOption('.board-style-select', 'handdrawn');
await page.waitForTimeout(900); // autosave debounce
const hd = await snapshot();
const hdShot = await canvasShot('2-handdrawn.png');

const ids = Object.keys(sketch);
const drawn = ids.filter((id) => hd[id].paths.length);
check(drawn.length === ids.filter((id) => ['shape', 'connector'].includes(hd[id].type)).length, `every shape and connector has hand-drawn paths (${drawn.length})`);
const unchanged = drawn.filter((id) => JSON.stringify(hd[id].paths) === JSON.stringify(sketch[id].paths));
check(unchanged.length === 0, `every shape/connector restyled (unchanged: ${unchanged.join(', ') || 'none'})`);
const strokes = drawn.flatMap((id) => hd[id].paths.filter((p) => p.stroke !== 'none'));
check(strokes.every((p) => [1.5, 2, 2.7].includes(p.w)), `pen widths only 1.5 / 2 / 2.7 (${[...new Set(strokes.map((p) => p.w))].join(', ')})`);
const borders = drawn.flatMap((id) => (hd[id].type === 'shape' && !id.includes('ell') && id !== 'mark' ? hd[id].paths.filter((p) => p.border) : []));
check(borders.every((p) => /^M[\d. -]+ Q/.test(p.d) && !/[CL]/.test(p.d)), 'straight-edged outlines are quadratic segments only');
check(hd.rect.paths.length === 1 && hd.rect.paths[0].d.split('M').length - 1 === 4, 'rect: one stroke path of 4 edges (single pass)');
const ellD = hd.ell.paths.find((p) => p.border).d;
check((ellD.match(/C/g) || []).length === 5, 'ellipse: 4 cubics + closing overshoot');
check(hd.mark.paths.length === 1 && hd.mark.paths[0].w === 2 && hd.mark.paths[0].fill === 'none', 'marker circle: stroke 2, no fill');
const heads = drawn.flatMap((id) => (hd[id].type === 'connector' ? hd[id].paths.filter((p) => !p.border) : []));
check(heads.length === 6 && heads.every((p) => p.fill === 'none' && /^M[\d. -]+ L[\d. -]+ L[\d. -]+$/.test(p.d)), `arrowheads are open chevrons (${heads.length})`);
check(drawn.every((id) => hd[id].paths.every((p) => p.fill === 'none' || !/^#(fff|ffffff|000|000000)$/i.test(p.fill))), 'no pure white/black fills');
check(JSON.stringify(hd.tri.paths.find((p) => p.border).dash) === '[6,5]' && JSON.stringify(hd['c-ref'].paths.find((p) => p.border).dash) === '[8,6]' && JSON.stringify(hd.dia.paths.find((p) => p.border).dash) === '[5,6]', 'dashes: outline 6 5, line 8 6, dotted 5 6');
const labels = ids.filter((id) => sketch[id].font !== null || hd[id].font !== null);
const notPen = labels.filter((id) => hd[id].font !== 'pen');
check(labels.length >= 13 && notPen.length === 0, `every label (${labels.length}) renders in the pen font (not: ${notPen.join(', ') || 'none'})`);
check(hd.note.paper !== sketch.note.paper, 'sticky paper restyled');
check(Buffer.compare(sketchShot.buf, hdShot.buf) !== 0, 'canvas pixels changed');
const hdSwatches = await page.evaluate(async () => (await import('/src/engine/styles/index.ts')).getStyleRenderer('handdrawn').palette.join(' '));
check(hdSwatches === '#1a1a1a #1971c2 #e8590c #2f9e44 #868e96 #a5d8ff', `style palette: ${hdSwatches}`);

// ---- reload: identical render ----
await page.goto(boardUrl);
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(800);
await page.evaluate(async () => (await import('/src/store/ui.ts')).useUI.getState().set({ gridMode: 'none' }));
check((await page.evaluate(() => window.__slateCtl.doc.style)) === 'handdrawn', 'board style restored on reload');
const reloaded = await snapshot();
const reloadDiff = ids.filter((id) => JSON.stringify(reloaded[id]) !== JSON.stringify(hd[id]));
for (const id of reloadDiff.slice(0, 3)) console.log(`     ${id}:\n       before ${JSON.stringify(hd[id]).slice(0, 400)}\n       after  ${JSON.stringify(reloaded[id]).slice(0, 400)}`);
check(reloadDiff.length === 0 && Object.keys(reloaded).length === ids.length, `reload: identical path data, fonts and sticky paper (differ: ${reloadDiff.join(', ') || 'none'})`);
const reloadShot = await canvasShot('3-reloaded.png');
check(Buffer.compare(reloadShot.buf, hdShot.buf) === 0, `reload: canvas pixels byte-identical (${hdShot.buf.length} bytes)`);

// ---- canvas vs PNG export vs SVG export ----
const cmp = await page.evaluate(
  async ({ canvasB64, zoom }) => {
    const ctl = window.__slateCtl;
    const ex = await import('/src/export/export.ts');
    const box = ex.exportBounds(ctl.doc);
    const png = await ex.exportPng(ctl.doc, box, zoom, false);
    const svg = await ex.exportSvg(ctl.doc, box, false);
    const load = (src) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
      });
    const W = Math.floor(box.w * zoom);
    const H = Math.floor(box.h * zoom);
    const pixels = (img) => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = '#f3f2ef';
      g.fillRect(0, 0, W, H);
      g.drawImage(img, 0, 0, W, H);
      return g.getImageData(0, 0, W, H).data;
    };
    const canvasImg = await load(`data:image/png;base64,${canvasB64}`);
    const pngImg = await load(URL.createObjectURL(png));
    const svgImg = await load(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })));
    const sets = { canvas: pixels(canvasImg), png: pixels(pngImg), svg: pixels(svgImg) };
    // "ink" = clearly darker or more saturated than the paper
    const inkMask = (d) => {
      const m = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) {
        const [r, g, b] = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
        m[i] = Math.max(Math.abs(r - 0xf3), Math.abs(g - 0xf2), Math.abs(b - 0xef)) > 60 ? 1 : 0;
      }
      return m;
    };
    const masks = Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, inkMask(v)]));
    /** share of A's ink pixels with B ink within 1px */
    const covered = (a, b) => {
      let n = 0;
      let hit = 0;
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          if (!a[y * W + x]) continue;
          n++;
          let found = 0;
          for (let dy = -1; dy <= 1 && !found; dy++) for (let dx = -1; dx <= 1 && !found; dx++) found = b[(y + dy) * W + x + dx];
          hit += found;
        }
      return n ? hit / n : 1;
    };
    const pair = (a, b) => Math.min(covered(masks[a], masks[b]), covered(masks[b], masks[a]));
    const ink = Object.fromEntries(Object.entries(masks).map(([k, m]) => [k, m.reduce((s, v) => s + v, 0)]));
    return {
      W, H, ink,
      canvasPng: pair('canvas', 'png'),
      canvasSvg: pair('canvas', 'svg'),
      pngSvg: pair('png', 'svg'),
      svgEmbedsKalam: /font-family:'Kalam'/.test(svg),
      svgUsesPen: svg.includes("'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Kalam', cursive"),
      svgDash: svg.includes('stroke-dasharray="6 5"') && svg.includes('stroke-dasharray="8 6"') && svg.includes('stroke-dasharray="5 6"'),
      svg,
      pngB64: await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.readAsDataURL(png);
      }),
    };
  },
  { canvasB64: reloadShot.buf.toString('base64'), zoom: reloadShot.box.zoom }
);
fs.writeFileSync(path.join(OUT, '4-export.png'), Buffer.from(cmp.pngB64, 'base64'));
fs.writeFileSync(path.join(OUT, '5-export.svg'), cmp.svg);
const pct = (v) => `${(v * 100).toFixed(2)}%`;
console.log(`     ink pixels ${cmp.W}x${cmp.H}: canvas ${cmp.ink.canvas}, png ${cmp.ink.png}, svg ${cmp.ink.svg}`);
check(cmp.canvasPng >= 0.98, `canvas vs PNG export: ${pct(cmp.canvasPng)} of ink matches within 1px`);
check(cmp.canvasSvg >= 0.95, `canvas vs SVG export: ${pct(cmp.canvasSvg)} of ink matches within 1px`);
check(cmp.pngSvg >= 0.95, `PNG vs SVG export: ${pct(cmp.pngSvg)} of ink matches within 1px`);
check(cmp.svgEmbedsKalam && cmp.svgUsesPen, 'SVG uses the pen stack and embeds Kalam');
check(cmp.svgDash, 'SVG carries the pen dash patterns');

console.log(`images in ${OUT}`);
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
await browser.close();
process.exitCode = failed || errors.length ? 1 : 0;

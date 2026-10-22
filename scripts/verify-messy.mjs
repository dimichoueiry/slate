// Verify the 'messy' drawing style end to end in the real app: switching a board
// to messy restyles every shape, connector and label (roughjs paths + Caveat), the
// fill-pattern picker shows only where it applies and persists per object, a
// reload renders pixel-identically, and the canvas, PNG export and SVG export match.
// Usage: PORT=5181 node scripts/verify-messy.mjs
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
const OUT = process.env.OUT ?? 'scripts/shots/messy';
fs.mkdirSync(OUT, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
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

// ---- a fixed board: every shape kind, fills, connectors, labels, text ----
await page.evaluate(() => {
  const ctl = window.__slateCtl;
  let z = 1;
  let seed = 1000;
  const base = (id, extra) => ({ id, x: 0, y: 0, rotation: 0, z: z++, seed: seed++, ...extra });
  const shape = (id, shape, x, y, extra = {}) =>
    base(id, { type: 'shape', shape, x, y, w: 170, h: 100, fill: 'transparent', stroke: '#1a1a1a', strokeWidth: 2, dash: 'solid', radius: 12, opacity: 1, text: '', textColor: '#1a1a1a', fontSize: 22, fontFamily: 'excalifont', ...extra });
  const conn = (id, from, to, routing, extra = {}) =>
    base(id, { type: 'connector', from, to, routing, stroke: '#1a1a1a', strokeWidth: 2, dash: 'solid', startArrow: 'none', endArrow: 'triangle', opacity: 1, ...extra });
  // setMany = how created objects land (marked dirty, so autosave persists them for the reload check)
  ctl.doc.setMany([
    shape('rect', 'rect', 40, 40, { fill: '#1971c2', text: 'hatched' }),
    shape('rrect', 'roundedRect', 300, 40, { adaptiveRadius: true, fill: '#2f9e44', text: 'rounded' }),
    shape('ell', 'ellipse', 560, 40, { text: '42', fontSize: 32 }),
    shape('tri', 'triangle', 820, 40, { fill: '#e8590c' }),
    shape('dia', 'diamond', 40, 220, { dash: 'dashed', stroke: '#1971c2' }),
    shape('para', 'parallelogram', 300, 220, { strokeWidth: 3, fill: '#868e96', fillStyle: 'dots' }),
    shape('dot', 'ellipse', 600, 260, { w: 16, h: 16, fill: '#e8590c' }),
    shape('plain', 'rect', 820, 220, { text: 'no fill' }),
    conn('c-straight', { objectId: 'rect' }, { objectId: 'rrect' }, 'straight', { label: 'calls' }),
    conn('c-curved', { objectId: 'rrect', anchor: 'bottom' }, { objectId: 'para', anchor: 'right' }, 'curved', { startArrow: 'triangle' }),
    conn('c-elbow', { objectId: 'dia', anchor: 'right' }, { objectId: 'dot', anchor: 'left' }, 'elbow'),
    conn('c-axis', { point: { x: 40, y: 420 } }, { point: { x: 1000, y: 420 } }, 'straight', { strokeWidth: 3 }),
    conn('c-dashed', { point: { x: 40, y: 470 } }, { point: { x: 520, y: 520 } }, 'curved', { dash: 'dashed', stroke: '#868e96' }),
    base('note', { type: 'sticky', x: 40, y: 560, w: 220, h: 160, color: '#F8DE7E', text: 'a sticky note that wraps onto a few lines', fontSize: 22, fontFamily: 'sans' }),
    base('txt', { type: 'text', x: 320, y: 580, text: 'body text label', color: '#1a1a1a', fontSize: 22, fontFamily: 'inter', w: 300, h: 30, fixedWidth: false }),
    base('num', { type: 'text', x: 320, y: 630, text: '$4.2M', color: '#1971c2', fontSize: 32, fontFamily: 'inter', w: 200, h: 44, fixedWidth: false }),
    base('small', { type: 'text', x: 600, y: 600, text: 'small label that wraps in a box', color: '#868e96', fontSize: 19, fontFamily: 'sans', w: 160, h: 60, fixedWidth: true }),
  ]);
});

/** every styled drawable + text face on the board, under the given board style */
const snapshot = (style) =>
  page.evaluate(async (style) => {
    const ctl = window.__slateCtl;
    const st = await import('/src/engine/styles/index.ts');
    const geo = await import('/src/engine/geometry.ts');
    const out = { draw: {}, faces: {} };
    for (const o of ctl.doc.all()) {
      if (o.type === 'shape') out.draw[o.id] = st.shapeDrawable(o, style);
      if (o.type === 'connector') out.draw[o.id] = st.connectorDrawable(o, geo.routeConnector(o, ctl.doc.resolve), style);
      if (o.type === 'connector' && o.label) out.faces[o.id] = st.drawFontId(o, style);
      else if ('text' in o && o.text) out.faces[o.id] = { fontId: st.drawFontId(o, style), weight: st.drawFontWeight(o, style, 400) };
    }
    return out;
  }, style);

const sketch = await snapshot('sketch');

// ---- switch the board to messy with the picker ----
await page.selectOption('.board-style-select', 'messy');
await page.waitForTimeout(900); // autosave debounce
const boardId = decodeURIComponent(new URL(page.url()).pathname.split('/').pop());
const meta = await page.evaluate(async (id) => (await import('/src/store/db.ts')).db.boards.get(id), boardId);
check(meta.style === 'messy', 'board picker saved style "messy"');
const messy = await snapshot('messy');
const ids = Object.keys(sketch.draw);
const restyled = ids.filter((id) => JSON.stringify(sketch.draw[id]) !== JSON.stringify(messy.draw[id]));
check(restyled.length === ids.length, `every shape + connector restyles (${restyled.length}/${ids.length})`);
const connIds = ids.filter((id) => id.startsWith('c-'));
check(connIds.every((id) => messy.draw[id].every((p) => p.fill === 'none')), 'no connector draws a filled arrowhead (open chevrons only)');
check(messy.draw['c-dashed'].some((p) => JSON.stringify(p.dash) === '[10,8]'), 'dashed connector carries strokeLineDash [10, 8]');
const hatched = messy.draw.rect.filter((p) => !p.isBorder);
check(hatched.length > 0 && hatched.every((p) => p.stroke === 'rgba(25,113,194,0.45)' && p.fill === 'none'), 'filled rect hatches in rgba(25,113,194,0.45), stroke-only');
const faceIds = Object.keys(messy.faces);
const caveat = faceIds.filter((id) => (messy.faces[id].fontId ?? messy.faces[id]) === 'caveat');
check(caveat.length === faceIds.length && faceIds.length === 9, `every label/text draws in Caveat (${caveat.length}/${faceIds.length})`);
check(messy.faces.num.weight === 700 && messy.faces.ell.weight === 700 && messy.faces.txt.weight === 400, 'key numbers (32px) bold, body regular');

// the canvas really paints those fonts: record ctx.font on every fillText of one frame
const painted = await page.evaluate(async () => {
  const ctl = window.__slateCtl;
  await document.fonts.ready;
  const fonts = new Set();
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (...a) {
    fonts.add(this.font);
    return orig.apply(this, a);
  };
  ctl.markSceneDirty();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  CanvasRenderingContext2D.prototype.fillText = orig;
  return {
    fonts: [...fonts],
    loaded400: document.fonts.check("400 22px 'Caveat'", 'abc'),
    loaded700: document.fonts.check("700 32px 'Caveat'", '$4.2M'),
  };
});
check(painted.fonts.length > 0 && painted.fonts.every((f) => f.includes('Caveat')), `canvas fillText fonts: ${painted.fonts.join(' | ')}`);
check(painted.loaded400 && painted.loaded700, 'Caveat 400 and 700 faces are loaded (bundled, not system)');

// ---- fill picker: only where it applies, stored per object ----
const clickObj = async (id) => {
  const p = await page.evaluate((id) => {
    const ctl = window.__slateCtl;
    const o = ctl.doc.get(id);
    return ctl.worldToScreenPt({ x: o.x + 6, y: o.y + o.h / 2 });
  }, id);
  await page.keyboard.press('v');
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
};
await page.evaluate(() => window.__slateCtl.zoomToFit());
await page.waitForTimeout(200);
await clickObj('rect');
const segBtns = await page.$$eval('.fill-style-seg button', (bs) => bs.map((b) => [b.dataset.fillStyle, b.classList.contains('active')]));
check(JSON.stringify(segBtns.map((b) => b[0])) === JSON.stringify(['hachure', 'solid', 'zigzag', 'dots', 'cross-hatch']), `fill picker on a filled messy shape: ${segBtns.map((b) => b[0]).join(', ')}`);
check(segBtns.find((b) => b[1])?.[0] === 'hachure', 'hachure is the active default');
await page.click('.fill-style-seg button[data-fill-style="zigzag"]');
await page.waitForTimeout(100);
const zig = await page.evaluate(() => window.__slateCtl.doc.get('rect').fillStyle);
check(zig === 'zigzag', 'picking zigzag stores fillStyle on the object');
await page.keyboard.press('Escape');
await clickObj('plain');
check((await page.locator('.fill-style-seg').count()) === 0, 'no fill picker on an unfilled shape');
await page.keyboard.press('Escape');
await page.selectOption('.board-style-select', 'sketch');
await page.waitForTimeout(100);
await clickObj('rect');
check((await page.locator('.fill-style-seg').count()) === 0, 'no fill picker under sketch (it has no fill patterns)');
await page.keyboard.press('Escape');
await page.selectOption('.board-style-select', 'messy');
await page.keyboard.press('Escape');
await page.waitForTimeout(900);

// ---- reload → identical render ----
const box = await page.evaluate(async () => (await import('/src/export/export.ts')).exportBounds(window.__slateCtl.doc));
const frame = async () => {
  await page.evaluate(async (box) => {
    const ctl = window.__slateCtl;
    const { useUI } = await import('/src/store/ui.ts');
    useUI.getState().set({ gridMode: 'none' });
    ctl.selectIds([]);
    ctl.setCamera({ x: box.x, y: box.y, zoom: 1 });
    await document.fonts.ready;
    ctl.markSceneDirty();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, box);
  // hide UI chrome so the shot holds only what the renderer drew
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('body *')) {
      if (el.tagName !== 'CANVAS' && !el.querySelector('canvas')) el.style.visibility = 'hidden';
    }
  });
  const c = await page.locator('canvas').first().boundingBox();
  return page.screenshot({ clip: { x: c.x, y: c.y, width: Math.ceil(box.w), height: Math.ceil(box.h) } });
};
const before = await frame();
const snapBefore = await snapshot('messy');
const drawBefore = JSON.stringify(snapBefore);
await page.reload();
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(800);
check((await page.evaluate(() => window.__slateCtl.doc.style)) === 'messy', 'board style restored on reload');
check((await page.evaluate(() => window.__slateCtl.doc.get('rect').fillStyle)) === 'zigzag', 'fillStyle restored on reload');
const after = await frame();
fs.writeFileSync(`${OUT}/canvas-before.png`, before);
fs.writeFileSync(`${OUT}/canvas-after.png`, after);
const snapAfter = await snapshot('messy');
const changed = Object.keys(snapBefore.draw).filter((id) => JSON.stringify(snapBefore.draw[id]) !== JSON.stringify(snapAfter.draw[id]));
const facesChanged = Object.keys({ ...snapBefore.faces, ...snapAfter.faces }).filter((id) => JSON.stringify(snapBefore.faces[id]) !== JSON.stringify(snapAfter.faces[id]));
check(!changed.length, `drawables identical after reload${changed.length ? ` (changed: ${changed.join(', ')})` : ''}`);
check(!facesChanged.length, `text faces identical after reload${facesChanged.length ? ` (changed: ${facesChanged.map((id) => `${id} ${JSON.stringify(snapBefore.faces[id])}→${JSON.stringify(snapAfter.faces[id])}`).join(', ')})` : ''}`);
check(Buffer.compare(before, after) === 0, `canvas pixels identical after reload (${before.length} vs ${after.length} bytes)`);

// ---- canvas vs PNG export vs SVG export ----
const cmp = await page.evaluate(
  async ({ box, canvasB64 }) => {
    const ctl = window.__slateCtl;
    const ex = await import('/src/export/export.ts');
    const st = await import('/src/engine/styles/index.ts');
    const geo = await import('/src/engine/geometry.ts');
    const png = await ex.exportPng(ctl.doc, box, 1, false);
    const svg = await ex.exportSvg(ctl.doc, box, false);
    const W = Math.ceil(box.w);
    const H = Math.ceil(box.h);
    const pixels = async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = '#f3f2ef';
      g.fillRect(0, 0, W, H);
      g.drawImage(img, 0, 0, W, H);
      return g.getImageData(0, 0, W, H).data;
    };
    const diff = (a, b) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 64) n++;
      }
      return n / (a.length / 4);
    };
    const pngUrl = URL.createObjectURL(png);
    const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const [canvasPx, pngPx, svgPx] = await Promise.all([pixels(`data:image/png;base64,${canvasB64}`), pixels(pngUrl), pixels(svgUrl)]);
    // every styled path is in the SVG verbatim
    const allD = [];
    for (const o of ctl.doc.all()) {
      if (o.type === 'shape') allD.push(...st.shapeDrawable(o, ctl.doc.style).map((p) => p.d));
      if (o.type === 'connector') allD.push(...st.connectorDrawable(o, geo.routeConnector(o, ctl.doc.resolve), ctl.doc.style).map((p) => p.d));
    }
    const texts = [...svg.matchAll(/<text [^>]*>/g)].map((m) => m[0]);
    const pngB64 = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.readAsDataURL(png);
    });
    return {
      canvasVsPng: diff(canvasPx, pngPx),
      pngVsSvg: diff(pngPx, svgPx),
      canvasVsSvg: diff(canvasPx, svgPx),
      pathsInSvg: allD.filter((d) => svg.includes(`d="${d}"`)).length,
      paths: allD.length,
      textEls: texts.length,
      caveatTextEls: texts.filter((t) => t.includes('Caveat')).length,
      boldTextEls: texts.filter((t) => t.includes('font-weight="700"')).length,
      face400: /font-family:'Caveat';font-weight:400;src:url\(data:/.test(svg),
      face700: /font-family:'Caveat';font-weight:700;src:url\(data:/.test(svg),
      dashed: svg.includes('stroke-dasharray="10 8"'),
      svg,
      pngB64,
    };
  },
  { box, canvasB64: after.toString('base64') }
);
fs.writeFileSync(`${OUT}/export.svg`, cmp.svg);
fs.writeFileSync(`${OUT}/export.png`, Buffer.from(cmp.pngB64, 'base64'));
const pct = (x) => `${(x * 100).toFixed(3)}%`;
check(cmp.pathsInSvg === cmp.paths && cmp.paths > 0, `SVG holds every messy path verbatim (${cmp.pathsInSvg}/${cmp.paths})`);
check(cmp.caveatTextEls === cmp.textEls && cmp.textEls > 0, `every SVG <text> uses Caveat (${cmp.caveatTextEls}/${cmp.textEls}); bold: ${cmp.boldTextEls}`);
check(cmp.face400 && cmp.face700, 'SVG embeds Caveat 400 + 700 @font-face as data URLs');
check(cmp.dashed, 'SVG dashed line uses stroke-dasharray="10 8"');
check(cmp.canvasVsPng < 0.002, `canvas vs PNG export: ${pct(cmp.canvasVsPng)} of pixels differ (>64/255)`);
check(cmp.pngVsSvg < 0.02, `PNG vs SVG export: ${pct(cmp.pngVsSvg)} of pixels differ`);
check(cmp.canvasVsSvg < 0.02, `canvas vs SVG export: ${pct(cmp.canvasVsSvg)} of pixels differ`);
console.log(`wrote ${OUT}/{canvas-before.png,canvas-after.png,export.png,export.svg}`);

console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
await browser.close();
process.exitCode = failed || errors.length ? 1 : 0;

// Verify: Excalidraw-style sketchy rendering for shapes, lines and arrows (sketchy is the default).
import { chromium } from 'playwright';
import fs from 'node:fs';

const SHOTS = process.env.SHOTS ?? 'scripts/shots';
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

// every new shape/connector is sketchy (no flag counts: absent means sketchy)
const flags = await page.evaluate(() => {
  const ctl = window.__slateCtl ?? null;
  return ctl ? ctl.doc.all().filter((o) => o.type === 'shape' || o.type === 'connector').map((o) => o.sketchy !== false) : null;
});
if (flags) console.log(flags.every(Boolean) ? `ALL SKETCHY (${flags.length})` : `NOT ALL SKETCHY: ${flags}`);

// shapes and connectors saved before the flag existed, or built by AI edit / AI panel /
// AI nodes / templates, carry no sketchy or seed: they must still render rough, and
// stably (seed from id). An explicit sketchy:false stays clean.
const legacy = await page.evaluate(async () => {
  const ctl = window.__slateCtl;
  const r = await import('/src/engine/renderer.ts');
  const box = (id, x, y, shape = 'rect', extra = {}) => ({ id, type: 'shape', shape, x, y, w: 160, h: 90, rotation: 0, z: ctl.doc.nextZ(), fill: 'transparent', stroke: '#1a1a1a', strokeWidth: 3, dash: 'solid', radius: 12, opacity: 1, text: id, textColor: '#1a1a1a', fontSize: 18, ...extra });
  const conn = (id, from, to, routing, extra = {}) => ({ id, type: 'connector', x: 0, y: 0, rotation: 0, z: ctl.doc.nextZ(), from, to, routing, stroke: '#1a1a1a', strokeWidth: 2, dash: 'solid', startArrow: 'none', endArrow: 'triangle', opacity: 1, ...extra });
  const objs = [
    box('A', 180, 160), box('B', 620, 160, 'roundedRect'), box('C', 180, 470, 'ellipse'), box('D', 620, 560, 'diamond', { fill: '#a5d8ff' }),
    box('E', 1000, 300, 'triangle'), box('Clean', 1000, 680, 'rect', { sketchy: false }),
    conn('legacyStraight', { point: { x: 1000, y: 150 } }, { point: { x: 1250, y: 260 } }, 'straight'),
    conn('legacyBound', { objectId: 'A' }, { objectId: 'B' }, 'straight'),
    conn('legacyCurved', { objectId: 'A', anchor: 'bottom' }, { objectId: 'D', anchor: 'left' }, 'curved'),
    conn('legacyElbow', { objectId: 'C', anchor: 'right' }, { objectId: 'D', anchor: 'top' }, 'elbow'),
    conn('aiDashed', { point: { x: 1000, y: 420 } }, { point: { x: 1250, y: 600 } }, 'curved', { stroke: '#868e96', dash: 'dashed' }),
  ];
  ctl.doc.begin();
  for (const o of ctl.doc.all()) ctl.doc.delete(o.id);
  for (const o of objs) ctl.doc.set(o);
  ctl.doc.commit();
  ctl.zoomToFit();
  ctl.markSceneDirty?.();
  return objs.map((o) => ({ id: o.id, type: o.type, rough: r.isSketchy(o), want: o.sketchy !== false }));
});
const bad = legacy.filter((o) => o.rough !== o.want);
const n = (t) => legacy.filter((o) => o.type === t && o.want).length;
console.log(bad.length ? `LEGACY WRONG: ${JSON.stringify(bad)}` : `LEGACY ROUGH: ${n('shape')} shapes, ${n('connector')} connectors; explicit sketchy:false stays clean`);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/sketchy-3-arrows.png` });
const c1 = await page.screenshot();
await page.mouse.wheel(0, 200);
await page.waitForTimeout(200);
await page.mouse.wheel(0, -200);
await page.waitForTimeout(400);
const c2 = await page.screenshot();
console.log(Buffer.compare(c1, c2) === 0 ? 'LEGACY STABLE' : 'LEGACY JITTER: frames differ');

// the style bar agrees with the renderer, and switching an unflagged shape to
// Sketchy keeps the wobble it already had (seed pinned from its id)
const screenOf = (id) =>
  page.evaluate((id) => {
    const ctl = window.__slateCtl;
    const o = ctl.doc.get(id);
    return ctl.worldToScreenPt({ x: o.x + 4, y: o.y + o.h / 2 });
  }, id);
async function toggleState(id) {
  const p = await screenOf(id);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(200);
  return page.evaluate(() => ({
    clean: document.querySelector('.stylebar button[title="Clean borders"]')?.classList.contains('active') ?? null,
    sketchy: document.querySelector('.stylebar button[title="Hand-drawn borders"]')?.classList.contains('active') ?? null,
  }));
}
const tA = await toggleState('A');
const tClean = await toggleState('Clean');
const tBar = tA.sketchy && !tA.clean && tClean.clean && !tClean.sketchy;
console.log(tBar ? 'STYLEBAR AGREES (unflagged=Sketchy, sketchy:false=Clean)' : `STYLEBAR WRONG: A=${JSON.stringify(tA)} Clean=${JSON.stringify(tClean)}`);
await toggleState('A');
await page.click('.stylebar button[title="Hand-drawn borders"]');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const pinned = await page.evaluate(() => {
  const a = window.__slateCtl.doc.get('A');
  return { sketchy: a.sketchy, seed: a.seed };
});
const c3 = await page.screenshot();
console.log(
  pinned.sketchy === true && pinned.seed !== undefined && Buffer.compare(c2, c3) === 0
    ? `TOGGLE KEEPS WOBBLE (seed ${pinned.seed})`
    : `TOGGLE CHANGED LOOK: ${JSON.stringify(pinned)}, frames ${Buffer.compare(c2, c3) === 0 ? 'same' : 'differ'}`
);

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
// export agrees too: only the explicit sketchy:false rect exports as a clean <rect>
const cleanRects = (svg.match(/<rect x="(\d+)" y="(\d+)" width="160"/g) ?? []);
console.log(
  cleanRects.length === 1 && cleanRects[0].includes('x="1000" y="680"')
    ? 'SVG EXPORT AGREES (unflagged shapes rough, sketchy:false clean)'
    : `SVG EXPORT WRONG: clean rects ${JSON.stringify(cleanRects)}`
);

console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
await browser.close();

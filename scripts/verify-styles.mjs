// Verify the drawing-style foundation end to end in the real app: board + object
// style persist through IndexedDB and a reload, seeds are created once and kept
// (duplicates get new ones), the pickers work, swatches come from the style's
// palette, and the tab-side MCP methods round-trip `style`.
// Usage: PORT=5181 node scripts/verify-styles.mjs
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
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
const boardId = decodeURIComponent(new URL(page.url()).pathname.split('/').pop());

const meta = () => page.evaluate(async (id) => (await import('/src/store/db.ts')).db.boards.get(id), boardId);
check((await meta()).style === 'sketch', 'new board is saved with style "sketch"');
check((await page.inputValue('.board-style-select')) === 'sketch', 'board picker shows Sketch');

// draw a rectangle and a sticky
await page.keyboard.press('r');
await page.mouse.move(300, 300);
await page.mouse.down();
await page.mouse.move(500, 420, { steps: 5 });
await page.mouse.up();
await page.keyboard.press('Escape');
await page.keyboard.press('s');
await page.mouse.click(800, 350);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const objs = () => page.evaluate(() => window.__slateCtl.doc.all().map((o) => ({ id: o.id, type: o.type, seed: o.seed, style: o.style })));
let all = await objs();
const rect = all.find((o) => o.type === 'shape');
const note = all.find((o) => o.type === 'sticky');
check(rect && note && Number.isInteger(rect.seed) && Number.isInteger(note.seed), `new objects get a seed (shape ${rect?.seed}, sticky ${note?.seed})`);

// select the rect: object toolbar picker, palette from the style
await page.keyboard.press('v');
await page.mouse.click(302, 360);
await page.waitForSelector('.object-style-select');
const opts = await page.$$eval('.object-style-select option', (os) => os.map((o) => o.textContent));
check(JSON.stringify(opts) === JSON.stringify(['Board default (Sketch)', 'Sketch', 'Hand-drawn', 'Messy']), `toolbar picker options: ${opts.join(' / ')}`);
await page.click('.stylebar .color-chip-btn[title="Stroke color"]');
const swatches = await page.$$eval('.color-pop .swatch:not(.transparent)', (s) => s.map((b) => b.style.background));
const palette = await page.evaluate(async () => (await import('/src/engine/styles/index.ts')).getStyleRenderer('sketch').palette.length);
check(swatches.length >= palette && palette > 0, `stroke swatches come from the sketch palette (${palette} colors)`);
await page.keyboard.press('Escape');
await page.mouse.click(302, 360);
await page.selectOption('.object-style-select', 'messy');
await page.waitForTimeout(100);
all = await objs();
check(all.find((o) => o.id === rect.id).style === 'messy', 'toolbar sets the per-object style');
check(all.find((o) => o.id === rect.id).seed === rect.seed, 'seed unchanged by the style edit');

// move it: seed kept
await page.mouse.move(302, 360);
await page.mouse.down();
await page.mouse.move(340, 400, { steps: 4 });
await page.mouse.up();
all = await objs();
check(all.find((o) => o.id === rect.id).seed === rect.seed, 'seed unchanged by a move');

// duplicate: new id, new seed
const dup = await page.evaluate(() => {
  const ctl = window.__slateCtl;
  ctl.duplicateSelection();
  return ctl.selectedObjects().map((o) => ({ id: o.id, seed: o.seed, style: o.style }));
});
check(dup.length === 1 && dup[0].id !== rect.id && dup[0].seed !== rect.seed && Number.isInteger(dup[0].seed), `duplicate gets a new seed (${dup[0]?.seed})`);

// board style
await page.selectOption('.board-style-select', 'handdrawn');
await page.waitForTimeout(800); // autosave debounce
check((await meta()).style === 'handdrawn', 'board picker persists board style');
const seedsBefore = Object.fromEntries((await objs()).map((o) => [o.id, o.seed]));

// reload: everything comes back
await page.reload();
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(600);
const after = await page.evaluate(() => ({
  docStyle: window.__slateCtl.doc.style,
  objs: window.__slateCtl.doc.all().map((o) => ({ id: o.id, seed: o.seed, style: o.style })),
}));
check(after.docStyle === 'handdrawn', 'board style restored on reload');
check((await page.inputValue('.board-style-select')) === 'handdrawn', 'board picker restored on reload');
check(after.objs.every((o) => o.seed === seedsBefore[o.id]) && after.objs.length === Object.keys(seedsBefore).length, 'all seeds identical after reload');
check(after.objs.find((o) => o.id === rect.id).style === 'messy', 'object style override restored on reload');

// ---- tab-side MCP methods ----
const mcp = await page.evaluate(async () => {
  const m = await import('/src/bridge/methods.ts');
  const out = {};
  const created = await m.create_board({ name: 'MCP styled', style: 'messy' });
  out.created = created;
  try {
    await m.create_board({ name: 'bad', style: 'crayon' });
    out.badCreate = 'accepted';
  } catch (e) {
    out.badCreate = e.message;
  }
  const added = await m.add_objects({
    boardId: created.boardId,
    objects: [
      { type: 'shape', ref: 'a', text: 'A', style: 'handdrawn' },
      { type: 'sticky', ref: 'b', text: 'B' },
      { type: 'connector', from: { ref: 'a' }, to: { ref: 'b' }, style: 'sketch' },
    ],
  });
  out.added = added;
  try {
    await m.add_objects({ boardId: created.boardId, objects: [{ type: 'shape', style: 'Messy' }] });
    out.badAdd = 'accepted';
  } catch (e) {
    out.badAdd = e.message;
  }
  const [a, b] = added.ids;
  out.update = await m.update_objects({
    boardId: created.boardId,
    edits: [
      { id: a, patch: { style: null } },
      { id: b, patch: { style: 'messy' } },
      { id: b, patch: { style: 'nope' } },
    ],
  });
  out.read = await m.read_board({ boardId: created.boardId });
  out.list = (await m.list_boards()).find((x) => x.id === created.boardId);
  out.seeds = window.__slateCtl.doc.all().map((o) => o.seed);
  return out;
});
check(mcp.created.style === 'messy', 'create_board style → board.style "messy"');
check(/style must be/.test(mcp.badCreate), `create_board rejects bad style (${mcp.badCreate})`);
check(/objects\[0\]: style must be/.test(mcp.badAdd), `add_objects rejects bad style (${mcp.badAdd})`);
const [ia, ib, ic] = mcp.added.ids;
const byId = Object.fromEntries(mcp.read.objects.map((o) => [o.id, o]));
check(mcp.read.board.style === 'messy' && mcp.list.style === 'messy', 'read_board / list_boards return the board style');
check(byId[ia].style === undefined, 'update_objects style:null clears the override');
check(byId[ib].style === 'messy', 'update_objects sets style');
check(byId[ic].style === 'sketch', 'add_objects style on a connector round-trips');
check(!mcp.update.results[2].ok && /rejected: style/.test(mcp.update.results[2].error), `update_objects rejects an invalid style value (${mcp.update.results[2].error})`);
check(mcp.seeds.every((s) => Number.isInteger(s)), 'agent-created objects all have seeds');

console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
await browser.close();
process.exitCode = failed || errors.length ? 1 : 0;

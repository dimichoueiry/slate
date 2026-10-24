// Phase 0 dashboard verification: name-on-create, ⋯ menu keyboard flow, Trash +
// undo, in-app dialogs, disk-mirror restore of projects, and Git Sync's trash
// behaviour against an in-process fake GitHub (host github.invalid — never a
// real repo). Fresh headless browser contexts; MCP bridge disabled.
//
// ISOLATED ONLY. Run a dev server on another port whose root is a scratch copy
// (so its ./data is empty and not yours), then:
//   SLATE_URL=http://localhost:5197 SLATE_DATA_DIR=<that root>/data node scripts/verify-phase0.mjs
// It refuses to start on :5180 or if SLATE_DATA_DIR already holds any boards.
// Optional: SHOTS=<dir> (default /tmp/slate-phase0-shots), PW_CHROMIUM=<executable>.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.SLATE_URL ?? 'http://localhost:5197';
const SHOTS = process.env.SHOTS ?? '/tmp/slate-phase0-shots';
const DATA_DIR = process.env.SLATE_DATA_DIR;
// guards: never the real origin (port 5180 = your real IndexedDB) or this repo's ./data
if (new URL(BASE).port === '5180') throw new Error('Refusing to run against :5180 (the real Slate origin).');
if (!DATA_DIR) throw new Error('Set SLATE_DATA_DIR to the isolated server\'s data dir.');
// a real mirror has boards in it; an isolated run starts from an empty one
const existing = fs.existsSync(path.join(DATA_DIR, 'boards')) ? fs.readdirSync(path.join(DATA_DIR, 'boards')) : [];
if (existing.length || fs.existsSync(path.join(DATA_DIR, 'projects.json')))
  throw new Error(`Refusing: ${DATA_DIR} already has data. Point the isolated server at an empty data dir.`);
fs.mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('[verify]', ...a);
const results = [];
let step = 'start';
const check = (name, ok, detail = '') => {
  step = name;
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

// ---------- fake GitHub contents API ----------
const repo = new Map(); // path -> { sha, bytes(Buffer) }
const mutations = []; // { method, path, message }
let shaN = 0;
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,HEAD,PUT,DELETE,OPTIONS',
};
async function fakeGitHub(route) {
  const req = route.request();
  const url = new URL(req.url());
  const m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const prefix = '/api/v3/repos/fake/repo';
  if (!url.pathname.startsWith(prefix)) return json(404, { message: 'Not Found' });
  const rest = url.pathname.slice(prefix.length);
  if (rest === '') return json(200, { permissions: { push: true } });
  if (!rest.startsWith('/contents/')) return json(404, { message: 'Not Found' });
  const p = decodeURIComponent(rest.slice('/contents/'.length));
  if (m === 'GET' || m === 'HEAD') {
    const f = repo.get(p);
    if (f) return json(200, { sha: f.sha, content: f.bytes.toString('base64'), encoding: 'base64', size: f.bytes.length });
    const children = [...repo.keys()].filter((k) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'));
    if (children.length && m === 'GET')
      return json(200, children.map((k) => ({ path: k, name: k.split('/').pop(), sha: repo.get(k).sha, size: repo.get(k).bytes.length, type: 'file' })));
    return json(404, { message: 'Not Found' });
  }
  const body = JSON.parse(req.postData() || '{}');
  const cur = repo.get(p);
  if (m === 'PUT') {
    if (cur && body.sha !== cur.sha) return json(409, { message: 'sha does not match' });
    if (!cur && body.sha) return json(404, { message: 'Not Found' });
    const sha = `sha${++shaN}`;
    repo.set(p, { sha, bytes: Buffer.from(body.content, 'base64') });
    mutations.push({ method: 'PUT', path: p, message: body.message });
    return json(200, { content: { sha } });
  }
  if (m === 'DELETE') {
    if (!cur) return json(404, { message: 'Not Found' });
    if (body.sha !== cur.sha) return json(409, { message: 'sha does not match' });
    repo.delete(p);
    mutations.push({ method: 'DELETE', path: p, message: body.message });
    return json(200, {});
  }
  return json(405, { message: 'no' });
}
const repoBoard = (id) => {
  const f = repo.get(`slate/boards/${id}.json`);
  return f ? JSON.parse(f.bytes.toString('utf8')) : null;
};

// ---------- browser (fresh, profile-less context) ----------
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const forbidden = [];
async function newContext() {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, colorScheme: 'dark' });
  await ctx.addInitScript(() => {
    localStorage.setItem('slate-bridge-disabled', '1');
    localStorage.setItem('slate-onboarded', '1');
    const WS = window.WebSocket;
    window.WebSocket = function (url, ...a) {
      if (String(url).includes('8642')) throw new Error('blocked bridge socket');
      return new WS(url, ...a);
    };
    window.WebSocket.prototype = WS.prototype;
    Object.assign(window.WebSocket, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 });
  });
  await ctx.route('https://github.invalid/**', fakeGitHub);
  // belt and braces: anything to real GitHub is aborted and recorded
  await ctx.route(/github\.com/, (r) => {
    forbidden.push(r.request().url());
    return r.abort();
  });
  ctx.on('request', (r) => {
    const u = r.url();
    if (u.includes(':8642') || (!u.startsWith(BASE) && !u.startsWith('https://github.invalid') && !u.startsWith('data:') && !u.startsWith('blob:')))
      forbidden.push(u);
  });
  return ctx;
}

const ctx = await newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('page error after:', step, '|', e.name, e.message); });


await page.goto(`${BASE}/app`);
await page.waitForSelector('text=New board');

// ---- 1. name on create ----
await page.click('.new-board');
await page.waitForSelector('.topbar input.board-name.naming');
await page.waitForTimeout(300);
const sel = await page.evaluate(() => {
  const i = document.activeElement;
  return { focused: i?.classList.contains('board-name'), selected: i.selectionStart === 0 && i.selectionEnd === i.value.length, value: i.value };
});
check('name on create: name field focused + fully selected', sel.focused && sel.selected && sel.value === 'Untitled board', JSON.stringify(sel));
await page.screenshot({ path: `${SHOTS}/03-name-on-create.png` });
await page.keyboard.type('Q3 launch plan');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const named = await page.evaluate(async () => {
  const { db } = await import('/src/store/db.ts');
  return (await db.boards.toArray()).map((b) => b.name);
});
check('name on create: typed name saved', named.includes('Q3 launch plan'), JSON.stringify(named));

// Escape keeps the default
await page.goto(`${BASE}/app`);
await page.click('.new-board');
await page.waitForSelector('.topbar input.board-name.naming');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const escName = await page.inputValue('.topbar input.board-name');
const stillFocused = await page.evaluate(() => document.activeElement?.classList.contains('board-name'));
check('name on create: Escape keeps "Untitled board" and leaves the field', escName === 'Untitled board' && !stillFocused);

// ---- seed a realistic dashboard ----
await page.goto(`${BASE}/app`);
await page.evaluate(async () => {
  const { createBoard, createProject, updateBoardMeta } = await import('/src/store/db.ts');
  const p = await createProject('Client work');
  const now = Date.now();
  const mk = async (name, projectId, ago) => {
    const b = await createBoard(name, projectId);
    await updateBoardMeta(b.id, {});
    const { db } = await import('/src/store/db.ts');
    await db.boards.update(b.id, { updatedAt: now - ago });
  };
  await mk('Agent architecture', null, 2 * 3600e3);
  await mk('RAG lesson sketch', null, 26 * 3600e3);
  await mk('Onboarding flow', p.id, 5 * 60e3);
  await mk('Pricing page wireframe', p.id, 3 * 86400e3);
});
await page.waitForTimeout(2000); // let the 1.5s disk-mirror debounce fire before any reload

// ---- connect Git Sync to the fake repo ----
await page.evaluate(async () => {
  const { connectGitSync } = await import('/src/store/gitsync/engine.ts');
  await connectGitSync({ host: 'github.invalid', owner: 'fake', repo: 'repo', token: 'fake-token' });
});
const settle = async () => {
  await page.evaluate(async () => {
    const { syncNow, useGitSync } = await import('/src/store/gitsync/engine.ts');
    syncNow();
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < 100 && useGitSync.getState().status === 'syncing'; i++) await new Promise((r) => setTimeout(r, 100));
    const s = useGitSync.getState();
    return { status: s.status, pending: s.pending, error: s.error };
  }).then((r) => console.log('  settle →', JSON.stringify(r), 'muts:', mutations.slice(-3).map((m) => m.method + ' ' + m.path + ' ' + m.message).join(' | ')));
};
await settle();
const boardIds = await page.evaluate(async () => {
  const { db } = await import('/src/store/db.ts');
  return Object.fromEntries((await db.boards.toArray()).map((b) => [b.name, b.id]));
});
check('git sync: every board pushed to fake repo', Object.values(boardIds).every((id) => repoBoard(id)), `${repo.size} files`);

// ---- dashboard screenshot ----
await page.goto(`${BASE}/app`);
await page.waitForSelector('.board-card');
await page.waitForTimeout(700);
await page.screenshot({ path: `${SHOTS}/01-dashboard.png`, fullPage: true });

// ---- keyboard: tab to a card, then its ⋯ menu ----
await page.locator('.new-board').first().focus();
await page.keyboard.press('Tab'); // first card
const cardFocus = await page.evaluate(() => document.activeElement?.className);
check('keyboard: Tab reaches the card button', cardFocus === 'card-open', cardFocus);
await page.keyboard.press('Tab'); // its ⋯
const menuBtnFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup'));
check('keyboard: next Tab reaches the ⋯ menu button', menuBtnFocus === 'menu');
await page.keyboard.press('Enter');
await page.waitForSelector('.card-menu');
await page.keyboard.press('ArrowDown');
const focusedItem = await page.evaluate(() => document.activeElement?.textContent);
check('keyboard: menu opens with focus inside, arrows move', focusedItem === 'Rename…', focusedItem);
await page.screenshot({ path: `${SHOTS}/02-card-menu-keyboard.png` });
await page.keyboard.press('Escape');
const backOnBtn = await page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup'));
check('keyboard: Escape closes menu and returns focus to ⋯', backOnBtn === 'menu' && !(await page.$('.card-menu')));

// card focus ring screenshot + Enter opens
await page.keyboard.press('Shift+Tab');
await page.screenshot({ path: `${SHOTS}/02b-card-focus-ring.png` });

// ---- trash via keyboard: ⋯ → End (Move to Trash) → Enter ----
const target = 'Agent architecture';
const tid = boardIds[target];
const card = page.locator('.board-card', { hasText: target });
await card.locator('.card-menu-btn').focus();
await page.keyboard.press('Enter');
await page.keyboard.press('End');
const lastItem = await page.evaluate(() => document.activeElement?.textContent);
await page.keyboard.press('Enter');
await page.waitForSelector('.toast');
await page.waitForTimeout(250);
await page.screenshot({ path: `${SHOTS}/04-delete-undo-toast.png` });
check('trash: End selects "Move to Trash"', lastItem === 'Move to Trash');
check('trash: card gone from dashboard', (await page.locator('.board-card', { hasText: target }).count()) === 0);
await settle();
const afterTrash = repoBoard(tid);
check('GIT SYNC: trashed board file still in repo', !!afterTrash);
check('GIT SYNC: repo file carries deletedAt', !!afterTrash?.meta?.deletedAt);
check('GIT SYNC: no DELETE issued for trashed board', !mutations.some((x) => x.method === 'DELETE'));
check('GIT SYNC: commit says "move to trash"', mutations.some((x) => x.message === `slate: move "${target}" to trash`));
const readme = repo.get('README.md')?.bytes.toString('utf8') ?? '';
check('GIT SYNC: README lists it under Trash', /## Trash[\s\S]*Agent architecture/.test(readme));

// Undo (toast still up: well inside 6s)
await page.click('.toast-action');
await page.waitForSelector(`.board-card:has-text("${target}")`);
check('undo: board back on dashboard', true);
await settle();
check('GIT SYNC: undo pushes deletedAt removal', repoBoard(tid) && !repoBoard(tid).meta.deletedAt);

// toast auto-dismiss ~6s
await card.locator('.card-menu-btn').click();
await page.click('.card-menu-item:has-text("Move to Trash")');
await page.waitForSelector('.toast');
const t0 = Date.now();
await page.waitForSelector('.toast', { state: 'detached', timeout: 10000 });
const shown = Date.now() - t0;
check('toast auto-dismisses after ~6s', shown > 5000 && shown < 7500, `${shown}ms`);

// trash the project too (via the project header button)
await page.click('button[aria-label="Move project Client work to Trash"]');
await page.waitForSelector('.toast');
const onboardingCard = await page.locator('.board-card', { hasText: 'Onboarding flow' }).count();
check('project trash: its boards still visible (under Unfiled)', onboardingCard === 1);
await page.click('.toast-close');

// ---- Trash view ----
await page.click('button:has-text("Trash")');
await page.waitForSelector('.trash-view');
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/05-trash-view.png`, fullPage: true });
check('trash view lists the board and the project', (await page.locator('.trash-row').count()) === 2);

// restore project from Trash
await page.click('button[aria-label="Restore project Client work"]');
await page.waitForTimeout(200);

// Delete forever (in-app confirm dialog)
await page.click(`button[aria-label="Delete ${target} forever"]`);
await page.waitForSelector('[role="alertdialog"]');
const dlgFocus = await page.evaluate(() => document.activeElement?.textContent);
await page.screenshot({ path: `${SHOTS}/06-delete-forever-dialog.png` });
check('dialog: role=alertdialog, focus on primary', dlgFocus === 'Delete forever', dlgFocus);
// opened by a mouse click: the auto-focused button must still show a ring
const ring = await page.evaluate(() => {
  const cs = getComputedStyle(document.activeElement);
  return `${cs.outlineStyle} ${cs.outlineWidth}`;
});
check('dialog: focus ring visible after mouse open', ring.startsWith('solid') && ring !== 'solid 0px', ring);
// focus trap: Tab twice stays inside
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
const inside = await page.evaluate(() => !!document.activeElement?.closest('.dlg'));
check('dialog: focus trapped', inside);
await page.keyboard.press('Escape');
check('dialog: Escape cancels', !(await page.$('[role="alertdialog"]')) && (await page.locator('.trash-row').count()) === 1);
await settle();
check('GIT SYNC: cancelled delete → file still in repo', !!repoBoard(tid));

await page.click(`button[aria-label="Delete ${target} forever"]`);
await page.click('[role="alertdialog"] button:has-text("Delete forever")');
await page.waitForTimeout(300);
await settle();
check('GIT SYNC: delete forever removes repo file', !repoBoard(tid));
check('GIT SYNC: exactly one DELETE, for that board', mutations.filter((x) => x.method === 'DELETE').map((x) => x.path).join() === `slate/boards/${tid}.json`);

// ---- in-app prompt (New project) ----
await page.click('button:has-text("← Boards")');
await page.click('button:has-text("New project")');
await page.waitForSelector('[role="dialog"] input');
await page.screenshot({ path: `${SHOTS}/07-new-project-dialog.png` });
await page.keyboard.press('Escape');

// ---- "Edited" timestamp: pan/zoom + leaving the board (thumbnail) don't move it; edits do ----
const metaOf = (id) =>
  page.evaluate(async (id) => {
    const { db } = await import('/src/store/db.ts');
    const b = await db.boards.get(id);
    return { updatedAt: b.updatedAt, viewport: b.viewport, thumb: !!b.thumb };
  }, id);
const eid = boardIds['RAG lesson sketch'];
const e0 = (await metaOf(eid)).updatedAt;
await page.goto(`${BASE}/board/${eid}`);
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(500);
await page.keyboard.press('r');
await page.mouse.move(500, 400);
await page.mouse.down();
await page.mouse.move(700, 520, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(2600); // autosave (300ms debounce, 2s max-wait)
const t1 = (await metaOf(eid)).updatedAt;
check('edited timestamp: drawing a shape bumps updatedAt', t1 > e0);

// ---- StyleBar "⊕ Save" → in-app prompt; IconTray right-click delete → in-app confirm ----
await page.click('button[title="Save selection as a reusable component"]');
await page.waitForSelector('[role="dialog"] input');
const inputRing = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
check('StyleBar save: in-app prompt with focused input (ring visible)', inputRing === 'solid', inputRing);
await page.screenshot({ path: `${SHOTS}/09-save-component-dialog.png` });
await page.keyboard.type('Phase0 component');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const comps = () => page.evaluate(async () => (await (await import('/src/store/db.ts')).listComponents()).map((c) => c.name));
check('StyleBar save: component created', (await comps()).includes('Phase0 component'));
// saving a component opens the tray itself (controller.saveSelectionAsComponent)
if (!(await page.locator('.icon-tray').count())) await page.click('button[title="Icon library (I)"]');
await page.fill('.icon-tray-header input', 'Phase0');
await page.waitForSelector('.comp-cell');
await page.click('.comp-cell', { button: 'right' });
await page.waitForSelector('[role="alertdialog"]');
const delTitle = await page.textContent('[role="alertdialog"] .dlg-title');
await page.click('[role="alertdialog"] button:has-text("Delete")');
await page.waitForTimeout(400);
check('IconTray delete: in-app confirm, component removed', delTitle.includes('Phase0 component') && !(await comps()).includes('Phase0 component'), delTitle);
await page.click('.icon-tray-header button[title="Close"]');

// leave (thumbnail is written on unmount), reopen, pan + zoom, leave again
await page.click('button[title="All boards"]'); // in-app nav, so BoardView unmounts and writes the thumb
await page.waitForSelector('.board-card');
await page.waitForTimeout(1500);
const m1 = await metaOf(eid);
await page.goto(`${BASE}/board/${eid}`);
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(500);
await page.mouse.move(700, 450);
for (let i = 0; i < 6; i++) await page.mouse.wheel(120, 80); // pan
await page.keyboard.down('Control');
for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -60); // pinch-zoom
await page.keyboard.up('Control');
await page.waitForTimeout(1200); // viewport save is debounced 500ms
const m2 = await metaOf(eid);
await page.click('button[title="All boards"]');
await page.waitForSelector('.board-card');
await page.waitForTimeout(1500);
const m3 = await metaOf(eid);
check('edited timestamp: thumbnail written on leave without bumping it', m1.thumb && m1.updatedAt === t1, `${m1.updatedAt} vs ${t1}`);
check('edited timestamp: pan/zoom saved the camera', JSON.stringify(m2.viewport) !== JSON.stringify(m1.viewport), JSON.stringify(m2.viewport));
check('edited timestamp: pan/zoom + leaving did not bump it', m2.updatedAt === t1 && m3.updatedAt === t1, `${m3.updatedAt} vs ${t1}`);

// ---- disk mirror: projects.json written; fresh IndexedDB restores boards INTO the project ----
await page.waitForTimeout(2200); // fsync debounce is 1.5s
const dataDir = DATA_DIR;
const projFile = fs.existsSync(`${dataDir}/projects.json`) ? JSON.parse(fs.readFileSync(`${dataDir}/projects.json`, 'utf8')) : [];
check('mirror: data/projects.json written', projFile.some((p) => p.name === 'Client work'));
await ctx.close();

const ctx2 = await newContext(); // fresh IndexedDB, no Git Sync
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => { errors.push(e.message); console.log('page error (fresh restore):', e.name, e.message); });
await p2.goto(`${BASE}/app`);
await p2.waitForSelector('.project-section', { timeout: 10000 });
await p2.waitForTimeout(800);
const inProj = await p2.locator('.project-section', { hasText: 'Client work' }).locator('.board-card').allInnerTexts();
check('restore: boards in a project show under it after a fresh restore', inProj.some((t) => t.includes('Onboarding flow')), `${inProj.length} cards`);
// orphan: a board pointing at a project that doesn't exist
await p2.evaluate(async () => {
  const { createBoard } = await import('/src/store/db.ts');
  await createBoard('Orphaned board', 'no-such-project');
});
await p2.goto(`${BASE}/app`);
await p2.waitForSelector('.board-card');
await p2.waitForTimeout(500);
check('orphan board shows under Unfiled', (await p2.locator('.board-grid').first().locator('.board-card', { hasText: 'Orphaned board' }).count()) === 1);
await p2.setViewportSize({ width: 390, height: 844 });
await p2.waitForTimeout(300);
await p2.screenshot({ path: `${SHOTS}/08-dashboard-mobile-390.png` });
await ctx2.close();
await browser.close();

check('no requests to 8642 / real GitHub / other hosts', forbidden.length === 0, forbidden.slice(0, 5).join(' '));
check('no page errors', errors.length === 0, errors.join(' | '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

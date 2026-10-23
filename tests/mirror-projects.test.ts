// Dev disk mirror (./data): projects must round-trip, or boards inside a
// project vanish from the dashboard after a restore into a fresh IndexedDB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createMirrorHandler } from '../vite-slate-mirror';
import { restoreSnapshot, type RestoreTarget, type Snapshot } from '../src/store/fsyncRestore';
import { groupBoards } from '../src/store/boardGroups';

/** in-memory stand-in for the Dexie tables restoreSnapshot touches */
function memDb() {
  const table = () => {
    const m = new Map<string, any>();
    return { m, get: async (k: string) => m.get(k), put: async (r: any) => void m.set(r.id, r) };
  };
  const objects = new Map<string, any>();
  const db = {
    boards: table(),
    blobs: table(),
    components: table(),
    projects: table(),
    objects: { m: objects, bulkPut: async (rows: any[]) => rows.forEach((r) => objects.set(r.id, r)) },
  };
  return db satisfies RestoreTarget;
}

/** drive the mirror handler like Vite's connect middleware would */
function call(handler: ReturnType<typeof createMirrorHandler>, method: string, url: string, body?: unknown) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
    req.method = method;
    req.url = url;
    const res: any = {
      statusCode: 0,
      setHeader() {},
      end(out: string) {
        resolve({ status: res.statusCode, body: out ? JSON.parse(out) : null });
      },
    };
    handler(req, res);
  });
}

const meta = (id: string, projectId: string | null) => ({
  id, name: id, createdAt: 1, updatedAt: 1, viewport: { x: 0, y: 0, zoom: 1 }, projectId,
});

test('mirror: projects written to disk come back in the snapshot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-mirror-'));
  try {
    const h = createMirrorHandler(dir);
    const projects = [{ id: 'p1', name: 'Client work', createdAt: 1 }];
    assert.equal((await call(h, 'PUT', '/projects', projects)).status, 200);
    assert.equal((await call(h, 'PUT', '/board/b1', { meta: meta('b1', 'p1'), objects: [] })).status, 200);
    const snap = (await call(h, 'GET', '/snapshot')).body;
    assert.deepEqual(snap.projects, projects);
    assert.equal(snap.boards[0].meta.projectId, 'p1');
    // files land only under the given data dir
    assert.deepEqual(fs.readdirSync(dir).sort(), ['boards', 'projects.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mirror: a mirror written before projects existed still snapshots (projects = [])', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-mirror-'));
  try {
    const h = createMirrorHandler(dir);
    await call(h, 'PUT', '/board/b1', { meta: meta('b1', null), objects: [] });
    const snap = (await call(h, 'GET', '/snapshot')).body;
    assert.deepEqual(snap.projects, []);
    assert.equal(snap.boards.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restore into a fresh IndexedDB: board in a project is visible under that project (bug repro)', async () => {
  const snap: Snapshot = {
    boards: [
      { meta: meta('loose', null), objects: [] },
      { meta: meta('filed', 'p1'), objects: [{ id: 'o1', type: 'sticky' }] },
    ],
    projects: [{ id: 'p1', name: 'Client work', createdAt: 1 }],
  };
  // before the fix the mirror had no projects → board 'filed' had a dangling projectId
  const before = memDb();
  await restoreSnapshot({ ...snap, projects: undefined }, before, async () => new Blob());
  const oldHome = [...before.boards.m.values()].filter((b) => !b.projectId); // old Home.tsx filter
  assert.deepEqual(oldHome.map((b) => b.id), ['loose']); // 'filed' was invisible

  const db = memDb();
  const res = await restoreSnapshot(snap, db, async () => new Blob());
  assert.deepEqual(res, { boards: 2, projects: 1, components: 0 });
  assert.ok(db.objects.m.has('filed:o1'));
  const g = groupBoards([...db.boards.m.values()], [...db.projects.m.values()]);
  assert.deepEqual(g.unfiled.map((b) => b.id), ['loose']);
  assert.deepEqual(g.byProject.get('p1')!.map((b) => b.id), ['filed']);
});

test('restore never overwrites rows IndexedDB already has', async () => {
  const db = memDb();
  await db.projects.put({ id: 'p1', name: 'Local name', createdAt: 1 });
  await db.boards.put({ ...meta('b1', 'p1'), name: 'Local board' });
  const res = await restoreSnapshot(
    { boards: [{ meta: { ...meta('b1', 'p1'), name: 'Disk board' }, objects: [] }], projects: [{ id: 'p1', name: 'Disk name', createdAt: 1 }] },
    db,
    async () => new Blob()
  );
  assert.deepEqual(res, { boards: 0, projects: 0, components: 0 });
  assert.equal(db.projects.m.get('p1').name, 'Local name');
  assert.equal(db.boards.m.get('b1').name, 'Local board');
});

test('mirror: a write after the data dir vanished answers (recreates it), never throws', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-mirror-'));
  try {
    const h = createMirrorHandler(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal((await call(h, 'PUT', '/projects', [])).status, 200);
    assert.equal((await call(h, 'PUT', '/board/b1', { meta: meta('b1', null), objects: [] })).status, 200);
    assert.ok(fs.existsSync(path.join(dir, 'boards', 'b1.json')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

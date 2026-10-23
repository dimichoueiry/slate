// File persistence sync (dev): mirrors IndexedDB → ./data on every change and
// restores missing boards/projects/components from disk on startup. Injected by the
// vite-slate-persist plugin; fails silently when the endpoints don't exist.
import { db } from './db';
import { restoreSnapshot, type Snapshot } from './fsyncRestore';

const API = '/__slate';
let restoring = false;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// ---------- push: IndexedDB → disk ----------

const boardTimers = new Map<string, ReturnType<typeof setTimeout>>();
let compTimer: ReturnType<typeof setTimeout> | null = null;
let projTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleBoardPush(boardId: string | undefined) {
  if (restoring || !boardId) return;
  clearTimeout(boardTimers.get(boardId));
  boardTimers.set(
    boardId,
    setTimeout(() => void pushBoard(boardId), 1500)
  );
}

function scheduleComponentsPush() {
  if (restoring) return;
  if (compTimer) clearTimeout(compTimer);
  compTimer = setTimeout(() => void pushComponents(), 1500);
}

function scheduleProjectsPush() {
  if (restoring) return;
  if (projTimer) clearTimeout(projTimer);
  projTimer = setTimeout(() => void pushProjects(), 1500);
}

async function pushBoard(boardId: string) {
  try {
    const meta = await db.boards.get(boardId);
    if (!meta) {
      await fetch(`${API}/board/${boardId}`, { method: 'DELETE' });
      return;
    }
    const rows = await db.objects.where('boardId').equals(boardId).toArray();
    const objects = rows.map((r) => r.data);
    const blobs: Record<string, string> = {};
    for (const o of objects as any[]) {
      if (o.type === 'image' && o.blobId && !blobs[o.blobId]) {
        const row = await db.blobs.get(o.blobId);
        if (row) blobs[o.blobId] = await blobToDataUrl(row.blob);
      }
    }
    await fetch(`${API}/board/${boardId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ meta, objects, blobs }),
    });
  } catch {
    // dev-only feature — never break the app over it
  }
}

async function pushComponents() {
  try {
    const components = await db.components.toArray();
    await fetch(`${API}/components`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(components),
    });
  } catch {
    // ignore
  }
}

// projects (incl. trashed ones) — without these a restored board's projectId
// points at nothing and, before the dashboard's orphan fallback, the board
// vanished from every screen
async function pushProjects() {
  try {
    const projects = await db.projects.toArray();
    await fetch(`${API}/projects`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(projects),
    });
  } catch {
    // ignore
  }
}

// ---------- restore: disk → IndexedDB (only what's missing) ----------

async function restore() {
  let restored = false;
  try {
    const res = await fetch(`${API}/snapshot`);
    if (!res.ok) return;
    const snap = (await res.json()) as Snapshot;
    restoring = true;
    await restoreSnapshot(snap, db, async (dataUrl) => (await fetch(dataUrl)).blob());
    restored = true;
    if ((snap.boards?.length ?? 0) + (snap.projects?.length ?? 0) > 0 && /^\/app\/?$/.test(location.pathname) && document.visibilityState === 'visible') {
      // boards restored before the home screen first rendered need a refresh of the list
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  } catch {
    // ignore — endpoints only exist under the dev server
  } finally {
    restoring = false;
  }
  // mirrors written before projects were mirrored have no projects.json yet:
  // write it once now. Only after a successful restore — IndexedDB then holds
  // every project the disk had, so this write can't drop one.
  if (restored) scheduleProjectsPush();
}

// ---------- wire Dexie hooks (no app code changes needed) ----------

db.objects.hook('creating', (_pk, obj) => scheduleBoardPush((obj as any)?.boardId));
db.objects.hook('updating', (_mods, _pk, obj) => scheduleBoardPush((obj as any)?.boardId));
db.objects.hook('deleting', (_pk, obj) => scheduleBoardPush((obj as any)?.boardId));
db.boards.hook('creating', (pk) => scheduleBoardPush(String(pk)));
db.boards.hook('updating', (_mods, pk) => scheduleBoardPush(String(pk)));
db.boards.hook('deleting', (pk) => scheduleBoardPush(String(pk)));
db.components.hook('creating', () => scheduleComponentsPush());
db.components.hook('updating', () => scheduleComponentsPush());
db.components.hook('deleting', () => scheduleComponentsPush());
db.projects.hook('creating', () => scheduleProjectsPush());
db.projects.hook('updating', () => scheduleProjectsPush());
db.projects.hook('deleting', () => scheduleProjectsPush());

void restore();

export {};

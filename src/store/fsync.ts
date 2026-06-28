// File persistence sync (dev): mirrors IndexedDB → ./data on every change and
// restores missing boards/components from disk on startup. Injected by the
// vite-slate-persist plugin; fails silently when the endpoints don't exist.
import { db } from './db';

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

// ---------- restore: disk → IndexedDB (only what's missing) ----------

async function restore() {
  try {
    const res = await fetch(`${API}/snapshot`);
    if (!res.ok) return;
    const snap = (await res.json()) as {
      boards?: { meta: any; objects: any[]; blobs?: Record<string, string> }[];
      components?: any[];
    };
    restoring = true;
    for (const sb of snap.boards ?? []) {
      if (!sb?.meta?.id) continue;
      if (await db.boards.get(sb.meta.id)) continue;
      await db.boards.put(sb.meta);
      await db.objects.bulkPut(
        (sb.objects ?? []).map((o: any) => ({ id: `${sb.meta.id}:${o.id}`, boardId: sb.meta.id, data: o }))
      );
      for (const [bid, dataUrl] of Object.entries(sb.blobs ?? {})) {
        if (!(await db.blobs.get(bid))) {
          const blob = await (await fetch(dataUrl)).blob();
          await db.blobs.put({ id: bid, blob });
        }
      }
    }
    for (const c of snap.components ?? []) {
      if (c?.id && !(await db.components.get(c.id))) await db.components.put(c);
    }
    if ((snap.boards?.length ?? 0) > 0 && /^\/app\/?$/.test(location.pathname) && document.visibilityState === 'visible') {
      // boards restored before the home screen first rendered need a refresh of the list
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  } catch {
    // ignore — endpoints only exist under the dev server
  } finally {
    restoring = false;
  }
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

void restore();

export {};

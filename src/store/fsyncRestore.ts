// Disk → IndexedDB restore for the dev mirror (./data). Split from fsync.ts so
// it runs against any table-shaped store — the real Dexie db in the app, plain
// in-memory maps in the unit tests. Restores only what's MISSING locally: it
// never overwrites a row IndexedDB already has.

interface Table<T> {
  get(key: string): Promise<T | undefined>;
  put(row: T): Promise<unknown>;
}

export interface RestoreTarget {
  boards: Table<any>;
  objects: { bulkPut(rows: { id: string; boardId: string; data: any }[]): Promise<unknown> };
  blobs: Table<{ id: string; blob: Blob }>;
  components: Table<any>;
  projects: Table<any>;
}

export interface Snapshot {
  boards?: { meta: any; objects: any[]; blobs?: Record<string, string> }[];
  components?: any[];
  projects?: any[];
}

export interface RestoreResult {
  boards: number;
  projects: number;
  components: number;
}

export async function restoreSnapshot(
  snap: Snapshot,
  db: RestoreTarget,
  dataUrlToBlob: (dataUrl: string) => Promise<Blob>
): Promise<RestoreResult> {
  const out: RestoreResult = { boards: 0, projects: 0, components: 0 };
  // projects first: a restored board's projectId should resolve the moment it lands
  for (const p of snap.projects ?? []) {
    if (p?.id && !(await db.projects.get(p.id))) {
      await db.projects.put(p);
      out.projects++;
    }
  }
  for (const sb of snap.boards ?? []) {
    if (!sb?.meta?.id) continue;
    if (await db.boards.get(sb.meta.id)) continue;
    await db.boards.put(sb.meta);
    await db.objects.bulkPut(
      (sb.objects ?? []).map((o: any) => ({ id: `${sb.meta.id}:${o.id}`, boardId: sb.meta.id, data: o }))
    );
    for (const [bid, dataUrl] of Object.entries(sb.blobs ?? {})) {
      if (!(await db.blobs.get(bid))) await db.blobs.put({ id: bid, blob: await dataUrlToBlob(dataUrl) });
    }
    out.boards++;
  }
  for (const c of snap.components ?? []) {
    if (c?.id && !(await db.components.get(c.id))) {
      await db.components.put(c);
      out.components++;
    }
  }
  return out;
}

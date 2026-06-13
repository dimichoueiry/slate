import Dexie, { type EntityTable } from 'dexie';
import { nanoid } from 'nanoid';
import type { BoardMeta, SlateObj } from '../types';
import type { Doc } from '../engine/doc';

interface ObjectRow {
  id: string;
  boardId: string;
  data: SlateObj;
}

interface BlobRow {
  id: string;
  blob: Blob;
}

/** A user-saved reusable component: a named bundle of objects normalized to origin. */
export interface ComponentDef {
  id: string;
  name: string;
  objects: SlateObj[];
  thumb?: string; // png data url
  w: number;
  h: number;
  createdAt: number;
}

/** A saved prompt template — reusable text dropped onto the canvas as a node. */
export interface PromptDef {
  id: string;
  name: string;
  text: string;
  createdAt: number;
}

class SlateDB extends Dexie {
  boards!: EntityTable<BoardMeta, 'id'>;
  objects!: EntityTable<ObjectRow, 'id'>;
  blobs!: EntityTable<BlobRow, 'id'>;
  components!: EntityTable<ComponentDef, 'id'>;
  prompts!: EntityTable<PromptDef, 'id'>;

  constructor() {
    super('slate');
    this.version(1).stores({
      boards: 'id, updatedAt',
      objects: 'id, boardId',
      blobs: 'id',
    });
    this.version(2).stores({
      boards: 'id, updatedAt',
      objects: 'id, boardId',
      blobs: 'id',
      components: 'id, createdAt',
    });
    this.version(3).stores({
      boards: 'id, updatedAt',
      objects: 'id, boardId',
      blobs: 'id',
      components: 'id, createdAt',
      prompts: 'id, createdAt',
    });
  }
}

export const db = new SlateDB();

export async function listBoards(): Promise<BoardMeta[]> {
  const boards = await db.boards.toArray();
  return boards.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
}

export async function createBoard(name = 'Untitled board'): Promise<BoardMeta> {
  const board: BoardMeta = {
    id: nanoid(10),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    viewport: { x: -200, y: -200, zoom: 1 },
  };
  await db.boards.add(board);
  return board;
}

export async function loadBoardObjects(boardId: string): Promise<SlateObj[]> {
  const rows = await db.objects.where('boardId').equals(boardId).toArray();
  return rows.map((r) => r.data);
}

export async function updateBoardMeta(id: string, patch: Partial<BoardMeta>) {
  await db.boards.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteBoard(id: string) {
  await db.transaction('rw', db.boards, db.objects, async () => {
    await db.objects.where('boardId').equals(id).delete();
    await db.boards.delete(id);
  });
}

export async function duplicateBoard(id: string): Promise<BoardMeta | null> {
  const src = await db.boards.get(id);
  if (!src) return null;
  const copy: BoardMeta = {
    ...src,
    id: nanoid(10),
    name: src.name + ' copy',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
  };
  const rows = await db.objects.where('boardId').equals(id).toArray();
  await db.transaction('rw', db.boards, db.objects, async () => {
    await db.boards.add(copy);
    await db.objects.bulkAdd(rows.map((r) => ({ ...r, id: `${copy.id}:${r.data.id}`, boardId: copy.id })));
  });
  return copy;
}

export async function listComponents(): Promise<ComponentDef[]> {
  const rows = await db.components.toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveComponent(comp: ComponentDef) {
  await db.components.put(comp);
}

export async function deleteComponent(id: string) {
  await db.components.delete(id);
}

export async function listPrompts(): Promise<PromptDef[]> {
  const rows = await db.prompts.toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function savePrompt(name: string, text: string): Promise<PromptDef> {
  const p: PromptDef = { id: nanoid(10), name, text, createdAt: Date.now() };
  await db.prompts.put(p);
  return p;
}

export async function deletePrompt(id: string) {
  await db.prompts.delete(id);
}

export async function putBlob(blob: Blob): Promise<string> {
  const id = nanoid(12);
  await db.blobs.put({ id, blob });
  return id;
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const row = await db.blobs.get(id);
  return row?.blob;
}

/**
 * Continuous autosave: watches the doc's dirty map and flushes it to IndexedDB,
 * debounced (300ms after last change) but with a 2s max-wait so a steady stream
 * of edits still hits disk. Returns a disposer that does a final flush.
 */
export function startAutosave(doc: Doc, boardId: string): { flush: () => Promise<void>; dispose: () => Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let oldestPending = 0;

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (doc.dirty.size === 0) return;
    const entries = [...doc.dirty.entries()];
    doc.dirty.clear();
    oldestPending = 0;
    const puts: ObjectRow[] = [];
    const dels: string[] = [];
    for (const [id, obj] of entries) {
      if (obj) puts.push({ id: `${boardId}:${id}`, boardId, data: obj });
      else dels.push(`${boardId}:${id}`);
    }
    await db.transaction('rw', db.objects, db.boards, async () => {
      if (puts.length) await db.objects.bulkPut(puts);
      if (dels.length) await db.objects.bulkDelete(dels);
      await db.boards.update(boardId, { updatedAt: Date.now() });
    });
  };

  const schedule = () => {
    const now = Date.now();
    if (!oldestPending) oldestPending = now;
    if (timer) clearTimeout(timer);
    const maxWaitHit = now - oldestPending > 2000;
    timer = setTimeout(() => void flush(), maxWaitHit ? 0 : 300);
  };

  const unsub = doc.subscribe(schedule);
  const beforeUnload = () => void flush();
  window.addEventListener('beforeunload', beforeUnload);

  return {
    flush,
    dispose: async () => {
      unsub();
      window.removeEventListener('beforeunload', beforeUnload);
      await flush();
    },
  };
}

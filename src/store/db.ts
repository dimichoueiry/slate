import Dexie, { type EntityTable } from 'dexie';
import { nanoid } from 'nanoid';
import type { BoardMeta, BrandKit, Project, SlateObj } from '../types';
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

/** Tiny key-value row for app-level state that must live in IndexedDB (e.g. the
 *  auto-backup directory handle — FileSystemHandle survives only in IDB). */
interface KvRow {
  key: string;
  value: unknown;
}

class SlateDB extends Dexie {
  boards!: EntityTable<BoardMeta, 'id'>;
  objects!: EntityTable<ObjectRow, 'id'>;
  blobs!: EntityTable<BlobRow, 'id'>;
  components!: EntityTable<ComponentDef, 'id'>;
  prompts!: EntityTable<PromptDef, 'id'>;
  brandKits!: EntityTable<BrandKit, 'id'>;
  projects!: EntityTable<Project, 'id'>;
  kv!: EntityTable<KvRow, 'key'>;

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
    this.version(4).stores({
      boards: 'id, updatedAt',
      objects: 'id, boardId',
      blobs: 'id',
      components: 'id, createdAt',
      prompts: 'id, createdAt',
      brandKits: 'id, createdAt',
    });
    this.version(5).stores({
      boards: 'id, updatedAt, projectId',
      objects: 'id, boardId',
      blobs: 'id',
      components: 'id, createdAt',
      prompts: 'id, createdAt',
      brandKits: 'id, createdAt',
      projects: 'id, createdAt',
    });
    this.version(6).stores({
      boards: 'id, updatedAt, projectId',
      objects: 'id, boardId',
      blobs: 'id',
      components: 'id, createdAt',
      prompts: 'id, createdAt',
      brandKits: 'id, createdAt',
      projects: 'id, createdAt',
      kv: 'key',
    });
  }
}

export const db = new SlateDB();

// When another tab (e.g. one running a newer deploy) upgrades the schema, this
// tab's connection gets force-closed and every query starts failing — which the
// UI used to render as an EMPTY board list, indistinguishable from data loss.
// Reload instead: the tab comes back on the new code with the data intact.
db.on('versionchange', () => {
  db.close();
  location.reload();
});

export async function listBoards(): Promise<BoardMeta[]> {
  const boards = await db.boards.toArray();
  return boards.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
}

export async function createBoard(name = 'Untitled board', projectId: string | null = null): Promise<BoardMeta> {
  const board: BoardMeta = {
    id: nanoid(10),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    viewport: { x: -200, y: -200, zoom: 1 },
    projectId,
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

// ---------- projects / folders ----------

export async function listProjects(): Promise<Project[]> {
  const rows = await db.projects.toArray();
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function createProject(name = 'New project'): Promise<Project> {
  const p: Project = { id: nanoid(10), name, createdAt: Date.now() };
  await db.projects.add(p);
  return p;
}

export async function renameProject(id: string, name: string) {
  await db.projects.update(id, { name });
}

export async function setProjectKit(id: string, brandKitId: string | null) {
  await db.projects.update(id, { brandKitId });
}

/** Delete a project; its boards become standalone (unfiled), not deleted. */
export async function deleteProject(id: string) {
  await db.transaction('rw', db.projects, db.boards, async () => {
    const boards = await db.boards.where('projectId').equals(id).toArray();
    for (const b of boards) await db.boards.update(b.id, { projectId: null });
    await db.projects.delete(id);
  });
}

// ---------- brand kits ----------

const DEFAULT_KIT_KEY = 'slate-default-brand-kit';

export async function listBrandKits(): Promise<BrandKit[]> {
  const rows = await db.brandKits.toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getBrandKit(id: string | null | undefined): Promise<BrandKit | undefined> {
  if (!id) return undefined;
  return db.brandKits.get(id);
}

export async function saveBrandKit(kit: BrandKit) {
  await db.brandKits.put(kit);
}

export async function deleteBrandKit(id: string) {
  await db.brandKits.delete(id);
}

export function getDefaultKitId(): string | null {
  try {
    return localStorage.getItem(DEFAULT_KIT_KEY);
  } catch {
    return null;
  }
}

export function setDefaultKitId(id: string | null) {
  try {
    if (id) localStorage.setItem(DEFAULT_KIT_KEY, id);
    else localStorage.removeItem(DEFAULT_KIT_KEY);
  } catch {
    // ignore
  }
}

/**
 * Resolve the active kit for a board with precedence:
 * board override → project default → global default.
 * (null at any level means "explicitly none" and stops the chain.)
 */
export async function resolveBoardKit(meta: BoardMeta | undefined): Promise<BrandKit | undefined> {
  if (!meta) return undefined;
  if (meta.brandKitId === null) return undefined; // board says: no brand
  if (meta.brandKitId) return getBrandKit(meta.brandKitId); // board override
  if (meta.projectId) {
    const proj = await db.projects.get(meta.projectId);
    if (proj?.brandKitId === null) return undefined; // project says: no brand
    if (proj?.brandKitId) return getBrandKit(proj.brandKitId); // project default
  }
  return getBrandKit(getDefaultKitId());
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

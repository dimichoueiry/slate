// Serialization between IndexedDB and the repo file format. Boards keep their
// ids across machines (sync needs stable identity — unlike import, which
// deliberately re-ids). Serialization is deterministic (sorted keys, sorted
// objects) so identical content always hashes identically on every machine —
// otherwise two synced machines would ping-pong no-op pushes forever.
//
// Data integrity: a board file always carries EVERY object and references EVERY
// blob. Reads apply atomically or not at all — a pull can never leave a board
// half-written or missing assets it references.

import { nanoid } from 'nanoid';
import { db } from '../db';
import type { BoardMeta, SlateObj } from '../../types';

export interface BoardFile {
  format: 'slate-git-board';
  version: 1;
  meta: BoardMeta;
  objects: SlateObj[];
  /** blobId -> content hash; the bytes live at assets/<hash> in the repo */
  assets: Record<string, string>;
}

export interface WorkspaceFile {
  format: 'slate-git-workspace';
  version: 1;
  projects: unknown[];
  brandKits: unknown[];
  components: unknown[];
  prompts: unknown[];
  /** blobId -> content hash for blobs referenced by component objects */
  assets: Record<string, string>;
}

export interface Serialized {
  json: string;
  /** deterministic hash of `json` — the "did anything change" token */
  hash: string;
  /** content hash -> bytes, for every asset the file references */
  assets: Map<string, { blobId: string; bytes: Uint8Array }>;
}

// ---------- hashing ----------

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashText(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

/** JSON.stringify with recursively sorted keys — deterministic across machines. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

// ---------- blob collection ----------

/** Every blob id an object references (image/video content, upload full files). */
function blobIdsOf(o: SlateObj): string[] {
  const ids: string[] = [];
  const blobId = (o as { blobId?: string }).blobId;
  if ((o.type === 'image' || o.type === 'video') && blobId && !blobId.startsWith('pending-')) ids.push(blobId);
  const file = (o as { file?: { blobId?: string } }).file;
  if (file?.blobId) ids.push(file.blobId);
  return ids;
}

/**
 * Resolve every referenced blob to (hash, bytes). A referenced blob missing
 * from the local store is skipped from assets (it never existed to lose —
 * e.g. a generation that failed), never silently replaced with partial data.
 */
async function collectAssets(objects: SlateObj[]): Promise<{ refs: Record<string, string>; assets: Serialized['assets'] }> {
  const refs: Record<string, string> = {};
  const assets: Serialized['assets'] = new Map();
  for (const o of objects) {
    for (const blobId of blobIdsOf(o)) {
      if (refs[blobId]) continue;
      const row = await db.blobs.get(blobId);
      if (!row) continue;
      const bytes = new Uint8Array(await row.blob.arrayBuffer());
      const hash = await sha256Hex(bytes);
      refs[blobId] = hash;
      assets.set(hash, { blobId, bytes });
    }
  }
  return { refs, assets };
}

// ---------- board ----------

export async function serializeBoard(boardId: string): Promise<Serialized | null> {
  const meta = await db.boards.get(boardId);
  if (!meta) return null;
  const rows = await db.objects.where('boardId').equals(boardId).toArray();
  const objects = rows.map((r) => r.data).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const { refs, assets } = await collectAssets(objects);
  const file: BoardFile = { format: 'slate-git-board', version: 1, meta, objects, assets: refs };
  const json = stableStringify(file);
  return { json, hash: await hashText(json), assets };
}

export function parseBoardFile(json: string): BoardFile {
  const data = JSON.parse(json) as BoardFile;
  if (data.format !== 'slate-git-board' || !data.meta?.id || !Array.isArray(data.objects)) {
    throw new Error('Not a valid Slate board file');
  }
  return data;
}

/**
 * Replace the local copy of a board with the remote one, atomically. Missing
 * blobs are fetched (by content hash) BEFORE the board is touched — if any
 * fetch fails, the local board stays exactly as it was.
 */
export async function applyRemoteBoard(
  data: BoardFile,
  fetchAsset: (hash: string) => Promise<Uint8Array>
): Promise<void> {
  const blobPuts: { id: string; blob: Blob }[] = [];
  for (const [blobId, hash] of Object.entries(data.assets ?? {})) {
    if (await db.blobs.get(blobId)) continue;
    const bytes = await fetchAsset(hash); // throws → nothing applied
    blobPuts.push({ id: blobId, blob: new Blob([bytes as BlobPart]) });
  }
  const boardId = data.meta.id;
  await db.transaction('rw', db.boards, db.objects, db.blobs, async () => {
    if (blobPuts.length) await db.blobs.bulkPut(blobPuts);
    await db.objects.where('boardId').equals(boardId).delete();
    await db.objects.bulkPut(data.objects.map((o) => ({ id: `${boardId}:${o.id}`, boardId, data: o })));
    await db.boards.put(data.meta);
  });
}

/**
 * Store a remote board as a NEW local board (conflict copy): fresh board id,
 * fresh object ids (so it can live beside the original), every object and blob
 * preserved — a conflict must never lose either version (PRD §5.4).
 */
export async function saveConflictCopy(
  data: BoardFile,
  label: string,
  fetchAsset: (hash: string) => Promise<Uint8Array>
): Promise<BoardMeta> {
  const blobPuts: { id: string; blob: Blob }[] = [];
  for (const [blobId, hash] of Object.entries(data.assets ?? {})) {
    if (await db.blobs.get(blobId)) continue;
    const bytes = await fetchAsset(hash);
    blobPuts.push({ id: blobId, blob: new Blob([bytes as BlobPart]) });
  }
  const meta: BoardMeta = {
    ...data.meta,
    id: nanoid(10),
    name: `${data.meta.name} (${label})`,
    pinned: false,
  };
  const idMap = new Map<string, string>();
  const objects = data.objects.map((o) => {
    const clone = structuredClone(o);
    clone.id = nanoid(8);
    idMap.set(o.id, clone.id);
    return clone;
  });
  for (const o of objects) {
    if (o.parentId) o.parentId = idMap.get(o.parentId) ?? null;
    if (o.type === 'connector') {
      if (o.from.objectId) o.from.objectId = idMap.get(o.from.objectId) ?? undefined;
      if (o.to.objectId) o.to.objectId = idMap.get(o.to.objectId) ?? undefined;
    }
  }
  await db.transaction('rw', db.boards, db.objects, db.blobs, async () => {
    if (blobPuts.length) await db.blobs.bulkPut(blobPuts);
    await db.boards.put(meta);
    await db.objects.bulkPut(objects.map((o) => ({ id: `${meta.id}:${o.id}`, boardId: meta.id, data: o })));
  });
  return meta;
}

// ---------- workspace (projects, kits, components, prompts) ----------

export async function serializeWorkspace(): Promise<Serialized> {
  const [projects, brandKits, components, prompts] = await Promise.all([
    db.projects.toArray(),
    db.brandKits.toArray(),
    db.components.toArray(),
    db.prompts.toArray(),
  ]);
  const componentObjects = components.flatMap((c) => c.objects ?? []);
  const { refs, assets } = await collectAssets(componentObjects);
  const file: WorkspaceFile = {
    format: 'slate-git-workspace',
    version: 1,
    projects: projects.sort(byId),
    brandKits: brandKits.sort(byId),
    components: components.sort(byId),
    prompts: prompts.sort(byId),
    assets: refs,
  };
  const json = stableStringify(file);
  return { json, hash: await hashText(json), assets };
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function parseWorkspaceFile(json: string): WorkspaceFile {
  const data = JSON.parse(json) as WorkspaceFile;
  if (data.format !== 'slate-git-workspace') throw new Error('Not a valid Slate workspace file');
  return data;
}

/**
 * Merge the remote workspace into local: upsert by id. Local-only entries are
 * left alone (they'll push on the next workspace push); nothing is deleted here
 * — workspace-collection deletion propagation is deliberately conservative.
 */
export async function applyRemoteWorkspace(
  data: WorkspaceFile,
  fetchAsset: (hash: string) => Promise<Uint8Array>
): Promise<void> {
  const blobPuts: { id: string; blob: Blob }[] = [];
  for (const [blobId, hash] of Object.entries(data.assets ?? {})) {
    if (await db.blobs.get(blobId)) continue;
    const bytes = await fetchAsset(hash);
    blobPuts.push({ id: blobId, blob: new Blob([bytes as BlobPart]) });
  }
  await db.transaction('rw', [db.projects, db.brandKits, db.components, db.prompts, db.blobs], async () => {
    if (blobPuts.length) await db.blobs.bulkPut(blobPuts);
    for (const p of data.projects ?? []) await db.projects.put(p as never);
    for (const k of data.brandKits ?? []) await db.brandKits.put(k as never);
    for (const c of data.components ?? []) await db.components.put(c as never);
    for (const p of data.prompts ?? []) await db.prompts.put(p as never);
  });
}

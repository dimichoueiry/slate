import RBush from 'rbush';
import type { Box, SlateObj } from '../types';
import { aabbOf, boxesIntersect } from './geometry';

interface IndexEntry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

/**
 * A reversible command: a map of object id -> snapshot-after (null = deleted)
 * and id -> snapshot-before (null = did not exist). Undo applies `before`,
 * redo applies `after`. One write path feeds history + persistence (PRD §8.6).
 */
export interface Command {
  before: Record<string, SlateObj | null>;
  after: Record<string, SlateObj | null>;
}

export type DocListener = (changed: Set<string>) => void;

const PAD = 1; // index padding so hairline objects are findable

export class Doc {
  objects = new Map<string, SlateObj>();
  private index = new RBush<IndexEntry>();
  private entries = new Map<string, IndexEntry>();
  private listeners = new Set<DocListener>();
  /** ids touched since last persistence flush (null value = deleted) */
  dirty = new Map<string, SlateObj | null>();

  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private pending: Command | null = null;

  zCounter = 1;

  get(id: string): SlateObj | undefined {
    return this.objects.get(id);
  }

  resolve = (id: string): SlateObj | undefined => this.objects.get(id);

  all(): SlateObj[] {
    return [...this.objects.values()];
  }

  allSorted(): SlateObj[] {
    return this.all().sort((a, b) => a.z - b.z);
  }

  nextZ(): number {
    return this.zCounter++;
  }

  subscribe(fn: DocListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(changed: Set<string>) {
    for (const fn of this.listeners) fn(changed);
  }

  /** Objects whose AABB intersects the box (connectors checked separately since their bounds depend on targets). */
  search(box: Box): SlateObj[] {
    const hits = this.index.search({
      minX: box.x,
      minY: box.y,
      maxX: box.x + box.w,
      maxY: box.y + box.h,
    });
    const out: SlateObj[] = [];
    for (const h of hits) {
      const o = this.objects.get(h.id);
      if (o) out.push(o);
    }
    return out;
  }

  private reindex(o: SlateObj) {
    this.unindex(o.id);
    const b = aabbOf(o, this.resolve);
    const e: IndexEntry = {
      minX: b.x - PAD,
      minY: b.y - PAD,
      maxX: b.x + b.w + PAD,
      maxY: b.y + b.h + PAD,
      id: o.id,
    };
    this.entries.set(o.id, e);
    this.index.insert(e);
  }

  private unindex(id: string) {
    const prev = this.entries.get(id);
    if (prev) {
      this.index.remove(prev, (a, b) => a.id === b.id);
      this.entries.delete(id);
    }
  }

  // ---------- mutation API (all changes funnel through apply) ----------

  /** Begin a transaction; subsequent set/delete calls collapse into one undo step. */
  begin() {
    if (!this.pending) this.pending = { before: {}, after: {} };
  }

  /** Commit the open transaction onto the undo stack. */
  commit() {
    const p = this.pending;
    this.pending = null;
    if (!p || Object.keys(p.after).length === 0) return;
    this.undoStack.push(p);
    if (this.undoStack.length > 500) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Discard the open transaction *records* (mutations already applied stay applied). */
  abort() {
    this.pending = null;
  }

  private record(id: string, before: SlateObj | null, after: SlateObj | null) {
    if (this.pending) {
      if (!(id in this.pending.before)) this.pending.before[id] = before;
      this.pending.after[id] = after;
    } else {
      const cmd: Command = { before: { [id]: before }, after: { [id]: after } };
      this.undoStack.push(cmd);
      if (this.undoStack.length > 500) this.undoStack.shift();
      this.redoStack = [];
    }
  }

  /** Create or replace an object (records undo). */
  set(obj: SlateObj) {
    const before = this.objects.get(obj.id) ?? null;
    this.record(obj.id, before ? { ...before } : null, { ...obj });
    this.rawSet(obj);
    this.notify(new Set([obj.id]));
  }

  /** Partial update (records undo). */
  update<T extends SlateObj>(id: string, patch: Partial<T>) {
    const cur = this.objects.get(id);
    if (!cur) return;
    const next = { ...cur, ...patch } as SlateObj;
    this.record(id, { ...cur }, { ...next });
    this.rawSet(next);
    this.notify(new Set([id]));
  }

  delete(id: string) {
    const cur = this.objects.get(id);
    if (!cur) return;
    this.record(id, { ...cur }, null);
    this.rawDelete(id);
    this.notify(new Set([id]));
  }

  /** Batch variants used inside transactions for multi-object edits. */
  setMany(objs: SlateObj[]) {
    const changed = new Set<string>();
    for (const o of objs) {
      const before = this.objects.get(o.id) ?? null;
      this.record(o.id, before ? { ...before } : null, { ...o });
      this.rawSet(o);
      changed.add(o.id);
    }
    if (changed.size) this.notify(changed);
  }

  deleteMany(ids: string[]) {
    const changed = new Set<string>();
    for (const id of ids) {
      const cur = this.objects.get(id);
      if (!cur) continue;
      this.record(id, { ...cur }, null);
      this.rawDelete(id);
      changed.add(id);
    }
    if (changed.size) this.notify(changed);
  }

  /** Apply without recording history (used by load + undo/redo). */
  rawSet(obj: SlateObj) {
    this.objects.set(obj.id, obj);
    this.reindex(obj);
    this.dirty.set(obj.id, obj);
    if (obj.z >= this.zCounter) this.zCounter = Math.floor(obj.z) + 1;
    // connectors attached to this object need their index bounds refreshed
    this.refreshAttachedConnectors(obj.id);
  }

  rawDelete(id: string) {
    this.objects.delete(id);
    this.unindex(id);
    this.dirty.set(id, null);
  }

  private refreshAttachedConnectors(targetId: string) {
    for (const o of this.objects.values()) {
      if (o.type === 'connector' && (o.from.objectId === targetId || o.to.objectId === targetId)) {
        this.unindex(o.id);
        this.reindex(o);
      }
    }
  }

  load(objs: SlateObj[]) {
    this.objects.clear();
    this.index.clear();
    this.entries.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty.clear();
    for (const o of objs) {
      this.objects.set(o.id, o);
      if (o.z >= this.zCounter) this.zCounter = Math.floor(o.z) + 1;
    }
    for (const o of objs) this.reindex(o);
    this.notify(new Set(objs.map((o) => o.id)));
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    this.applySnapshot(cmd.before);
    this.redoStack.push(cmd);
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    this.applySnapshot(cmd.after);
    this.undoStack.push(cmd);
  }

  private applySnapshot(snap: Record<string, SlateObj | null>) {
    const changed = new Set<string>();
    for (const [id, obj] of Object.entries(snap)) {
      if (obj === null) this.rawDelete(id);
      else this.rawSet({ ...obj });
      changed.add(id);
    }
    this.notify(changed);
  }

  /** All connectors whose endpoints reference any of the given ids. */
  connectorsAttachedTo(ids: Set<string>): SlateObj[] {
    const out: SlateObj[] = [];
    for (const o of this.objects.values()) {
      if (
        o.type === 'connector' &&
        ((o.from.objectId && ids.has(o.from.objectId)) || (o.to.objectId && ids.has(o.to.objectId)))
      ) {
        out.push(o);
      }
    }
    return out;
  }

  /** Visible objects for a viewport box, z-sorted. Connectors are re-checked precisely. */
  visible(box: Box): SlateObj[] {
    const out = this.search(box);
    return out
      .filter((o) => boxesIntersect(aabbOf(o, this.resolve), box))
      .sort((a, b) => a.z - b.z);
  }
}

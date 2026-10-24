// Which board-meta writes count as "edits" (bump updatedAt → "Edited 2h ago")
// and which don't. Panning, zooming, a regenerated thumbnail, pinning, moving
// between projects or trashing aren't edits to the board, so they must not
// move its timestamp. Pure, so it's testable without IndexedDB.
import type { BoardMeta } from '../types';

export const NON_EDIT_FIELDS: ReadonlySet<string> = new Set<keyof BoardMeta>([
  'viewport',
  'thumb',
  'pinned',
  'projectId',
  'deletedAt',
]);

export function stampEdit(patch: Partial<BoardMeta>, now: number): Partial<BoardMeta> {
  const isEdit = Object.keys(patch).some((k) => k !== 'updatedAt' && !NON_EDIT_FIELDS.has(k));
  return isEdit ? { ...patch, updatedAt: now } : patch;
}

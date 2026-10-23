// Pure Git Sync decisions, split out so they're unit-testable without
// IndexedDB or a repo.
//
// Trash and sync: moving a board to Trash only sets meta.deletedAt — a board
// UPDATE. It syncs like any edit: the repo file stays, gains deletedAt, and
// every other machine shows the board in its Trash. Only "Delete forever" (a
// real row delete) removes the repo file.

export interface KnownBoard {
  pushedHash: string;
  remoteSha: string;
}

export type RemoteMissingAction = 'delete-local' | 'push';

/**
 * A local board has no file in the repo. `known` is what we last synced,
 * `localHash` the board's current content hash.
 *  - never synced → it's new here: push it.
 *  - synced, unchanged since → another machine deleted it forever: follow.
 *  - synced, but edited here since → keep it and push it back. Local work is
 *    never thrown away because the file disappeared (same rule as a push that
 *    finds the file gone: local wins, the file is recreated).
 */
export function remoteMissingAction(known: KnownBoard | undefined, localHash: string | null): RemoteMissingAction {
  if (!known?.remoteSha) return 'push';
  return localHash !== null && localHash !== known.pushedHash ? 'push' : 'delete-local';
}

/** Commit message for pushing a board file. */
export function boardCommitMessage(name: string, trashed: boolean): string {
  return trashed ? `slate: move "${name}" to trash` : `slate: update "${name}"`;
}

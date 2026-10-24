// Trash × Git Sync: a trashed board stays in the repo (as an update carrying
// deletedAt) until it's deleted forever; remote deletions never eat local edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardCommitMessage, remoteMissingAction } from '../src/store/gitsync/policy';
import { renderReadme, stableStringify, parseBoardFile, type BoardFile } from '../src/store/gitsync/serialize';
import type { BoardMeta, Project } from '../src/types';

const board = (id: string, extra: Partial<BoardMeta> = {}): BoardMeta => ({
  id, name: id, createdAt: 1, updatedAt: Date.UTC(2026, 9, 1), viewport: { x: 0, y: 0, zoom: 1 }, ...extra,
});

test('remote file missing: never-synced board is pushed (new here)', () => {
  assert.equal(remoteMissingAction(undefined, 'h1'), 'push');
});

test('remote file missing: synced + unchanged → deleted forever elsewhere, follow it', () => {
  assert.equal(remoteMissingAction({ pushedHash: 'h1', remoteSha: 's1' }, 'h1'), 'delete-local');
});

test('remote file missing: synced but edited here since → keep and push (no data loss)', () => {
  // before: any known board whose file vanished was hard-deleted locally, edits and all
  assert.equal(remoteMissingAction({ pushedHash: 'h1', remoteSha: 's1' }, 'h2'), 'push');
});

test('trashing changes the board file (so it is pushed) and the file still parses with deletedAt', () => {
  const live: BoardFile = { format: 'slate-git-board', version: 1, meta: board('b1'), objects: [], assets: {} };
  const trashed: BoardFile = { ...live, meta: { ...live.meta, deletedAt: 123 } };
  const a = stableStringify(live);
  const b = stableStringify(trashed);
  assert.notEqual(a, b); // new hash → flushBoard PUTs the file; nothing is deleted
  assert.equal(parseBoardFile(b).meta.deletedAt, 123);
  // restore = deletedAt removed → back to byte-identical live content
  const restored = { ...trashed, meta: { ...trashed.meta } };
  delete restored.meta.deletedAt;
  assert.equal(stableStringify(restored), a);
});

test('commit message says trash for a trashed board', () => {
  assert.equal(boardCommitMessage('Plan', true), 'slate: move "Plan" to trash');
  assert.equal(boardCommitMessage('Plan', false), 'slate: update "Plan"');
});

test('repo README lists trashed boards under Trash and orphans under General', () => {
  const projects: Project[] = [
    { id: 'p1', name: 'Client', createdAt: 1 },
    { id: 'p2', name: 'Old', createdAt: 2, deletedAt: 5 },
  ];
  const md = renderReadme(
    [
      board('live'),
      board('filed', { projectId: 'p1' }),
      board('orphan', { projectId: 'missing' }),
      board('inTrashedProject', { projectId: 'p2' }),
      board('binned', { deletedAt: 9 }),
    ],
    projects
  );
  const section = (h: string) => md.split(`## ${h}\n`)[1]?.split('\n## ')[0] ?? '';
  assert.match(section('General'), /\[live\]/);
  assert.match(section('General'), /\[orphan\]/);
  assert.match(section('General'), /\[inTrashedProject\]/);
  assert.match(section('Client'), /\[filed\]/);
  assert.match(section('Trash'), /\[binned\]/);
  assert.doesNotMatch(section('General'), /binned/);
  assert.doesNotMatch(md, /## Old/); // a trashed project gets no section
  for (const id of ['live', 'filed', 'orphan', 'inTrashedProject', 'binned']) {
    assert.equal(md.split(`(slate/boards/${id}.json)`).length - 1, 1, `${id} listed exactly once`);
  }
});

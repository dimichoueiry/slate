// Dashboard foundations: orphan-safe grouping, relative timestamps, undo toasts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupBoards } from '../src/store/boardGroups';
import { relativeTime } from '../src/store/relativeTime';
import { dismissToast, toast, useToasts, UNDO_TOAST_MS } from '../src/store/toasts';
import type { BoardMeta, Project } from '../src/types';

const board = (id: string, extra: Partial<BoardMeta> = {}): BoardMeta => ({
  id, name: id, createdAt: 1, updatedAt: 1, viewport: { x: 0, y: 0, zoom: 1 }, ...extra,
});
const project = (id: string, extra: Partial<Project> = {}): Project => ({ id, name: id, createdAt: 1, ...extra });

/** every live board id the dashboard renders, across all sections */
const shown = (g: ReturnType<typeof groupBoards>) => [...g.unfiled, ...[...g.byProject.values()].flat()].map((b) => b.id).sort();

// ---------- grouping ----------

test('old dashboard filter hid a board whose project is missing (the bug)', () => {
  // Home.tsx before: unfiled = !projectId; project sections only for existing projects
  const boards = [board('a'), board('b', { projectId: 'gone' })];
  const projects: Project[] = [];
  const oldShown = [
    ...boards.filter((b) => !b.projectId),
    ...projects.flatMap((p) => boards.filter((b) => b.projectId === p.id)),
  ].map((b) => b.id);
  assert.deepEqual(oldShown, ['a']); // 'b' is in IndexedDB but on no screen
});

test('a board whose project is missing shows under Unfiled', () => {
  const g = groupBoards([board('a'), board('b', { projectId: 'gone' })], []);
  assert.deepEqual(g.unfiled.map((b) => b.id), ['a', 'b']);
});

test('a board whose project is in Trash shows under Unfiled; restoring files it back', () => {
  const boards = [board('b', { projectId: 'p' })];
  const trashed = groupBoards(boards, [project('p', { deletedAt: 5 })]);
  assert.deepEqual(trashed.unfiled.map((b) => b.id), ['b']);
  assert.equal(trashed.byProject.has('p'), false);
  const restored = groupBoards(boards, [project('p')]);
  assert.deepEqual(restored.unfiled, []);
  assert.deepEqual(restored.byProject.get('p')!.map((b) => b.id), ['b']);
});

test('every live board is shown exactly once; trashed boards never are', () => {
  const boards = [
    board('a'),
    board('b', { projectId: 'p1' }),
    board('c', { projectId: 'p2' }),
    board('d', { projectId: 'missing' }),
    board('e', { deletedAt: 9 }),
    board('f', { projectId: 'p1', deletedAt: 9 }),
  ];
  const g = groupBoards(boards, [project('p1'), project('p2'), project('p3')]);
  assert.deepEqual(shown(g), ['a', 'b', 'c', 'd']);
  assert.deepEqual(g.byProject.get('p3'), []); // empty projects still get a section
});

// ---------- relative timestamps ----------

test('relativeTime buckets', () => {
  const now = new Date(2026, 9, 23, 16, 0, 0).getTime();
  const m = 60_000;
  assert.equal(relativeTime(now - 5_000, now), 'just now');
  assert.equal(relativeTime(now + 30_000, now), 'just now'); // small clock skew
  assert.equal(relativeTime(now - 3 * m, now), '3m ago');
  assert.equal(relativeTime(now - 2 * 60 * m, now), '2h ago');
  assert.equal(relativeTime(now - 25 * 60 * m, now), 'yesterday');
  assert.equal(relativeTime(now - 3 * 24 * 60 * m, now), '3d ago');
  assert.match(relativeTime(new Date(2026, 0, 2).getTime(), now), /Jan/);
  assert.match(relativeTime(new Date(2024, 0, 2).getTime(), now), /2024/);
});

// ---------- undo toast ----------

test('undo toast: shows ~6s, then dismisses itself', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(UNDO_TOAST_MS, 6000);
  let undone = false;
  const id = toast('“x” moved to Trash.', { action: { label: 'Undo', run: () => void (undone = true) } });
  assert.equal(useToasts.getState().toasts.length, 1);
  t.mock.timers.tick(5999);
  assert.equal(useToasts.getState().toasts.length, 1);
  t.mock.timers.tick(1);
  assert.equal(useToasts.getState().toasts.length, 0);
  assert.equal(undone, false);
  dismissToast(id); // idempotent
});

test('undo toast: action runs the undo and the toast is dismissable', () => {
  let undone = 0;
  const id = toast('moved', { action: { label: 'Undo', run: () => void undone++ } });
  const t = useToasts.getState().toasts.find((x) => x.id === id)!;
  void t.action!.run();
  dismissToast(id);
  assert.equal(undone, 1);
  assert.equal(useToasts.getState().toasts.some((x) => x.id === id), false);
});

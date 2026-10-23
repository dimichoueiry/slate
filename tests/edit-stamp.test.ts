// "Edited 2h ago" must reflect real edits only: pan/zoom, thumbnails, pinning,
// moving and trashing must not touch updatedAt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stampEdit } from '../src/store/editStamp';

const NOW = 1_800_000_000_000;

test('camera change (pan/zoom) does not bump updatedAt', () => {
  assert.deepEqual(stampEdit({ viewport: { x: 10, y: 20, zoom: 1.5 } }, NOW), { viewport: { x: 10, y: 20, zoom: 1.5 } });
});

test('thumbnail, pin, move and trash do not bump updatedAt', () => {
  for (const patch of [{ thumb: 'data:image/png;base64,x' }, { pinned: true }, { projectId: 'p1' }, { projectId: null }, { deletedAt: 5 }]) {
    assert.equal('updatedAt' in stampEdit(patch, NOW), false, JSON.stringify(patch));
  }
});

test('real edits bump updatedAt', () => {
  for (const patch of [{ name: 'Q3' }, { notes: '# hi' }, { style: 'messy' as const }, { canvasDark: true }, { brandKitId: 'k' }]) {
    assert.equal(stampEdit(patch, NOW).updatedAt, NOW, JSON.stringify(patch));
  }
});

test('a mixed patch with any real edit bumps updatedAt', () => {
  assert.equal(stampEdit({ viewport: { x: 0, y: 0, zoom: 1 }, name: 'x' }, NOW).updatedAt, NOW);
});

test('BoardView saves the camera through the viewport-only path', () => {
  // guards against regressing to updateBoardMeta({ viewport }) for camera saves
  const src = fs.readFileSync(path.resolve('src/components/BoardView.tsx'), 'utf8');
  assert.match(src, /saveBoardViewport\(boardId, \{ \.\.\.controller\.camera \}\)/);
  assert.doesNotMatch(src, /updateBoardMeta\(boardId, \{ viewport/);
  const db = fs.readFileSync(path.resolve('src/store/db.ts'), 'utf8');
  const fn = db.slice(db.indexOf('export async function saveBoardViewport'));
  assert.match(fn.slice(0, fn.indexOf('\n}')), /db\.boards\.update\(id, \{ viewport \}\)/);
});

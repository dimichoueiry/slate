// Drawing-style foundation: seeds, style resolution, dispatch and the drawable cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/engine/doc';
import {
  backfillSeeds,
  boardStyleOf,
  DRAW_STYLES,
  effectiveStyle,
  idSeed,
  isDrawStyle,
  isSeed,
  newSeed,
} from '../src/engine/style';
import {
  connectorDrawable,
  drawableCache,
  getStyleRenderer,
  shapeDrawable,
  styleRendererFor,
} from '../src/engine/styles';
import { DrawableCache } from '../src/engine/styles/cache';
import type { ConnectorObj, ShapeObj, SlateObj, StickyObj } from '../src/types';

const shape = (id: string, extra: Partial<ShapeObj> = {}): ShapeObj => ({
  id, type: 'shape', shape: 'rect', x: 10, y: 20, w: 160, h: 90, rotation: 0, z: 1,
  fill: 'transparent', stroke: '#1a1a1a', strokeWidth: 3, dash: 'solid', radius: 12, opacity: 1,
  text: '', textColor: '#1a1a1a', fontSize: 16, ...extra,
});
const sticky = (id: string, extra: Partial<StickyObj> = {}): StickyObj => ({
  id, type: 'sticky', x: 0, y: 0, w: 200, h: 180, rotation: 0, z: 2, color: '#F8DE7E', text: 'hi', fontSize: 18, ...extra,
});
const connector = (id: string, extra: Partial<ConnectorObj> = {}): ConnectorObj => ({
  id, type: 'connector', x: 0, y: 0, rotation: 0, z: 3, from: { point: { x: 0, y: 0 } }, to: { point: { x: 200, y: 80 } },
  routing: 'straight', stroke: '#1a1a1a', strokeWidth: 2, dash: 'solid', startArrow: 'none', endArrow: 'triangle', opacity: 1, ...extra,
});
/** what IndexedDB / the JSON files do to an object on save + load */
const saveLoad = <T,>(objs: T[]): T[] => JSON.parse(JSON.stringify(structuredClone(objs)));

// ---------- seeds ----------

test('seed is created once on creation and survives update, move, replace, undo/redo', () => {
  const doc = new Doc();
  const s = shape('s1');
  const n = sticky('n1');
  doc.set(s);
  doc.setMany([n]);
  const seedS = doc.get('s1')!.seed!;
  const seedN = doc.get('n1')!.seed!;
  assert.ok(isSeed(seedS) && isSeed(seedN), 'every type gets a 31-bit integer seed');
  assert.equal(s.seed, seedS, 'the caller’s object carries the seed too');

  doc.update('s1', { x: 400, y: 300 }); // move
  doc.update('s1', { w: 50, stroke: '#e03131', style: 'messy' }); // edit
  assert.equal(doc.get('s1')!.seed, seedS);
  const { seed: _drop, ...noSeed } = doc.get('s1')!;
  doc.set(noSeed as SlateObj); // a whole-object replace that forgot the seed
  assert.equal(doc.get('s1')!.seed, seedS);
  doc.undo();
  doc.undo();
  doc.redo();
  assert.equal(doc.get('s1')!.seed, seedS);
  assert.equal(doc.get('n1')!.seed, seedN);
});

test('seed is stable across save → load → update', () => {
  const doc = new Doc();
  doc.set(shape('s1'));
  doc.set(connector('c1'));
  const seeds = Object.fromEntries(doc.all().map((o) => [o.id, o.seed]));
  const reloaded = new Doc();
  reloaded.load(saveLoad(doc.all()));
  for (const o of reloaded.all()) assert.equal(o.seed, seeds[o.id]);
  reloaded.update('c1', { strokeWidth: 5 });
  const again = new Doc();
  again.load(saveLoad(reloaded.all()));
  assert.equal(again.get('c1')!.seed, seeds.c1);
});

test('explicit seeds are kept; brand-new objects get distinct random seeds', () => {
  const doc = new Doc();
  doc.set(shape('keep', { seed: 4242 }));
  assert.equal(doc.get('keep')!.seed, 4242);
  const seeds = new Set(Array.from({ length: 50 }, () => newSeed()));
  assert.ok(seeds.size > 45);
  for (const s of seeds) assert.ok(isSeed(s));
});

test('old objects are backfilled with a deterministic id-derived seed on load', () => {
  // the FNV-1a fallback the sketch renderer always used for seedless objects
  assert.equal(idSeed('legacy-A'), 219680088);
  const old = [shape('legacy-A'), sticky('legacy-B'), shape('has-seed', { seed: 7 })];
  const d1 = new Doc();
  d1.load(saveLoad(old));
  const d2 = new Doc();
  d2.load(saveLoad(old));
  assert.equal(d1.get('legacy-A')!.seed, 219680088);
  assert.equal(d1.get('legacy-B')!.seed, idSeed('legacy-B'));
  assert.equal(d1.get('legacy-B')!.seed, d2.get('legacy-B')!.seed, 'same on every load');
  assert.equal(d1.get('has-seed')!.seed, 7, 'existing seeds are never replaced');
  // the persistence-side helper (db.loadBoardObjects) agrees
  const rows = backfillSeeds(saveLoad(old));
  assert.deepEqual(rows.map((o) => o.seed), [219680088, idSeed('legacy-B'), 7]);
});

// ---------- style resolution ----------

test('effective style = object.style ?? board.style; old boards read as sketch', () => {
  assert.deepEqual([...DRAW_STYLES], ['sketch', 'handdrawn', 'messy']);
  assert.equal(boardStyleOf(undefined), 'sketch');
  assert.equal(boardStyleOf({}), 'sketch');
  assert.equal(boardStyleOf({ style: 'messy' }), 'messy');
  assert.equal(boardStyleOf({ style: 'bogus' as never }), 'sketch');
  assert.equal(effectiveStyle({}, 'handdrawn'), 'handdrawn');
  assert.equal(effectiveStyle({ style: 'messy' }, 'handdrawn'), 'messy');
  assert.equal(effectiveStyle({ style: undefined }, 'messy'), 'messy');
  assert.equal(effectiveStyle({ style: 'nope' }, 'handdrawn'), 'handdrawn');
  assert.equal(effectiveStyle({}, undefined), 'sketch');
  assert.ok(isDrawStyle('sketch') && !isDrawStyle('Sketch') && !isDrawStyle(null));
  assert.equal(new Doc().style, 'sketch');
});

test('getStyleRenderer dispatches by style; every style has a palette and a font', () => {
  for (const st of DRAW_STYLES) {
    const sr = getStyleRenderer(st);
    assert.equal(sr.id, st);
    assert.ok(sr.palette.length > 0 && sr.stickyPalette.length > 0);
    assert.ok(sr.fontStack.length > 0 && sr.defaultFontId.length > 0);
  }
  assert.equal(getStyleRenderer(undefined).id, 'sketch');
  assert.equal(styleRendererFor({ style: 'messy' }, 'sketch').id, 'messy');
  assert.equal(styleRendererFor({}, 'handdrawn').id, 'handdrawn');
});

test('the messy stub currently draws exactly like sketch', () => {
  const s = shape('stub', { seed: 99, shape: 'ellipse', fill: '#ffd43b' });
  const c = connector('stubc', { seed: 5, routing: 'curved' });
  const pts = [{ x: 0, y: 0 }, { x: 70, y: 10 }, { x: 140, y: 60 }, { x: 200, y: 80 }];
  const ref = { s: shapeDrawable(s, 'sketch'), c: connectorDrawable(c, pts, 'sketch') };
  for (const st of ['messy'] as const) {
    assert.deepEqual(shapeDrawable(s, st), ref.s);
    assert.deepEqual(connectorDrawable(c, pts, st), ref.c);
  }
});

// ---------- drawable cache ----------

test('DrawableCache returns the same value for the same key and regenerates on a new key', () => {
  const cache = new DrawableCache<object>();
  let made = 0;
  const make = () => ({ n: ++made });
  const a = cache.get('x', 'k1', make);
  assert.equal(cache.get('x', 'k1', make), a);
  assert.equal(made, 1);
  const b = cache.get('x', 'k2', make);
  assert.notEqual(b, a);
  assert.equal(made, 2);
  cache.evict('x');
  assert.ok(!cache.has('x'));
});

test('shape drawables are reused for unchanged keys and regenerate on geometry, seed or style change', () => {
  const s = shape('cache-s', { seed: 1 });
  const first = shapeDrawable(s, 'sketch');
  assert.equal(shapeDrawable({ ...s }, 'sketch'), first, 'new object instance, same key → same drawable');
  assert.equal(shapeDrawable({ ...s, text: 'label', z: 9 }, 'sketch'), first, 'non-geometry edits reuse it');

  const moved = shapeDrawable({ ...s, x: s.x + 5 }, 'sketch');
  assert.notEqual(moved, first, 'geometry change regenerates');
  assert.notDeepEqual(moved, first);
  const reseeded = shapeDrawable({ ...s, x: s.x + 5, seed: 2 }, 'sketch');
  assert.notEqual(reseeded, moved, 'seed change regenerates');
  assert.notDeepEqual(reseeded, moved);
  const restyledObj = shapeDrawable({ ...s, x: s.x + 5, seed: 2, style: 'messy' }, 'sketch');
  assert.notEqual(restyledObj, reseeded, 'object style change regenerates');
  const restyledBoard = shapeDrawable({ ...s, x: s.x + 5, seed: 2 }, 'handdrawn');
  assert.notEqual(restyledBoard, restyledObj, 'board style change regenerates');
  const stroked = shapeDrawable({ ...s, x: s.x + 5, seed: 2, strokeWidth: 6 }, 'handdrawn');
  assert.notEqual(stroked, restyledBoard, 'style option change regenerates');
  assert.equal(shapeDrawable({ ...s, x: s.x + 5, seed: 2, strokeWidth: 6 }, 'handdrawn'), stroked);
});

test('connector drawables regenerate when the route or seed changes', () => {
  const c = connector('cache-c', { seed: 3 });
  const pts = [{ x: 0, y: 0 }, { x: 200, y: 80 }];
  const a = connectorDrawable(c, pts, 'sketch');
  assert.equal(connectorDrawable({ ...c }, pts.map((p) => ({ ...p })), 'sketch'), a);
  assert.notEqual(connectorDrawable(c, [{ x: 0, y: 0 }, { x: 210, y: 80 }], 'sketch'), a);
  assert.notEqual(connectorDrawable({ ...c, seed: 4 }, [{ x: 0, y: 0 }, { x: 210, y: 80 }], 'sketch'), a);
});

test('deleting an object evicts its cached drawables', () => {
  const doc = new Doc();
  const s = shape('evict-me');
  doc.set(s);
  shapeDrawable(doc.get('evict-me') as ShapeObj, doc.style);
  assert.ok(drawableCache.has('evict-me'));
  doc.delete('evict-me');
  assert.ok(!drawableCache.has('evict-me'));
});

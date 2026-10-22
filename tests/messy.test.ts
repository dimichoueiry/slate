// 'messy' style: determinism, roughjs options per primitive (checked against
// roughjs itself with the spec values written out literally), open chevrons,
// hachure defaults, cache keys, palette/fonts, and that 'sketch' is untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import rough from 'roughjs';
import { setStyleInk } from '../src/engine/style';
import { connectorDrawable, drawFontId, drawFontWeight, getStyleRenderer, labelFontOf, shapeDrawable } from '../src/engine/styles';
import { curvePoints, messyStyle } from '../src/engine/styles/messy';
import type { StrokeStyle, StyledPath } from '../src/engine/styles/types';
import { chevronArms } from '../src/engine/styles/geom';
import type { ConnectorObj, ShapeObj, Vec } from '../src/types';

const gen = rough.generator();
type Opts = Parameters<typeof gen.path>[1];
const ds = (d: ReturnType<typeof gen.path>) => gen.toPaths(d).map((p) => p.d);
const dOf = (paths: StyledPath[]) => paths.map((p) => p.d);
const tuple = (p: Vec) => [p.x, p.y] as [number, number];

const st = (extra: Partial<StrokeStyle> = {}): StrokeStyle => ({
  seed: 1234, stroke: '#1a1a1a', strokeWidth: 2, dash: 'solid', fill: 'transparent', size: { w: 200, h: 120 }, ...extra,
});
const shape = (id: string, extra: Partial<ShapeObj> = {}): ShapeObj => ({
  id, type: 'shape', shape: 'rect', x: 10, y: 20, w: 160, h: 90, rotation: 0, z: 1, seed: 77,
  fill: 'transparent', stroke: '#1a1a1a', strokeWidth: 2, dash: 'solid', radius: 12, opacity: 1,
  text: '', textColor: '#1a1a1a', fontSize: 16, ...extra,
});
const connector = (id: string, extra: Partial<ConnectorObj> = {}): ConnectorObj => ({
  id, type: 'connector', x: 0, y: 0, rotation: 0, z: 3, seed: 5, from: { point: { x: 0, y: 0 } }, to: { point: { x: 200, y: 80 } },
  routing: 'straight', stroke: '#1a1a1a', strokeWidth: 2, dash: 'solid', startArrow: 'none', endArrow: 'triangle', opacity: 1, ...extra,
});
const line: Vec[] = [{ x: 0, y: 0 }, { x: 120, y: 40 }, { x: 220, y: 40 }];
const longLine: Vec[] = [{ x: 0, y: 0 }, { x: 500, y: 0 }];
// 25 samples of one cubic, like geometry.routeConnector's curved route
const curvePts: Vec[] = Array.from({ length: 25 }, (_, i) => {
  const t = i / 24;
  return { x: 300 * t, y: 120 * t * t * (3 - 2 * t) };
});
const tri: Vec[] = [{ x: 0, y: 100 }, { x: 60, y: 0 }, { x: 120, y: 100 }];

/** every primitive with one seed */
const allPrimitives = (seed: number) => {
  const s = st({ seed, fill: '#1971c2' });
  return [
    messyStyle.rect(0, 0, 200, 120, s),
    messyStyle.roundedRect(0, 0, 200, 120, 20, s),
    messyStyle.ellipse(100, 60, 200, 120, s),
    messyStyle.ellipse(100, 60, 200, 120, { ...s, hasText: true }),
    messyStyle.polygon(tri, s),
    messyStyle.polyline(line, st({ seed })),
    messyStyle.curve(curvePts, st({ seed })),
    messyStyle.arrowhead({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, st({ seed })),
  ];
};

// ---------- determinism ----------

test('same seed → identical drawables and paths; a different seed → different ones', () => {
  const a = allPrimitives(1234);
  const b = allPrimitives(1234);
  assert.deepEqual(a, b);
  const c = allPrimitives(98765);
  a.forEach((paths, i) => assert.notDeepEqual(dOf(paths), dOf(c[i]), `primitive #${i} must change with the seed`));
});

test('every fill pattern is deterministic per seed (roughjs dots use bare Math.random)', () => {
  for (const fillStyle of ['hachure', 'solid', 'zigzag', 'dots', 'cross-hatch'] as const) {
    const s = st({ fill: '#868e96', fillStyle });
    const a = dOf(messyStyle.polygon(tri, s));
    Math.random(); // advance the global RNG between runs
    assert.deepEqual(dOf(messyStyle.polygon(tri, s)), a, `${fillStyle} repeats`);
    if (fillStyle !== 'solid') assert.notDeepEqual(dOf(messyStyle.polygon(tri, { ...s, seed: s.seed + 1 })), a, `${fillStyle} follows the seed`);
  }
  const r = Math.random;
  messyStyle.rect(0, 0, 50, 50, st({ fill: '#868e96', fillStyle: 'dots' }));
  assert.equal(Math.random, r, 'Math.random is restored');
});

test('the object’s stored seed drives the drawable (cache cleared between runs)', () => {
  const o = shape('det', { fill: '#2f9e44', seed: 4242 });
  const first = JSON.stringify(shapeDrawable(o, 'messy'));
  const again = JSON.stringify(shapeDrawable({ ...o, id: 'det-2' }, 'messy'));
  assert.equal(again, first, 'same seed on another object id → same paths (id is not a randomness source)');
  assert.notEqual(JSON.stringify(shapeDrawable({ ...o, id: 'det-3', seed: 4243 }, 'messy')), first);
});

// ---------- roughjs options per primitive (spec values written literally) ----------

test('lines: roughness 1.6, bowing 2, strokeWidth 2, multi-stroke on, seed passed', () => {
  const opts: Opts = { seed: 1234, roughness: 1.6, bowing: 2, stroke: '#1a1a1a', strokeWidth: 2, disableMultiStroke: false };
  const out = messyStyle.polyline(line, st());
  assert.deepEqual(dOf(out), ds(gen.linearPath(line.map(tuple), opts)));
  assert.ok(out.every((p) => p.strokeWidth === 2 && p.isBorder && !p.dash));
  // multi-stroke: roughjs draws each segment twice → two moveTos per segment
  assert.equal((out[0].d.match(/M/g) ?? []).length, 2 * (line.length - 1));
});

test('emphasized lines are 2.8 wide; axes / long lines use roughness 1.8', () => {
  const thick = messyStyle.polyline(line, st({ strokeWidth: 3 }));
  assert.ok(thick.every((p) => p.strokeWidth === 2.8));
  const long = messyStyle.polyline(longLine, st());
  const opts: Opts = { seed: 1234, roughness: 1.8, bowing: 2, stroke: '#1a1a1a', strokeWidth: 2, disableMultiStroke: false };
  assert.deepEqual(dOf(long), ds(gen.linearPath(longLine.map(tuple), opts)));
});

test('dashed lines: strokeLineDash [10, 8] at roughness 1.3', () => {
  const opts: Opts = { seed: 1234, roughness: 1.3, bowing: 2, stroke: '#1a1a1a', strokeWidth: 2, disableMultiStroke: false, strokeLineDash: [10, 8] };
  const out = messyStyle.polyline(line, st({ dash: 'dashed' }));
  assert.deepEqual(dOf(out), ds(gen.linearPath(line.map(tuple), opts)));
  assert.ok(out.every((p) => JSON.stringify(p.dash) === '[10,8]'), 'the dash pattern rides on the path for canvas + SVG');
});

test('curved connectors: rough curve() through the route points at roughness 1.5', () => {
  const opts: Opts = { seed: 1234, roughness: 1.5, bowing: 2, stroke: '#1a1a1a', strokeWidth: 2, disableMultiStroke: false };
  const through = curvePoints(curvePts);
  assert.deepEqual(dOf(messyStyle.curve(curvePts, st())), ds(gen.curve(through.map(tuple), opts)));
  // through route points only (thinned to ~40px apart so the jitter doesn't squiggle), ends kept
  assert.ok(through.every((p) => curvePts.includes(p)));
  assert.equal(through[0], curvePts[0]);
  assert.equal(through[through.length - 1], curvePts[curvePts.length - 1]);
  assert.ok(through.length >= 5 && through.length < curvePts.length, `${through.length} of ${curvePts.length} points`);
});

test('rects and polygons: roughness 1.6, fill drawn separately with stroke none', () => {
  const s = st({ fill: '#1971c2' });
  const fill: Opts = {
    seed: 1234, roughness: 1.6, bowing: 1, stroke: 'none', fill: 'rgba(25,113,194,0.45)', fillStyle: 'hachure',
    hachureGap: 9, hachureAngle: -41, fillWeight: 1.3,
  };
  const outline: Opts = { seed: 1234, roughness: 1.6, bowing: 1, stroke: '#1a1a1a', strokeWidth: 2, disableMultiStroke: false };
  assert.deepEqual(dOf(messyStyle.rect(0, 0, 200, 120, s)), [...ds(gen.rectangle(0, 0, 200, 120, fill)), ...ds(gen.rectangle(0, 0, 200, 120, outline))]);
  assert.deepEqual(dOf(messyStyle.polygon(tri, s)), [...ds(gen.polygon(tri.map(tuple), fill)), ...ds(gen.polygon(tri.map(tuple), outline))]);
});

test('"circled answer" ellipse around text: roughness 2.2, strokeWidth 2, ~10% larger than its box', () => {
  const s = st({ strokeWidth: 3, hasText: true });
  const opts: Opts = { seed: 1234, roughness: 2.2, bowing: 1, stroke: '#1a1a1a', strokeWidth: 2, disableMultiStroke: false };
  const out = messyStyle.ellipse(100, 60, 200, 120, s);
  assert.deepEqual(dOf(out), ds(gen.ellipse(100, 60, 200 * 1.1, 120 * 1.1, opts)));
  assert.ok(out.every((p) => p.strokeWidth === 2));
  // without text it is a plain shape: box-sized, roughness 1.6
  const plain: Opts = { seed: 1234, roughness: 1.6, bowing: 1, stroke: '#1a1a1a', strokeWidth: 2.8, disableMultiStroke: false };
  assert.deepEqual(dOf(messyStyle.ellipse(100, 60, 200, 120, { ...s, hasText: false })), ds(gen.ellipse(100, 60, 200, 120, plain)));
});

test('small marker circles (d≈16): roughness 1.4, strokeWidth 1.7; filled ones cross-hatch at gap 3', () => {
  const s = st({ size: { w: 16, h: 16 }, fill: '#e8590c' });
  const fill: Opts = {
    seed: 1234, roughness: 1.4, bowing: 1, stroke: 'none', fill: 'rgba(232,89,12,0.45)', fillStyle: 'cross-hatch',
    hachureGap: 3, hachureAngle: -41, fillWeight: 1,
  };
  const outline: Opts = { seed: 1234, roughness: 1.4, bowing: 1, stroke: '#1a1a1a', strokeWidth: 1.7, disableMultiStroke: false };
  assert.deepEqual(dOf(messyStyle.ellipse(8, 8, 16, 16, s)), [...ds(gen.ellipse(8, 8, 16, 16, fill)), ...ds(gen.ellipse(8, 8, 16, 16, outline))]);
});

// ---------- arrowheads ----------

test('arrowheads are open chevrons: one 3-point linearPath at roughness 1.1, never filled', () => {
  const from = { x: 0, y: 0 };
  const tip = { x: 100, y: 0 };
  const [a, b] = chevronArms(from, tip, 20);
  const opts: Opts = { seed: 1234, roughness: 1.1, bowing: 1, stroke: '#1a1a1a', strokeWidth: 2, disableMultiStroke: false };
  const head = messyStyle.arrowhead(from, tip, 20, st());
  assert.deepEqual(dOf(head), ds(gen.linearPath([tuple(a), tuple(tip), tuple(b)], opts)));
  for (const p of head) {
    assert.equal(p.fill, 'none', 'no fill');
    assert.ok(!/z/i.test(p.d), 'path never closes');
    assert.equal(p.stroke, '#1a1a1a');
  }
  // a whole connector with 'triangle' heads at both ends still has no filled path
  const c = connectorDrawable(connector('heads', { startArrow: 'triangle' }), [{ x: 0, y: 0 }, { x: 200, y: 80 }], 'messy');
  assert.ok(c.length >= 3 && c.every((p) => p.fill === 'none'));
});

// ---------- fills ----------

test('hachure defaults: gap 9, angle -41, weight 1.3, fill at 45% alpha, only the hatching strokes', () => {
  const out = messyStyle.rect(0, 0, 200, 120, st({ fill: '#1971c2' }));
  const fills = out.filter((p) => !p.isBorder);
  assert.ok(fills.length > 0);
  for (const p of fills) {
    assert.equal(p.stroke, 'rgba(25,113,194,0.45)');
    assert.equal(p.strokeWidth, 1.3);
    assert.equal(p.fill, 'none', 'hachure is strokes, not an area');
  }
  // hachureAngle -41: roughjs measures it from the vertical, so on screen (y down) the
  // lines run at -(90 + angle) = -49° from the x axis. Check the median rough stroke.
  const angles = fills[0].d
    .split('M')
    .filter(Boolean)
    .map((sp) => sp.trim().split(/[ ,C]+/).filter(Boolean).map(Number))
    .filter((n) => Math.hypot(n[n.length - 2] - n[0], n[n.length - 1] - n[1]) > 10)
    .map((n) => (Math.atan2(n[n.length - 1] - n[1], n[n.length - 2] - n[0]) * 180) / Math.PI)
    .sort((x, y) => x - y);
  assert.ok(angles.length > 10, `${angles.length} hatch lines`);
  const median = angles[Math.floor(angles.length / 2)];
  assert.ok(Math.abs(median - -(90 + -41)) < 6, `median hatch angle ${median.toFixed(1)}°`);
  // gap 9: a 200x120 box crossed at that angle holds about (200·sin41 + 120·cos41) / 9 ≈ 25
  // lines, each drawn twice (roughjs multi-stroke fill, kept on for the marker look)
  assert.ok(angles.length >= 40 && angles.length <= 60, `${angles.length} strokes at gap 9`);
  // no fill → no fill paths at all
  assert.ok(messyStyle.rect(0, 0, 200, 120, st()).every((p) => p.isBorder));
});

test('fill picker values: solid is an opaque area, zigzag / dots / cross-hatch are patterns', () => {
  const s = st({ fill: '#2f9e44' });
  const solid = messyStyle.rect(0, 0, 200, 120, { ...s, fillStyle: 'solid' }).filter((p) => !p.isBorder);
  assert.ok(solid.length === 1 && solid[0].fill === '#2f9e44' && solid[0].stroke === 'none');
  const outs = (['hachure', 'zigzag', 'dots', 'cross-hatch'] as const).map((fillStyle) => dOf(messyStyle.rect(0, 0, 200, 120, { ...s, fillStyle })));
  for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) assert.notDeepEqual(outs[i], outs[j]);
  assert.deepEqual([...(messyStyle.fillStyles ?? [])], ['hachure', 'solid', 'zigzag', 'dots', 'cross-hatch']);
  assert.deepEqual([...(getStyleRenderer('sketch').fillStyles ?? [])], [], 'sketch offers no fill-pattern picker');
});

test('cache key includes the fill style', () => {
  const o = shape('cache-fill', { fill: '#1971c2' });
  const a = shapeDrawable(o, 'messy');
  assert.equal(shapeDrawable({ ...o }, 'messy'), a);
  const z = shapeDrawable({ ...o, fillStyle: 'zigzag' }, 'messy');
  assert.notEqual(z, a);
  assert.notDeepEqual(z, a);
  assert.equal(shapeDrawable({ ...o, fillStyle: 'zigzag' }, 'messy'), z);
  const h = shapeDrawable({ ...o, fillStyle: 'hachure' }, 'messy');
  assert.notEqual(h, z, 'switching back regenerates');
  assert.deepEqual(h, a, 'explicit hachure = the default');
  // the label toggles the circled-highlight ellipse, so it is part of the key too
  const e = shape('cache-ell', { shape: 'ellipse' });
  const bare = shapeDrawable(e, 'messy');
  assert.notDeepEqual(shapeDrawable({ ...e, text: '42' }, 'messy'), bare);
});

// ---------- palette + text ----------

test('palette: ink follows the canvas theme, then blue, orange, green, gray', () => {
  setStyleInk('#1a1a1a');
  assert.deepEqual([...messyStyle.palette], ['#1a1a1a', '#1971c2', '#e8590c', '#2f9e44', '#868e96']);
  setStyleInk('#e8e6f0'); // dark board
  assert.equal(messyStyle.palette[0], '#e8e6f0');
  setStyleInk('#1a1a1a');
});

test('text: Caveat everywhere, bold at key-number size, 19px labels; measured with the same face', () => {
  assert.equal(messyStyle.fontId('inter'), 'caveat');
  assert.equal(messyStyle.fontId(undefined), 'caveat');
  assert.equal(messyStyle.fontWeight(22, 400), 400);
  assert.equal(messyStyle.fontWeight(18, 500), 400, 'sticky 500 → Caveat Regular (only 400/700 are bundled)');
  assert.equal(messyStyle.fontWeight(32, 400), 700);
  assert.deepEqual(labelFontOf(messyStyle), { size: 19, weight: 400 });
  assert.equal(drawFontId({}, 'messy'), 'caveat', 'labels (no fontFamily) are Caveat too');
  assert.equal(drawFontId({ fontFamily: 'inter' }, 'messy'), 'caveat');
  assert.equal(drawFontWeight({ fontSize: 32 }, 'messy', 400), 700);
  // sketch keeps the object's own font and the caller's weight
  assert.equal(drawFontId({ fontFamily: 'inter' }, 'sketch'), 'inter');
  assert.equal(drawFontWeight({ fontSize: 32 }, 'sketch', 500), 500);
  // styles without a weight / label override keep the caller's weight and the 13px/500 label
  assert.equal(drawFontWeight({ fontSize: 32 }, 'handdrawn', 500), 500);
  assert.deepEqual(labelFontOf(getStyleRenderer('sketch')), { size: 13, weight: 500 });
  assert.deepEqual(labelFontOf(getStyleRenderer('handdrawn')), { size: 13, weight: 500 });
});

// ---------- sketch is untouched ----------

/** Golden hash of the sketch drawables below, computed against main @ ced3454 (before this style). */
const SKETCH_GOLDEN = 'cb85f983111014ca4f4d17a4fa798a817d5ad54e2621be5ff7ee91b5d4e8ec2a';

export function sketchFixture() {
  const objs: ShapeObj[] = [
    shape('g-rect', { seed: 11, fill: '#a5d8ff', strokeWidth: 3 }),
    shape('g-rrect', { seed: 12, shape: 'roundedRect', adaptiveRadius: true, dash: 'dashed' }),
    shape('g-ell', { seed: 13, shape: 'ellipse', fill: '#ffd43b', text: 'circled' }),
    shape('g-tri', { seed: 14, shape: 'triangle', dash: 'dotted' }),
    shape('g-tiny', { seed: 15, w: 14, h: 12 }),
  ];
  const conns: [ConnectorObj, Vec[]][] = [
    [connector('g-c1', { seed: 21 }), line],
    [connector('g-c2', { seed: 22, routing: 'curved', startArrow: 'triangle' }), curvePts],
    [connector('g-c3', { seed: 23, dash: 'dashed', endArrow: 'chevron' }), longLine],
  ];
  return JSON.stringify([...objs.map((o) => shapeDrawable(o, 'sketch')), ...conns.map(([c, pts]) => connectorDrawable(c, pts, 'sketch'))]);
}

test("'sketch' drawables are byte-identical to main", () => {
  const hash = createHash('sha256').update(sketchFixture()).digest('hex');
  assert.equal(hash, SKETCH_GOLDEN);
});

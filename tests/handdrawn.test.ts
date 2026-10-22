// 'handdrawn' style: determinism, bowed quadratics, ellipse overshoot, open
// chevrons, fonts — and that adding it left 'sketch' byte-identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { connectorDrawable, getStyleRenderer, shapeDrawable, type StrokeStyle } from '../src/engine/styles';
import { ellipseStroke, handdrawnStyle, HANDDRAWN_PALETTE, penDash, PEN_FONT_ID } from '../src/engine/styles/handdrawn';
import { fontStack, type ConnectorObj, type ShapeObj } from '../src/types';

const shape = (id: string, extra: Partial<ShapeObj> = {}): ShapeObj => ({
  id, type: 'shape', shape: 'rect', x: 10, y: 20, w: 160, h: 90, rotation: 0, z: 1,
  fill: 'transparent', stroke: '#1a1a1a', strokeWidth: 2, dash: 'solid', radius: 12, opacity: 1,
  text: '', textColor: '#1a1a1a', fontSize: 16, ...extra,
});
const connector = (id: string, extra: Partial<ConnectorObj> = {}): ConnectorObj => ({
  id, type: 'connector', x: 0, y: 0, rotation: 0, z: 3, from: { point: { x: 0, y: 0 } }, to: { point: { x: 200, y: 80 } },
  routing: 'straight', stroke: '#1a1a1a', strokeWidth: 2, dash: 'solid', startArrow: 'none', endArrow: 'triangle', opacity: 1, ...extra,
});
const style = (seed: number, extra: Partial<StrokeStyle> = {}): StrokeStyle => ({
  seed, stroke: '#1a1a1a', strokeWidth: 2, dash: 'solid', fill: 'transparent', size: { w: 100, h: 100 }, ...extra,
});
const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

/** Distance from p to the line through a and b. */
const offChord = (p: number[], a: number[], b: number[]) =>
  Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]);

const SHAPES = ['rect', 'roundedRect', 'ellipse', 'diamond', 'triangle'] as const;

test('same seed gives identical path data; a different seed gives different data', () => {
  for (const kind of SHAPES) {
    const a = shapeDrawable(shape(`a-${kind}`, { seed: 42, shape: kind, fill: '#a5d8ff' }), 'handdrawn');
    const b = shapeDrawable(shape(`b-${kind}`, { seed: 42, shape: kind, fill: '#a5d8ff' }), 'handdrawn');
    const c = shapeDrawable(shape(`c-${kind}`, { seed: 43, shape: kind, fill: '#a5d8ff' }), 'handdrawn');
    assert.deepEqual(a, b, `${kind}: same seed, same paths (ids differ)`);
    assert.notDeepEqual(a.map((p) => p.d), c.map((p) => p.d), `${kind}: new seed, new paths`);
  }
  const pts = [{ x: 0, y: 0 }, { x: 70, y: 10 }, { x: 140, y: 60 }, { x: 200, y: 80 }];
  for (const routing of ['straight', 'elbow', 'curved'] as const) {
    const p = routing === 'straight' ? [pts[0], pts[3]] : pts;
    const a = connectorDrawable(connector(`a-${routing}`, { seed: 7, routing }), p, 'handdrawn');
    const b = connectorDrawable(connector(`b-${routing}`, { seed: 7, routing }), p, 'handdrawn');
    const c = connectorDrawable(connector(`c-${routing}`, { seed: 8, routing }), p, 'handdrawn');
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.map((x) => x.d), c.map((x) => x.d));
  }
});

test('no Math.random: output is a pure function of the seed', () => {
  const real = Math.random;
  Math.random = () => {
    throw new Error('handdrawn must not call Math.random');
  };
  try {
    for (const kind of SHAPES) shapeDrawable(shape(`rnd-${kind}`, { seed: 3, shape: kind, fill: '#a5d8ff' }), 'handdrawn');
    connectorDrawable(connector('rnd-c', { seed: 3, routing: 'curved' }), [{ x: 0, y: 0 }, { x: 70, y: 10 }, { x: 140, y: 60 }, { x: 200, y: 80 }], 'handdrawn');
  } finally {
    Math.random = real;
  }
});

test('a straight line is a single Q segment bowed 2-4px off its chord', () => {
  for (let seed = 0; seed < 200; seed++) {
    const [p] = handdrawnStyle.polyline([{ x: 70, y: 362 }, { x: 595, y: 361 }], style(seed));
    assert.match(p.d, /^M[-\d. ]+ Q[-\d. ]+$/, p.d);
    assert.equal((p.d.match(/Q/g) ?? []).length, 1);
    const [x0, y0, cx, cy, x1, y1] = nums(p.d);
    assert.deepEqual([x0, y0, x1, y1], [70, 362, 595, 361], 'ends exactly on its endpoints');
    const bow = offChord([cx, cy], [x0, y0], [x1, y1]);
    assert.ok(bow >= 2 - 0.1 && bow <= 4 + 0.1, `seed ${seed}: bow ${bow}`);
    assert.equal(p.strokeWidth, 2);
    assert.equal(p.fill, 'none');
  }
});

test('rect: four single-stroke bowed edges, each 0-3px past or short of its corners', () => {
  for (let seed = 0; seed < 100; seed++) {
    const out = handdrawnStyle.rect(100, 100, 200, 120, style(seed));
    assert.equal(out.length, 1, 'no fill, single stroke path — never a double pass');
    const subs = out[0].d.split('M').filter(Boolean).map(nums);
    assert.equal(subs.length, 4);
    const corners = [[100, 100], [300, 100], [300, 220], [100, 220]];
    subs.forEach(([ax, ay, cx, cy, bx, by], i) => {
      const [s, e] = [corners[i], corners[(i + 1) % 4]];
      assert.ok(Math.hypot(ax - s[0], ay - s[1]) <= 3.05, `start miss ${seed}/${i}`);
      assert.ok(Math.hypot(bx - e[0], by - e[1]) <= 3.05, `end miss ${seed}/${i}`);
      const bow = offChord([cx, cy], s, e);
      assert.ok(bow >= 1.9 && bow <= 4.1, `edge bow ${bow}`);
    });
  }
});

test('fills are solid or none (never hatched); pure white/black are not in the palette', () => {
  const filled = handdrawnStyle.rect(0, 0, 100, 60, style(1, { fill: '#a5d8ff' }));
  assert.equal(filled.length, 2);
  assert.equal(filled[0].fill, '#a5d8ff');
  assert.equal(filled[0].stroke, 'none');
  assert.equal((filled[0].d.match(/M/g) ?? []).length, 1, 'one solid region, no hachure lines');
  assert.deepEqual([...HANDDRAWN_PALETTE], ['#1a1a1a', '#1971c2', '#e8590c', '#2f9e44', '#868e96', '#a5d8ff']);
  for (const c of HANDDRAWN_PALETTE) assert.ok(!/^#(000|000000|fff|ffffff)$/i.test(c));
});

test('ellipse: 4 cubics plus a 5-10° overshoot past its start', () => {
  for (let seed = 0; seed < 200; seed++) {
    const [p] = handdrawnStyle.ellipse(200, 200, 200, 200, style(seed));
    assert.equal((p.d.match(/C/g) ?? []).length, 5, '4 quarter arcs + the closing tail');
    const v = nums(p.d);
    const start = Math.atan2(v[1] - 200, v[0] - 200);
    const end = Math.atan2(v[v.length - 1] - 200, v[v.length - 2] - 200);
    let past = ((end - start) * 180) / Math.PI;
    past = ((past % 360) + 360) % 360;
    assert.ok(past >= 5 - 0.2 && past <= 10 + 0.2, `seed ${seed}: overshoot ${past}°`);
    const { overshoot } = ellipseStroke(seed);
    assert.ok(Math.abs(past - (overshoot * 180) / Math.PI) < 0.2);
    // the start anchor sits within 3% of the radius (+0.1px path rounding)
    const r0 = Math.hypot(v[0] - 200, v[1] - 200);
    assert.ok(r0 >= 96.9 && r0 <= 103.1, `start radius ${r0}`);
  }
});

test('small marker circles: stroke 2 and no fill', () => {
  const out = handdrawnStyle.ellipse(50, 50, 30, 30, style(9, { strokeWidth: 4, fill: '#a5d8ff' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].strokeWidth, 2);
  assert.equal(out[0].fill, 'none');
});

test('arrowheads are open chevrons: two short strokes, same color and width, never filled', () => {
  const c = connector('arrow', { seed: 11, stroke: '#1971c2', startArrow: 'triangle', endArrow: 'triangle' });
  const paths = connectorDrawable(c, [{ x: 70, y: 361 }, { x: 597, y: 361 }], 'handdrawn');
  const heads = paths.filter((p) => !p.isBorder);
  assert.equal(heads.length, 2);
  for (const h of heads) {
    assert.match(h.d, /^M[-\d. ]+ L[-\d. ]+ L[-\d. ]+$/, h.d);
    assert.equal(h.fill, 'none');
    assert.equal(h.stroke, '#1971c2');
    assert.equal(h.strokeWidth, paths[0].strokeWidth);
    const [ax, ay, tx, ty, bx, by] = nums(h.d);
    const la = Math.hypot(ax - tx, ay - ty);
    const lb = Math.hypot(bx - tx, by - ty);
    assert.ok(la > 8 && la < 16 && lb > 8 && lb < 16, `arm lengths ${la} ${lb}`);
  }
});

test('dashes map onto the existing options; widths follow the pen scale', () => {
  assert.deepEqual(penDash('dashed', true), [6, 5]);
  assert.deepEqual(penDash('dashed', false), [8, 6]);
  assert.deepEqual(penDash('dotted', true), [5, 6]);
  assert.equal(penDash('solid', true), undefined);
  const [outline] = shapeDrawable(shape('dash', { seed: 1, dash: 'dashed' }), 'handdrawn');
  assert.deepEqual(outline.dash, [6, 5]);
  const [shaft] = connectorDrawable(connector('dashc', { seed: 1, dash: 'dashed', endArrow: 'none' }), [{ x: 0, y: 0 }, { x: 100, y: 0 }], 'handdrawn');
  assert.deepEqual(shaft.dash, [8, 6]);
  assert.equal(handdrawnStyle.polyline([{ x: 0, y: 0 }, { x: 99, y: 0 }], style(1, { strokeWidth: 1 }))[0].strokeWidth, 1.5);
  assert.equal(handdrawnStyle.polyline([{ x: 0, y: 0 }, { x: 99, y: 0 }], style(1, { strokeWidth: 6 }))[0].strokeWidth, 2.7);
});

test('text renders in the pen stack; explicit non-default fonts are kept', () => {
  assert.equal(fontStack(PEN_FONT_ID), "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Kalam', cursive");
  assert.equal(handdrawnStyle.fontStack, fontStack(PEN_FONT_ID));
  for (const f of [undefined, 'excalifont', 'hand', 'kalam']) assert.equal(handdrawnStyle.fontId(f), PEN_FONT_ID);
  assert.equal(handdrawnStyle.fontId('mono'), 'mono');
  assert.equal(getStyleRenderer('sketch').fontId('excalifont'), 'excalifont');
});

// ---------- sketch is untouched ----------

/** Every sketch primitive over a fixed fixture set; the hash was taken from main (ced3454) before this style existed. */
function sketchFingerprint(): string {
  const out: unknown[] = [];
  for (const kind of [...SHAPES, 'parallelogram'] as const) {
    for (const seed of [1, 99, 123456]) {
      out.push(shapeDrawable(shape(`fp-${kind}-${seed}`, { seed, shape: kind, fill: seed === 99 ? '#ffd43b' : 'transparent', dash: seed === 1 ? 'dashed' : 'solid' }), 'sketch'));
    }
  }
  const pts = [{ x: 0, y: 0 }, { x: 70, y: 10 }, { x: 140, y: 60 }, { x: 200, y: 80 }];
  for (const routing of ['straight', 'elbow', 'curved'] as const) {
    for (const seed of [5, 77]) {
      const c = connector(`fpc-${routing}-${seed}`, { seed, routing, startArrow: 'triangle' });
      out.push(connectorDrawable(c, routing === 'straight' ? [pts[0], pts[3]] : pts, 'sketch'));
    }
  }
  return createHash('sha256').update(JSON.stringify(out)).digest('hex');
}

test("'sketch' output is byte-identical to before the hand-drawn style", () => {
  assert.equal(sketchFingerprint(), SKETCH_FINGERPRINT);
});

const SKETCH_FINGERPRINT = 'b22b1a686b92470b7cff72c155d7a06a333fc4868c4c55661e7b3ca14017279d';

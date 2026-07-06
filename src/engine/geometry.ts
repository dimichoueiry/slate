import type { Box, SlateObj, Vec, ConnectorObj, AnchorSide } from '../types';

export function boundsOf(o: SlateObj, resolve?: (id: string) => SlateObj | undefined): Box {
  switch (o.type) {
    case 'stroke':
      return { x: o.x, y: o.y, w: o.w, h: o.h };
    case 'connector': {
      const { a, b } = connectorEndpoints(o, resolve);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    }
    default:
      return { x: o.x, y: o.y, w: (o as any).w ?? 0, h: (o as any).h ?? 0 };
  }
}

/** Axis-aligned bounds inflated to cover rotation. */
export function aabbOf(o: SlateObj, resolve?: (id: string) => SlateObj | undefined): Box {
  const b = boundsOf(o, resolve);
  if (!o.rotation) return b;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const cos = Math.abs(Math.cos(o.rotation));
  const sin = Math.abs(Math.sin(o.rotation));
  const w = b.w * cos + b.h * sin;
  const h = b.w * sin + b.h * cos;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function boxUnion(boxes: Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function boxContains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function pointInBox(p: Vec, b: Box, pad = 0): boolean {
  return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
}

/** Rotate point p around center c by angle (radians). */
export function rotatePoint(p: Vec, c: Vec, angle: number): Vec {
  if (!angle) return p;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Transform a world point into an object's local (unrotated) space. */
export function toLocalPoint(p: Vec, o: SlateObj, resolve?: (id: string) => SlateObj | undefined): Vec {
  if (!o.rotation) return p;
  const b = boundsOf(o, resolve);
  return rotatePoint(p, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, -o.rotation);
}

export function distSq(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const l2 = distSq(a, b);
  if (l2 === 0) return Math.sqrt(distSq(p, a));
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt(distSq(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }));
}

export function distToPolyline(p: Vec, pts: Vec[]): number {
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    min = Math.min(min, distToSegment(p, pts[i], pts[i + 1]));
  }
  return min;
}

// ---------- connectors ----------

export function anchorPoint(b: Box, side: AnchorSide): Vec {
  switch (side) {
    case 'left': return { x: b.x, y: b.y + b.h / 2 };
    case 'right': return { x: b.x + b.w, y: b.y + b.h / 2 };
    case 'top': return { x: b.x + b.w / 2, y: b.y };
    case 'bottom': return { x: b.x + b.w / 2, y: b.y + b.h };
    case 'center': return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
}

/**
 * Point where a ray from the shape's center toward `target` crosses the shape's
 * actual outline (ellipse rim, polygon edge, box border) — so connector endpoints
 * always sit exactly on the edge, plus the side used for routing direction.
 */
export function edgePointToward(
  o: SlateObj,
  b: Box,
  target: Vec
): { p: Vec; side: AnchorSide } {
  const c: Vec = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  let dx = target.x - c.x;
  let dy = target.y - c.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dx = 1;

  // side = dominant direction normalized by the box aspect (used for elbow/curve exits)
  const side: AnchorSide =
    Math.abs(dx) * b.h >= Math.abs(dy) * b.w
      ? dx >= 0
        ? 'right'
        : 'left'
      : dy >= 0
        ? 'bottom'
        : 'top';

  if (o.type === 'shape') {
    const s = o as { shape: string };
    if (s.shape === 'ellipse') {
      const rx = b.w / 2 || 1;
      const ry = b.h / 2 || 1;
      const k = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
      return { p: { x: c.x + dx * k, y: c.y + dy * k }, side };
    }
    const poly = shapePolygon(s.shape, b);
    if (poly) {
      const far: Vec = { x: c.x + dx * 1e6, y: c.y + dy * 1e6 };
      let best: Vec | null = null;
      let bestT = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const hit = segmentIntersection(c, far, poly[i], poly[(i + 1) % poly.length]);
        if (hit && hit.t < bestT) {
          bestT = hit.t;
          best = hit.p;
        }
      }
      if (best) return { p: best, side };
    }
  }
  // default: box border intersection
  const tx = Math.abs(dx) > 1e-6 ? b.w / 2 / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-6 ? b.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { p: { x: c.x + dx * t, y: c.y + dy * t }, side };
}

function segmentIntersection(a: Vec, b: Vec, c: Vec, d: Vec): { p: Vec; t: number } | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { p: { x: a.x + t * r.x, y: a.y + t * r.y }, t };
}

export function connectorEndpoints(
  c: ConnectorObj,
  resolve?: (id: string) => SlateObj | undefined
): { a: Vec; b: Vec; aSide: AnchorSide | null; bSide: AnchorSide | null } {
  let a: Vec = c.from.point ?? { x: c.x, y: c.y };
  let b: Vec = c.to.point ?? { x: c.x, y: c.y };
  let aSide: AnchorSide | null = null;
  let bSide: AnchorSide | null = null;

  const fromObj = c.from.objectId && resolve ? resolve(c.from.objectId) : undefined;
  const toObj = c.to.objectId && resolve ? resolve(c.to.objectId) : undefined;
  const fromBox = fromObj ? boundsOf(fromObj, resolve) : null;
  const toBox = toObj ? boundsOf(toObj, resolve) : null;

  // an end with a stored anchor is PINNED: it sits on that side and moves
  // rigidly with the object, exactly where the user snapped it
  const aPin = fromBox && c.from.anchor && c.from.anchor !== 'center' ? c.from.anchor : null;
  const bPin = toBox && c.to.anchor && c.to.anchor !== 'center' ? c.to.anchor : null;
  if (aPin) {
    a = anchorPoint(fromBox!, aPin);
    aSide = aPin;
  }
  if (bPin) {
    b = anchorPoint(toBox!, bPin);
    bSide = bPin;
  }

  // a floating end lands exactly where the line toward the other end crosses
  // the shape's outline, recomputed live so connectors re-route on any move
  const refForA: Vec = bPin ? b : toBox ? { x: toBox.x + toBox.w / 2, y: toBox.y + toBox.h / 2 } : b;
  const refForB: Vec = aPin ? a : fromBox ? { x: fromBox.x + fromBox.w / 2, y: fromBox.y + fromBox.h / 2 } : a;

  if (fromObj && fromBox && !aPin) {
    const e = edgePointToward(fromObj, fromBox, refForA);
    a = e.p;
    aSide = e.side;
  }
  if (toObj && toBox && !bPin) {
    const e = edgePointToward(toObj, toBox, refForB);
    b = e.p;
    bSide = e.side;
  }
  return { a, b, aSide, bSide };
}

/** Route a connector to a polyline (world coords). */
export function routeConnector(
  c: ConnectorObj,
  resolve?: (id: string) => SlateObj | undefined
): Vec[] {
  const { a, b, aSide, bSide } = connectorEndpoints(c, resolve);
  if (c.routing === 'straight') return [a, b];
  if (c.routing === 'elbow') return elbowRoute(a, b, aSide, bSide);
  // curved: sample the bezier so hit-testing & arrows share one representation
  const [c1, c2] = curveControls(a, b, aSide, bSide);
  const pts: Vec[] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(cubicAt(a, c1, c2, b, t));
  }
  return pts;
}

export function curveControls(a: Vec, b: Vec, aSide: AnchorSide | null, bSide: AnchorSide | null): [Vec, Vec] {
  const d = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 2);
  const dirA = sideDir(aSide) ?? norm({ x: b.x - a.x, y: b.y - a.y });
  const dirB = sideDir(bSide) ?? norm({ x: a.x - b.x, y: a.y - b.y });
  return [
    { x: a.x + dirA.x * d, y: a.y + dirA.y * d },
    { x: b.x + dirB.x * d, y: b.y + dirB.y * d },
  ];
}

function cubicAt(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const mt = 1 - t;
  const A = mt * mt * mt, B = 3 * mt * mt * t, C = 3 * mt * t * t, D = t * t * t;
  return {
    x: A * p0.x + B * p1.x + C * p2.x + D * p3.x,
    y: A * p0.y + B * p1.y + C * p2.y + D * p3.y,
  };
}

function sideDir(s: AnchorSide | null): Vec | null {
  switch (s) {
    case 'left': return { x: -1, y: 0 };
    case 'right': return { x: 1, y: 0 };
    case 'top': return { x: 0, y: -1 };
    case 'bottom': return { x: 0, y: 1 };
    default: return null;
  }
}

function norm(v: Vec): Vec {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

function elbowRoute(a: Vec, b: Vec, aSide: AnchorSide | null, bSide: AnchorSide | null): Vec[] {
  const STUB = 24;
  const dirA = sideDir(aSide);
  const dirB = sideDir(bSide);
  const pa = dirA ? { x: a.x + dirA.x * STUB, y: a.y + dirA.y * STUB } : a;
  const pb = dirB ? { x: b.x + dirB.x * STUB, y: b.y + dirB.y * STUB } : b;

  // simple orthogonal route between the stub points
  const mid: Vec[] = [];
  const horizontalFirst = dirA ? dirA.y === 0 : Math.abs(pb.x - pa.x) > Math.abs(pb.y - pa.y);
  if (horizontalFirst) {
    const mx = dirB && dirB.y === 0 ? (pa.x + pb.x) / 2 : pb.x;
    if (dirB && dirB.y === 0) {
      mid.push({ x: mx, y: pa.y }, { x: mx, y: pb.y });
    } else {
      mid.push({ x: mx, y: pa.y });
    }
  } else {
    const my = dirB && dirB.x === 0 ? (pa.y + pb.y) / 2 : pb.y;
    if (dirB && dirB.x === 0) {
      mid.push({ x: pa.x, y: my }, { x: pb.x, y: my });
    } else {
      mid.push({ x: pa.x, y: my });
    }
  }
  const pts = [a, pa, ...mid, pb, b];
  // collapse duplicate consecutive points
  return pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 0.01 || Math.abs(p.y - pts[i - 1].y) > 0.01);
}

// ---------- shape outline (for hit tests + svg export) ----------

export function shapePolygon(shape: string, b: Box): Vec[] | null {
  switch (shape) {
    case 'triangle':
      return [
        { x: b.x + b.w / 2, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
      ];
    case 'diamond':
      return [
        { x: b.x + b.w / 2, y: b.y },
        { x: b.x + b.w, y: b.y + b.h / 2 },
        { x: b.x + b.w / 2, y: b.y + b.h },
        { x: b.x, y: b.y + b.h / 2 },
      ];
    case 'parallelogram': {
      const k = b.w * 0.22;
      return [
        { x: b.x + k, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w - k, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
      ];
    }
    default:
      return null;
  }
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point halfway along a polyline by arc length. */
export function polylineMidpoint(pts: Vec[]): Vec {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0];
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    lens.push(l);
    total += l;
  }
  let half = total / 2;
  for (let i = 0; i < lens.length; i++) {
    if (half <= lens[i]) {
      const t = lens[i] === 0 ? 0 : half / lens[i];
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      };
    }
    half -= lens[i];
  }
  return pts[pts.length - 1];
}

export function snapAngle(angle: number, stepDeg = 15): number {
  const step = (stepDeg * Math.PI) / 180;
  return Math.round(angle / step) * step;
}

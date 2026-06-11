// Shape recognition for rough ink strokes (the "auto-shape" pen toggle).
// Pure geometry heuristics: closure + isoperimetric roundness + RDP corner count.

import type { Box, Vec } from '../types';

export type Recognized =
  | { kind: 'line'; a: Vec; b: Vec }
  | { kind: 'ellipse' | 'rect' | 'triangle' | 'diamond'; box: Box };

export function recognizeStroke(pts: Vec[]): Recognized | null {
  if (pts.length < 8) return null;

  const first = pts[0];
  const last = pts[pts.length - 1];
  let perimeter = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    perimeter += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  if (perimeter < 40) return null;

  const closeGap = Math.hypot(last.x - first.x, last.y - first.y);
  const closed = closeGap < Math.max(24, perimeter * 0.16);

  if (!closed) {
    // straight line? max deviation from the chord
    const chord = Math.hypot(last.x - first.x, last.y - first.y);
    if (chord < 30) return null;
    let maxDev = 0;
    for (const p of pts) {
      maxDev = Math.max(maxDev, pointLineDistance(p, first, last));
    }
    if (maxDev < Math.max(7, chord * 0.045)) {
      return { kind: 'line', a: first, b: last };
    }
    return null;
  }

  // closed stroke → circle vs polygon
  const area = Math.abs(shoelace(pts));
  if (area < 250) return null;
  const roundness = (4 * Math.PI * area) / (perimeter * perimeter); // 1 = perfect circle
  const box = bboxOf(pts);
  if (box.w < 16 || box.h < 16) return null;

  if (roundness > 0.82) return { kind: 'ellipse', box };

  // corner counting on the simplified outline
  const simplified = rdp(pts, Math.max(6, perimeter * 0.022));
  // drop duplicate closing point
  let corners = simplified.length;
  if (
    corners > 1 &&
    Math.hypot(simplified[0].x - simplified[corners - 1].x, simplified[0].y - simplified[corners - 1].y) <
      Math.max(20, perimeter * 0.08)
  ) {
    corners -= 1;
  }

  if (corners === 3) return { kind: 'triangle', box };
  if (corners === 4 || corners === 5) {
    // rect if corners sit near the bbox corners; diamond if near the edge midpoints
    const verts = simplified.slice(0, corners);
    const cornerPts = [
      { x: box.x, y: box.y },
      { x: box.x + box.w, y: box.y },
      { x: box.x + box.w, y: box.y + box.h },
      { x: box.x, y: box.y + box.h },
    ];
    const midPts = [
      { x: box.x + box.w / 2, y: box.y },
      { x: box.x + box.w, y: box.y + box.h / 2 },
      { x: box.x + box.w / 2, y: box.y + box.h },
      { x: box.x, y: box.y + box.h / 2 },
    ];
    const dCorner = avgNearest(verts, cornerPts);
    const dMid = avgNearest(verts, midPts);
    return { kind: dMid < dCorner ? 'diamond' : 'rect', box };
  }
  // many soft corners but still fairly round → ellipse
  if (roundness > 0.7) return { kind: 'ellipse', box };
  return null;
}

function pointLineDistance(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

function shoelace(pts: Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function bboxOf(pts: Vec[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Ramer–Douglas–Peucker simplification. */
function rdp(pts: Vec[], epsilon: number): Vec[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0;
  let idx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointLineDistance(pts[i], a, b);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= epsilon) return [a, b];
  const left = rdp(pts.slice(0, idx + 1), epsilon);
  const right = rdp(pts.slice(idx), epsilon);
  return [...left.slice(0, -1), ...right];
}

function avgNearest(verts: Vec[], targets: Vec[]): number {
  let sum = 0;
  for (const v of verts) {
    let best = Infinity;
    for (const t of targets) best = Math.min(best, Math.hypot(v.x - t.x, v.y - t.y));
    sum += best;
  }
  return sum / verts.length;
}

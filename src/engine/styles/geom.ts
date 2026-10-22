import type { Vec } from '../../types';

/** Two arm endpoints of an open chevron at `tip`, pointing away from `from`. */
export function chevronArms(from: Vec, tip: Vec, len: number): [Vec, Vec] {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const spread = (20 * Math.PI) / 180; // Excalidraw's "arrow" head angle
  return [
    { x: tip.x - len * Math.cos(angle - spread), y: tip.y - len * Math.sin(angle - spread) },
    { x: tip.x - len * Math.cos(angle + spread), y: tip.y - len * Math.sin(angle + spread) },
  ];
}

/** Point `dist` back along the polyline from its last point, so a head on a curve aims along the curve, not its last tiny segment. */
export function pointBack(pts: Vec[], dist: number): Vec {
  let left = dist;
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d >= left) return { x: b.x + ((a.x - b.x) * left) / d, y: b.y + ((a.y - b.y) * left) / d };
    left -= d;
  }
  return pts[0];
}

/** SVG path of the cubic bezier that `pts` (evenly sampled in t, count - 1 divisible by 3) was sampled from. */
export function cubicThrough(pts: Vec[]): string | null {
  const n = pts.length - 1;
  if (n < 3 || n % 3 !== 0) return null;
  const a = pts[0];
  const b = pts[n];
  const p1 = pts[n / 3]; // B(1/3) = (8a + 12c1 + 6c2 + b) / 27
  const p2 = pts[(2 * n) / 3]; // B(2/3) = (a + 6c1 + 12c2 + 8b) / 27
  const r1 = { x: 27 * p1.x - 8 * a.x - b.x, y: 27 * p1.y - 8 * a.y - b.y };
  const r2 = { x: 27 * p2.x - a.x - 8 * b.x, y: 27 * p2.y - a.y - 8 * b.y };
  const c1 = { x: (2 * r1.x - r2.x) / 18, y: (2 * r1.y - r2.y) / 18 };
  const c2 = { x: (2 * r2.x - r1.x) / 18, y: (2 * r2.y - r1.y) / 18 };
  return `M${a.x} ${a.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
}

/** Total length of a polyline. */
export function polylineLength(pts: Vec[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

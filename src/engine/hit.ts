import type { SlateObj, Vec } from '../types';
import type { Doc } from './doc';
import {
  boundsOf,
  distToPolyline,
  pointInBox,
  pointInPolygon,
  routeConnector,
  shapePolygon,
  toLocalPoint,
} from './geometry';
import { strokePointsAsVecs } from './ink';

export interface HitOptions {
  ignoreFrames?: boolean;
  /** treat unfilled shapes as solid — used for connector targeting, where the
   *  whole shape area should accept an attachment, not just the painted rim */
  solidShapes?: boolean;
}

/** Topmost object at world point p. tolerance in world units. */
export function hitTest(doc: Doc, p: Vec, tolerance: number, opts?: HitOptions): SlateObj | null {
  const candidates = doc
    .search({ x: p.x - tolerance, y: p.y - tolerance, w: tolerance * 2, h: tolerance * 2 })
    .sort((a, b) => b.z - a.z); // topmost first
  for (const o of candidates) {
    if (o.locked) continue;
    if (opts?.ignoreFrames && o.type === 'frame') continue;
    if (hitsObject(doc, o, p, tolerance, opts?.solidShapes)) return o;
  }
  return null;
}

export function hitsObject(doc: Doc, o: SlateObj, p: Vec, tol: number, solidShapes = false): boolean {
  const local = toLocalPoint(p, o, doc.resolve);
  const b = boundsOf(o, doc.resolve);
  switch (o.type) {
    case 'stroke': {
      if (!pointInBox(local, b, tol + o.size)) return false;
      return distToPolyline(local, strokePointsAsVecs(o)) <= tol + o.size / 2 + 1;
    }
    case 'connector': {
      const pts = routeConnector(o, doc.resolve);
      return distToPolyline(p, pts) <= tol + o.strokeWidth / 2 + 2;
    }
    case 'shape': {
      if (!pointInBox(local, b, tol)) return false;
      const poly = shapePolygon(o.shape, b);
      const hollow = o.fill === 'transparent' && !solidShapes;
      if (poly) {
        const inside = pointInPolygon(local, poly);
        if (!hollow) return inside;
        return inside && !pointInPolygon(local, shrinkPolygon(poly, Math.max(tol, o.strokeWidth + 4)));
      }
      if (o.shape === 'ellipse') {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const rx = b.w / 2 || 1;
        const ry = b.h / 2 || 1;
        const v = ((local.x - cx) / rx) ** 2 + ((local.y - cy) / ry) ** 2;
        if (!hollow) return v <= 1;
        const inner = Math.max(0, 1 - (Math.max(tol, o.strokeWidth + 4) / Math.min(rx, ry)));
        return v <= 1 && v >= inner * inner;
      }
      // rect / roundedRect
      if (!hollow || o.text) return true; // bounds check above passed
      const inner = Math.max(tol, o.strokeWidth + 4);
      return !pointInBox(local, { x: b.x + inner, y: b.y + inner, w: b.w - inner * 2, h: b.h - inner * 2 });
    }
    case 'frame': {
      // frames hit only on their border/label so content stays selectable
      const edge = tol + 4;
      if (!pointInBox(local, b, edge)) return false;
      return !pointInBox(local, { x: b.x + edge, y: b.y + edge, w: b.w - edge * 2, h: b.h - edge * 2 });
    }
    default:
      return pointInBox(local, b, tol);
  }
}

function shrinkPolygon(poly: Vec[], by: number): Vec[] {
  let cx = 0, cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= poly.length;
  cy /= poly.length;
  return poly.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, (d - by) / d);
    return { x: cx + dx * k, y: cy + dy * k };
  });
}

/** Strokes intersecting an eraser segment (for the stroke eraser). */
export function strokesHitBySegment(doc: Doc, a: Vec, b: Vec, radius: number): SlateObj[] {
  const minX = Math.min(a.x, b.x) - radius;
  const minY = Math.min(a.y, b.y) - radius;
  const candidates = doc.search({
    x: minX,
    y: minY,
    w: Math.abs(a.x - b.x) + radius * 2,
    h: Math.abs(a.y - b.y) + radius * 2,
  });
  const out: SlateObj[] = [];
  for (const o of candidates) {
    if (o.type !== 'stroke' || o.locked) continue;
    const pts = strokePointsAsVecs(o);
    const tol = radius + o.size / 2;
    let hit = false;
    for (const p of pts) {
      if (distToPolyline(p, [a, b]) <= tol) {
        hit = true;
        break;
      }
    }
    if (hit) out.push(o);
  }
  return out;
}

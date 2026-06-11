import type { Box } from '../types';
import type { Doc } from './doc';
import { aabbOf } from './geometry';

export interface SnapResult {
  dx: number;
  dy: number;
  guides: { axis: 'x' | 'y'; pos: number; from: number; to: number }[];
}

/**
 * Snap a moving box against nearby objects' edges and centers.
 * threshold is in world units (caller divides screen px by zoom).
 */
export function snapBox(doc: Doc, moving: Box, excludeIds: Set<string>, threshold: number): SnapResult {
  const SEARCH = 1200;
  const others = doc
    .search({ x: moving.x - SEARCH, y: moving.y - SEARCH, w: moving.w + SEARCH * 2, h: moving.h + SEARCH * 2 })
    .filter((o) => !excludeIds.has(o.id) && o.type !== 'connector' && o.type !== 'stroke');

  const mxs = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const mys = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  let bestDx: number | null = null;
  let bestDy: number | null = null;
  let bestXGuide: SnapResult['guides'][0] | null = null;
  let bestYGuide: SnapResult['guides'][0] | null = null;

  for (const o of others) {
    const b = aabbOf(o, doc.resolve);
    const oxs = [b.x, b.x + b.w / 2, b.x + b.w];
    const oys = [b.y, b.y + b.h / 2, b.y + b.h];
    for (const mx of mxs) {
      for (const ox of oxs) {
        const d = ox - mx;
        if (Math.abs(d) <= threshold && (bestDx === null || Math.abs(d) < Math.abs(bestDx))) {
          bestDx = d;
          bestXGuide = {
            axis: 'x',
            pos: ox,
            from: Math.min(moving.y, b.y),
            to: Math.max(moving.y + moving.h, b.y + b.h),
          };
        }
      }
    }
    for (const my of mys) {
      for (const oy of oys) {
        const d = oy - my;
        if (Math.abs(d) <= threshold && (bestDy === null || Math.abs(d) < Math.abs(bestDy))) {
          bestDy = d;
          bestYGuide = {
            axis: 'y',
            pos: oy,
            from: Math.min(moving.x, b.x),
            to: Math.max(moving.x + moving.w, b.x + b.w),
          };
        }
      }
    }
  }

  const guides: SnapResult['guides'] = [];
  if (bestXGuide) guides.push(bestXGuide);
  if (bestYGuide) guides.push(bestYGuide);
  return { dx: bestDx ?? 0, dy: bestDy ?? 0, guides };
}

export function snapToGrid(v: number, step = 32): number {
  return Math.round(v / step) * step;
}

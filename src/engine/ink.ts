import { getStroke } from 'perfect-freehand';
import type { PenTool, StrokeObj } from '../types';

export interface PenConfig {
  thinning: number;
  smoothing: number;
  streamline: number;
  taperStart: number;
  taperEnd: number;
  simulatePressure: boolean;
  composite: GlobalCompositeOperation;
  opacityMul: number;
}

export const PEN_CONFIGS: Record<PenTool, PenConfig> = {
  fineliner: {
    thinning: 0,
    smoothing: 0.5,
    streamline: 0.45,
    taperStart: 0,
    taperEnd: 0,
    simulatePressure: false,
    composite: 'source-over',
    opacityMul: 1,
  },
  pen: {
    thinning: 0.65,
    smoothing: 0.5,
    streamline: 0.5,
    taperStart: 0,
    taperEnd: 4,
    simulatePressure: true,
    composite: 'source-over',
    opacityMul: 1,
  },
  pencil: {
    thinning: 0.45,
    smoothing: 0.35,
    streamline: 0.3,
    taperStart: 0,
    taperEnd: 0,
    simulatePressure: true,
    composite: 'source-over',
    opacityMul: 0.85,
  },
  marker: {
    thinning: 0,
    smoothing: 0.6,
    streamline: 0.5,
    taperStart: 0,
    taperEnd: 0,
    simulatePressure: false,
    composite: 'multiply',
    opacityMul: 0.45,
  },
  brush: {
    thinning: 0.8,
    smoothing: 0.55,
    streamline: 0.55,
    taperStart: 24,
    taperEnd: 24,
    simulatePressure: true,
    composite: 'source-over',
    opacityMul: 1,
  },
};

export interface InputPoint {
  x: number;
  y: number;
  p: number;
}

/** Compute outline polygon for a stroke from raw points (in any coordinate space). */
export function strokeOutline(
  pts: InputPoint[],
  tool: PenTool,
  size: number,
  smoothingBoost = 0
): number[][] {
  const cfg = PEN_CONFIGS[tool];
  const hasRealPressure = pts.some((p) => p.p !== 0.5 && p.p > 0);
  return getStroke(
    pts.map((p) => [p.x, p.y, p.p]),
    {
      size,
      thinning: cfg.thinning,
      smoothing: Math.min(0.99, cfg.smoothing + smoothingBoost),
      streamline: Math.min(0.99, cfg.streamline + smoothingBoost * 0.5),
      simulatePressure: cfg.simulatePressure && !hasRealPressure,
      start: { taper: cfg.taperStart, cap: true },
      end: { taper: cfg.taperEnd, cap: true },
      last: true,
    }
  );
}

export function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  if (outline.length < 2) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  // quadratic midpoint smoothing for a clean closed outline
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1];
    const [x1, y1] = outline[i];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

export function outlineToSvgPathData(outline: number[][]): string {
  if (outline.length < 2) return '';
  const f = (n: number) => Math.round(n * 100) / 100;
  let d = `M${f(outline[0][0])},${f(outline[0][1])}`;
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1];
    const [x1, y1] = outline[i];
    d += `Q${f(x0)},${f(y0)} ${f((x0 + x1) / 2)},${f((y0 + y1) / 2)}`;
  }
  return d + 'Z';
}

// Path2D cache per stroke object — invalidated when the object instance changes
// (the doc store always replaces object instances on mutation, so identity works as a key).
const pathCache = new WeakMap<StrokeObj, Path2D>();

export function strokePath(o: StrokeObj): Path2D {
  let p = pathCache.get(o);
  if (!p) {
    const pts: InputPoint[] = [];
    for (let i = 0; i < o.points.length; i += 3) {
      pts.push({ x: o.points[i], y: o.points[i + 1], p: o.points[i + 2] });
    }
    p = outlineToPath(strokeOutline(pts, o.tool, o.size));
    pathCache.set(o, p);
  }
  return p;
}

export function strokePointsAsVecs(o: StrokeObj): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < o.points.length; i += 3) {
    out.push({ x: o.x + o.points[i], y: o.y + o.points[i + 1] });
  }
  return out;
}

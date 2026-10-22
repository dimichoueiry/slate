// 'sketch': the original roughjs look, moved here verbatim from renderer.ts.
// Tuned to match Excalidraw's "artist" sloppiness: roughness 1, bowing 1,
// roughjs's default double-pass strokes, solid fills, round caps and joins.
// Output must stay byte-identical — scripts/render-sample.mjs guards it.

import rough from 'roughjs';
import { PALETTE, STICKY_COLORS, fontStack, type StickyObj, type Vec } from '../../types';
import { stickyPaperPath } from '../sticky';
import { chevronArms, cubicThrough, polylineLength } from './geom';
import type { StrokeStyle, StyledPath, StyleRenderer } from './types';

const gen = rough.generator();
type Drawable = ReturnType<typeof gen.path>;

function sketchyOptions(seed: number, stroke: string, strokeWidth: number, dash: string, size: { w: number; h: number }) {
  // small shapes get less roughness, or the jitter swamps them
  const maxSize = Math.max(size.w, size.h);
  const minSize = Math.min(size.w, size.h);
  const roughness = (minSize >= 20 && maxSize >= 50) || minSize >= 15 ? 1 : 1 / (maxSize < 10 ? 3 : 2);
  return {
    seed,
    roughness,
    bowing: 1,
    stroke: stroke === 'transparent' ? 'none' : stroke,
    strokeWidth,
    // dashes on top of a double pass look like noise
    disableMultiStroke: dash !== 'solid',
    preserveVertices: true,
  };
}

/** Options for closed outlines (with solid fill). */
function closedOptions(s: StrokeStyle) {
  return {
    ...sketchyOptions(s.seed, s.stroke, s.strokeWidth, s.dash, s.size),
    fill: s.fill !== 'transparent' ? s.fill : undefined,
    fillStyle: 'solid',
    hachureGap: s.strokeWidth * 4,
    fillWeight: s.strokeWidth / 2,
  };
}

/** Options for open lines: long lines get full roughness regardless of their bounding box. */
function lineOptions(s: StrokeStyle) {
  const linear = Math.hypot(s.size.w, s.size.h) >= 50;
  return sketchyOptions(s.seed, s.stroke, s.strokeWidth, s.dash, linear ? { w: 50, h: 50 } : s.size);
}

function toPaths(drawable: Drawable, borderStroke: string): StyledPath[] {
  return gen.toPaths(drawable).map((info) => ({
    d: info.d,
    stroke: info.stroke,
    strokeWidth: info.strokeWidth,
    fill: info.fill ?? 'none',
    isBorder: info.stroke === borderStroke,
  }));
}

const tuple = (p: Vec) => [p.x, p.y] as [number, number];

export const sketchStyle: StyleRenderer = {
  id: 'sketch',
  label: 'Sketch',
  version: 1,
  palette: PALETTE,
  stickyPalette: STICKY_COLORS,
  defaultFontId: 'excalifont',
  fontStack: fontStack('excalifont'),

  fontId: (id) => id,
  fontWeight: (_size, weight) => weight,
  labelFont: { fontId: undefined, size: 13, weight: 500 },
  fillStyles: [],

  rect: (x, y, w, h, s) => toPaths(gen.rectangle(x, y, w, h, closedOptions(s)), s.stroke),

  roundedRect(x, y, w, h, r, s) {
    const d = `M${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r} L${x},${y + r} Q${x},${y} ${x + r},${y} Z`;
    return toPaths(gen.path(d, closedOptions(s)), s.stroke);
  },

  ellipse: (cx, cy, w, h, s) => toPaths(gen.ellipse(cx, cy, w, h, { ...closedOptions(s), curveFitting: 1 }), s.stroke),

  polygon: (pts, s) => toPaths(gen.polygon(pts.map(tuple), closedOptions(s)), s.stroke),

  polyline: (pts, s) => toPaths(gen.linearPath(pts.map(tuple), lineOptions(s)), s.stroke),

  curve(pts, s) {
    // one rough cubic, like the clean curve; roughjs's curve() through a few samples kinks at each one
    const bezier = cubicThrough(pts);
    const opts = lineOptions(s);
    return toPaths(bezier ? gen.path(bezier, opts) : gen.linearPath(pts.map(tuple), opts), s.stroke);
  },

  arrowhead(from, tip, len, s) {
    const opts = { ...lineOptions(s), disableMultiStroke: false };
    return chevronArms(from, tip, len).flatMap((arm) => toPaths(gen.line(arm.x, arm.y, tip.x, tip.y, opts), ''));
  },

  // Excalidraw's "arrow" head: 25px arms, never more than half the arrow
  arrowHeadLen: (_strokeWidth, pts) => Math.min(25, polylineLength(pts) * 0.5),

  // the paper wobble keeps its own id-derived seed (unchanged look for every note)
  stickyPaper: (o: StickyObj) => stickyPaperPath(o),
};

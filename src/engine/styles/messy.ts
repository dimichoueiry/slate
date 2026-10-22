// 'messy': loose, energetic whiteboard marker. roughjs at high roughness and
// bowing with its double-pass strokes kept on, open chevron arrowheads, hachure
// fills at ~45% alpha (solid / zigzag / dots / cross-hatch on request) and
// Caveat for all text. Every roughjs call gets the object's stored seed, so the
// same object always wobbles the same way.

import rough from 'roughjs';
import { STICKY_COLORS, fontStack, type FillStyle, type Vec } from '../../types';
import { styleInk } from '../style';
import { stickyPaperPath } from '../sticky';
import { chevronArms, polylineLength } from './geom';
import type { StrokeStyle, StyledPath, StyleRenderer } from './types';

const gen = rough.generator();
type Drawable = ReturnType<typeof gen.path>;
type Options = NonNullable<Parameters<typeof gen.path>[1]>;

// ---- tuning (the spec this style was drawn to) ----
export const MESSY = {
  lineRoughness: 1.6,
  longLineRoughness: 1.8,
  /** a line at least this long (px) counts as an axis / long line */
  longLine: 400,
  dashedRoughness: 1.3,
  dash: [10, 8],
  curveRoughness: 1.5,
  bowing: 2,
  lineWidth: 2,
  emphasizedWidth: 2.8,
  headRoughness: 1.1,
  shapeRoughness: 1.6,
  /** an ellipse around a text label: a "circled answer" */
  highlightRoughness: 2.2,
  highlightWidth: 2,
  /** the highlight ellipse is drawn this much larger than the box it circles */
  highlightScale: 1.1,
  /** shapes whose larger side is at most this are small markers */
  markerSize: 24,
  markerRoughness: 1.4,
  markerWidth: 1.7,
  hachureGap: 9,
  hachureAngle: -41,
  fillWeight: 1.3,
  fillAlpha: 0.45,
  markerHachureGap: 3,
  markerFillWeight: 1,
} as const;

export const MESSY_FILL_STYLES: readonly FillStyle[] = ['hachure', 'solid', 'zigzag', 'dots', 'cross-hatch'];

/** Stroke width in the messy look: thin marker by default, a thicker "emphasized" marker for heavier strokes. */
export function messyWidth(strokeWidth: number): number {
  if (strokeWidth <= 2) return MESSY.lineWidth;
  if (strokeWidth <= 3) return MESSY.emphasizedWidth;
  return strokeWidth;
}

/** `color` at the given alpha, for hex colors; anything else passes through. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const stroked = (stroke: string) => (stroke === 'transparent' ? 'none' : stroke);

function toPaths(drawable: Drawable, isBorder: boolean, lineDash?: number[]): StyledPath[] {
  return gen.toPaths(drawable).map((info) => ({
    d: info.d,
    stroke: info.stroke,
    strokeWidth: info.strokeWidth,
    fill: info.fill ?? 'none',
    isBorder,
    ...(lineDash ? { lineDash } : {}),
  }));
}

const isMarker = (s: StrokeStyle) => Math.max(s.size.w, s.size.h) <= MESSY.markerSize;

/** Options for an open line of the given length. */
export function lineOptions(s: StrokeStyle, length: number): Options {
  const dashed = s.dash === 'dashed';
  return {
    seed: s.seed,
    roughness: dashed ? MESSY.dashedRoughness : length >= MESSY.longLine ? MESSY.longLineRoughness : MESSY.lineRoughness,
    bowing: MESSY.bowing,
    stroke: stroked(s.stroke),
    strokeWidth: messyWidth(s.strokeWidth),
    disableMultiStroke: false,
    ...(dashed ? { strokeLineDash: [...MESSY.dash] } : {}),
  };
}

/** Options for a closed outline (stroke only: fills are generated separately). */
export function outlineOptions(s: StrokeStyle, highlight = false): Options {
  const marker = isMarker(s);
  return {
    seed: s.seed,
    roughness: highlight ? MESSY.highlightRoughness : marker ? MESSY.markerRoughness : MESSY.shapeRoughness,
    bowing: 1,
    stroke: stroked(s.stroke),
    strokeWidth: highlight ? MESSY.highlightWidth : marker ? MESSY.markerWidth : messyWidth(s.strokeWidth),
    disableMultiStroke: false,
    ...(s.dash === 'dashed' ? { strokeLineDash: [...MESSY.dash] } : {}),
  };
}

/** Options for a shape's area fill: stroke 'none', so only the hatching (or solid area) shows. */
export function fillOptions(s: StrokeStyle): Options | null {
  if (!s.fill || s.fill === 'transparent') return null;
  const marker = isMarker(s);
  const fillStyle: FillStyle = s.fillStyle ?? (marker ? 'cross-hatch' : 'hachure');
  return {
    seed: s.seed,
    roughness: marker ? MESSY.markerRoughness : MESSY.shapeRoughness,
    bowing: 1,
    stroke: 'none',
    fill: fillStyle === 'solid' ? s.fill : withAlpha(s.fill, MESSY.fillAlpha),
    fillStyle,
    hachureGap: marker ? MESSY.markerHachureGap : MESSY.hachureGap,
    hachureAngle: MESSY.hachureAngle,
    fillWeight: marker ? MESSY.markerFillWeight : MESSY.fillWeight,
  };
}

const dashOf = (o: Options) => (o.strokeLineDash ? [...o.strokeLineDash] : undefined);

/** Fill (under) + outline (over) of one closed figure. */
function closed(s: StrokeStyle, draw: (o: Options) => Drawable, highlight = false): StyledPath[] {
  const out: StyledPath[] = [];
  const f = fillOptions(s);
  if (f) out.push(...toPaths(draw(f), false));
  if (s.stroke !== 'transparent' && s.strokeWidth > 0) {
    const o = outlineOptions(s, highlight);
    out.push(...toPaths(draw(o), true, dashOf(o)));
  }
  return out;
}

const tuple = (p: Vec) => [p.x, p.y] as [number, number];

export const messyStyle: StyleRenderer = {
  id: 'messy',
  label: 'Messy',
  version: 1,
  // ink follows the canvas surface (light ink on a dark board), then the marker colors
  get palette() {
    return [styleInk(), '#1971c2', '#e8590c', '#2f9e44', '#868e96'];
  },
  stickyPalette: STICKY_COLORS,
  defaultFontId: 'caveat',
  fontStack: fontStack('caveat'),

  // all text is Caveat in this style, whatever font the object was given
  fontId: () => 'caveat',
  // key numbers (big text) in Caveat Bold; everything else Regular
  fontWeight: (size) => (size >= 32 ? 700 : 400),
  labelFont: { fontId: 'caveat', size: 19, weight: 400 },
  fillStyles: MESSY_FILL_STYLES,
  fontSizes: [16, 19, 21, 22, 24, 32, 40, 56, 72, 96],

  rect: (x, y, w, h, s) => closed(s, (o) => gen.rectangle(x, y, w, h, o)),

  roundedRect(x, y, w, h, r, s) {
    const d = `M${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r} L${x},${y + r} Q${x},${y} ${x + r},${y} Z`;
    return closed(s, (o) => gen.path(d, o));
  },

  ellipse(cx, cy, w, h, s) {
    // an ellipse around a label is a loose "circled" highlight, drawn a bit larger than its box
    const k = s.hasText ? MESSY.highlightScale : 1;
    return closed(s, (o) => gen.ellipse(cx, cy, w * k, h * k, o), s.hasText);
  },

  polygon: (pts, s) => closed(s, (o) => gen.polygon(pts.map(tuple), o)),

  polyline(pts, s) {
    const o = lineOptions(s, polylineLength(pts));
    return toPaths(gen.linearPath(pts.map(tuple), o), true, dashOf(o));
  },

  curve(pts, s) {
    const o = { ...lineOptions(s, polylineLength(pts)), ...(s.dash === 'dashed' ? {} : { roughness: MESSY.curveRoughness }) };
    return toPaths(gen.curve(pts.map(tuple), o), true, dashOf(o));
  },

  // open chevron: one 3-point linearPath through both arms and the tip, never a filled triangle
  arrowhead(from, tip, len, s) {
    const [a, b] = chevronArms(from, tip, len);
    const o: Options = {
      seed: s.seed,
      roughness: MESSY.headRoughness,
      bowing: 1,
      stroke: stroked(s.stroke),
      strokeWidth: messyWidth(s.strokeWidth),
      disableMultiStroke: false,
    };
    return toPaths(gen.linearPath([tuple(a), tuple(tip), tuple(b)], o), false);
  },

  arrowHeadLen: (strokeWidth, pts) => Math.min(16 + messyWidth(strokeWidth) * 2, polylineLength(pts) * 0.4),

  stickyPaper: (o) => stickyPaperPath(o),
};

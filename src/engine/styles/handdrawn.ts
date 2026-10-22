// 'handdrawn': calm, careful pen notes. One gently imperfect stroke per outline:
// every straight segment is a single quadratic bowed 2-4px off its chord, rect
// edges over/undershoot their corners, ellipses are 4 jittered cubics that close
// a few degrees past their start, arrowheads are open chevrons, fills are solid
// or none. All randomness comes from the object's stored seed (never Math.random),
// so the same object draws the same way on canvas, in PNG and in SVG export.

import { STICKY_COLORS, fontStack, type DashStyle, type StickyObj, type Vec } from '../../types';
import { seedOf } from '../style';
import { cubicControlsThrough, polylineLength } from './geom';
import type { StrokeStyle, StyledPath, StyleRenderer } from './types';

/** ink, blue, orange, green, gray, light-blue fill — no pure white/black, so it reads on light and dark boards */
export const HANDDRAWN_PALETTE = ['#1a1a1a', '#1971c2', '#e8590c', '#2f9e44', '#868e96', '#a5d8ff'] as const;

/** FONTS id of the pen font stack ("Segoe Print", "Bradley Hand", "Comic Sans MS", Kalam, cursive). */
export const PEN_FONT_ID = 'pen';
/** Object fonts that mean "the default handwriting", so they switch to the pen font in this style. */
const DEFAULT_FONTS = new Set(['excalifont', 'hand', 'kalam']);

// ---------- seeded randomness ----------

/** mulberry32: tiny deterministic PRNG in [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent stream per primitive part, so e.g. a connector's two arrowheads differ. */
function stream(seed: number, salt: number): () => number {
  return rng(seed ^ Math.imul(salt + 1, 0x9e3779b1));
}

const range = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();
const sign = (r: () => number) => (r() < 0.5 ? -1 : 1);

const n = (v: number) => String(Math.round(v * 10) / 10);
const pt = (p: Vec) => `${n(p.x)} ${n(p.y)}`;

// ---------- pen widths and dashes ----------

/** 1.5 for minor/helper lines, 2 for outlines and connectors, 2.7 for emphasized lines. */
export function penWidth(strokeWidth: number): number {
  return strokeWidth < 1.75 ? 1.5 : strokeWidth <= 3 ? 2 : 2.7;
}

/**
 * The existing dash options in pen terms: a dashed outline is a boundary/cut-off
 * ('6 5'), a dashed line is an ideal/reference line ('8 6'), dotted is a guess or
 * unknown ('5 6').
 */
export function penDash(dash: DashStyle, closed: boolean): number[] | undefined {
  if (dash === 'dashed') return closed ? [6, 5] : [8, 6];
  if (dash === 'dotted') return [5, 6];
  return undefined;
}

// ---------- primitives ----------

/** Control point of a quadratic from a to b, 2-4px off the chord midpoint (less on very short segments). */
export function bowControl(a: Vec, b: Vec, r: () => number): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const bow = Math.min(range(r, 2, 4), len / 8) * sign(r);
  const along = range(r, -1, 1) * Math.min(2.5, len * 0.05);
  if (len < 1e-6) return { x: a.x, y: a.y };
  const ux = dx / len;
  const uy = dy / len;
  return { x: (a.x + b.x) / 2 + ux * along - uy * bow, y: (a.y + b.y) / 2 + uy * along + ux * bow };
}

/** Move a back by ea and b forward by eb along their line (negative = fall short). */
function extend(a: Vec, b: Vec, ea: number, eb: number): [Vec, Vec] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  return [
    { x: a.x - ux * ea, y: a.y - uy * ea },
    { x: b.x + ux * eb, y: b.y + uy * eb },
  ];
}

/** 0-3px past (mostly) or short of a corner. */
const cornerMiss = (r: () => number) => range(r, 0, 3) * (r() < 0.7 ? 1 : -1);

const hasStroke = (s: StrokeStyle) => s.stroke !== 'transparent' && s.strokeWidth > 0;

function strokePath(d: string, s: StrokeStyle, closed: boolean, width = penWidth(s.strokeWidth)): StyledPath {
  return { d, stroke: s.stroke, strokeWidth: width, fill: 'none', isBorder: true, dash: penDash(s.dash, closed) };
}

function fillPath(d: string, fill: string | undefined): StyledPath[] {
  return fill && fill !== 'transparent' && fill !== 'none' ? [{ d, stroke: 'none', strokeWidth: 0, fill, isBorder: false }] : [];
}

/** Closed outline through `pts`: a solid fill of the bowed polygon, then one stroke per edge, each missing its corners by 0-3px. */
function closedEdges(pts: Vec[], s: StrokeStyle): StyledPath[] {
  if (pts.length < 2) return [];
  const r = stream(s.seed, 1);
  const edges = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    return { a, b, c: bowControl(a, b, r), ea: cornerMiss(r), eb: cornerMiss(r) };
  });
  const out = fillPath(`M${pt(pts[0])} ${edges.map((e) => `Q${pt(e.c)} ${pt(e.b)}`).join(' ')} Z`, s.fill);
  if (hasStroke(s)) {
    const d = edges
      .map((e) => {
        const [a, b] = extend(e.a, e.b, e.ea, e.eb);
        return `M${pt(a)} Q${pt(e.c)} ${pt(b)}`;
      })
      .join(' ');
    out.push(strokePath(d, s, true));
  }
  return out;
}

const onEllipse = (cx: number, cy: number, rx: number, ry: number, t: number, f: number): Vec => ({
  x: cx + f * rx * Math.cos(t),
  y: cy + f * ry * Math.sin(t),
});

/** ×(1 ± 2-3%) */
const radiusJitter = (r: () => number) => 1 + sign(r) * range(r, 0.02, 0.03);

/** Cubic from angle ta (radius ×fa) to tb (×fb); each control point radially jittered ±2-3%. */
function ellipseArc(cx: number, cy: number, rx: number, ry: number, ta: number, tb: number, fa: number, fb: number, r: () => number): string {
  const k = (4 / 3) * Math.tan((tb - ta) / 4);
  const a = onEllipse(cx, cy, rx, ry, ta, fa);
  const b = onEllipse(cx, cy, rx, ry, tb, fb);
  const ctrl = (p: Vec, t: number, f: number, dir: number): Vec => {
    const j = radiusJitter(r);
    const x = p.x - dir * k * f * rx * Math.sin(t);
    const y = p.y + dir * k * f * ry * Math.cos(t);
    return { x: cx + (x - cx) * j, y: cy + (y - cy) * j };
  };
  return `C${pt(ctrl(a, ta, fa, 1))} ${pt(ctrl(b, tb, fb, -1))} ${pt(b)}`;
}

/** Where an ellipse stroke starts (radians, around the top) and how far past a full turn it ends (5-10°). */
export function ellipseStroke(seed: number) {
  const r = stream(seed, 2);
  const start = range(r, -150, -30) * (Math.PI / 180);
  const overshoot = range(r, 5, 10) * (Math.PI / 180);
  return { start, overshoot, r };
}

/** Marker circles (r ≈ 15) and smaller: stroke 2, never filled. */
const MARKER_MAX = 40;

// ---------- the style ----------

export const handdrawnStyle: StyleRenderer = {
  id: 'handdrawn',
  label: 'Hand-drawn',
  version: 1,
  palette: HANDDRAWN_PALETTE,
  stickyPalette: STICKY_COLORS,
  defaultFontId: PEN_FONT_ID,
  fontStack: fontStack(PEN_FONT_ID),

  fontId: (id) => (id === undefined || DEFAULT_FONTS.has(id) ? PEN_FONT_ID : id),

  rect: (x, y, w, h, s) =>
    closedEdges(
      [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
      s
    ),

  roundedRect(x, y, w, h, radius, s) {
    const rr = Math.min(radius, w / 2, h / 2);
    if (!(rr > 0)) return handdrawnStyle.rect(x, y, w, h, s);
    const r = stream(s.seed, 3);
    // [edge start, edge end, the corner after it]; corners are quadratics around the true corner
    const runs: [Vec, Vec, Vec][] = [
      [{ x: x + rr, y }, { x: x + w - rr, y }, { x: x + w, y }],
      [{ x: x + w, y: y + rr }, { x: x + w, y: y + h - rr }, { x: x + w, y: y + h }],
      [{ x: x + w - rr, y: y + h }, { x: x + rr, y: y + h }, { x, y: y + h }],
      [{ x, y: y + h - rr }, { x, y: y + rr }, { x, y }],
    ];
    let body = '';
    runs.forEach(([a, b, corner], i) => {
      body += ` Q${pt(bowControl(a, b, r))} ${pt(b)} Q${pt(corner)} ${pt(runs[(i + 1) % 4][0])}`;
    });
    const out = fillPath(`M${pt(runs[0][0])}${body} Z`, s.fill);
    if (hasStroke(s)) {
      // the pen lands a little before or past where it started
      out.push(strokePath(`M${pt({ x: x + rr - cornerMiss(r), y })}${body}`, s, true));
    }
    return out;
  },

  ellipse(cx, cy, w, h, s) {
    const rx = w / 2;
    const ry = h / 2;
    const marker = Math.max(w, h) <= MARKER_MAX;
    const { start, overshoot, r } = ellipseStroke(s.seed);
    const f = [0, 1, 2, 3].map(() => radiusJitter(r));
    const t = (i: number) => start + (i * Math.PI) / 2;
    let loop = '';
    for (let i = 0; i < 4; i++) loop += ` ${ellipseArc(cx, cy, rx, ry, t(i), t(i + 1), f[i], f[(i + 1) % 4], r)}`;
    const head = `M${pt(onEllipse(cx, cy, rx, ry, start, f[0]))}`;
    const out = marker ? [] : fillPath(`${head}${loop} Z`, s.fill);
    if (hasStroke(s)) {
      // carry on 5-10° past the start, drifting slightly in or out, like a pen closing a circle
      const tail = ellipseArc(cx, cy, rx, ry, t(4), t(4) + overshoot, f[0], radiusJitter(r), r);
      out.push(strokePath(`${head}${loop} ${tail}`, s, true, marker ? 2 : penWidth(s.strokeWidth)));
    }
    return out;
  },

  polygon: (pts, s) => closedEdges(pts, s),

  polyline(pts, s) {
    if (pts.length < 2 || !hasStroke(s)) return [];
    const r = stream(s.seed, 4);
    let d = `M${pt(pts[0])}`;
    for (let i = 1; i < pts.length; i++) d += ` Q${pt(bowControl(pts[i - 1], pts[i], r))} ${pt(pts[i])}`;
    return [strokePath(d, s, false)];
  },

  curve(pts, s) {
    const cubic = cubicControlsThrough(pts);
    if (!cubic || !hasStroke(s)) return handdrawnStyle.polyline(pts, s);
    const r = stream(s.seed, 5);
    const nudge = (p: Vec): Vec => ({ x: p.x + range(r, -2.5, 2.5), y: p.y + range(r, -2.5, 2.5) });
    const [a, c1, c2, b] = cubic;
    return [strokePath(`M${pt(a)} C${pt(nudge(c1))} ${pt(nudge(c2))} ${pt(b)}`, s, false)];
  },

  arrowhead(from, tip, len, s) {
    if (!hasStroke(s)) return [];
    const r = stream(s.seed, 6 + Math.round(tip.x) * 31 + Math.round(tip.y) * 17);
    const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
    const arm = (side: number): Vec => {
      const spread = range(r, 32, 38) * (Math.PI / 180);
      const l = len * range(r, 0.92, 1.05);
      return { x: tip.x - l * Math.cos(angle + side * spread), y: tip.y - l * Math.sin(angle + side * spread) };
    };
    // open chevron, same pen as the line, never filled
    const d = `M${pt(arm(-1))} L${pt(tip)} L${pt(arm(1))}`;
    return [{ d, stroke: s.stroke, strokeWidth: penWidth(s.strokeWidth), fill: 'none', isBorder: false }];
  },

  // short ~12px arms, never more than 40% of the line
  arrowHeadLen: (strokeWidth, pts) => Math.min(Math.max(12, 5 * penWidth(strokeWidth)), polylineLength(pts) * 0.4),

  stickyPaper(o: StickyObj) {
    // a neat sheet: faintly bowed edges, softly rounded corners
    const r = stream(seedOf(o), 7);
    const { x, y, w, h } = o;
    const c = Math.min(6, w / 4, h / 4);
    const runs: [Vec, Vec, Vec][] = [
      [{ x: x + c, y }, { x: x + w - c, y }, { x: x + w, y }],
      [{ x: x + w, y: y + c }, { x: x + w, y: y + h - c }, { x: x + w, y: y + h }],
      [{ x: x + w - c, y: y + h }, { x: x + c, y: y + h }, { x, y: y + h }],
      [{ x, y: y + h - c }, { x, y: y + c }, { x, y }],
    ];
    let d = `M${pt(runs[0][0])}`;
    runs.forEach(([a, b, corner], i) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const bow = range(r, -1.5, 1.5);
      const ctl = { x: (a.x + b.x) / 2 - ((b.y - a.y) / len) * bow, y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * bow };
      d += ` Q${pt(ctl)} ${pt(b)} Q${pt(corner)} ${pt(runs[(i + 1) % 4][0])}`;
    });
    return `${d} Z`;
  },
};

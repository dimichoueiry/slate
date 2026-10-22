// Shared clamp layout for text-bearing objects (sticky notes and text objects).
// Long content is capped to a max box height on the canvas and shown behind a
// "Show more" chip; the full text opens in the reader modal. The full text always
// lives in `o.text` — clamping is purely a display concern, never a truncation.

import type { StickyObj, TextObj } from '../types';
import type { StyleRenderer } from './styles/types';
import { wrapText, lineHeight } from './text';

/** Objects that participate in clamping. */
export type ClampObj = StickyObj | TextObj;

/** Max auto-sized height (px, world units) before content is clamped. */
export const STICKY_MAX_H = 360;
/** Default width for a short sticky note. */
export const STICKY_NARROW_W = 220;
/** Wider width used when a freshly-created note's text is long, so it reads less like a ribbon. */
export const STICKY_WIDE_W = 320;
/** A note longer than this (chars) is created at the wider width. */
const WIDE_TEXT_THRESHOLD = 180;

export interface ClampLayout {
  /** Lines actually drawn on the canvas (a prefix of the full text when clamped). */
  lines: string[];
  /** True when the object's text doesn't fit its box and is clamped behind a chip. */
  clamped: boolean;
  /** Total line count (clamped or not). */
  totalLines: number;
  /** Word count of the full text (shown in the chip). */
  wordCount: number;
  /** Chip rectangle in world coordinates (present only when clamped). */
  chip?: { x: number; y: number; w: number; h: number };
}

/** Cap an auto-computed height. Used at creation time where there is no prior height. */
export function clampHeight(desiredH: number): number {
  return Math.min(desiredH, STICKY_MAX_H);
}

/**
 * Cap a *growing* height while respecting an object the user manually enlarged past the cap.
 * If it's already taller than the cap (explicit resize), let it keep growing; otherwise hold
 * it at the cap so editing long content doesn't turn it back into a ribbon.
 */
export function clampGrowHeight(currentH: number, desiredH: number): number {
  if (currentH > STICKY_MAX_H) return desiredH;
  return Math.min(desiredH, STICKY_MAX_H);
}

/** Pick a creation width based on how much text a sticky holds. */
export function stickyWidthFor(text: string): number {
  return (text?.length ?? 0) > WIDE_TEXT_THRESHOLD ? STICKY_WIDE_W : STICKY_NARROW_W;
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Per-type geometry: where text starts, how it wraps, its weight and vertical padding. */
function geom(o: ClampObj) {
  const lh = lineHeight(o.fontSize);
  if (o.type === 'sticky') {
    return { wrapW: Math.max(8, o.w - 24), weight: 500 as const, padY: 24, inset: 10, chipGap: 8 };
  }
  // text object: draws flush at x/y; wrap only when fixedWidth
  return { wrapW: o.fixedWidth ? o.w : null, weight: 400 as const, padY: 0, inset: 0, chipGap: 2 };
}

/** A style's weight override (StyleRenderer.fontWeight); absent = the object type's base weight. */
export type FontWeightFn = StyleRenderer['fontWeight'];

/**
 * Compute the on-canvas layout: which lines show, and whether the object is clamped.
 * `fontId` is the font the text is drawn with (its style may override o.fontFamily; see drawFontId),
 * `fontWeight` the style's weight override, if any (see drawFontWeight).
 */
export function clampLayout(o: ClampObj, fontId: string | undefined = o.fontFamily, fontWeight?: FontWeightFn): ClampLayout {
  const g = geom(o);
  const weight = fontWeight ? fontWeight(o.fontSize, g.weight) : g.weight;
  const all =
    g.wrapW != null
      ? wrapText(o.text, o.fontSize, g.wrapW, weight, fontId)
      : o.text.split('\n');
  const lh = lineHeight(o.fontSize);
  const avail = o.h - g.padY;
  const maxLines = Math.max(1, Math.floor(avail / lh));

  if (all.length <= maxLines) {
    return { lines: all, clamped: false, totalLines: all.length, wordCount: wordCount(o.text) };
  }

  // Reserve the bottom row for the fade + chip so we never clip a half-line under it.
  const shown = all.slice(0, Math.max(1, maxLines - 1));
  const chipH = lh + 6;
  const chip = {
    x: o.x + g.inset,
    y: o.y + o.h - chipH - g.chipGap,
    w: o.w - g.inset * 2,
    h: chipH,
  };
  return { lines: shown, clamped: true, totalLines: all.length, wordCount: wordCount(o.text), chip };
}

/** True if a world-space point lands on a clamped object's "Show more" chip. */
export function pointInClampChip(
  o: ClampObj,
  p: { x: number; y: number },
  fontId: string | undefined = o.fontFamily,
  fontWeight?: FontWeightFn
): boolean {
  const l = clampLayout(o, fontId, fontWeight);
  if (!l.clamped || !l.chip) return false;
  const c = l.chip;
  return p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
}

// ---- paper look: rounded, slightly irregular outline + hard offset shadow + date ----
// Shared by the canvas renderer and SVG export so both draw the same note.

/** Hard offset shadow under the paper (≈ #d6d6d6 on a white board). */
export const STICKY_SHADOW = 'rgba(0,0,0,0.16)';
/** Color of the small created-date label. */
export const STICKY_DATE_COLOR = '#2b2b2b';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** FNV-1a hash of the id → stable per-note seed, so the wobble never changes between frames. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: tiny deterministic PRNG in [0, 1). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * SVG path data for the note's paper: a rounded quad whose four corners are nudged by
 * ±~1.5px from a seed on the id, so each note is a hair off-square. Used directly in SVG
 * export and via `new Path2D(d)` on canvas.
 */
export function stickyPaperPath(o: StickyObj): string {
  const { x, y, w, h } = o;
  const short = Math.max(1, Math.min(w, h));
  const amp = Math.min(1.6, short * 0.008);
  const r = Math.min(9, short / 4);
  const rand = rng(seedOf(o.id));
  const j = () => (rand() * 2 - 1) * amp;
  // tl, tr, br, bl
  const c = [
    { x: x + j(), y: y + j() },
    { x: x + w + j(), y: y + j() },
    { x: x + w + j(), y: y + h + j() },
    { x: x + j(), y: y + h + j() },
  ];
  const toward = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: a.x + (dx / len) * r, y: a.y + (dy / len) * r };
  };
  const f = (n: number) => Math.round(n * 100) / 100;
  let d = '';
  for (let i = 0; i < 4; i++) {
    const prev = c[(i + 3) % 4];
    const cur = c[i];
    const next = c[(i + 1) % 4];
    const a = toward(cur, prev);
    const b = toward(cur, next);
    d += `${i === 0 ? 'M' : 'L'}${f(a.x)},${f(a.y)}Q${f(cur.x)},${f(cur.y)} ${f(b.x)},${f(b.y)}`;
  }
  return d + 'Z';
}

/** Offset of the hard shadow, scaled a little with note size (4–6px at 1x). */
export function stickyShadowOffset(o: StickyObj): number {
  return Math.max(4, Math.min(6, Math.min(o.w, o.h) * 0.025));
}

/** "20 Oct" style label for the note's creation date, or null when it has none. */
export function stickyDateLabel(o: StickyObj): string | null {
  if (typeof o.createdAt !== 'number' || !isFinite(o.createdAt)) return null;
  const d = new Date(o.createdAt);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Font size and bottom-right anchor (right edge, baseline) for the date label. */
export function stickyDateGeom(o: StickyObj) {
  const size = Math.max(10, Math.min(14, o.w * 0.05));
  const inset = Math.max(8, size * 0.9);
  return { size, x: o.x + o.w - inset, y: o.y + o.h - inset * 0.8 };
}

/** Top of the first drawn body line: vertically centred when it all fits, top-padded when clamped. */
export function stickyTextTop(o: StickyObj, layout: ClampLayout): number {
  const lh = lineHeight(o.fontSize);
  if (layout.clamped) return o.y + 12;
  return o.y + Math.max(12, (o.h - layout.lines.length * lh) / 2);
}

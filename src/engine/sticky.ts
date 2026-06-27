// Shared clamp layout for text-bearing objects (sticky notes and text objects).
// Long content is capped to a max box height on the canvas and shown behind a
// "Show more" chip; the full text opens in the reader modal. The full text always
// lives in `o.text` — clamping is purely a display concern, never a truncation.

import type { StickyObj, TextObj } from '../types';
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

/** Compute the on-canvas layout: which lines show, and whether the object is clamped. */
export function clampLayout(o: ClampObj): ClampLayout {
  const g = geom(o);
  const all =
    g.wrapW != null
      ? wrapText(o.text, o.fontSize, g.wrapW, g.weight, o.fontFamily)
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
export function pointInClampChip(o: ClampObj, p: { x: number; y: number }): boolean {
  const l = clampLayout(o);
  if (!l.clamped || !l.chip) return false;
  const c = l.chip;
  return p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
}

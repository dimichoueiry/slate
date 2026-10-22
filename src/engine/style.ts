// Drawing-style + seed bookkeeping shared by the doc, persistence, renderer and
// MCP bridge. Pure (no DOM, no roughjs) so it is unit-testable in node.

import type { BoardMeta, DrawStyle } from '../types';

export const DRAW_STYLES: readonly DrawStyle[] = ['sketch', 'handdrawn', 'messy'];
export const DEFAULT_DRAW_STYLE: DrawStyle = 'sketch';

export const DRAW_STYLE_LABELS: Record<DrawStyle, string> = {
  sketch: 'Sketch',
  handdrawn: 'Hand-drawn',
  messy: 'Messy',
};

export function isDrawStyle(v: unknown): v is DrawStyle {
  return typeof v === 'string' && (DRAW_STYLES as readonly string[]).includes(v);
}

/** Board default style; boards saved before styles existed read as 'sketch'. */
export function boardStyleOf(meta: Pick<BoardMeta, 'style'> | null | undefined): DrawStyle {
  return isDrawStyle(meta?.style) ? meta!.style! : DEFAULT_DRAW_STYLE;
}

/** The style an object actually renders with: its own override, else the board's. */
export function effectiveStyle(o: { style?: unknown }, boardStyle: DrawStyle | undefined): DrawStyle {
  if (isDrawStyle(o.style)) return o.style;
  return isDrawStyle(boardStyle) ? boardStyle : DEFAULT_DRAW_STYLE;
}

// ---------- seeds ----------

const SEED_RANGE = 2 ** 31;

export function isSeed(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < SEED_RANGE;
}

/** Fresh random 31-bit seed for a newly created (or duplicated) object. */
export function newSeed(): number {
  return Math.floor(Math.random() * SEED_RANGE);
}

/**
 * Deterministic 31-bit seed from an object id (FNV-1a). This is exactly the
 * fallback the 'sketch' renderer always used for seedless shapes/connectors, so
 * backfilling it keeps old boards pixel-identical.
 */
export function idSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % SEED_RANGE;
}

/** The object's stored seed, or its id-derived fallback when it has none. */
export function seedOf(o: { id: string; seed?: number }): number {
  return o.seed !== undefined ? o.seed : idSeed(o.id);
}

/** Give a loaded object a seed if it was saved without one (mutates; returns it). */
export function backfillSeed<T extends { id: string; seed?: number }>(o: T): T {
  // only fill a missing seed: an existing one (even odd-looking) is what the object renders with
  if (typeof o.seed !== 'number' || !Number.isFinite(o.seed)) o.seed = idSeed(o.id);
  return o;
}

export function backfillSeeds<T extends { id: string; seed?: number }>(objs: T[]): T[] {
  for (const o of objs) backfillSeed(o);
  return objs;
}

// ---------- canvas ink ----------
// The default ink of the open board's canvas surface (dark on light paper, light
// on a dark board). The theme layer sets it; styles whose palette leads with
// "ink" read it so the swatch stays legible in dark mode.

let canvasInk = '#1a1a1a';

export function setStyleInk(color: string) {
  canvasInk = color;
}

export function styleInk(): string {
  return canvasInk;
}

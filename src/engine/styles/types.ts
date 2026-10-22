// The contract every drawing style implements. Canvas, PNG export (and so MCP
// render_board) and SVG export all draw through these methods, so a style only
// has to produce path data once to look the same everywhere.

import type { DashStyle, DrawStyle, StickyObj, Vec } from '../../types';

/** One output path. Canvas draws it via Path2D(d); SVG export emits it as <path d>. */
export interface StyledPath {
  d: string;
  /** 'none' = no stroke */
  stroke: string;
  strokeWidth: number;
  /** 'none' = no fill */
  fill: string;
  /** the object's outline (gets the object's dash pattern); fills and arrowheads don't */
  isBorder: boolean;
}

/** Everything a primitive needs to know about how to stroke/fill it. */
export interface StrokeStyle {
  /** the object's stored seed; all randomness must derive from it */
  seed: number;
  /** may be 'transparent' */
  stroke: string;
  strokeWidth: number;
  dash: DashStyle;
  /** closed shapes only: fill color, may be 'transparent' */
  fill?: string;
  /** size of the object the primitive belongs to (shape box, or a connector's path bounds) — styles scale jitter by it */
  size: { w: number; h: number };
}

export interface StyleRenderer {
  readonly id: DrawStyle;
  readonly label: string;
  /** bump when the style's output changes, so cached drawables regenerate */
  readonly version: number;
  /** swatches offered in the color pickers while this style is active */
  readonly palette: readonly string[];
  /** sticky-note paper swatches */
  readonly stickyPalette: readonly string[];
  /** FONTS id new text defaults to in this style, and its CSS stack */
  readonly defaultFontId: string;
  readonly fontStack: string;

  /** FONTS id to render an object's text with, given the object's own fontFamily. */
  fontId(objectFontId: string | undefined): string | undefined;

  // ---- closed outlines (fill comes from StrokeStyle.fill) ----
  rect(x: number, y: number, w: number, h: number, s: StrokeStyle): StyledPath[];
  roundedRect(x: number, y: number, w: number, h: number, r: number, s: StrokeStyle): StyledPath[];
  ellipse(cx: number, cy: number, w: number, h: number, s: StrokeStyle): StyledPath[];
  polygon(pts: Vec[], s: StrokeStyle): StyledPath[];

  // ---- open lines ----
  /** straight/elbow connector shaft or any polyline */
  polyline(pts: Vec[], s: StrokeStyle): StyledPath[];
  /** curved connector shaft: `pts` are evenly-in-t samples of one cubic (geometry.routeConnector) */
  curve(pts: Vec[], s: StrokeStyle): StyledPath[];
  /** arrowhead at `tip`, aimed from `from`; `len` from arrowHeadLen */
  arrowhead(from: Vec, tip: Vec, len: number, s: StrokeStyle): StyledPath[];
  /** arm length for a connector with this stroke width along `pts` */
  arrowHeadLen(strokeWidth: number, pts: Vec[]): number;

  /** SVG path data of a sticky note's paper (filled with the note color, shadow drawn offset) */
  stickyPaper(o: StickyObj): string;
}

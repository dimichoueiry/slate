// THE style dispatch point. The canvas renderer, PNG export (and therefore MCP
// render_board) and SVG export all get an object's hand-drawn paths from
// shapeDrawable / connectorDrawable below, which pick the StyleRenderer for the
// object's effective style and cache the result per object.

import type { ConnectorObj, DrawStyle, ShapeObj, Vec } from '../../types';
import { cornerRadius, shapePolygon } from '../geometry';
import { effectiveStyle, seedOf } from '../style';
import { DrawableCache } from './cache';
import { pointBack } from './geom';
import { handdrawnStyle } from './handdrawn';
import { messyStyle } from './messy';
import { sketchStyle } from './sketch';
import type { StrokeStyle, StyledPath, StyleRenderer } from './types';

export type { StrokeStyle, StyledPath, StyleRenderer } from './types';
export { chevronArms } from './geom';

const RENDERERS: Record<DrawStyle, StyleRenderer> = {
  sketch: sketchStyle,
  handdrawn: handdrawnStyle,
  messy: messyStyle,
};

export function getStyleRenderer(style: DrawStyle | undefined): StyleRenderer {
  return (style && RENDERERS[style]) || sketchStyle;
}

/** Renderer for an object on a board with the given default style. */
export function styleRendererFor(o: { style?: unknown }, boardStyle: DrawStyle | undefined): StyleRenderer {
  return getStyleRenderer(effectiveStyle(o, boardStyle));
}

// ---------- cached drawables ----------

export const drawableCache = new DrawableCache<StyledPath[]>();

/** Drop an object's cached drawables (Doc calls this on delete). */
export function evictDrawables(id: string) {
  drawableCache.evict(id);
}

export function clearDrawables() {
  drawableCache.clear();
}

/** Hand-drawn outline + fill of a shape, in its effective style. Cached. */
export function shapeDrawable(o: ShapeObj, boardStyle: DrawStyle | undefined): StyledPath[] {
  const sr = styleRendererFor(o, boardStyle);
  const seed = seedOf(o);
  const r = o.shape === 'roundedRect' ? cornerRadius(o) : 0;
  const key = `shape|${sr.id}@${sr.version}|${seed}|${o.shape}|${o.x},${o.y},${o.w},${o.h},${r}|${o.stroke}|${o.strokeWidth}|${o.dash}|${o.fill}`;
  return drawableCache.get(o.id, key, () => {
    const s: StrokeStyle = { seed, stroke: o.stroke, strokeWidth: o.strokeWidth, dash: o.dash, fill: o.fill, size: { w: o.w, h: o.h } };
    const { x, y, w, h } = o;
    switch (o.shape) {
      case 'rect':
        return sr.rect(x, y, w, h, s);
      case 'roundedRect':
        return sr.roundedRect(x, y, w, h, r, s);
      case 'ellipse':
        return sr.ellipse(x + w / 2, y + h / 2, w, h, s);
      default:
        return sr.polygon(shapePolygon(o.shape, { x, y, w, h }) ?? [], s);
    }
  });
}

/** Hand-drawn shaft + arrowheads of a connector routed along `pts`. Cached. */
export function connectorDrawable(o: ConnectorObj, pts: Vec[], boardStyle: DrawStyle | undefined): StyledPath[] {
  const sr = styleRendererFor(o, boardStyle);
  const seed = seedOf(o);
  const route = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const key = `conn|${sr.id}@${sr.version}|${seed}|${o.routing}|${route}|${o.startArrow},${o.endArrow}|${o.stroke}|${o.strokeWidth}|${o.dash}`;
  return drawableCache.get(o.id, key, () => {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const size = { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    const s: StrokeStyle = { seed, stroke: o.stroke, strokeWidth: o.strokeWidth, dash: o.dash, size };
    const paths = o.routing === 'curved' ? sr.curve(pts, s) : sr.polyline(pts, s);
    const headLen = sr.arrowHeadLen(o.strokeWidth, pts);
    const heads: [Vec, Vec][] = [];
    if (o.endArrow !== 'none') heads.push([pointBack(pts, headLen), pts[pts.length - 1]]);
    if (o.startArrow !== 'none') heads.push([pointBack([...pts].reverse(), headLen), pts[0]]);
    for (const [from, tip] of heads) paths.push(...sr.arrowhead(from, tip, headLen, s));
    return paths;
  });
}

// ---------- canvas helpers ----------

const path2dCache = new WeakMap<StyledPath, Path2D>();

export function toPath2D(p: StyledPath): Path2D {
  let path = path2dCache.get(p);
  if (!path) path2dCache.set(p, (path = new Path2D(p.d)));
  return path;
}

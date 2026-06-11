import type { Box, Vec } from '../types';

export interface Camera {
  /** world coordinate at the top-left of the screen */
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 64;

export function screenToWorld(c: Camera, s: Vec): Vec {
  return { x: c.x + s.x / c.zoom, y: c.y + s.y / c.zoom };
}

export function worldToScreen(c: Camera, w: Vec): Vec {
  return { x: (w.x - c.x) * c.zoom, y: (w.y - c.y) * c.zoom };
}

export function visibleWorldRect(c: Camera, viewW: number, viewH: number): Box {
  return { x: c.x, y: c.y, w: viewW / c.zoom, h: viewH / c.zoom };
}

/** Zoom keeping the given screen point fixed. */
export function zoomAt(c: Camera, screenPoint: Vec, nextZoom: number): Camera {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  const before = screenToWorld(c, screenPoint);
  const next = { ...c, zoom: z };
  const after = screenToWorld(next, screenPoint);
  return { x: next.x + before.x - after.x, y: next.y + before.y - after.y, zoom: z };
}

/** Camera that fits a world box into the view with padding. */
export function cameraToFit(box: Box, viewW: number, viewH: number, pad = 64): Camera {
  if (box.w <= 0 || box.h <= 0) {
    return { x: -viewW / 2, y: -viewH / 2, zoom: 1 };
  }
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min((viewW - pad * 2) / box.w, (viewH - pad * 2) / box.h))
  );
  return {
    x: box.x + box.w / 2 - viewW / 2 / zoom,
    y: box.y + box.h / 2 - viewH / 2 / zoom,
    zoom,
  };
}

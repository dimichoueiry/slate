import type {
  Box,
  ConnectorObj,
  FrameObj,
  IconObj,
  ImageObj,
  VideoObj,
  ShapeObj,
  SlateObj,
  StickyObj,
  StrokeObj,
  TextObj,
  Vec,
} from '../types';
import { iconPaths } from './icons';
import type { Camera } from './camera';
import { visibleWorldRect } from './camera';
import type { Doc } from './doc';
import { boundsOf, polylineMidpoint, routeConnector, shapePolygon } from './geometry';
import { PEN_CONFIGS, strokePath } from './ink';
import { fontString, lineHeight, wrapText } from './text';
import { clampLayout, type ClampLayout, type ClampObj } from './sticky';
import { fontStack } from '../types';
import rough from 'roughjs';

const roughGenerator = rough.generator();

// ---------- theme-aware canvas colors ----------
// Set by the theme layer (src/store/theme.ts) whenever light/dark changes, so the
// canvas clear, grid dots, and text-fade match the active theme.
export const sceneColors = {
  bg: '#f3f2ef',
  gridDot: 'rgba(60,60,70,0.18)',
  gridLine: 'rgba(60,60,70,0.08)',
};

export function setSceneColors(next: Partial<typeof sceneColors>) {
  Object.assign(sceneColors, next);
}

// ---------- image bitmap cache ----------

type CachedImage = ImageBitmap | HTMLImageElement;
const bitmapCache = new Map<string, CachedImage | 'loading' | 'missing'>();
let onBitmapReady: (() => void) | null = null;
let blobLoader: ((blobId: string) => Promise<Blob | undefined>) | null = null;

export function configureImageLoading(
  loader: (blobId: string) => Promise<Blob | undefined>,
  onReady: () => void
) {
  blobLoader = loader;
  onBitmapReady = onReady;
}

async function loadViaImgTag(blob: Blob): Promise<HTMLImageElement> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

export function getBitmap(blobId: string): CachedImage | null {
  const hit = bitmapCache.get(blobId);
  if (hit instanceof ImageBitmap || hit instanceof HTMLImageElement) return hit;
  if (hit === 'loading' || hit === 'missing') return null;
  bitmapCache.set(blobId, 'loading');
  blobLoader?.(blobId).then(async (blob) => {
    if (!blob) {
      bitmapCache.set(blobId, 'missing');
      return;
    }
    try {
      const bmp = await createImageBitmap(blob);
      bitmapCache.set(blobId, bmp);
      onBitmapReady?.();
    } catch {
      try {
        // Some environments fail createImageBitmap for SVG blobs.
        // Fallback to decoding via <img> so vector inserts still render.
        const img = await loadViaImgTag(blob);
        bitmapCache.set(blobId, img);
        onBitmapReady?.();
      } catch {
        bitmapCache.set(blobId, 'missing');
      }
    }
  });
  return null;
}

export function primeBitmap(blobId: string, bmp: ImageBitmap) {
  bitmapCache.set(blobId, bmp);
}

// ---------- video element cache ----------
// Videos are drawn into the 2D canvas frame-by-frame (so they behave exactly
// like image objects — selectable, draggable, exportable). A hidden, muted,
// looping <video> per blob feeds ctx.drawImage; while any are playing we ask
// the scene to keep redrawing.
const videoCache = new Map<string, HTMLVideoElement | 'loading' | 'missing'>();
let videoPumpRaf = 0;

function pumpVideos() {
  let anyPlaying = false;
  videoCache.forEach((v) => {
    if (v instanceof HTMLVideoElement && !v.paused && !v.ended && v.readyState >= 2) anyPlaying = true;
  });
  if (anyPlaying) {
    onBitmapReady?.(); // mark the scene dirty so the next frame redraws
    videoPumpRaf = requestAnimationFrame(pumpVideos);
  } else {
    videoPumpRaf = 0;
  }
}
function ensureVideoPump() {
  if (!videoPumpRaf) videoPumpRaf = requestAnimationFrame(pumpVideos);
}

function getVideoEl(blobId: string): HTMLVideoElement | null {
  const hit = videoCache.get(blobId);
  if (hit instanceof HTMLVideoElement) return hit.readyState >= 2 ? hit : null;
  if (hit === 'loading' || hit === 'missing') return null;
  videoCache.set(blobId, 'loading');
  blobLoader?.(blobId).then((blob) => {
    if (!blob) {
      videoCache.set(blobId, 'missing');
      return;
    }
    const v = document.createElement('video');
    v.src = URL.createObjectURL(blob);
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    v.oncanplay = () => {
      v.play().catch(() => {});
      onBitmapReady?.();
      ensureVideoPump();
    };
    videoCache.set(blobId, v);
  });
  return null;
}

export function drawVideo(ctx: CanvasRenderingContext2D, o: VideoObj) {
  const v = getVideoEl(o.blobId);
  ctx.save();
  ctx.globalAlpha = o.opacity;
  if (o.radius > 0) {
    const clip = new Path2D();
    clip.roundRect(o.x, o.y, o.w, o.h, o.radius);
    ctx.clip(clip);
  }
  if (v) {
    try {
      ctx.drawImage(v, o.x, o.y, o.w, o.h);
    } catch {
      /* frame not ready this tick */
    }
    ensureVideoPump();
  } else {
    ctx.fillStyle = 'rgba(140,140,150,0.2)';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeStyle = 'rgba(140,140,150,0.5)';
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    // play glyph
    ctx.fillStyle = 'rgba(90,90,100,0.6)';
    const cx = o.x + o.w / 2;
    const cy = o.y + o.h / 2;
    const r = Math.min(o.w, o.h) * 0.12;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.5, cy - r);
    ctx.lineTo(cx - r * 0.5, cy + r);
    ctx.lineTo(cx + r, cy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---------- scene ----------

export interface GridSettings {
  mode: 'dots' | 'lines' | 'none';
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  doc: Doc,
  camera: Camera,
  viewW: number,
  viewH: number,
  dpr: number,
  grid: GridSettings,
  editingId?: string | null
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewW, viewH);
  ctx.fillStyle = sceneColors.bg;
  ctx.fillRect(0, 0, viewW, viewH);

  if (grid.mode !== 'none') drawGrid(ctx, camera, viewW, viewH, grid.mode);

  const world = visibleWorldRect(camera, viewW, viewH);
  // expand a bit so stroke widths at the border aren't clipped out by culling
  const pad = 64 / camera.zoom;
  const cullBox: Box = {
    x: world.x - pad,
    y: world.y - pad,
    w: world.w + pad * 2,
    h: world.h + pad * 2,
  };

  ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, -camera.x * dpr * camera.zoom, -camera.y * dpr * camera.zoom);

  const objs = doc.visible(cullBox);
  const lod = camera.zoom < 0.08; // far-out LOD: boxes only
  for (const o of objs) {
    if (lod && o.type !== 'frame') {
      drawLodPlaceholder(ctx, o, doc);
      continue;
    }
    if (o.id === editingId) {
      // the text-editor overlay shows this object's text; render it textless
      if (o.type === 'text') continue;
      if (o.type === 'shape' || o.type === 'sticky') {
        drawObject(ctx, { ...o, text: '' }, doc, camera.zoom);
        continue;
      }
      if (o.type === 'connector') {
        drawObject(ctx, { ...o, label: '' }, doc, camera.zoom);
        continue;
      }
    }
    drawObject(ctx, o, doc, camera.zoom);
  }
}

function drawLodPlaceholder(ctx: CanvasRenderingContext2D, o: SlateObj, doc: Doc) {
  const b = boundsOf(o, doc.resolve);
  ctx.fillStyle = 'rgba(120,120,130,0.35)';
  ctx.fillRect(b.x, b.y, Math.max(b.w, 1), Math.max(b.h, 1));
}

export function drawObject(ctx: CanvasRenderingContext2D, o: SlateObj, doc: Doc, zoom: number) {
  ctx.save();
  if (o.rotation && o.type !== 'connector') {
    const b = boundsOf(o, doc.resolve);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(o.rotation);
    ctx.translate(-cx, -cy);
  }
  switch (o.type) {
    case 'frame':
      drawFrame(ctx, o, zoom);
      break;
    case 'stroke':
      drawStroke(ctx, o);
      break;
    case 'shape':
      drawShape(ctx, o);
      break;
    case 'sticky':
      drawSticky(ctx, o);
      break;
    case 'text':
      drawText(ctx, o);
      break;
    case 'image':
      drawImage(ctx, o);
      break;
    case 'video':
      drawVideo(ctx, o);
      break;
    case 'icon':
      drawIcon(ctx, o);
      break;
    case 'connector':
      drawConnector(ctx, o, doc);
      break;
  }
  ctx.restore();
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewW: number,
  viewH: number,
  mode: 'dots' | 'lines'
) {
  // pick a grid step that lands between 24 and 96 screen px
  let step = 32;
  while (step * camera.zoom < 24) step *= 2;
  while (step * camera.zoom > 96) step /= 2;

  const startX = Math.floor(camera.x / step) * step;
  const startY = Math.floor(camera.y / step) * step;
  const endX = camera.x + viewW / camera.zoom;
  const endY = camera.y + viewH / camera.zoom;

  ctx.save();
  if (mode === 'dots') {
    ctx.fillStyle = sceneColors.gridDot;
    const r = Math.max(1, 1.2);
    for (let x = startX; x <= endX; x += step) {
      for (let y = startY; y <= endY; y += step) {
        const sx = (x - camera.x) * camera.zoom;
        const sy = (y - camera.y) * camera.zoom;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    ctx.strokeStyle = sceneColors.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += step) {
      const sx = (x - camera.x) * camera.zoom;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, viewH);
    }
    for (let y = startY; y <= endY; y += step) {
      const sy = (y - camera.y) * camera.zoom;
      ctx.moveTo(0, sy);
      ctx.lineTo(viewW, sy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawStroke(ctx: CanvasRenderingContext2D, o: StrokeObj) {
  const cfg = PEN_CONFIGS[o.tool];
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.globalAlpha = o.opacity * cfg.opacityMul;
  ctx.globalCompositeOperation = cfg.composite;
  ctx.fillStyle = o.color;
  ctx.fill(strokePath(o));
  ctx.restore();
}

export function shapePath(o: ShapeObj): Path2D {
  const p = new Path2D();
  const { x, y, w, h } = o;
  switch (o.shape) {
    case 'rect':
      p.rect(x, y, w, h);
      break;
    case 'roundedRect': {
      const r = Math.min(o.radius, w / 2, h / 2);
      p.roundRect(x, y, w, h, r);
      break;
    }
    case 'ellipse':
      p.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    default: {
      const poly = shapePolygon(o.shape, { x, y, w, h });
      if (poly) {
        p.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) p.lineTo(poly[i].x, poly[i].y);
        p.closePath();
      }
    }
  }
  return p;
}

export function applyDash(ctx: CanvasRenderingContext2D, dash: string, width: number) {
  if (dash === 'dashed') ctx.setLineDash([width * 3, width * 2.5]);
  else if (dash === 'dotted') ctx.setLineDash([width * 0.5, width * 2]);
  else ctx.setLineDash([]);
}

export function drawShape(ctx: CanvasRenderingContext2D, o: ShapeObj) {
  ctx.save();
  ctx.globalAlpha = o.opacity;
  if (o.sketchy) {
    drawSketchy(ctx, o);
  } else {
    const path = shapePath(o);
    if (o.fill && o.fill !== 'transparent') {
      ctx.fillStyle = o.fill;
      ctx.fill(path);
    }
    if (o.strokeWidth > 0 && o.stroke !== 'transparent') {
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = o.strokeWidth;
      applyDash(ctx, o.dash, o.strokeWidth);
      ctx.stroke(path);
    }
  }
  if (o.text) {
    drawCenteredText(ctx, o.text, o, o.textColor, o.fontSize, o.fontFamily);
  }
  ctx.restore();
}

// ---------- sketchy (roughjs) rendering ----------

interface SketchyPath {
  d: string;
  path: Path2D;
  stroke: string;
  strokeWidth: number;
  fill: string;
  isBorder: boolean;
}

const sketchyCache = new WeakMap<ShapeObj, SketchyPath[]>();

export function sketchyPaths(o: ShapeObj): SketchyPath[] {
  let paths = sketchyCache.get(o);
  if (paths) return paths;
  const opts = {
    seed: o.seed ?? 7,
    roughness: 1.4,
    bowing: 1.2,
    stroke: o.stroke === 'transparent' ? 'none' : o.stroke,
    strokeWidth: o.strokeWidth,
    fill: o.fill !== 'transparent' ? o.fill : undefined,
    fillStyle: 'hachure',
    hachureGap: Math.max(5, o.strokeWidth * 4),
    fillWeight: Math.max(0.8, o.strokeWidth / 2),
  };
  const { x, y, w, h } = o;
  let drawable;
  switch (o.shape) {
    case 'rect':
      drawable = roughGenerator.rectangle(x, y, w, h, opts);
      break;
    case 'roundedRect': {
      const r = Math.min(o.radius, w / 2, h / 2);
      const d = `M${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r} L${x},${y + r} Q${x},${y} ${x + r},${y} Z`;
      // tame roughness on the corner curves or they come out mangled
      drawable = roughGenerator.path(d, {
        ...opts,
        roughness: 0.8,
        bowing: 0.7,
        preserveVertices: true,
        disableMultiStrokeFill: true,
      });
      break;
    }
    case 'ellipse':
      drawable = roughGenerator.ellipse(x + w / 2, y + h / 2, w, h, opts);
      break;
    default: {
      const poly = shapePolygon(o.shape, { x, y, w, h });
      drawable = roughGenerator.polygon(
        (poly ?? []).map((p) => [p.x, p.y] as [number, number]),
        opts
      );
    }
  }
  paths = roughGenerator.toPaths(drawable).map((info) => ({
    d: info.d,
    path: new Path2D(info.d),
    stroke: info.stroke,
    strokeWidth: info.strokeWidth,
    fill: info.fill ?? 'none',
    isBorder: info.stroke === o.stroke,
  }));
  sketchyCache.set(o, paths);
  return paths;
}

/** Raw path data for SVG export. */
export function sketchyPathInfos(o: ShapeObj): { d: string; stroke: string; strokeWidth: number; fill: string }[] {
  return sketchyPaths(o).map(({ d, stroke, strokeWidth, fill }) => ({ d, stroke, strokeWidth, fill }));
}

function drawSketchy(ctx: CanvasRenderingContext2D, o: ShapeObj) {
  for (const p of sketchyPaths(o)) {
    if (p.fill && p.fill !== 'none') {
      ctx.fillStyle = p.fill;
      ctx.fill(p.path);
    }
    if (p.stroke && p.stroke !== 'none') {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth;
      ctx.lineCap = 'round';
      applyDash(ctx, p.isBorder ? o.dash : 'solid', o.strokeWidth);
      ctx.stroke(p.path);
      ctx.setLineDash([]);
    }
  }
}

function drawCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  b: Box,
  color: string,
  fontSize: number,
  fontId?: string
) {
  const maxW = Math.max(8, b.w - 16);
  const lines = wrapText(text, fontSize, maxW, 400, fontId);
  const lh = lineHeight(fontSize);
  const totalH = lines.length * lh;
  ctx.fillStyle = color;
  ctx.font = fontString(fontSize, 400, fontStack(fontId));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = b.x + b.w / 2;
  let y = b.y + b.h / 2 - totalH / 2 + lh / 2;
  for (const line of lines) {
    ctx.fillText(line, cx, y);
    y += lh;
  }
}

export function drawSticky(ctx: CanvasRenderingContext2D, o: StickyObj) {
  ctx.save();
  // soft shadow for the paper feel
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = o.color;
  const p = new Path2D();
  p.roundRect(o.x, o.y, o.w, o.h, 4);
  ctx.fill(p);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  if (o.text) {
    const layout = clampLayout(o);
    const lh = lineHeight(o.fontSize);
    ctx.fillStyle = 'rgba(20,20,20,0.92)';
    ctx.font = fontString(o.fontSize, 500, fontStack(o.fontFamily));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let y = o.y + 12;
    for (const line of layout.lines) {
      ctx.fillText(line, o.x + 12, y);
      y += lh;
    }
    // fade clamped overflow into the paper (the sticky's own color)
    drawClampOverlay(ctx, o, layout, o.color);
  }
  ctx.restore();
}

/** Same color at zero alpha, so a fade reads as "dissolving" rather than greying out. */
function transparentVariant(color: string): string {
  const h = color.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h);
  if (m) {
    const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},0)`;
  }
  return 'rgba(0,0,0,0)';
}

/** Draw the fade + "Show more · N words" pill over a clamped object's overflow. */
function drawClampOverlay(
  ctx: CanvasRenderingContext2D,
  o: ClampObj,
  layout: ClampLayout,
  fadeColor: string
) {
  if (!layout.clamped || !layout.chip) return;
  const chip = layout.chip;
  const lh = lineHeight(o.fontSize);
  const fadeTop = chip.y - lh;
  const grad = ctx.createLinearGradient(0, fadeTop, 0, chip.y + chip.h);
  grad.addColorStop(0, transparentVariant(fadeColor));
  grad.addColorStop(1, fadeColor);
  ctx.fillStyle = grad;
  ctx.fillRect(o.x - 2, fadeTop, o.w + 4, o.y + o.h - fadeTop);

  const label = `Show more · ${layout.wordCount} words`;
  const pill = new Path2D();
  pill.roundRect(chip.x, chip.y, chip.w, chip.h, chip.h / 2);
  ctx.fillStyle = 'rgba(20,20,20,0.08)';
  ctx.fill(pill);
  ctx.fillStyle = 'rgba(20,20,20,0.66)';
  ctx.font = fontString(Math.max(11, o.fontSize - 4), 600, fontStack(o.fontFamily));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, chip.x + chip.w / 2, chip.y + chip.h / 2);
}

export function drawText(ctx: CanvasRenderingContext2D, o: TextObj) {
  ctx.save();
  ctx.fillStyle = o.color;
  ctx.font = fontString(o.fontSize, 400, fontStack(o.fontFamily));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const layout = clampLayout(o);
  const lh = lineHeight(o.fontSize);
  let y = o.y;
  for (const line of layout.lines) {
    ctx.fillText(line, o.x, y);
    y += lh;
  }
  drawClampOverlay(ctx, o, layout, sceneColors.bg);
  ctx.restore();
}

export function drawImage(ctx: CanvasRenderingContext2D, o: ImageObj) {
  const bmp = getBitmap(o.blobId);
  ctx.save();
  ctx.globalAlpha = o.opacity;
  if (o.radius > 0) {
    const clip = new Path2D();
    clip.roundRect(o.x, o.y, o.w, o.h, o.radius);
    ctx.clip(clip);
  }
  if (bmp) {
    ctx.drawImage(bmp, o.x, o.y, o.w, o.h);
  } else {
    ctx.fillStyle = 'rgba(140,140,150,0.2)';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeStyle = 'rgba(140,140,150,0.5)';
    ctx.strokeRect(o.x, o.y, o.w, o.h);
  }
  ctx.restore();
}

export function drawIcon(ctx: CanvasRenderingContext2D, o: IconObj) {
  ctx.save();
  ctx.globalAlpha = o.opacity;
  ctx.translate(o.x, o.y);
  ctx.scale(o.w / 24, o.h / 24);
  ctx.strokeStyle = o.color;
  ctx.lineWidth = o.strokeWidth ?? 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of iconPaths(o.icon)) ctx.stroke(p);
  ctx.restore();
}

export function drawFrame(ctx: CanvasRenderingContext2D, o: FrameObj, zoom: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillRect(o.x, o.y, o.w, o.h);
  ctx.strokeStyle = 'rgba(100,100,115,0.5)';
  ctx.lineWidth = 1 / zoom;
  ctx.strokeRect(o.x, o.y, o.w, o.h);
  // frame label (constant screen size)
  const fs = 12 / zoom;
  ctx.fillStyle = 'rgba(90,90,105,0.9)';
  ctx.font = fontString(fs, 600);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(o.name, o.x, o.y - 4 / zoom);
  ctx.restore();
}

export function drawConnector(ctx: CanvasRenderingContext2D, o: ConnectorObj, doc: Doc) {
  const pts = routeConnector(o, doc.resolve);
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = o.opacity;
  ctx.strokeStyle = o.stroke;
  ctx.fillStyle = o.stroke;
  ctx.lineWidth = o.strokeWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  applyDash(ctx, o.dash, o.strokeWidth);

  // shorten ends to make room for arrowheads
  const headLen = o.strokeWidth * 4 + 4;
  const drawPts = [...pts];
  if (o.endArrow !== 'none') trimEnd(drawPts, headLen * 0.6);
  if (o.startArrow !== 'none') trimStart(drawPts, headLen * 0.6);

  ctx.beginPath();
  ctx.moveTo(drawPts[0].x, drawPts[0].y);
  if (o.routing === 'curved' && pts.length > 8) {
    for (const p of drawPts.slice(1)) ctx.lineTo(p.x, p.y);
  } else {
    for (const p of drawPts.slice(1)) ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  if (o.endArrow === 'triangle') {
    drawArrowhead(ctx, pts[pts.length - 2], pts[pts.length - 1], headLen);
  }
  if (o.startArrow === 'triangle') {
    drawArrowhead(ctx, pts[1], pts[0], headLen);
  }
  if (o.label) {
    const mid = polylineMidpoint(pts);
    const fs = 13;
    ctx.font = fontString(fs, 500);
    const tw = ctx.measureText(o.label).width;
    const padX = 6;
    const bg = new Path2D();
    bg.roundRect(mid.x - tw / 2 - padX, mid.y - 10, tw + padX * 2, 20, 6);
    ctx.fillStyle = '#f3f2ef';
    ctx.fill(bg);
    ctx.fillStyle = o.stroke;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.label, mid.x, mid.y + 0.5);
  }
  ctx.restore();
}

function trimEnd(pts: Vec[], by: number) {
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = Math.max(0, 1 - by / d);
  pts[pts.length - 1] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function trimStart(pts: Vec[], by: number) {
  const a = pts[1];
  const b = pts[0];
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = Math.max(0, 1 - by / d);
  pts[0] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function drawArrowhead(ctx: CanvasRenderingContext2D, from: Vec, tip: Vec, len: number) {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - len * Math.cos(angle - spread), tip.y - len * Math.sin(angle - spread));
  ctx.lineTo(tip.x - len * Math.cos(angle + spread), tip.y - len * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();
}

import type { Box, BoardMeta, ConnectorObj, DrawStyle, IconObj, ImageObj, ShapeObj, SlateObj, StickyObj, StrokeObj, TextObj, VideoObj } from '../types';
import { fontStack } from '../types';
import { iconDef } from '../engine/icons';
import type { Doc } from '../engine/doc';
import { aabbOf, boundsOf, boxUnion, cornerRadius, polylineMidpoint, routeConnector, shapePolygon } from '../engine/geometry';
import { arrowHeadLen, chevronArms, connectorLabelHeight, drawObject, isSketchy, getBitmap } from '../engine/renderer';
import { connectorDrawable, drawFontId, drawFontWeight, labelFontOf, shapeDrawable, styleRendererFor, type StyledPath } from '../engine/styles';
import { boardStyleOf, isDrawStyle } from '../engine/style';
import { stickyDateGeom, stickyDateLabel, stickyShadowOffset, STICKY_DATE_COLOR, STICKY_SHADOW } from '../engine/sticky';
import { outlineToSvgPathData, strokeOutline, PEN_CONFIGS, type InputPoint } from '../engine/ink';
import { fontString, lineHeight, textBlockSize, wrapText, FONT_FAMILY } from '../engine/text';
import { caveatFaceCss, ensureObjectFonts, excalifontFaceCss, kalamFaceCss } from '../engine/fonts';
import { db, getBlob, putBlob, createBoard } from '../store/db';
import { nanoid } from 'nanoid';

export function exportBounds(doc: Doc, selection?: Set<string>): Box | null {
  const objs =
    selection && selection.size > 0
      ? [...selection].map((id) => doc.get(id)).filter((o): o is SlateObj => !!o)
      : doc.all();
  if (objs.length === 0) return null;
  const b = boxUnion(objs.map((o) => aabbOf(o, doc.resolve)));
  const pad = 32;
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

async function ensureBitmaps(doc: Doc, box: Box) {
  const images = doc.all().filter((o): o is ImageObj => o.type === 'image');
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (getBitmap(img.blobId)) return resolve();
          // getBitmap kicked off a load; poll briefly
          let tries = 0;
          const t = setInterval(() => {
            if (getBitmap(img.blobId) || ++tries > 100) {
              clearInterval(t);
              resolve();
            }
          }, 50);
        })
    )
  );
}

export async function exportPng(
  doc: Doc,
  box: Box,
  scale: number,
  transparent: boolean
): Promise<Blob> {
  await ensureBitmaps(doc, box);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.w * scale));
  canvas.height = Math.max(1, Math.round(box.h * scale));
  const ctx = canvas.getContext('2d')!;
  if (!transparent) {
    ctx.fillStyle = '#f3f2ef';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
  const visible = doc
    .allSorted()
    .filter((o) => {
      const b = aabbOf(o, doc.resolve);
      return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
    });
  await ensureObjectFonts(
    visible,
    (o) => styleRendererFor(o, doc.style).fontId(o.fontFamily),
    // (a style's own label weight; text at its style weight on a 400 base)
    (o) => {
      const sr = styleRendererFor(o, doc.style);
      if (o.type === 'connector') return sr.labelFont ? sr.labelFont.weight : 400;
      return sr.fontWeight ? sr.fontWeight(o.fontSize ?? 16, 400) : 400;
    }
  );
  for (const o of visible) drawObject(ctx, o, doc, scale);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('export failed'))), 'image/png')
  );
}

// ---------- SVG ----------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function exportSvg(doc: Doc, box: Box, transparent: boolean): Promise<string> {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" width="${box.w}" height="${box.h}" font-family="${esc(FONT_FAMILY)}">`
  );
  if (!transparent) {
    parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#f3f2ef"/>`);
  }
  const visible = doc.allSorted().filter((o) => {
    const b = aabbOf(o, doc.resolve);
    return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
  });
  // embed Excalifont (and Kalam, the pen stack's fallback) so the file still renders handwritten outside the app
  const fontOf = (o: SlateObj) => styleRendererFor(o, doc.style).fontId((o as { fontFamily?: string }).fontFamily);
  const textIn = (family: string) =>
    visible
      .filter((o) => 'text' in o && typeof o.text === 'string' && fontStack(fontOf(o)).includes(family))
      .map((o) => (o as { text: string }).text)
      .join('');
  const excaliText = textIn('Excalifont');
  // connector labels have no fontFamily of their own; the style picks theirs
  const kalamText =
    textIn('Kalam') +
    visible
      .filter((o): o is ConnectorObj => o.type === 'connector' && !!o.label && fontStack(fontOf(o)).includes('Kalam'))
      .map((o) => o.label)
      .join('');
  // Caveat (the 'messy' style's font) per weight it is drawn at, labels included
  const caveatText = new Map<number, string>();
  for (const o of visible) {
    const t = o.type === 'connector' ? o.label ?? '' : 'text' in o && typeof o.text === 'string' ? o.text : '';
    if (!t || !fontStack(fontOf(o)).includes('Caveat')) continue;
    const weight =
      o.type === 'connector'
        ? labelFontOf(styleRendererFor(o, doc.style)).weight
        : drawFontWeight(o as { fontSize: number }, doc.style, o.type === 'sticky' ? 500 : 400);
    caveatText.set(weight, (caveatText.get(weight) ?? '') + t);
  }
  const css = [
    excaliText ? await excalifontFaceCss(excaliText).catch(() => '') : '',
    kalamText ? await kalamFaceCss(kalamText).catch(() => '') : '',
    caveatText.size ? await caveatFaceCss(caveatText).catch(() => '') : '',
  ].filter(Boolean);
  if (css.length) parts.push(`<defs><style>${css.join('\n')}</style></defs>`);
  for (const o of visible) {
    const rot = o.rotation && o.type !== 'connector'
      ? (() => {
          const b = boundsOf(o, doc.resolve);
          return ` transform="rotate(${(o.rotation * 180) / Math.PI} ${b.x + b.w / 2} ${b.y + b.h / 2})"`;
        })()
      : '';
    parts.push(`<g${rot}>`);
    parts.push(await objectToSvg(o, doc));
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('\n');
}

async function objectToSvg(o: SlateObj, doc: Doc): Promise<string> {
  // the same style dispatch the canvas uses (engine/styles), so the file matches the screen
  const sr = styleRendererFor(o, doc.style);
  switch (o.type) {
    case 'stroke': {
      const s = o as StrokeObj;
      const pts: InputPoint[] = [];
      for (let i = 0; i < s.points.length; i += 3) {
        pts.push({ x: s.points[i] + s.x, y: s.points[i + 1] + s.y, p: s.points[i + 2] });
      }
      const d = outlineToSvgPathData(strokeOutline(pts, s.tool, s.size));
      const cfg = PEN_CONFIGS[s.tool];
      const op = s.opacity * cfg.opacityMul;
      const blend = s.tool === 'marker' ? ' style="mix-blend-mode:multiply"' : '';
      return `<path d="${d}" fill="${s.color}" fill-opacity="${op}"${blend}/>`;
    }
    case 'shape': {
      const s = o as ShapeObj;
      if (isSketchy(s)) {
        let el = sketchySvg(shapeDrawable(s, doc.style), s.dash, s.strokeWidth, s.opacity);
        if (s.text) el += centeredTextSvg(s.text, s, s.textColor, s.fontSize, ...faceOf(s, doc));
        return el;
      }
      const fill = s.fill === 'transparent' ? 'none' : s.fill;
      const dashAttr =
        s.dash === 'dashed'
          ? ` stroke-dasharray="${s.strokeWidth * 3} ${s.strokeWidth * 2.5}"`
          : s.dash === 'dotted'
            ? ` stroke-dasharray="${s.strokeWidth * 0.5} ${s.strokeWidth * 2}" stroke-linecap="round"`
            : '';
      const common = `fill="${fill}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" opacity="${s.opacity}"${dashAttr}`;
      let el = '';
      if (s.shape === 'rect') el = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" ${common}/>`;
      else if (s.shape === 'roundedRect')
        el = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${cornerRadius(s)}" ${common}/>`;
      else if (s.shape === 'ellipse')
        el = `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${s.w / 2}" ry="${s.h / 2}" ${common}/>`;
      else {
        const poly = shapePolygon(s.shape, { x: s.x, y: s.y, w: s.w, h: s.h });
        if (poly) el = `<polygon points="${poly.map((p) => `${p.x},${p.y}`).join(' ')}" ${common}/>`;
      }
      if (s.text) el += centeredTextSvg(s.text, s, s.textColor, s.fontSize, ...faceOf(s, doc));
      return el;
    }
    case 'sticky': {
      const s = o as StickyObj;
      const d = sr.stickyPaper(s);
      const font = drawFontId(s, doc.style);
      const weight = drawFontWeight(s, doc.style, 500);
      const off = stickyShadowOffset(s);
      let el = `<path d="${d}" transform="translate(${off} ${off})" fill="${STICKY_SHADOW}"/>`;
      el += `<path d="${d}" fill="${s.color}"/>`;
      if (s.text) {
        const lines = wrapText(s.text, s.fontSize, s.w - 24, weight, font);
        const lh = lineHeight(s.fontSize);
        const top = s.y + Math.max(12, (s.h - lines.length * lh) / 2);
        let y = top + s.fontSize * 0.8;
        const cx = s.x + s.w / 2;
        for (const line of lines) {
          el += `<text x="${cx}" y="${y}" text-anchor="middle" font-size="${s.fontSize}" font-weight="${weight}" font-family="${esc(fontStack(font))}" fill="rgba(20,20,20,0.92)">${esc(line)}</text>`;
          y += lh;
        }
      }
      const date = stickyDateLabel(s);
      if (date) {
        const g = stickyDateGeom(s);
        el += `<text x="${g.x}" y="${g.y}" text-anchor="end" font-size="${g.size}" font-family="${esc(fontStack('sans'))}" fill="${STICKY_DATE_COLOR}">${esc(date)}</text>`;
      }
      return el;
    }
    case 'text': {
      const t = o as TextObj;
      const font = drawFontId(t, doc.style);
      const weight = drawFontWeight(t, doc.style, 400);
      const lines = t.fixedWidth ? wrapText(t.text, t.fontSize, t.w, weight, font) : t.text.split('\n');
      const lh = lineHeight(t.fontSize);
      let y = t.y + t.fontSize * 0.8;
      let el = '';
      for (const line of lines) {
        el += `<text x="${t.x}" y="${y}" font-size="${t.fontSize}"${weightAttr(weight)} font-family="${esc(fontStack(font))}" fill="${t.color}">${esc(line)}</text>`;
        y += lh;
      }
      return el;
    }
    case 'image': {
      const img = o as ImageObj;
      const blob = await getBlob(img.blobId);
      if (!blob) return '';
      const dataUrl = await blobToDataUrl(blob);
      const rx = img.radius > 0 ? ` clip-path="inset(0 round ${img.radius}px)"` : '';
      return `<image x="${img.x}" y="${img.y}" width="${img.w}" height="${img.h}" opacity="${img.opacity}" href="${dataUrl}"${rx}/>`;
    }
    case 'video': {
      // static SVG can't play video — export a dark poster with a play glyph
      const v = o as VideoObj;
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      const r = Math.min(v.w, v.h) * 0.12;
      const rx = v.radius > 0 ? ` rx="${v.radius}" ry="${v.radius}"` : '';
      return (
        `<rect x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}"${rx} fill="#15151a" opacity="${v.opacity}"/>` +
        `<polygon points="${cx - r * 0.5},${cy - r} ${cx - r * 0.5},${cy + r} ${cx + r},${cy}" fill="#ffffff" opacity="0.85"/>`
      );
    }
    case 'connector': {
      const c = o as ConnectorObj;
      const pts = routeConnector(c, doc.resolve);
      if (pts.length < 2) return '';
      let el = '';
      if (isSketchy(c)) {
        el = sketchySvg(connectorDrawable(c, pts, doc.style), c.dash, c.strokeWidth, c.opacity);
      } else {
        const d = `M${pts.map((p) => `${p.x},${p.y}`).join('L')}`;
        el = `<path d="${d}" fill="none" stroke="${c.stroke}" stroke-width="${c.strokeWidth}" opacity="${c.opacity}" stroke-linejoin="round" stroke-linecap="round"${dashSvg(c.dash, c.strokeWidth)}/>`;
        const headLen = arrowHeadLen(c, pts);
        if (c.endArrow !== 'none') el += arrowSvg(pts[pts.length - 2], pts[pts.length - 1], headLen, c, c.endArrow);
        if (c.startArrow !== 'none') el += arrowSvg(pts[1], pts[0], headLen, c, c.startArrow);
      }
      if (c.label) {
        const mid = polylineMidpoint(pts);
        const font = sr.fontId(undefined);
        const family = font ? ` font-family="${esc(fontStack(font))}"` : '';
        if (!sr.labelFont) {
          const w = c.label.length * 7.5 + 12;
          el += `<rect x="${mid.x - w / 2}" y="${mid.y - 10}" width="${w}" height="20" rx="6" fill="#f3f2ef"/>`;
          el += `<text x="${mid.x}" y="${mid.y + 4}" font-size="13" font-weight="500" fill="${c.stroke}" text-anchor="middle"${family}>${esc(c.label)}</text>`;
        } else {
          // a style that sizes its own labels: measure the pill in the label's font
          const lf = sr.labelFont;
          const w = textBlockSize(c.label, lf.size, undefined, lf.weight, font).w + 12;
          const h = connectorLabelHeight(lf.size);
          el += `<rect x="${mid.x - w / 2}" y="${mid.y - h / 2}" width="${w}" height="${h}" rx="6" fill="#f3f2ef"/>`;
          el += `<text x="${mid.x}" y="${mid.y + lf.size * 0.3}" font-size="${lf.size}" font-weight="${lf.weight}" fill="${c.stroke}" text-anchor="middle"${family}>${esc(c.label)}</text>`;
        }
      }
      return el;
    }
    case 'icon': {
      const ic = o as IconObj;
      const def = iconDef(ic.icon);
      if (!def) return '';
      const paths = def.d
        .map((d) => `<path d="${d}" fill="none" stroke="${ic.color}" stroke-width="${ic.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round"/>`)
        .join('');
      return `<g transform="translate(${ic.x} ${ic.y}) scale(${ic.w / 24} ${ic.h / 24})" opacity="${ic.opacity}">${paths}</g>`;
    }
    case 'frame': {
      const f = o;
      return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" fill="rgba(255,255,255,0.65)" stroke="rgba(100,100,115,0.5)"/><text x="${f.x}" y="${f.y - 6}" font-size="12" font-weight="600" fill="rgba(90,90,105,0.9)">${esc(f.name)}</text>`;
    }
  }
}

function centeredTextSvg(
  text: string,
  b: { x: number; y: number; w: number; h: number },
  color: string,
  fontSize: number,
  fontId?: string,
  weight = 400
): string {
  const lines = wrapText(text, fontSize, Math.max(8, b.w - 16), weight, fontId);
  const lh = lineHeight(fontSize);
  const totalH = lines.length * lh;
  let y = b.y + b.h / 2 - totalH / 2 + lh / 2 + fontSize * 0.3;
  let el = '';
  for (const line of lines) {
    el += `<text x="${b.x + b.w / 2}" y="${y}" font-size="${fontSize}"${weightAttr(weight)} font-family="${esc(fontStack(fontId))}" fill="${color}" text-anchor="middle">${esc(line)}</text>`;
    y += lh;
  }
  return el;
}

/** [fontId, weight] a shape's label draws with in its style. */
function faceOf(s: ShapeObj, doc: Doc): [string | undefined, number] {
  return [drawFontId(s, doc.style), drawFontWeight(s, doc.style, 400)];
}

/** font-weight attribute, omitted at the default 400 */
const weightAttr = (weight: number) => (weight === 400 ? '' : ` font-weight="${weight}"`);

/** SVG dash attributes matching applyDash on the canvas. */
function dashSvg(dash: string, width: number): string {
  if (dash === 'dashed') return ` stroke-dasharray="${width * 3} ${width * 2.5}"`;
  if (dash === 'dotted') return ` stroke-dasharray="${width * 0.5} ${width * 2}"`;
  return '';
}

/** roughjs paths as SVG, styled like strokeSketchyPaths on the canvas. */
function sketchySvg(paths: StyledPath[], dash: string, width: number, opacity: number): string {
  let el = '';
  for (const p of paths) {
    const dashAttr = !p.isBorder ? '' : p.dash ? ` stroke-dasharray="${p.dash.join(' ')}"` : dashSvg(dash, width);
    el += `<path d="${p.d}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" fill-rule="evenodd"${dashAttr}/>`;
  }
  return el;
}

function arrowSvg(from: { x: number; y: number }, tip: { x: number; y: number }, len: number, c: ConnectorObj, kind: ConnectorObj['endArrow']): string {
  const { stroke: color, opacity } = c;
  if (kind === 'chevron') {
    const [a, b] = chevronArms(from, tip, len);
    return `<path d="M${a.x},${a.y}L${tip.x},${tip.y}L${b.x},${b.y}" fill="none" stroke="${color}" stroke-width="${c.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
  }
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const spread = Math.PI / 7;
  const p1 = { x: tip.x - len * Math.cos(angle - spread), y: tip.y - len * Math.sin(angle - spread) };
  const p2 = { x: tip.x - len * Math.cos(angle + spread), y: tip.y - len * Math.sin(angle + spread) };
  return `<polygon points="${tip.x},${tip.y} ${p1.x},${p1.y} ${p2.x},${p2.y}" fill="${color}" opacity="${opacity}"/>`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// ---------- .slate file (full-fidelity backup) ----------

interface SlateFile {
  format: 'slate';
  version: 1;
  board: { name: string; viewport: BoardMeta['viewport']; style?: DrawStyle };
  objects: SlateObj[];
  blobs: Record<string, string>; // blobId -> dataURL
}

/** Everything on this machine in one file — boards, projects, kits, components, prompts, blobs. */
export interface SlateArchive {
  format: 'slate-archive';
  version: 1;
  exportedAt: number;
  boards: { meta: BoardMeta; objects: SlateObj[] }[];
  projects: unknown[];
  brandKits: unknown[];
  components: unknown[];
  prompts: unknown[];
  blobs: Record<string, string>; // blobId -> dataURL
}

/** Every blob id an object references — image, ready video, upload full-file content. */
function blobIdsOf(o: SlateObj): string[] {
  const ids: string[] = [];
  if ((o.type === 'image' || o.type === 'video') && o.blobId && !String(o.blobId).startsWith('pending-')) ids.push(o.blobId);
  const file = (o as { file?: { blobId?: string } }).file;
  if (file?.blobId) ids.push(file.blobId);
  return ids;
}

/** blobId -> dataURL for every blob the objects reference. Nothing is dropped. */
async function collectBlobs(objects: SlateObj[]): Promise<Record<string, string>> {
  const blobs: Record<string, string> = {};
  for (const o of objects) {
    for (const id of blobIdsOf(o)) {
      if (blobs[id]) continue;
      const blob = await getBlob(id);
      if (blob) blobs[id] = await blobToDataUrl(blob);
    }
  }
  return blobs;
}

export async function exportSlateFile(meta: BoardMeta, doc: Doc): Promise<Blob> {
  return buildSlateFile(meta, doc.allSorted());
}

/** Export a board straight from IndexedDB — no live doc needed (works from Home). */
export async function exportSlateFileById(boardId: string): Promise<{ blob: Blob; name: string } | null> {
  const meta = await db.boards.get(boardId);
  if (!meta) return null;
  const rows = await db.objects.where('boardId').equals(boardId).toArray();
  return { blob: await buildSlateFile(meta, rows.map((r) => r.data)), name: meta.name };
}

async function buildSlateFile(meta: BoardMeta, objects: SlateObj[]): Promise<Blob> {
  const file: SlateFile = {
    format: 'slate',
    version: 1,
    board: { name: meta.name, viewport: meta.viewport, style: boardStyleOf(meta) },
    objects,
    blobs: await collectBlobs(objects),
  };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

/** Rewrites an imported object's blob references to the freshly-stored blob ids. */
function remapBlobIds(o: SlateObj, blobIdMap: Map<string, string>) {
  if ((o.type === 'image' || o.type === 'video') && blobIdMap.has(o.blobId)) o.blobId = blobIdMap.get(o.blobId)!;
  const file = (o as { file?: { blobId?: string } }).file;
  if (file?.blobId && blobIdMap.has(file.blobId)) file.blobId = blobIdMap.get(file.blobId)!;
}

export async function importSlateFile(file: File): Promise<BoardMeta> {
  const data = JSON.parse(await file.text()) as SlateFile;
  if (data.format !== 'slate') throw new Error('Not a .slate file');
  const blobIdMap = await restoreBlobs(data.blobs);
  const board = await createBoard(
    data.board.name || file.name.replace(/\.slate$/, ''),
    null,
    isDrawStyle(data.board.style) ? data.board.style : undefined
  );
  await db.boards.update(board.id, { viewport: data.board.viewport });
  await restoreBoardObjects(board.id, data.objects ?? [], blobIdMap);
  return board;
}

/** Re-store blobs under fresh ids; returns old id -> new id. */
async function restoreBlobs(blobs: Record<string, string> | undefined): Promise<Map<string, string>> {
  const blobIdMap = new Map<string, string>();
  for (const [oldId, dataUrl] of Object.entries(blobs ?? {})) {
    const blob = await (await fetch(dataUrl)).blob();
    blobIdMap.set(oldId, await putBlob(blob));
  }
  return blobIdMap;
}

/** Clone objects under fresh ids into `boardId`, remapping refs (connectors, parents, blobs). */
async function restoreBoardObjects(boardId: string, source: SlateObj[], blobIdMap: Map<string, string>) {
  const objects = source.map((o) => {
    const clone = structuredClone(o);
    clone.id = nanoid(8);
    remapBlobIds(clone, blobIdMap);
    return clone;
  });
  const idMap = new Map<string, string>();
  source.forEach((orig, i) => idMap.set(orig.id, objects[i].id));
  for (const o of objects) {
    if (o.parentId) o.parentId = idMap.get(o.parentId) ?? null;
    if (o.type === 'connector') {
      if (o.from.objectId) o.from.objectId = idMap.get(o.from.objectId) ?? undefined;
      if (o.to.objectId) o.to.objectId = idMap.get(o.to.objectId) ?? undefined;
    }
  }
  await db.objects.bulkPut(objects.map((o) => ({ id: `${boardId}:${o.id}`, boardId, data: o })));
}

// ---------- whole-workspace archive (backup / migration between machines & origins) ----------

export async function exportArchive(): Promise<Blob> {
  const [boards, projects, brandKits, components, prompts] = await Promise.all([
    db.boards.toArray(),
    db.projects.toArray(),
    db.brandKits.toArray(),
    db.components.toArray(),
    db.prompts.toArray(),
  ]);
  const withObjects = await Promise.all(
    boards.map(async (meta) => ({
      meta,
      objects: (await db.objects.where('boardId').equals(meta.id).toArray()).map((r) => r.data),
    })),
  );
  // components carry objects too (their blobs must survive a restore)
  const allObjects = [
    ...withObjects.flatMap((b) => b.objects),
    ...components.flatMap((c) => c.objects ?? []),
  ];
  const archive: SlateArchive = {
    format: 'slate-archive',
    version: 1,
    exportedAt: Date.now(),
    boards: withObjects,
    projects,
    brandKits,
    components,
    prompts,
    blobs: await collectBlobs(allObjects),
  };
  return new Blob([JSON.stringify(archive)], { type: 'application/json' });
}

/** Restore an archive alongside existing data — nothing is overwritten; everything gets fresh ids. */
export async function importArchive(file: File): Promise<{ boards: number; projects: number }> {
  const data = JSON.parse(await file.text()) as SlateArchive;
  if (data.format !== 'slate-archive') throw new Error('Not a Slate archive');
  const blobIdMap = await restoreBlobs(data.blobs);

  const projectIdMap = new Map<string, string>();
  for (const p of (data.projects ?? []) as { id: string; name?: string }[]) {
    const fresh = { ...p, id: nanoid(10) };
    projectIdMap.set(p.id, fresh.id);
    await db.projects.put(fresh as never);
  }
  for (const k of (data.brandKits ?? []) as { id: string }[]) await db.brandKits.put({ ...k, id: nanoid(10) } as never);
  for (const c of (data.components ?? []) as { id: string; objects?: SlateObj[] }[]) {
    const clone = structuredClone(c);
    clone.id = nanoid(10);
    for (const o of clone.objects ?? []) remapBlobIds(o, blobIdMap);
    await db.components.put(clone as never);
  }
  for (const p of (data.prompts ?? []) as { id: string }[]) await db.prompts.put({ ...p, id: nanoid(10) } as never);

  for (const b of data.boards ?? []) {
    const meta: BoardMeta = {
      ...b.meta,
      id: nanoid(10),
      projectId: b.meta.projectId ? projectIdMap.get(b.meta.projectId) ?? null : null,
    };
    await db.boards.put(meta);
    await restoreBoardObjects(meta.id, b.objects ?? [], blobIdMap);
  }
  return { boards: (data.boards ?? []).length, projects: (data.projects ?? []).length };
}

/** Import either a single .slate board or a whole archive; dispatch on the format field. */
export async function importAnySlateFile(file: File): Promise<{ kind: 'board'; board: BoardMeta } | { kind: 'archive'; boards: number; projects: number }> {
  const text = await file.text();
  const format = (JSON.parse(text) as { format?: string }).format;
  // re-wrap so each importer can parse independently (files are small enough to re-read)
  const clone = new File([text], file.name, { type: file.type });
  if (format === 'slate-archive') return { kind: 'archive', ...(await importArchive(clone)) };
  return { kind: 'board', board: await importSlateFile(clone) };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

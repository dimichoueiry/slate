import type { Box, BoardMeta, ConnectorObj, IconObj, ImageObj, ShapeObj, SlateObj, StickyObj, StrokeObj, TextObj } from '../types';
import { fontStack } from '../types';
import { iconDef } from '../engine/icons';
import type { Doc } from '../engine/doc';
import { aabbOf, boundsOf, boxUnion, polylineMidpoint, routeConnector, shapePolygon } from '../engine/geometry';
import { drawObject, getBitmap, sketchyPathInfos } from '../engine/renderer';
import { outlineToSvgPathData, strokeOutline, PEN_CONFIGS, type InputPoint } from '../engine/ink';
import { fontString, lineHeight, wrapText, FONT_FAMILY } from '../engine/text';
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
      if (s.sketchy) {
        let el = '';
        for (const p of sketchyPathInfos(s)) {
          el += `<path d="${p.d}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-linecap="round" opacity="${s.opacity}" fill-rule="evenodd"/>`;
        }
        if (s.text) el += centeredTextSvg(s.text, s, s.textColor, s.fontSize, s.fontFamily);
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
        el = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${Math.min(s.radius, s.w / 2, s.h / 2)}" ${common}/>`;
      else if (s.shape === 'ellipse')
        el = `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${s.w / 2}" ry="${s.h / 2}" ${common}/>`;
      else {
        const poly = shapePolygon(s.shape, { x: s.x, y: s.y, w: s.w, h: s.h });
        if (poly) el = `<polygon points="${poly.map((p) => `${p.x},${p.y}`).join(' ')}" ${common}/>`;
      }
      if (s.text) el += centeredTextSvg(s.text, s, s.textColor, s.fontSize, s.fontFamily);
      return el;
    }
    case 'sticky': {
      const s = o as StickyObj;
      let el = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="4" fill="${s.color}"/>`;
      if (s.text) {
        const lines = wrapText(s.text, s.fontSize, s.w - 24, 500, s.fontFamily);
        const lh = lineHeight(s.fontSize);
        let y = s.y + 12 + s.fontSize * 0.8;
        for (const line of lines) {
          el += `<text x="${s.x + 12}" y="${y}" font-size="${s.fontSize}" font-weight="500" font-family="${esc(fontStack(s.fontFamily))}" fill="rgba(20,20,20,0.92)">${esc(line)}</text>`;
          y += lh;
        }
      }
      return el;
    }
    case 'text': {
      const t = o as TextObj;
      const lines = t.fixedWidth ? wrapText(t.text, t.fontSize, t.w, 400, t.fontFamily) : t.text.split('\n');
      const lh = lineHeight(t.fontSize);
      let y = t.y + t.fontSize * 0.8;
      let el = '';
      for (const line of lines) {
        el += `<text x="${t.x}" y="${y}" font-size="${t.fontSize}" font-family="${esc(fontStack(t.fontFamily))}" fill="${t.color}">${esc(line)}</text>`;
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
    case 'connector': {
      const c = o as ConnectorObj;
      const pts = routeConnector(c, doc.resolve);
      const d = `M${pts.map((p) => `${p.x},${p.y}`).join('L')}`;
      let el = `<path d="${d}" fill="none" stroke="${c.stroke}" stroke-width="${c.strokeWidth}" opacity="${c.opacity}" stroke-linejoin="round" stroke-linecap="round"/>`;
      const headLen = c.strokeWidth * 4 + 4;
      if (c.endArrow === 'triangle') el += arrowSvg(pts[pts.length - 2], pts[pts.length - 1], headLen, c.stroke, c.opacity);
      if (c.startArrow === 'triangle') el += arrowSvg(pts[1], pts[0], headLen, c.stroke, c.opacity);
      if (c.label) {
        const mid = polylineMidpoint(pts);
        const w = c.label.length * 7.5 + 12;
        el += `<rect x="${mid.x - w / 2}" y="${mid.y - 10}" width="${w}" height="20" rx="6" fill="#f3f2ef"/>`;
        el += `<text x="${mid.x}" y="${mid.y + 4}" font-size="13" font-weight="500" fill="${c.stroke}" text-anchor="middle">${esc(c.label)}</text>`;
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
  fontId?: string
): string {
  const lines = wrapText(text, fontSize, Math.max(8, b.w - 16), 400, fontId);
  const lh = lineHeight(fontSize);
  const totalH = lines.length * lh;
  let y = b.y + b.h / 2 - totalH / 2 + lh / 2 + fontSize * 0.3;
  let el = '';
  for (const line of lines) {
    el += `<text x="${b.x + b.w / 2}" y="${y}" font-size="${fontSize}" font-family="${esc(fontStack(fontId))}" fill="${color}" text-anchor="middle">${esc(line)}</text>`;
    y += lh;
  }
  return el;
}

function arrowSvg(from: { x: number; y: number }, tip: { x: number; y: number }, len: number, color: string, opacity: number): string {
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
  board: { name: string; viewport: BoardMeta['viewport'] };
  objects: SlateObj[];
  blobs: Record<string, string>; // blobId -> dataURL
}

export async function exportSlateFile(meta: BoardMeta, doc: Doc): Promise<Blob> {
  const objects = doc.allSorted();
  const blobs: Record<string, string> = {};
  for (const o of objects) {
    if (o.type === 'image') {
      const blob = await getBlob(o.blobId);
      if (blob) blobs[o.blobId] = await blobToDataUrl(blob);
    }
  }
  const file: SlateFile = {
    format: 'slate',
    version: 1,
    board: { name: meta.name, viewport: meta.viewport },
    objects,
    blobs,
  };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export async function importSlateFile(file: File): Promise<BoardMeta> {
  const data = JSON.parse(await file.text()) as SlateFile;
  if (data.format !== 'slate') throw new Error('Not a .slate file');
  const board = await createBoard(data.board.name || file.name.replace(/\.slate$/, ''));
  await db.boards.update(board.id, { viewport: data.board.viewport });

  // re-store blobs under fresh ids
  const blobIdMap = new Map<string, string>();
  for (const [oldId, dataUrl] of Object.entries(data.blobs ?? {})) {
    const blob = await (await fetch(dataUrl)).blob();
    blobIdMap.set(oldId, await putBlob(blob));
  }
  const objects = (data.objects ?? []).map((o) => {
    const clone = structuredClone(o);
    clone.id = nanoid(8);
    if (clone.type === 'image' && blobIdMap.has(clone.blobId)) {
      clone.blobId = blobIdMap.get(clone.blobId)!;
    }
    return clone;
  });
  // remap connector references + parent/group ids
  const idMap = new Map<string, string>();
  data.objects.forEach((orig, i) => idMap.set(orig.id, objects[i].id));
  for (const o of objects) {
    if (o.parentId) o.parentId = idMap.get(o.parentId) ?? null;
    if (o.type === 'connector') {
      if (o.from.objectId) o.from.objectId = idMap.get(o.from.objectId) ?? undefined;
      if (o.to.objectId) o.to.objectId = idMap.get(o.to.objectId) ?? undefined;
    }
  }
  await db.objects.bulkPut(objects.map((o) => ({ id: `${board.id}:${o.id}`, boardId: board.id, data: o })));
  return board;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

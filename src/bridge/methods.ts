// Tab-side implementations of the MCP bridge tools (PRD §7, v1.1 §5, v1.2 §5).
// All mutations funnel through the doc command model as one transaction per
// call, so every agent action is a single undo step — exactly like aiEdit.ts.

import { nanoid } from 'nanoid';
import { db, listBoards, createBoard, loadBoardObjects, listProjects, putBlob } from '../store/db';
import { textBlockSize } from '../engine/text';
import { clampHeight } from '../engine/sticky';
import { ICONS } from '../engine/icons';
import { aabbOf, boxUnion } from '../engine/geometry';
import { cameraToFit } from '../engine/camera';
import { exportPng, exportBounds } from '../export/export';
import { readUpload, uploadLabel } from '../ui/upload';
import { runAINode, isAINode } from '../ui/ainodes';
import { getActiveCtl, waitForBoard } from './registry';
import { layoutLayered, layoutGrid, type LayoutItem, type LayoutEdge } from './layout';
import { checkSvg, svgNaturalSize, withExplicitSize } from './svgCheck';

type AnyObj = Record<string, any>;

export class BridgeError extends Error {}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DASHES = new Set(['solid', 'dashed', 'dotted']);
const SHAPES = new Set(['rect', 'roundedRect', 'ellipse', 'triangle', 'diamond', 'parallelogram']);
const ROUTINGS = new Set(['straight', 'elbow', 'curved']);
const STICKY_DEFAULT = '#FFE066';

const num = (v: any, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const color = (v: any, fallback: string, allowTransparent = false) =>
  typeof v === 'string' && (HEX.test(v) || (allowTransparent && v === 'transparent')) ? v : fallback;
const str = (v: any, fallback = '') => (typeof v === 'string' ? v : fallback);
const nid = () => Math.random().toString(36).slice(2, 10);

// ---------- board access ----------

async function boardExists(boardId: string): Promise<boolean> {
  return !!(await db.boards.get(boardId));
}

function navigateToBoard(id: string) {
  const path = `/board/${encodeURIComponent(id)}`;
  if (location.pathname !== path) {
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

/** Controller for `boardId`, auto-switching the tab to it if needed (PRD §6.2). */
async function ensureBoardOpen(boardId: string): Promise<AnyObj> {
  if (!(await boardExists(boardId))) throw new BridgeError(`No board with id "${boardId}"`);
  const cur = getActiveCtl();
  if (cur && cur.boardId === boardId) return cur.ctl;
  navigateToBoard(boardId);
  return waitForBoard(boardId);
}

/** Objects of a board — live doc when open, IndexedDB otherwise. Never truncated. */
async function boardObjects(boardId: string): Promise<AnyObj[]> {
  const cur = getActiveCtl();
  if (cur && cur.boardId === boardId) return cur.ctl.doc.all();
  if (!(await boardExists(boardId))) throw new BridgeError(`No board with id "${boardId}"`);
  return loadBoardObjects(boardId);
}

// ---------- read tools ----------

export async function list_boards(): Promise<AnyObj[]> {
  const [boards, projects] = await Promise.all([listBoards(), listProjects()]);
  const projName = new Map(projects.map((p) => [p.id, p.name]));
  return Promise.all(
    boards.map(async (b) => ({
      id: b.id,
      name: b.name,
      projectName: b.projectId ? projName.get(b.projectId) ?? null : null,
      updatedAt: b.updatedAt,
      objectCount: await db.objects.where('boardId').equals(b.id).count(),
    })),
  );
}

function serializeObj(o: AnyObj): AnyObj | null {
  const r = (n: number) => Math.round(n ?? 0);
  const base: AnyObj = { id: o.id, type: o.type, x: r(o.x), y: r(o.y) };
  if (o.parentId) base.frameId = o.parentId;
  if (o.createdBy) base.createdBy = o.createdBy;
  if (o.locked) base.locked = true;
  switch (o.type) {
    case 'sticky':
      return { ...base, w: r(o.w), h: r(o.h), color: o.color, text: o.text, ...(o.file ? { upload: { name: o.file.name, kind: o.file.kind, rows: o.file.rows } } : {}), runnable: isAINode(o) };
    case 'text':
      return { ...base, w: r(o.w), h: r(o.h), fontSize: o.fontSize, color: o.color, text: o.text, runnable: isAINode(o) };
    case 'shape':
      return { ...base, w: r(o.w), h: r(o.h), shape: o.shape, fill: o.fill, stroke: o.stroke, text: o.text, textColor: o.textColor };
    case 'frame':
      return { ...base, w: r(o.w), h: r(o.h), name: o.name };
    case 'connector':
      return {
        id: o.id,
        type: 'connector',
        from: o.from?.objectId ? { objectId: o.from.objectId } : { point: o.from?.point },
        to: o.to?.objectId ? { objectId: o.to.objectId } : { point: o.to?.point },
        label: o.label ?? '',
        routing: o.routing,
        ...(o.createdBy ? { createdBy: o.createdBy } : {}),
        ...(o.locked ? { locked: true } : {}),
      };
    case 'icon':
      return { ...base, w: r(o.w), h: r(o.h), icon: o.icon, color: o.color };
    case 'image':
      return { ...base, w: r(o.w), h: r(o.h) };
    case 'video':
      return { ...base, w: r(o.w), h: r(o.h), pending: String(o.blobId).startsWith('pending-') };
    case 'stroke':
      // ink is summarized, not vectorized (PRD §7.1)
      return { ...base, type: 'ink', w: r(o.w), h: r(o.h) };
    default:
      return null;
  }
}

export async function read_board(params: AnyObj): Promise<AnyObj> {
  const boardId = str(params?.boardId);
  if (!boardId) throw new BridgeError('boardId is required');
  const meta = await db.boards.get(boardId);
  if (!meta) throw new BridgeError(`No board with id "${boardId}"`);
  let objs = await boardObjects(boardId);
  const frameId = str(params?.frameId);
  if (frameId) {
    const frame = objs.find((o) => o.id === frameId && o.type === 'frame');
    if (!frame) throw new BridgeError(`No frame with id "${frameId}" on this board`);
    objs = objs.filter(
      (o) =>
        o.id === frameId ||
        o.parentId === frameId ||
        (typeof o.x === 'number' &&
          o.x >= frame.x &&
          o.y >= frame.y &&
          o.x + (o.w ?? 0) <= frame.x + frame.w &&
          o.y + (o.h ?? 0) <= frame.y + frame.h),
    );
  }
  // full object list, never truncated (data-integrity rule)
  const objects = objs.map(serializeObj).filter(Boolean) as AnyObj[];
  objects.sort((a, b) => (a.type === 'connector' ? 1 : 0) - (b.type === 'connector' ? 1 : 0));
  // live selection marker — only meaningful (and only stamped) on the open board (PRD v1.2 §5.2)
  const cur = getActiveCtl();
  if (cur && cur.boardId === boardId && cur.ctl.selection?.size) {
    for (const o of objects) if (cur.ctl.selection.has(o.id)) o.selected = true;
  }
  return { board: { id: meta.id, name: meta.name }, objectCount: objects.length, objects };
}

/** First non-node text object a node points at — same rule the flow engine uses. */
function outputOf(objs: AnyObj[], nodeId: string): AnyObj {
  const byId = new Map(objs.map((o) => [o.id, o]));
  const outs = objs
    .filter((c) => c.type === 'connector' && c.from?.objectId === nodeId && c.to?.objectId)
    .map((c) => byId.get(c.to.objectId))
    .filter(Boolean) as AnyObj[];
  for (const o of outs) {
    if ((o.type === 'sticky' || o.type === 'text' || o.type === 'shape') && !isAINode(o) && typeof o.text === 'string' && o.text.trim()) {
      return { kind: 'text', text: o.text, objectId: o.id };
    }
  }
  for (const o of outs) {
    if (o.type === 'image') return { kind: 'image', objectId: o.id, note: 'image output on the canvas' };
    if (o.type === 'video')
      return {
        kind: 'video',
        objectId: o.id,
        note: String(o.blobId).startsWith('pending-') ? 'video still generating' : 'video output on the canvas',
      };
  }
  return { kind: 'none', note: 'this node has no output yet — run it first' };
}

export async function get_node_output(params: AnyObj): Promise<AnyObj> {
  const boardId = str(params?.boardId);
  const objectId = str(params?.objectId);
  if (!boardId || !objectId) throw new BridgeError('boardId and objectId are required');
  const objs = await boardObjects(boardId);
  const node = objs.find((o) => o.id === objectId);
  if (!node) throw new BridgeError(`No object "${objectId}" on board "${boardId}"`);
  if (!isAINode(node)) throw new BridgeError(`Object "${objectId}" is not a runnable node`);
  return outputOf(objs, objectId);
}

/**
 * Snapshot of the user's live selection on the open board (PRD v1.2 §5.1).
 * Read-only, no input: selection is a property of the open tab, so this also
 * answers "which board?". Never switches boards, never touches history.
 */
export async function get_selection(): Promise<AnyObj> {
  const cur = getActiveCtl();
  if (!cur) throw new BridgeError('No board is open in the Slate tab — ask the user to open one');
  const { ctl, boardId } = cur;
  const meta = await db.boards.get(boardId);
  const objs = [...ctl.selection].map((id: string) => ctl.doc.get(id)).filter(Boolean) as AnyObj[];
  // same serialization as read_board; anything it can't shape still comes back
  // as a stub — a selection of N must never return fewer than N (data-integrity)
  const selection = objs.map(
    (o) => serializeObj(o) ?? { id: o.id, type: o.type, x: Math.round(o.x ?? 0), y: Math.round(o.y ?? 0) },
  );
  const result: AnyObj = { boardId, boardName: meta?.name ?? '', count: selection.length, selection };
  if (!objs.length) {
    result.hint = 'Nothing is selected — ask the user to select the objects they mean.';
  } else {
    const b = boxUnion(objs.map((o) => aabbOf(o as any, ctl.doc.resolve)));
    result.bounds = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
  }
  return result;
}

// ---------- write tools ----------

export async function create_board(params: AnyObj): Promise<AnyObj> {
  const name = str(params?.name, 'Untitled board').trim() || 'Untitled board';
  const projectId = str(params?.projectId) || null;
  if (projectId && !(await db.projects.get(projectId))) throw new BridgeError(`No project with id "${projectId}"`);
  const board = await createBoard(name, projectId);
  navigateToBoard(board.id);
  await waitForBoard(board.id).catch(() => null);
  return { boardId: board.id, name: board.name };
}

interface BuiltSpec {
  obj: AnyObj | null; // null → connector, resolved in pass 2
  raw: AnyObj;
  ref: string; // user ref or synthetic
}

function fail(i: number, msg: string): never {
  throw new BridgeError(`objects[${i}]: ${msg}`);
}

/** Validate one non-connector spec into a full SlateObj. Throws with a precise field error. */
function buildObject(spec: AnyObj, i: number, doc: AnyObj): AnyObj {
  const x = num(spec.x, 0, -1e6, 1e6);
  const y = num(spec.y, 0, -1e6, 1e6);
  const base = { id: nid(), x, y, rotation: 0, z: doc.nextZ(), createdBy: 'agent' as const };
  switch (spec.type) {
    case 'sticky': {
      const text = str(spec.text);
      const w = num(spec.w, 200, 40, 2000);
      const fontSize = num(spec.fontSize, 18, 8, 96);
      const m = textBlockSize(text || ' ', fontSize, w - 24, 500);
      const h = clampHeight(Math.max(num(spec.h, 180, 40, 4000), m.h + 24));
      return { ...base, type: 'sticky', w, h, color: color(spec.color, STICKY_DEFAULT), text, fontSize };
    }
    case 'text': {
      const text = str(spec.text);
      if (!text) fail(i, 'text objects need a non-empty "text"');
      const fontSize = num(spec.fontSize, 20, 6, 200);
      const m = textBlockSize(text, fontSize);
      return { ...base, type: 'text', text, color: color(spec.color, '#1a1a1a'), fontSize, w: m.w, h: clampHeight(m.h), fixedWidth: false };
    }
    case 'shape': {
      if (spec.shape !== undefined && !SHAPES.has(spec.shape)) fail(i, `unknown shape "${spec.shape}" — use ${[...SHAPES].join('|')}`);
      return {
        ...base,
        type: 'shape',
        shape: SHAPES.has(spec.shape) ? spec.shape : 'roundedRect',
        w: num(spec.w, 180, 8, 4000),
        h: num(spec.h, 90, 8, 4000),
        fill: color(spec.fill, 'transparent', true),
        stroke: color(spec.stroke, '#1a1a1a'),
        strokeWidth: num(spec.strokeWidth, 2, 0.5, 20),
        dash: DASHES.has(spec.dash) ? spec.dash : 'solid',
        radius: 12,
        opacity: 1,
        text: str(spec.text),
        textColor: color(spec.textColor, '#1a1a1a'),
        fontSize: num(spec.fontSize, 16, 8, 96),
      };
    }
    case 'frame':
      return { ...base, z: -doc.nextZ(), type: 'frame', name: str(spec.name, 'Frame'), w: num(spec.w, 800, 40, 20000), h: num(spec.h, 500, 40, 20000) };
    case 'icon': {
      const name = str(spec.icon);
      if (!ICONS.some((d) => d.id === name)) fail(i, `no icon "${name}" — closest: ${closestIcons(name).join(', ')}`);
      const w = num(spec.w, 48, 12, 1024);
      return { ...base, type: 'icon', icon: name, w, h: num(spec.h, w, 12, 1024), color: color(spec.color, '#1a1a1a'), opacity: 1 };
    }
    case 'image': {
      const check = checkSvg(spec.svg);
      if (!check.ok) fail(i, check.reason);
      const natural = svgNaturalSize(spec.svg);
      if (!natural && !(spec.w && spec.h)) fail(i, 'svg needs a viewBox (or explicit w/h in the spec) so it can be sized');
      let w = num(spec.w, natural?.w ?? 300, 8, 4000);
      let h = num(spec.h, natural?.h ?? 300, 8, 4000);
      // canvas-sanity cap on DISPLAY size only — the full svg source is stored
      const long = Math.max(w, h);
      if (long > 1600) {
        w = Math.round((w * 1600) / long);
        h = Math.round((h * 1600) / long);
      }
      // blobId filled in by add_objects after validation (blob storage is async)
      return { ...base, type: 'image', w, h, blobId: '', opacity: 1, radius: 0, _svg: withExplicitSize(spec.svg, w, h) };
    }
    default:
      fail(i, `unknown type "${spec.type}" — use sticky|text|shape|frame|connector|icon|image`);
  }
}

/** Closest icon names for a typo/guess — substring hits first, then edit distance. */
function closestIcons(name: string, n = 5): string[] {
  const q = name.toLowerCase();
  const dist = (a: string, b: string): number => {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
    for (let j = 1; j <= b.length; j++) {
      let prev = dp[0]++;
      for (let i = 1; i <= a.length; i++) {
        const cur = dp[i];
        dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
      }
    }
    return dp[a.length];
  };
  return ICONS.map((d) => ({
    id: d.id,
    score: d.id.includes(q) || q.includes(d.id) || d.tags?.includes(q) ? 0 : dist(d.id, q),
  }))
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
    .map((d) => d.id);
}

function buildConnector(spec: AnyObj, i: number, doc: AnyObj, resolveRef: (r: any, field: string) => AnyObj): AnyObj {
  const end = (e: any, field: string): AnyObj => {
    if (e && typeof e === 'object') {
      if (typeof e.ref === 'string' || typeof e.id === 'string') return resolveRef(e.ref ?? e.id, field);
      if (isFinite(Number(e.x)) && isFinite(Number(e.y))) return { point: { x: num(e.x, 0, -1e6, 1e6), y: num(e.y, 0, -1e6, 1e6) } };
    }
    fail(i, `connector "${field}" must be {ref}, {id} or {x,y}`);
  };
  return {
    id: nid(),
    x: 0,
    y: 0,
    rotation: 0,
    z: doc.nextZ(),
    createdBy: 'agent' as const,
    type: 'connector',
    from: end(spec.from, 'from'),
    to: end(spec.to, 'to'),
    routing: ROUTINGS.has(spec.routing) ? spec.routing : 'curved',
    stroke: color(spec.stroke, '#1a1a1a'),
    strokeWidth: num(spec.strokeWidth, 2, 0.5, 20),
    dash: DASHES.has(spec.dash) ? spec.dash : 'solid',
    startArrow: 'none',
    endArrow: spec.endArrow === 'none' ? 'none' : 'triangle',
    opacity: 1,
    label: str(spec.label) || undefined,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function add_objects(params: AnyObj): Promise<AnyObj> {
  const boardId = str(params?.boardId);
  if (!boardId) throw new BridgeError('boardId is required');
  const specs: AnyObj[] = Array.isArray(params?.objects) ? params.objects : [];
  if (!specs.length) throw new BridgeError('objects must be a non-empty array');
  const ctl = await ensureBoardOpen(boardId);
  const doc = ctl.doc;

  // ---- pass 1: validate everything before touching the doc (no partial application) ----
  const built: BuiltSpec[] = specs.map((spec, i) => {
    if (!spec || typeof spec !== 'object') fail(i, 'each entry must be an object spec');
    const ref = typeof spec.ref === 'string' && spec.ref ? spec.ref : `#${i}`;
    return { obj: spec.type === 'connector' ? null : buildObject(spec, i, doc), raw: spec, ref };
  });
  const byRef = new Map<string, AnyObj>();
  for (const b of built) {
    if (b.obj) {
      if (byRef.has(b.ref)) throw new BridgeError(`duplicate ref "${b.ref}"`);
      byRef.set(b.ref, b.obj);
    }
  }
  const connectors: AnyObj[] = [];
  built.forEach((b, i) => {
    if (b.raw.type !== 'connector') return;
    const resolveRef = (r: any, field: string): AnyObj => {
      const target = byRef.get(String(r));
      if (target) return { objectId: target.id };
      if (doc.get(String(r))) return { objectId: String(r) };
      fail(i, `connector "${field}" references "${r}" — no such ref in this call and no such object on the board`);
    };
    connectors.push(buildConnector(b.raw, i, doc, resolveRef));
  });

  // ---- auto-layout (PRD §7.4) ----
  const bodies = built.filter((b) => b.obj).map((b) => b.obj!) as AnyObj[];
  const mode = str(params?.autoLayout, 'none');
  if (mode === 'layered' || mode === 'grid') {
    const cam = ctl.camera ?? { x: 0, y: 0, zoom: 1 };
    const origin = {
      x: Math.round(cam.x + (ctl.viewW ?? 1200) / 4 / (cam.zoom || 1)),
      y: Math.round(cam.y + (ctl.viewH ?? 800) / 4 / (cam.zoom || 1)),
    };
    const keyed = new Map(built.filter((b) => b.obj).map((b) => [b.obj!.id, b.ref]));
    const items: LayoutItem[] = bodies.filter((o) => o.type !== 'frame').map((o) => ({ key: keyed.get(o.id)!, w: o.w, h: o.h }));
    if (mode === 'layered') {
      const edges: LayoutEdge[] = connectors
        .filter((c) => c.from.objectId && c.to.objectId)
        .map((c) => ({
          from: [...byRef.entries()].find(([, o]) => o.id === c.from.objectId)?.[0] ?? '',
          to: [...byRef.entries()].find(([, o]) => o.id === c.to.objectId)?.[0] ?? '',
        }))
        .filter((e) => e.from && e.to);
      layoutLayered(items, edges, origin);
    } else {
      layoutGrid(items, origin);
    }
    for (const it of items) {
      const o = byRef.get(it.key)!;
      o.x = it.x!;
      o.y = it.y!;
    }
  }

  // ---- store agent-authored SVGs as blobs (async, so before the transaction) ----
  for (const o of bodies) {
    if (o.type === 'image' && o._svg) {
      o.blobId = await putBlob(new Blob([o._svg], { type: 'image/svg+xml' }));
      delete o._svg;
    }
  }

  // ---- pass 2: apply as ONE transaction, staggered so the agent visibly "draws" ----
  const delay = Math.min(220, Math.max(50, Math.round(3500 / (bodies.length + connectors.length))));
  doc.begin();
  try {
    for (const o of bodies) {
      doc.set(o);
      await sleep(delay);
    }
    for (const c of connectors) {
      doc.set(c);
      await sleep(delay);
    }
  } finally {
    doc.commit();
  }

  // return ids mapped 1:1 to input order
  let ci = 0;
  const ids = built.map((b) => (b.obj ? b.obj.id : connectors[ci++].id));
  return { ids, created: ids.length };
}

// per-type editable props, mirroring aiEdit.ts EDITABLE
const EDITABLE: Record<string, Set<string>> = {
  sticky: new Set(['text', 'color', 'fontSize', 'x', 'y', 'w', 'h']),
  shape: new Set(['text', 'fill', 'stroke', 'textColor', 'strokeWidth', 'dash', 'x', 'y', 'w', 'h']),
  text: new Set(['text', 'color', 'fontSize', 'x', 'y']),
  connector: new Set(['label', 'stroke', 'strokeWidth', 'dash']),
  icon: new Set(['color', 'strokeWidth', 'x', 'y']),
  frame: new Set(['name', 'x', 'y', 'w', 'h']),
};
const COLOR_PROPS = new Set(['color', 'fill', 'stroke', 'textColor']);

export async function update_objects(params: AnyObj): Promise<AnyObj> {
  const boardId = str(params?.boardId);
  if (!boardId) throw new BridgeError('boardId is required');
  const edits: AnyObj[] = Array.isArray(params?.edits) ? params.edits : [];
  if (!edits.length) throw new BridgeError('edits must be a non-empty array of {id, patch}');
  const ctl = await ensureBoardOpen(boardId);
  const doc = ctl.doc;

  const results: AnyObj[] = [];
  doc.begin();
  try {
    for (const e of edits) {
      const target = e && typeof e.id === 'string' ? doc.get(e.id) : undefined;
      if (!target) {
        results.push({ id: e?.id ?? null, ok: false, error: 'no such object' });
        continue;
      }
      const allowed = EDITABLE[target.type];
      if (!allowed) {
        results.push({ id: e.id, ok: false, error: `objects of type "${target.type}" are not editable via the bridge` });
        continue;
      }
      const set = e.patch ?? {};
      const patch: AnyObj = {};
      const rejected: string[] = [];
      for (const [k, v] of Object.entries(set as AnyObj)) {
        if (!allowed.has(k)) {
          rejected.push(k);
          continue;
        }
        if (COLOR_PROPS.has(k)) {
          if (typeof v === 'string' && (HEX.test(v) || (k === 'fill' && v === 'transparent'))) patch[k] = v;
          else rejected.push(k);
        } else if (k === 'dash') {
          if (DASHES.has(v as string)) patch[k] = v;
          else rejected.push(k);
        } else if (k === 'text' || k === 'label' || k === 'name') {
          if (typeof v === 'string') patch[k] = v;
          else rejected.push(k);
        } else if (k === 'fontSize') patch[k] = num(v, (target as AnyObj).fontSize ?? 16, 6, 200);
        else if (k === 'strokeWidth') patch[k] = num(v, (target as AnyObj).strokeWidth ?? 2, 0.5, 20);
        else if (k === 'x' || k === 'y') patch[k] = num(v, (target as AnyObj)[k], -1e6, 1e6);
        else if (k === 'w' || k === 'h') patch[k] = num(v, (target as AnyObj)[k], 8, 20000);
      }
      if (!Object.keys(patch).length) {
        results.push({ id: e.id, ok: false, error: `no applicable props${rejected.length ? ` (rejected: ${rejected.join(', ')})` : ''}` });
        continue;
      }
      // keep text-bearing objects sized to their content, like aiEdit does
      const t = target as AnyObj;
      if (t.type === 'text' && (patch.text !== undefined || patch.fontSize !== undefined)) {
        const m = textBlockSize((patch.text ?? t.text) || ' ', patch.fontSize ?? t.fontSize, t.fixedWidth ? t.w : undefined, 400, t.fontFamily);
        patch.w = t.fixedWidth ? t.w : m.w;
        patch.h = m.h;
      }
      if (t.type === 'sticky' && (patch.text !== undefined || patch.fontSize !== undefined)) {
        const m = textBlockSize((patch.text ?? t.text) || ' ', patch.fontSize ?? t.fontSize, (patch.w ?? t.w) - 24, 500, t.fontFamily);
        patch.h = Math.max(patch.h ?? t.h, m.h + 24);
      }
      doc.update(e.id, patch);
      results.push({ id: e.id, ok: true, ...(rejected.length ? { rejected } : {}) });
    }
  } finally {
    doc.commit();
  }
  return { results };
}

export async function delete_objects(params: AnyObj): Promise<AnyObj> {
  const boardId = str(params?.boardId);
  if (!boardId) throw new BridgeError('boardId is required');
  const ids: any[] = Array.isArray(params?.ids) ? params.ids : [];
  if (!ids.length) throw new BridgeError('ids must be a non-empty array');
  const ctl = await ensureBoardOpen(boardId);
  const doc = ctl.doc;
  const results: AnyObj[] = [];
  doc.begin();
  try {
    for (const id of ids) {
      if (typeof id === 'string' && doc.get(id)) {
        doc.delete(id);
        results.push({ id, ok: true });
      } else results.push({ id, ok: false, error: 'no such object' });
    }
  } finally {
    doc.commit();
  }
  return { results };
}

// ---------- run tools ----------

interface Run {
  id: string;
  boardId: string;
  objectId: string;
  status: 'running' | 'done' | 'error';
  error?: string;
  startedAt: number;
}

const runs = new Map<string, Run>();

export async function run_node(params: AnyObj): Promise<AnyObj> {
  const boardId = str(params?.boardId);
  const objectId = str(params?.objectId);
  if (!boardId || !objectId) throw new BridgeError('boardId and objectId are required');
  const ctl = await ensureBoardOpen(boardId);
  const node = ctl.doc.get(objectId);
  if (!node) throw new BridgeError(`No object "${objectId}" on board "${boardId}"`);
  if (!isAINode(node)) throw new BridgeError(`Object "${objectId}" is not a runnable node (its text must start with a prefix like "ai:", "img:", "chart:")`);

  const run: Run = { id: nanoid(10), boardId, objectId, status: 'running', startedAt: Date.now() };
  runs.set(run.id, run);
  const promise = runAINode(ctl, node)
    .then(() => {
      run.status = 'done';
    })
    .catch((e: any) => {
      run.status = 'error';
      run.error = String(e?.message ?? e);
    });

  const timeoutSeconds = num(params?.timeoutSeconds, 60, 1, 3600);
  await Promise.race([promise, sleep(timeoutSeconds * 1000)]);

  if (run.status === 'running') return { status: 'running', runId: run.id, note: `still running after ${timeoutSeconds}s — poll get_run_status` };
  if (run.status === 'error') throw new BridgeError(`node run failed: ${run.error}`);
  return { status: 'done', output: outputOf(ctl.doc.all(), objectId) };
}

export async function get_run_status(params: AnyObj): Promise<AnyObj> {
  const run = runs.get(str(params?.runId));
  if (!run) throw new BridgeError(`No run with id "${params?.runId}"`);
  if (run.status === 'running') return { status: 'running' };
  if (run.status === 'error') return { status: 'error', error: run.error };
  const objs = await boardObjects(run.boardId);
  return { status: 'done', output: outputOf(objs, run.objectId) };
}

// ---------- senses: render + camera (PRD v1.1 §5.3–5.4) ----------

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? '').split(',')[1] ?? '');
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

export async function render_board(params: AnyObj): Promise<AnyObj> {
  const boardId = str(params?.boardId);
  if (!boardId) throw new BridgeError('boardId is required');
  const ctl = await ensureBoardOpen(boardId);
  const doc = ctl.doc;

  let box: AnyObj | null = null;
  const region = params?.region;
  if (region && Array.isArray(region.objectIds)) {
    const objs = region.objectIds.map((id: any) => doc.get(String(id))).filter(Boolean);
    if (!objs.length) throw new BridgeError('none of the given objectIds exist on this board');
    const b = boxUnion(objs.map((o: AnyObj) => aabbOf(o as any, doc.resolve)));
    box = { x: b.x - 32, y: b.y - 32, w: b.w + 64, h: b.h + 64 };
  } else if (region && isFinite(Number(region.w)) && isFinite(Number(region.h))) {
    box = {
      x: num(region.x, 0, -1e6, 1e6),
      y: num(region.y, 0, -1e6, 1e6),
      w: num(region.w, 100, 1, 2e6),
      h: num(region.h, 100, 1, 2e6),
    };
  } else {
    box = exportBounds(doc);
    if (!box) throw new BridgeError('the board is empty — nothing to render');
  }

  const maxDim = num(params?.maxDimension, 1568, 64, 4096);
  const scale = Math.min(4, maxDim / Math.max(box!.w, box!.h));
  const blob = await exportPng(doc, box as any, scale, false);
  const imageBase64 = await blobToBase64(blob);
  return {
    mimeType: 'image/png',
    imageBase64,
    // world-coordinate mapping so what the agent SEES converts back to board space
    region: { x: Math.round(box!.x), y: Math.round(box!.y), w: Math.round(box!.w), h: Math.round(box!.h) },
    scale: Number(scale.toFixed(4)),
    pixelWidth: Math.max(1, Math.round(box!.w * scale)),
    pixelHeight: Math.max(1, Math.round(box!.h * scale)),
  };
}

let lastFocusAt = 0;
let focusAnim: number | null = null;

export async function focus_on(params: AnyObj): Promise<AnyObj> {
  const boardId = str(params?.boardId);
  if (!boardId) throw new BridgeError('boardId is required');
  const ids: any[] = Array.isArray(params?.objectIds) ? params.objectIds : [];
  if (!ids.length) throw new BridgeError('objectIds must be a non-empty array');
  const ctl = await ensureBoardOpen(boardId);
  const objs = ids.map((id) => ctl.doc.get(String(id))).filter(Boolean);
  if (!objs.length) throw new BridgeError('none of the given objectIds exist on this board');

  // at most one camera move per second — excess calls coalesce (PRD §5.4)
  const now = Date.now();
  if (now - lastFocusAt < 1000) {
    return { coalesced: true, viewport: { ...ctl.camera } };
  }
  lastFocusAt = now;

  const box = boxUnion(objs.map((o: AnyObj) => aabbOf(o as any, ctl.doc.resolve)));
  const target = cameraToFit(box, ctl.viewW, ctl.viewH, 96);
  const from = { ...ctl.camera };
  if (focusAnim !== null) cancelAnimationFrame(focusAnim);
  const t0 = performance.now();
  const DUR = 400;
  const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
  await new Promise<void>((resolve) => {
    const step = (t: number) => {
      const k = ease(Math.min(1, (t - t0) / DUR));
      ctl.setCamera({
        x: from.x + (target.x - from.x) * k,
        y: from.y + (target.y - from.y) * k,
        zoom: from.zoom + (target.zoom - from.zoom) * k,
      });
      if (k < 1) focusAnim = requestAnimationFrame(step);
      else {
        focusAnim = null;
        resolve();
      }
    };
    focusAnim = requestAnimationFrame(step);
  });
  return { viewport: { ...ctl.camera } };
}

// ---------- pipeline: uploads from the agent's environment (PRD v1.1 §5.5) ----------

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const UPLOAD_KIND_EXT: Record<string, string> = { csv: 'csv', text: 'txt', json: 'json', markdown: 'md' };

export async function add_upload(params: AnyObj): Promise<AnyObj> {
  const boardId = str(params?.boardId);
  if (!boardId) throw new BridgeError('boardId is required');
  let filename = str(params?.filename).trim();
  const content = params?.content;
  if (!filename) throw new BridgeError('filename is required');
  if (typeof content !== 'string' || !content) throw new BridgeError('content must be a non-empty string');
  if (new TextEncoder().encode(content).length > MAX_UPLOAD_BYTES) {
    // a stated, LOUD limit — never silent truncation (data-integrity rule)
    throw new BridgeError('file too large for the bridge (20 MB max) — ask the user to drop it into Slate directly so no data is lost');
  }
  if (/\.pdf$/i.test(filename) || params?.kind === 'pdf') {
    throw new BridgeError('binary formats are not supported over the bridge — text formats only (csv, txt, json, md)');
  }
  const kind = str(params?.kind);
  if (kind && !UPLOAD_KIND_EXT[kind]) throw new BridgeError(`unknown kind "${kind}" — use csv|text|json|markdown`);
  if (!/\.[a-z0-9]+$/i.test(filename)) filename += `.${UPLOAD_KIND_EXT[kind] || 'txt'}`;

  const ctl = await ensureBoardOpen(boardId);
  // reuse the app's own upload parser so preview caps, row counts and blob
  // storage are byte-identical to a hand-dropped file (PRD end-condition 7)
  const file = new File([content], filename, { type: kind === 'csv' ? 'text/csv' : 'text/plain' });
  const upload = await readUpload(file);

  const cam = ctl.camera ?? { x: 0, y: 0, zoom: 1 };
  const x = num(params?.x, Math.round(cam.x + (ctl.viewW ?? 1200) / 4 / (cam.zoom || 1)), -1e6, 1e6);
  const y = num(params?.y, Math.round(cam.y + (ctl.viewH ?? 800) / 4 / (cam.zoom || 1)), -1e6, 1e6);
  const text = uploadLabel(upload);
  const w = 260;
  const m = textBlockSize(text, 18, w - 24, 500);
  const node = {
    id: nid(),
    type: 'sticky' as const,
    x,
    y,
    rotation: 0,
    z: ctl.doc.nextZ(),
    createdBy: 'agent' as const,
    w,
    h: clampHeight(m.h + 24),
    color: STICKY_DEFAULT,
    text,
    fontSize: 18,
    file: upload,
  };
  ctl.doc.begin();
  try {
    ctl.doc.set(node);
  } finally {
    ctl.doc.commit();
  }
  return {
    objectId: node.id,
    kind: upload.kind,
    rows: upload.rows ?? null,
    // complete = analytics read EVERY row: either nothing was capped, or the
    // full file is in the blob store
    complete: !upload.truncated || !!upload.blobId,
  };
}

// ---------- dispatcher (capability ceiling: exactly these thirteen methods) ----------

export const METHODS: Record<string, (params: AnyObj) => Promise<any>> = {
  list_boards,
  read_board,
  get_selection,
  get_node_output,
  create_board,
  add_objects,
  update_objects,
  delete_objects,
  run_node,
  get_run_status,
  render_board,
  focus_on,
  add_upload,
};

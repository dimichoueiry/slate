// AI canvas editing: serialize the selection → one LLM call → validated plan
// (edits + creations + deletions) → applied as a single undoable transaction.
import { chat, type ChatMessage } from './llm';
import { textBlockSize } from '../engine/text';
import { clampHeight } from '../engine/sticky';

type AnyObj = Record<string, any>;

const EDITABLE: Record<string, Set<string>> = {
  sticky: new Set(['text', 'color', 'fontSize', 'x', 'y', 'w', 'h']),
  shape: new Set(['text', 'fill', 'stroke', 'textColor', 'strokeWidth', 'dash', 'x', 'y', 'w', 'h']),
  text: new Set(['text', 'color', 'fontSize', 'x', 'y']),
  connector: new Set(['label', 'stroke', 'strokeWidth', 'dash']),
  icon: new Set(['color', 'strokeWidth', 'x', 'y']),
  frame: new Set(['name', 'x', 'y', 'w', 'h']),
  stroke: new Set(['color']),
};

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const COLOR_PROPS = new Set(['color', 'fill', 'stroke', 'textColor']);
const DASHES = new Set(['solid', 'dashed', 'dotted']);
const SHAPES = new Set(['rect', 'roundedRect', 'ellipse', 'triangle', 'diamond', 'parallelogram']);

const nid = () => Math.random().toString(36).slice(2, 10);

function serialize(objs: AnyObj[]): AnyObj[] {
  const r = (n: number) => Math.round(n);
  return objs
    .map((o) => {
      const base = { id: o.id, type: o.type, x: r(o.x), y: r(o.y) };
      switch (o.type) {
        case 'sticky':
          return { ...base, w: r(o.w), h: r(o.h), color: o.color, text: o.text };
        case 'shape':
          return { ...base, w: r(o.w), h: r(o.h), shape: o.shape, fill: o.fill, stroke: o.stroke, textColor: o.textColor, text: o.text };
        case 'text':
          return { ...base, fontSize: o.fontSize, color: o.color, text: o.text };
        case 'connector':
          return { id: o.id, type: o.type, label: o.label ?? '', stroke: o.stroke };
        case 'icon':
          return { ...base, w: r(o.w), h: r(o.h), icon: o.icon, color: o.color };
        case 'frame':
          return { ...base, w: r(o.w), h: r(o.h), name: o.name };
        case 'stroke':
          return { id: o.id, type: o.type, color: o.color };
        default:
          return null;
      }
    })
    .filter(Boolean) as AnyObj[];
}

const SYSTEM = `You edit objects on an infinite whiteboard canvas.
You receive a JSON array of the user's selected objects (with absolute x,y positions and w,h sizes) and an instruction.

Reply with ONLY a JSON object (no markdown, no prose):
{"edits":[{"id":"<id>","set":{...}}], "create":[{...}], "delete":["<id>"]}
All three keys are optional — include only what's needed.

EDITS — editable props per type:
- sticky: text, color, fontSize, x, y, w, h
- shape: text, fill, stroke, textColor, strokeWidth, dash, x, y, w, h
- text: text, color, fontSize, x, y
- connector: label, stroke, strokeWidth, dash
- icon: color, x, y
- frame: name, x, y, w, h
- stroke (ink): color

CREATE — new objects (give absolute x,y; place them sensibly relative to the existing objects, e.g. aligned to the same grid):
- {"type":"sticky","x":0,"y":0,"w":180,"h":180,"color":"#FFE066","text":"..."}
- {"type":"shape","shape":"rect|roundedRect|ellipse|triangle|diamond","x":0,"y":0,"w":160,"h":100,"fill":"#FFD43B","stroke":"#1a1a1a","textColor":"#1a1a1a","text":""}
- {"type":"text","x":0,"y":0,"fontSize":20,"color":"#1a1a1a","text":"..."}
- {"type":"frame","x":0,"y":0,"w":800,"h":500,"name":"..."}
- {"type":"connector","from":{"id":"<existing or ref>"}|{"x":0,"y":0},"to":{...},"label":"","routing":"straight|elbow|curved"}
Optionally give a created object a "ref":"r1" so connectors can reference it via {"id":"r1"}.

DELETE — array of selected object ids to remove.

Rules:
- Colors are hex like "#A8D8EA"; shape fill may be "transparent". dash: solid|dashed|dotted.
- Only include objects you change. Keep text concise; match the user's language.
- When creating grids/panels, mirror the spacing, sizes and colors of the existing objects.
- CHECKLISTS: write each item as its own line starting with "☐ " (unchecked) or "☑ " (checked) inside a sticky or text object — the canvas renders these as clickable checkboxes. Example sticky text: "☐ buy milk\n☐ ship v1\n☑ write spec". Users may also type lines as "[ ] item" or "[x] item" - same meaning.`;

function coercePlan(value: any): { edits: any[]; create: any[]; del: string[] } | null {
  if (Array.isArray(value)) return { edits: value, create: [], del: [] };
  if (value && typeof value === 'object') {
    const edits = Array.isArray(value.edits) ? value.edits : Array.isArray(value.changes) ? value.changes : [];
    const create = Array.isArray(value.create) ? value.create : Array.isArray(value.add) ? value.add : [];
    const del = Array.isArray(value.delete) ? value.delete : Array.isArray(value.remove) ? value.remove : [];
    if (edits.length || create.length || del.length) return { edits, create, del };
    if (typeof value.id === 'string' && value.set) return { edits: [value], create: [], del: [] };
    const keys = Object.keys(value);
    if (keys.length === 1 && Array.isArray(value[keys[0]])) return { edits: value[keys[0]], create: [], del: [] };
  }
  return null;
}

function extractPlan(raw: string): { edits: any[]; create: any[]; del: string[] } {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  try {
    const direct = coercePlan(JSON.parse(cleaned));
    if (direct) return direct;
  } catch {
    /* fall through */
  }
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = cleaned.indexOf(open);
    const end = cleaned.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        const sliced = coercePlan(JSON.parse(cleaned.slice(start, end + 1)));
        if (sliced) return sliced;
      } catch {
        /* keep trying */
      }
    }
  }
  throw new Error('AI did not return JSON edits');
}

const num = (v: any, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const color = (v: any, fallback: string, allowTransparent = false) =>
  typeof v === 'string' && (HEX.test(v) || (allowTransparent && v === 'transparent')) ? v : fallback;
const str = (v: any, fallback = '') => (typeof v === 'string' ? v : fallback);

function buildCreated(item: AnyObj, refs: Map<string, string>, doc: AnyObj): AnyObj | null {
  if (!item || typeof item !== 'object') return null;
  const id = nid();
  if (typeof item.ref === 'string') refs.set(item.ref, id);
  const x = num(item.x, 0, -1e6, 1e6);
  const y = num(item.y, 0, -1e6, 1e6);
  const base = { id, x, y, rotation: 0, z: doc.nextZ() };
  switch (item.type) {
    case 'sticky': {
      const w = num(item.w, 180, 40, 2000);
      const fontSize = num(item.fontSize, 18, 8, 96);
      const text = str(item.text);
      const m = textBlockSize(text || ' ', fontSize, w - 24, 500);
      const h = clampHeight(Math.max(num(item.h, 180, 40, 4000), m.h + 24));
      return { ...base, type: 'sticky', w, h, color: color(item.color, '#FFE066'), text, fontSize };
    }
    case 'shape':
      return {
        ...base,
        type: 'shape',
        shape: SHAPES.has(item.shape) ? item.shape : 'roundedRect',
        w: num(item.w, 160, 8, 4000),
        h: num(item.h, 100, 8, 4000),
        fill: color(item.fill, 'transparent', true),
        stroke: color(item.stroke, '#1a1a1a'),
        strokeWidth: num(item.strokeWidth, 2, 0.5, 20),
        dash: DASHES.has(item.dash) ? item.dash : 'solid',
        radius: 12,
        opacity: 1,
        text: str(item.text),
        textColor: color(item.textColor, '#1a1a1a'),
        fontSize: num(item.fontSize, 16, 8, 96),
      };
    case 'text': {
      const fontSize = num(item.fontSize, 20, 6, 200);
      const text = str(item.text, ' ');
      const m = textBlockSize(text, fontSize);
      return { ...base, type: 'text', text, color: color(item.color, '#1a1a1a'), fontSize, w: m.w, h: clampHeight(m.h), fixedWidth: false };
    }
    case 'frame':
      return { ...base, z: -doc.nextZ(), type: 'frame', name: str(item.name, 'Frame'), w: num(item.w, 800, 40, 20000), h: num(item.h, 500, 40, 20000) };
    case 'connector': {
      const end = (e: any): AnyObj => {
        if (e && typeof e.id === 'string') {
          const target = refs.get(e.id) ?? e.id;
          return { objectId: target };
        }
        return { point: { x: num(e?.x, x, -1e6, 1e6), y: num(e?.y, y, -1e6, 1e6) } };
      };
      return {
        ...base,
        type: 'connector',
        from: end(item.from),
        to: end(item.to),
        routing: ['straight', 'elbow', 'curved'].includes(item.routing) ? item.routing : 'curved',
        stroke: color(item.stroke, '#1a1a1a'),
        strokeWidth: num(item.strokeWidth, 2, 0.5, 20),
        dash: 'solid',
        startArrow: 'none',
        endArrow: item.endArrow === 'none' ? 'none' : 'triangle',
        opacity: 1,
        label: str(item.label) || undefined,
      };
    }
    default:
      return null;
  }
}

export interface AIEditResult {
  applied: number;
  created: number;
  deleted: number;
  skipped: number;
}

export async function aiEditSelection(ctl: AnyObj, instruction: string): Promise<AIEditResult> {
  const objs: AnyObj[] = ctl.selectedObjects();

  const payload = serialize(objs);
  const cam = ctl.camera ?? { x: 0, y: 0, zoom: 1 };
  const center = {
    x: Math.round(cam.x + (ctl.viewW ?? 1200) / 2 / (cam.zoom || 1)),
    y: Math.round(cam.y + (ctl.viewH ?? 800) / 2 / (cam.zoom || 1)),
  };
  const context =
    objs.length > 0
      ? `Selected objects:\n${JSON.stringify(payload)}`
      : `Nothing is selected — this is a CREATE task. Place new objects around the canvas point (${center.x}, ${center.y}).`;
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${context}\n\nInstruction: ${instruction}` },
  ];
  const reply = await chat(messages, { temperature: 0.4, maxTokens: 8000, json: true });

  let plan: { edits: any[]; create: any[]; del: string[] };
  try {
    plan = extractPlan(reply);
  } catch {
    const retry = await chat(
      [
        ...messages,
        { role: 'assistant', content: reply.slice(0, 2000) },
        {
          role: 'user',
          content:
            'That was not valid JSON. Reply again with ONLY the JSON object {"edits":[...],"create":[...],"delete":[...]} — no prose, no markdown fences.',
        },
      ],
      { temperature: 0, maxTokens: 8000, json: true }
    );
    plan = extractPlan(retry);
  }

  const byId = new Map(objs.map((o) => [o.id, o]));
  const refs = new Map<string, string>();
  let applied = 0;
  let created = 0;
  let deleted = 0;
  let skipped = 0;

  ctl.doc.begin();
  try {
    // deletions (restricted to the selection for safety)
    for (const id of plan.del.slice(0, 200)) {
      if (typeof id === 'string' && byId.has(id)) {
        ctl.doc.delete(id);
        deleted++;
      } else skipped++;
    }
    // edits
    for (const edit of plan.edits.slice(0, 500)) {
      const target = edit && typeof edit.id === 'string' ? byId.get(edit.id) : undefined;
      const set = edit?.set ?? edit?.props;
      if (!target || !set || typeof set !== 'object') {
        skipped++;
        continue;
      }
      const allowed = EDITABLE[target.type];
      const patch: AnyObj = {};
      for (const [k, v] of Object.entries(set as AnyObj)) {
        if (!allowed?.has(k)) continue;
        if (COLOR_PROPS.has(k)) {
          if (typeof v !== 'string') continue;
          if (!HEX.test(v) && !(k === 'fill' && v === 'transparent')) continue;
          patch[k] = v;
          continue;
        }
        if (k === 'dash') {
          if (DASHES.has(v as string)) patch[k] = v;
          continue;
        }
        if (k === 'text' || k === 'label' || k === 'name') {
          if (typeof v === 'string') patch[k] = v;
          continue;
        }
        if (k === 'fontSize') {
          patch[k] = num(v, target.fontSize ?? 16, 6, 200);
          continue;
        }
        if (k === 'strokeWidth') {
          patch[k] = num(v, target.strokeWidth ?? 2, 0.5, 20);
          continue;
        }
        if (k === 'x' || k === 'y') {
          patch[k] = num(v, target[k], -1e6, 1e6);
          continue;
        }
        if (k === 'w' || k === 'h') {
          patch[k] = num(v, target[k], 8, 20000);
          continue;
        }
      }
      if (Object.keys(patch).length === 0) {
        skipped++;
        continue;
      }
      if (target.type === 'text' && (patch.text !== undefined || patch.fontSize !== undefined)) {
        const text = patch.text ?? target.text;
        const fontSize = patch.fontSize ?? target.fontSize;
        const m = textBlockSize(text || ' ', fontSize, target.fixedWidth ? target.w : undefined, 400, target.fontFamily);
        patch.w = target.fixedWidth ? target.w : m.w;
        patch.h = m.h;
      }
      if (target.type === 'sticky' && (patch.text !== undefined || patch.fontSize !== undefined)) {
        const text = patch.text ?? target.text;
        const fontSize = patch.fontSize ?? target.fontSize;
        const m = textBlockSize(text || ' ', fontSize, (patch.w ?? target.w) - 24, 500, target.fontFamily);
        patch.h = Math.max(patch.h ?? target.h, m.h + 24);
      }
      ctl.doc.update(target.id, patch);
      applied++;
    }
    // creations (two passes so connectors can reference refs)
    const pending = plan.create.slice(0, 200);
    const connectors = pending.filter((c) => c?.type === 'connector');
    const others = pending.filter((c) => c?.type !== 'connector');
    const createdObjs: AnyObj[] = [];
    for (const item of others) {
      const obj = buildCreated(item, refs, ctl.doc);
      if (obj) {
        ctl.doc.set(obj);
        createdObjs.push(obj);
        created++;
      } else skipped++;
    }
    for (const item of connectors) {
      const obj = buildCreated(item, refs, ctl.doc);
      if (obj) {
        ctl.doc.set(obj);
        createdObjs.push(obj);
        created++;
      } else skipped++;
    }
    if (createdObjs.length) {
      ctl.selection = new Set(createdObjs.map((o) => o.id));
      ctl.syncSelection?.();
    }
  } finally {
    ctl.doc.commit();
  }
  return { applied, created, deleted, skipped };
}

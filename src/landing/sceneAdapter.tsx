import type { SlateObj } from '../types';
import type { RNote, RNode, ROut, RScene } from './RunnableBoard';

/* Turn a REAL board (SlateObj[] — the same format the app uses, e.g. from
   src/engine/templates.ts) into a hero RScene the guided/canned engine renders.
   This keeps ONE source of truth for board content: the real templates. The
   only landing-specific bit is `canned` — the predefined outputs (since the
   real ones come from an LLM), supplied in board order of the AI nodes. */

// matches the app's AI-node detection (src/ui/ainodes.ts) — inlined so the
// landing bundle doesn't pull in the AI execution stack.
const RUN = /^(▶ ?)?(ai|img|web|search|ask|research|extract|chart|fix|data|business|condition|if|interval|timer|every):/i;
const firstLine = (t: string) => t.split('\n')[0];

type Canned = (anim: boolean) => JSX.Element;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export function sceneFromObjects(objects: SlateObj[], canned: Canned[], meta: { id: string; name: string }): RScene {
  const byId = new Map(objects.map((o) => [o.id, o] as const));
  const txt = (o: Any): string => (typeof o?.text === 'string' ? o.text : '');
  const isNode = (o: Any) => (o?.type === 'sticky' || o?.type === 'text') && RUN.test(firstLine(txt(o)));
  const conns = objects.filter((o) => o.type === 'connector') as Any[];
  const stickies = objects.filter((o) => o.type === 'sticky') as Any[];
  const nodes = objects.filter(isNode) as Any[];
  const nodeIds = new Set(nodes.map((n) => n.id));

  // an output = an empty sticky that a node points into
  const outOf = new Map<string, Any>();
  for (const c of conns) {
    const from = c.from?.objectId;
    const to = c.to?.objectId;
    if (from && nodeIds.has(from) && to) {
      const t = byId.get(to) as Any;
      if (t && t.type === 'sticky' && !isNode(t) && txt(t).trim() === '') outOf.set(from, t);
    }
  }
  const outIds = new Set([...outOf.values()].map((o) => o.id));

  // context notes = stickies that are neither nodes nor output placeholders
  const notes: RNote[] = stickies
    .filter((o) => !isNode(o) && !outIds.has(o.id))
    .map((o) => ({ id: o.id, x: o.x, y: o.y, w: o.w, h: o.h, color: o.color ?? '#FFE066', body: txt(o) }));

  let ci = 0;
  const rnodes: RNode[] = nodes.map((o) => {
    const m = firstLine(txt(o)).match(/^\s*(▶ ?)?(\w+:)\s*(.*)$/);
    const cmd = m ? m[2] : 'ai:';
    const rest = m ? m[3] : firstLine(txt(o));
    const inputs = conns.filter((c) => c.to?.objectId === o.id && c.from?.objectId).map((c) => c.from.objectId as string);
    const os = outOf.get(o.id);
    const orect = os
      ? { id: os.id, x: os.x, y: os.y, w: os.w, h: os.h }
      : { id: `${o.id}__out`, x: o.x, y: o.y + (o.h ?? 160) + 40, w: Math.max(240, o.w ?? 240), h: 150 };
    const render = canned[ci++] ?? (() => <span />);
    const out: ROut = { ...orect, title: '', bare: cmd === 'img:', render };
    return { id: o.id, x: o.x, y: o.y, w: o.w, h: o.h, cmd, rest, inputs, out };
  });

  return { id: meta.id, name: meta.name, notes, nodes: rnodes };
}

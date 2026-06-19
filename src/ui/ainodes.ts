// AI function nodes: a sticky/text whose text starts with "ai:" becomes a
// runnable node (auto-prefixed with a clickable RUN glyph). Inputs = objects
// wired INTO it with connectors; outputs = objects it points AT. Clicking the
// glyph gathers input texts, runs the instruction through the LLM, and writes
// the result into the output objects (creating one if none is wired).
import { chat, chatWithTools, explainEmptyToolResult, generateImage, hasOpenRouter } from '../ai/llm';
import { makeBusinessTools, pickTable, tableSummary } from '../ai/tools';
import { useUI } from '../store/ui';
import { getBlob, putBlob } from '../store/db';
import { exportPng } from '../export/export';
import { lineHeight, textBlockSize } from '../engine/text';
import { getBasePrompt } from '../ai/basePrompts';
import { uploadLabel } from './upload';
import type { UploadFile } from '../types';

type AnyObj = Record<string, any>;

/** Brand voice/audience/don'ts guidance for text (ai:) system prompts. */
function brandTextAddon(): string {
  const k = useUI.getState().activeBrandKit;
  if (!k) return '';
  const parts: string[] = [];
  if (k.voice?.trim()) parts.push(`Voice/tone: ${k.voice.trim()}`);
  if (k.audience?.trim()) parts.push(`Audience: ${k.audience.trim()}`);
  if (k.donts?.trim()) parts.push(`Avoid: ${k.donts.trim()}`);
  if (parts.length === 0) return '';
  return `\n\nBRAND GUIDELINES (follow these) — ${k.name}:\n${parts.join('\n')}`;
}

/** Brand style guidance appended to img: prompts. */
function brandImageAddon(): string {
  const k = useUI.getState().activeBrandKit;
  if (!k) return '';
  const bits: string[] = [];
  if (k.palette?.length) bits.push(`color palette ${k.palette.join(', ')}`);
  if (k.voice?.trim()) bits.push(`brand feel: ${k.voice.trim()}`);
  return bits.length ? `\n\nMatch this brand style: ${bits.join('; ')}.` : '';
}

/** The active kit's logo as a data URL, if any (used as an img: reference). */
async function brandLogoDataUrl(): Promise<string | null> {
  const k = useUI.getState().activeBrandKit;
  if (!k?.logoBlobId) return null;
  try {
    const blob = await getBlob(k.logoBlobId);
    return blob ? await blobToDataUrl(blob) : null;
  } catch {
    return null;
  }
}

// ai: text · img: image · web: scrape · search: links · ask: answered web search · research: deep agent · extract: table · chart: graph · fix: better prompt · data: HTTP fetch · condition: yes/no branch · interval/timer: schedule
const RUN = /^(▶ ?)?(ai|img|web|search|ask|research|extract|chart|fix|data|business|condition|if|interval|timer|every):/i;
const IMG = /^(▶ ?)?img:/i;
const WEB = /^(▶ ?)?web:/i;
const ASK = /^(▶ ?)?ask:/i;
const DATA = /^(▶ ?)?data:/i;
const COND = /^(▶ ?)?(condition|if):/i;
const TICK = /^(▶ ?)?(interval|every|timer):/i;
const SEARCH = /^(▶ ?)?search:/i;
const RESEARCH = /^(▶ ?)?research:/i;
const EXTRACT = /^(▶ ?)?extract:/i;
const CHART = /^(▶ ?)?chart:/i;
const FIX = /^(▶ ?)?fix:/i;
const BUSINESS = /^(▶ ?)?business:/i;
const RAW = /^(\s*)ai:/i;
const nid = () => Math.random().toString(36).slice(2, 10);
const last = { id: '', t: 0 };

export function normalizeAINodeText(_text: string): string | null {
  // glyph injection retired — ai-nodes now get a real DOM run button
  return null;
}

export function attachAINodeNormalizer(ctl: AnyObj) {
  ctl.doc.subscribe((changedIds: Set<string>) => {
    for (const id of changedIds) {
      const o = ctl.doc.get(id);
      if (!o || (o.type !== 'sticky' && o.type !== 'text')) continue;
      if (typeof o.text !== 'string' || normalizeAINodeText(o.text) === null) continue;
      setTimeout(() => {
        try {
          const ui = (window as any).__slateUIState?.();
          if (ui?.editingTextId === id) return;
          const fresh = ctl.doc.get(id);
          if (!fresh) return;
          const norm = normalizeAINodeText(fresh.text);
          if (norm !== null) ctl.doc.update(id, { text: norm });
        } catch {
          /* never break editing */
        }
      }, 0);
    }
  });
}

function nodeAt(ctl: AnyObj, world: { x: number; y: number }): AnyObj | null {
  const candidates = ctl.doc
    .search({ x: world.x - 1, y: world.y - 1, w: 2, h: 2 })
    .filter(
      (o: AnyObj) =>
        (o.type === 'sticky' || o.type === 'text') &&
        !o.locked &&
        typeof o.text === 'string' &&
        RUN.test(o.text.split('\n')[0])
    )
    .sort((a: AnyObj, b: AnyObj) => b.z - a.z);
  for (const o of candidates) {
    const pad = o.type === 'sticky' ? 12 : 0;
    const startX = o.x + pad;
    const startY = o.y + pad;
    const lh = lineHeight(o.fontSize);
    if (world.x < startX || world.x > startX + o.fontSize * 1.5) continue;
    if (world.y < startY || world.y > startY + lh) continue; // first row only
    return o;
  }
  return null;
}

export function isOnRunGlyph(ctl: AnyObj, e: { clientX: number; clientY: number }): boolean {
  try {
    return nodeAt(ctl, ctl.toWorld(e)) !== null;
  } catch {
    return false;
  }
}

export function tryRunAINode(ctl: AnyObj, e: { clientX: number; clientY: number }): boolean {
  try {
    const node = nodeAt(ctl, ctl.toWorld(e));
    if (!node) return false;
    const now = Date.now();
    if (last.id === node.id && now - last.t < 600) return true;
    last.id = node.id;
    last.t = now;
    void execute(ctl, node);
    return true;
  } catch {
    return false;
  }
}

function setText(ctl: AnyObj, id: string, text: string) {
  const o = ctl.doc.get(id);
  if (!o) return;
  const patch: AnyObj = { text };
  if (o.type === 'sticky') {
    const m = textBlockSize(text || ' ', o.fontSize, o.w - 24, 500, o.fontFamily);
    patch.h = Math.max(o.h, m.h + 24);
  } else if (o.type === 'text') {
    const m = textBlockSize(text || ' ', o.fontSize, o.fixedWidth ? o.w : undefined, 400, o.fontFamily);
    patch.w = o.fixedWidth ? o.w : m.w;
    patch.h = m.h;
  }
  ctl.doc.update(id, patch);
}

/** The node's true instruction source — the hidden prompt when locked. */
function promptSource(node: AnyObj): string {
  return typeof node.aiPrompt === 'string' && node.aiPrompt ? node.aiPrompt : String(node.text ?? '');
}

export function isHiddenNode(node: AnyObj): boolean {
  return typeof node?.aiPrompt === 'string' && node.aiPrompt.length > 0;
}

/** Hide/reveal a node's prompt. Hidden prompts live in `aiPrompt`; the visible text becomes a mask. */
export function toggleHiddenPrompt(ctl: AnyObj, node: AnyObj) {
  if (isHiddenNode(node)) {
    ctl.doc.update(node.id, { text: node.aiPrompt, aiPrompt: null });
  } else {
    const kind = IMG.test(String(node.text ?? '').split('\n')[0]) ? 'img' : 'ai';
    ctl.doc.update(node.id, { aiPrompt: node.text, text: `${kind}: \u{1F512} hidden prompt` });
  }
}

/** Is there a hidden node under the pointer? (used to block the text editor on locked nodes) */
export function hiddenNodeAt(ctl: AnyObj, e: { clientX: number; clientY: number }): boolean {
  try {
    const w = ctl.toWorld(e);
    return ctl.doc
      .search({ x: w.x - 1, y: w.y - 1, w: 2, h: 2 })
      .some(
        (o: AnyObj) =>
          isAINode(o) &&
          isHiddenNode(o) &&
          w.x >= o.x &&
          w.x <= o.x + (o.w ?? 0) &&
          w.y >= o.y &&
          w.y <= o.y + (o.h ?? 0)
      );
  } catch {
    return false;
  }
}

/** Public runner used by the floating run buttons. */
export async function runAINode(ctl: AnyObj, node: AnyObj): Promise<void> {
  const head = promptSource(node).split('\n')[0];
  if (IMG.test(head)) return executeImage(ctl, node);
  if (WEB.test(head)) return executeWeb(ctl, node);
  if (SEARCH.test(head)) return executeSearch(ctl, node);
  if (ASK.test(head)) return executeAsk(ctl, node);
  if (RESEARCH.test(head)) return executeResearch(ctl, node);
  if (EXTRACT.test(head)) return executeExtract(ctl, node);
  if (CHART.test(head)) return executeChart(ctl, node);
  if (FIX.test(head)) return executeFix(ctl, node);
  if (BUSINESS.test(head)) return executeBusiness(ctl, node);
  if (DATA.test(head)) return executeData(ctl, node);
  if (COND.test(head)) return executeCondition(ctl, node);
  if (TICK.test(head)) return executeTick(ctl, node);
  return execute(ctl, node);
}

/** First line marks an AI node? */
export function isAINode(o: AnyObj | undefined): boolean {
  return (
    !!o &&
    (o?.type === 'sticky' || o?.type === 'text') &&
    typeof o.text === 'string' &&
    RUN.test(o.text.split('\n')[0])
  );
}

export interface Flow {
  id: string;
  label: string;
  nodes: AnyObj[]; // runnable nodes in execution (topological) order
}

function nodeLabel(node: AnyObj): string {
  const t = String(promptSource(node) ?? '')
    .replace(/\n/g, ' ')
    .trim();
  return t.length > 30 ? t.slice(0, 30) + '…' : t || 'node';
}

/**
 * Connected flows on the board. A flow is a group of objects wired together by
 * connectors that contains at least one runnable node. Isolated/unconnected
 * nodes are not flows (run those with their own ▶). Within each flow, nodes are
 * ordered topologically so every node runs after the nodes feeding into it.
 */
export function getFlows(ctl: AnyObj): Flow[] {
  const objs: AnyObj[] = ctl.doc.all();
  const byId = new Map(objs.map((o) => [o.id, o]));

  // build undirected (for components) + directed (for ordering) adjacency from connectors
  const undirected = new Map<string, Set<string>>();
  const directed = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  const link = (a: string, b: string) => {
    (undirected.get(a) ?? undirected.set(a, new Set()).get(a)!).add(b);
    (undirected.get(b) ?? undirected.set(b, new Set()).get(b)!).add(a);
  };
  for (const c of objs) {
    if (c.type !== 'connector') continue;
    const from = c.from?.objectId;
    const to = c.to?.objectId;
    if (from && to && byId.has(from) && byId.has(to) && from !== to) {
      link(from, to);
      (directed.get(from) ?? directed.set(from, []).get(from)!).push(to);
      indeg.set(to, (indeg.get(to) ?? 0) + 1);
      if (!indeg.has(from)) indeg.set(from, 0);
    }
  }

  // weakly-connected components over only the objects that take part in connectors
  const visited = new Set<string>();
  const flows: Flow[] = [];
  for (const start of undirected.keys()) {
    if (visited.has(start)) continue;
    const comp: string[] = [];
    const q = [start];
    visited.add(start);
    while (q.length) {
      const id = q.shift()!;
      comp.push(id);
      for (const nb of undirected.get(id) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          q.push(nb);
        }
      }
    }
    const compSet = new Set(comp);
    if (!comp.some((id) => isAINode(byId.get(id)))) continue; // no runnable node → not a flow

    // Kahn topo within the component
    const localIndeg = new Map<string, number>();
    for (const id of comp) localIndeg.set(id, indeg.get(id) ?? 0);
    const ready = comp.filter((id) => (localIndeg.get(id) ?? 0) === 0);
    const order: string[] = [];
    const seen = new Set<string>();
    while (ready.length) {
      const id = ready.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      for (const nxt of directed.get(id) ?? []) {
        if (!compSet.has(nxt)) continue;
        localIndeg.set(nxt, (localIndeg.get(nxt) ?? 1) - 1);
        if ((localIndeg.get(nxt) ?? 0) <= 0) ready.push(nxt);
      }
    }
    for (const id of comp) if (!seen.has(id)) order.push(id); // cycle leftovers
    const nodes = order.map((id) => byId.get(id)!).filter((o) => o && isAINode(o));
    const first = nodes[0];
    if (!first) continue;
    flows.push({ id: [...comp].sort()[0] ?? first.id, label: nodeLabel(first), nodes });
  }
  // stable order: by topmost node position
  flows.sort((a, b) => (a.nodes[0]?.y ?? 0) - (b.nodes[0]?.y ?? 0) || (a.nodes[0]?.x ?? 0) - (b.nodes[0]?.x ?? 0));
  return flows;
}

export interface LoopProgress {
  /** 1-based current iteration of the loop body, when the running node is inside a loop */
  iter: number;
  /** total iterations the loop will run */
  total: number;
}

type Branch = 'yes' | 'no' | null;

interface RunPlan {
  steps: AnyObj[];
  loop: LoopProgress[];
  /** edges into each node id (within the flow), each carrying any branch gate */
  incoming: Map<string, Array<{ from: string; branch: Branch }>>;
}

/** Classify a connector label as a yes/no branch gate (for condition nodes). */
function branchOf(label: unknown): Branch {
  const s = typeof label === 'string' ? label.trim().toLowerCase() : '';
  if (!s) return null;
  if (/^(y\b|yes|true|✓|✔|pass|success)/.test(s)) return 'yes';
  if (/^(n\b|no|false|✗|✘|fail)/.test(s)) return 'no';
  return null;
}

/**
 * Build the execution sequence for a flow: topological order, expanding any
 * closed loop, plus the incoming-edge map used to gate condition branches.
 *
 * A loop is a connector pointing "backwards" — from a later node to an earlier
 * one — closing a cycle; its numeric label sets how many times the body repeats
 * (default 3, cap 10). A condition node's outgoing connectors labeled yes/no are
 * branch gates: at run time the untaken branch is skipped. Acyclic, label-free
 * flows are unaffected.
 */
function planExecution(ctl: AnyObj, nodes: AnyObj[]): RunPlan {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);

  // object-level adjacency from connectors, keeping each connector's label
  const objAdj = new Map<string, Array<{ to: string; label: unknown }>>();
  for (const c of ctl.doc.all()) {
    if (c.type === 'connector' && c.from?.objectId && c.to?.objectId && c.from.objectId !== c.to.objectId) {
      (objAdj.get(c.from.objectId) ?? objAdj.set(c.from.objectId, []).get(c.from.objectId)!).push({ to: c.to.objectId, label: c.label });
    }
  }

  // collapse to a node→node graph; the branch gate is the label of the connector
  // leaving the source node (carried through any plain stickies on the path)
  const edges = new Map<string, Array<{ to: string; branch: Branch }>>();
  for (const n of nodes) {
    const list: Array<{ to: string; branch: Branch }> = [];
    const seen = new Set<string>([n.id]);
    const q: Array<{ id: string; branch: Branch }> = (objAdj.get(n.id) ?? []).map((e) => ({ id: e.to, branch: branchOf(e.label) }));
    while (q.length) {
      const { id, branch } = q.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (idSet.has(id)) {
        list.push({ to: id, branch }); // stop at the next node
        continue;
      }
      for (const nx of objAdj.get(id) ?? []) q.push({ id: nx.to, branch });
    }
    edges.set(n.id, list);
  }
  const targets = (u: string) => (edges.get(u) ?? []).map((e) => e.to);

  // DFS to find back-edges (an edge into a node still on the recursion stack)
  const color = new Map<string, number>(); // 0 white, 1 gray, 2 black
  const backEdges: Array<{ from: string; to: string }> = [];
  const dfs = (u: string) => {
    color.set(u, 1);
    for (const v of targets(u)) {
      const c = color.get(v) ?? 0;
      if (c === 1) backEdges.push({ from: u, to: v });
      else if (c === 0) dfs(v);
    }
    color.set(u, 2);
  };
  for (const id of ids) if ((color.get(id) ?? 0) === 0) dfs(id);

  // topo sort with back-edges removed → a clean DAG ordering
  const skip = new Set(backEdges.map((e) => `${e.from}->${e.to}`));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const u of ids) for (const v of targets(u)) {
    if (skip.has(`${u}->${v}`)) continue;
    indeg.set(v, (indeg.get(v) ?? 0) + 1);
  }
  const ready = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const order: string[] = [];
  const done = new Set<string>();
  while (ready.length) {
    const u = ready.shift()!;
    if (done.has(u)) continue;
    done.add(u);
    order.push(u);
    for (const v of targets(u)) {
      if (skip.has(`${u}->${v}`)) continue;
      indeg.set(v, (indeg.get(v) ?? 1) - 1);
      if ((indeg.get(v) ?? 0) <= 0) ready.push(v);
    }
  }
  for (const id of ids) if (!done.has(id)) order.push(id);

  // incoming edges (within the flow), for runtime branch gating
  const incoming = new Map<string, Array<{ from: string; branch: Branch }>>();
  for (const id of ids) incoming.set(id, []);
  for (const u of ids) for (const e of edges.get(u) ?? []) incoming.get(e.to)?.push({ from: u, branch: e.branch });

  // pick the outermost loop (widest span in the ordering) — v1 supports one loop
  let best: { start: number; end: number; n: number } | null = null;
  for (const e of backEdges) {
    const start = order.indexOf(e.to); // loop entry (earlier node)
    const end = order.indexOf(e.from); // loop exit (later node)
    if (start < 0 || end < 0 || end < start) continue;
    const n = loopCount(ctl, e.from, e.to);
    if (!best || end - start > best.end - best.start) best = { start, end, n };
  }

  const steps: AnyObj[] = [];
  const loop: LoopProgress[] = [];
  const push = (id: string, lp: LoopProgress | null) => {
    const o = byId.get(id);
    if (!o) return;
    steps.push(o);
    loop.push(lp ?? { iter: 0, total: 0 });
  };
  if (!best) {
    for (const id of order) push(id, null);
  } else {
    for (let i = 0; i < best.start; i++) push(order[i]!, null);
    for (let it = 1; it <= best.n; it++) {
      for (let i = best.start; i <= best.end; i++) push(order[i]!, { iter: it, total: best.n });
    }
    for (let i = best.end + 1; i < order.length; i++) push(order[i]!, null);
  }
  return { steps, loop, incoming };
}

// ---------- interval/timer: in-tab scheduling ----------
//
// These run a flow on a clock *while the board is open in the tab*. `interval:`
// (alias `every:`) re-runs on a period; `timer:` fires once after a countdown.
// They are not a server cron — closing the tab stops them. State lives in a
// module map so the floating run button can show / toggle the active schedule.

interface Schedule {
  handle: ReturnType<typeof setInterval>;
  kind: 'interval' | 'timer';
}
const schedules = new Map<string, Schedule>();

/** Is this node a scheduling trigger (interval/timer/every)? */
export function isTickNode(o: AnyObj | undefined): boolean {
  return !!o && (o.type === 'sticky' || o.type === 'text') && typeof o.text === 'string' && TICK.test(o.text.split('\n')[0]);
}

/** Is a schedule currently ticking for this node? (used by the run button) */
export function isScheduleActive(id: string): boolean {
  return schedules.has(id);
}

/** Stop every schedule — called when the board unmounts so timers don't leak. */
export function stopAllSchedules() {
  for (const s of schedules.values()) clearInterval(s.handle);
  schedules.clear();
}

/** Parse "60s" / "5m" / "1h" / "24h" / "30" (seconds default) → milliseconds. */
function parseDuration(s: string): number | null {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec(?:s|onds)?|m|min(?:s|utes)?|h|hr(?:s)?|hours?|d|days?)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  if (!isFinite(n) || n <= 0) return null;
  const u = (m[2] || 's').toLowerCase();
  let mult = 1000; // seconds default
  if (/^ms/.test(u)) mult = 1;
  else if (/^s/.test(u)) mult = 1000;
  else if (/^m/.test(u)) mult = 60_000;
  else if (/^h/.test(u)) mult = 3_600_000;
  else if (/^d/.test(u)) mult = 86_400_000;
  return Math.round(n * mult);
}

/** Humanize a millisecond period back to a compact label. */
function fmtPeriod(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s % 86400 === 0) return `${s / 86400}d`;
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60}m`;
  return `${s}s`;
}

/** Write a one-line status under a trigger node (spawns a small note once, then reuses it). */
function tickStatus(ctl: AnyObj, nodeId: string, msg: string) {
  const doc = ctl.doc;
  const node = doc.get(nodeId);
  if (!node) return;
  doc.begin();
  const existing = node.statusId ? doc.get(node.statusId) : null;
  if (existing) {
    setText(ctl, node.statusId, msg);
  } else {
    const id = nid();
    doc.set({
      id,
      type: 'text',
      x: node.x,
      y: node.y + (node.h ?? 60) + 8,
      w: 260,
      h: 18,
      rotation: 0,
      z: doc.nextZ(),
      text: msg,
      color: '#6741d9',
      fontSize: 12,
      fontFamily: 'jetbrains',
      fixedWidth: false,
    });
    doc.update(nodeId, { statusId: id });
  }
  doc.commit();
}

function stopSchedule(ctl: AnyObj, nodeId: string) {
  const s = schedules.get(nodeId);
  if (s) {
    clearInterval(s.handle);
    schedules.delete(nodeId);
  }
  if (ctl.doc.get(nodeId)) {
    ctl.doc.begin();
    ctl.doc.update(nodeId, { ticking: false });
    ctl.doc.commit();
  }
}

/** Toggle a node's schedule on/off. Firing runs the node's whole flow (the trigger itself is skipped). */
async function executeTick(ctl: AnyObj, node: AnyObj) {
  if (schedules.has(node.id)) {
    stopSchedule(ctl, node.id);
    tickStatus(ctl, node.id, '⏹ stopped');
    return;
  }
  const head = promptSource(node).split('\n')[0];
  const kind: 'interval' | 'timer' = /timer:/i.test(head) ? 'timer' : 'interval';
  const period = parseDuration(promptSource(node).replace(RUN, '').trim());
  if (!period) {
    tickStatus(ctl, node.id, '⚠ set a duration — e.g. interval: 60s  ·  timer: 10m');
    return;
  }
  const periodMs = Math.max(kind === 'interval' ? 1000 : 100, period);

  const fire = () => {
    if (!ctl.doc.get(node.id)) {
      stopSchedule(ctl, node.id); // node was deleted — clean up
      return;
    }
    const flow = getFlows(ctl).find((f) => f.nodes.some((n) => n.id === node.id));
    const toRun = flow ? flow.nodes : [];
    tickStatus(ctl, node.id, `▶ running… (${new Date().toLocaleTimeString()})`);
    void runFlow(ctl, toRun).then(() => {
      if (kind === 'timer') {
        stopSchedule(ctl, node.id);
        tickStatus(ctl, node.id, `✓ ran once at ${new Date().toLocaleTimeString()}`);
      } else if (schedules.has(node.id)) {
        tickStatus(ctl, node.id, `⏱ every ${fmtPeriod(periodMs)} · last ${new Date().toLocaleTimeString()}`);
      }
    });
  };

  ctl.doc.begin();
  ctl.doc.update(node.id, { ticking: true });
  ctl.doc.commit();

  if (kind === 'timer') {
    schedules.set(node.id, { handle: setTimeout(fire, periodMs), kind });
    tickStatus(ctl, node.id, `⏳ runs in ${fmtPeriod(periodMs)}…`);
  } else {
    schedules.set(node.id, { handle: setInterval(fire, periodMs), kind });
    fire(); // first run immediately, then every period
  }
}

/** Iterations for a loop-closing connector: its numeric label, default 3, capped 1–10. */
function loopCount(ctl: AnyObj, fromId: string, toId: string): number {
  const c = ctl.doc
    .all()
    .find((o: AnyObj) => o.type === 'connector' && o.from?.objectId === fromId && o.to?.objectId === toId);
  const m = typeof c?.label === 'string' ? c.label.match(/\d+/) : null;
  const n = m ? parseInt(m[0], 10) : 3;
  return Math.max(1, Math.min(10, Number.isFinite(n) ? n : 3));
}

/**
 * Execute a flow in dependency order, expanding loops and honoring condition
 * branches: a node runs only if it's a root or has at least one *active*
 * incoming edge. An edge is active when its source actually ran and — if the
 * source is a condition node — the edge's yes/no gate matches the verdict. The
 * untaken branch (and everything downstream of it) is skipped.
 */
export async function runFlow(
  ctl: AnyObj,
  nodes: AnyObj[],
  onProgress?: (done: number, total: number, node: AnyObj, loop?: LoopProgress) => void
): Promise<{ ran: number }> {
  const { steps, loop, incoming } = planExecution(ctl, nodes);
  const ran = new Set<string>(); // nodes that actually executed
  const verdict = new Map<string, boolean>(); // condition id → yes(true) / no(false)

  const edgeActive = (from: string, branch: Branch) => {
    if (!ran.has(from)) return false;
    if (verdict.has(from) && branch) return verdict.get(from) === (branch === 'yes');
    return true; // plain edge, or an unlabeled edge out of a condition
  };
  const enabled = (id: string) => {
    const inc = incoming.get(id) ?? [];
    return inc.length === 0 || inc.some((e) => edgeActive(e.from, e.branch));
  };

  let count = 0;
  for (let i = 0; i < steps.length; i++) {
    const node = steps[i]!;
    const lp = loop[i];
    onProgress?.(i, steps.length, node, lp && lp.total > 0 ? lp : undefined);
    if (!enabled(node.id)) continue; // branch not taken → skip this node
    if (isTickNode(node)) {
      ran.add(node.id); // trigger nodes are pass-through inside a run (no recursion)
      continue;
    }
    try {
      await runAINode(ctl, node);
    } catch {
      // individual node failures already surface in their own output; keep going
    }
    ran.add(node.id);
    count++;
    if (COND.test(promptSource(node).split('\n')[0])) {
      verdict.set(node.id, ctl.doc.get(node.id)?.conditionResult === 'yes');
    }
  }
  onProgress?.(steps.length, steps.length, steps[steps.length - 1]!);
  return { ran: count };
}

async function execute(ctl: AnyObj, node: AnyObj) {
  const doc = ctl.doc;
  const conns = doc.all().filter((c: AnyObj) => c.type === 'connector');
  const inputs = gatherInputs(ctl, node);
  const imageInputs = [...(await gatherImageInputs(ctl, node)), ...(await gatherFrameSnapshots(ctl, node))];
  let outIds: string[] = conns
    .filter((c: AnyObj) => c.from?.objectId === node.id && c.to?.objectId && c.to.objectId !== node.id)
    .map((c: AnyObj) => c.to.objectId)
    .filter((id: string) => {
      const t = doc.get(id);
      return t && (t.type === 'sticky' || t.type === 'text' || t.type === 'shape');
    });

  doc.begin();
  if (outIds.length === 0) {
    // spawn an output sticky to the right and wire it
    const out: AnyObj = {
      id: nid(),
      type: 'sticky',
      x: node.x + (node.w ?? 200) + 80,
      y: node.y,
      w: 220,
      h: Math.max(120, node.h ?? 120),
      rotation: 0,
      z: doc.nextZ(),
      color: '#F1F0EC',
      text: '',
      fontSize: 16,
    };
    doc.set(out);
    doc.set({
      id: nid(),
      type: 'connector',
      x: node.x,
      y: node.y,
      rotation: 0,
      z: doc.nextZ(),
      from: { objectId: node.id },
      to: { objectId: out.id },
      routing: 'curved',
      stroke: '#868e96',
      strokeWidth: 2,
      dash: 'dashed',
      startArrow: 'none',
      endArrow: 'triangle',
      opacity: 1,
    });
    outIds = [out.id];
  }
  for (const id of outIds) setText(ctl, id, '⏳ thinking…');
  doc.commit();

  const instruction = promptSource(node).replace(RUN, '').trim();
  const inputBlock =
    inputs.length > 0
      ? inputs.map((o: AnyObj, i: number) => `[input ${i + 1}]\n${o.text}`).join('\n---\n')
      : '(no inputs wired)';
  try {
    const n = outIds.length;
    const wantVersions = n > 1;
    const userText = wantVersions
      ? `INPUTS:\n${inputBlock}\n\nINSTRUCTION: ${instruction}\n\nProduce exactly ${n} DISTINCT versions (different angles, wording, or ideas — not rephrasings). Reply with ONLY JSON: {"versions": ["...", ...]} with exactly ${n} strings.`
      : `INPUTS:\n${inputBlock}\n\nINSTRUCTION: ${instruction}`;
    const result = await chat(
      [
        {
          role: 'system',
          content: getBasePrompt('ai') + brandTextAddon(),
        },
        imageInputs.length
          ? {
              role: 'user',
              content: [
                { type: 'text', text: userText },
                ...imageInputs.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
              ],
            }
          : { role: 'user', content: userText },
      ],
      { temperature: wantVersions ? 0.9 : 0.5, json: wantVersions }
    );
    let versions: string[] | null = null;
    if (wantVersions) {
      try {
        const cleaned = result.replace(/```(?:json)?/gi, '').trim();
        const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
        const arr = Array.isArray(parsed) ? parsed : parsed?.versions;
        if (Array.isArray(arr) && arr.length) versions = arr.map((v: unknown) => String(v));
      } catch {
        versions = null; // fall back to broadcasting the raw text
      }
    }
    doc.begin();
    outIds.forEach((id: string, i: number) => {
      const text = versions ? versions[i % versions.length] : result;
      setText(ctl, id, (text ?? '').trim() || '(empty result)');
    });
    doc.commit();
  } catch (err) {
    doc.begin();
    for (const id of outIds) setText(ctl, id, '⚠ ' + (err instanceof Error ? err.message : String(err)));
    doc.commit();
  }
}


const URL_RE = /https?:\/\/[^\s)<>"']+/gi;

async function executeWeb(ctl: AnyObj, node: AnyObj) {
  const doc = ctl.doc;
  const conns = doc.all().filter((c: AnyObj) => c.type === 'connector');

  // collect URLs from wired text inputs + the node's own text
  const sources = [...gatherInputs(ctl, node).map((o: AnyObj) => o.text), promptSource(node)];
  const urls = Array.from(new Set(sources.join('\n').match(URL_RE) ?? [])).slice(0, 20);

  let outIds: string[] = conns
    .filter((c: AnyObj) => c.from?.objectId === node.id && c.to?.objectId && c.to.objectId !== node.id)
    .map((c: AnyObj) => c.to.objectId)
    .filter((id: string) => {
      const t = doc.get(id);
      return t && (t.type === 'sticky' || t.type === 'text' || t.type === 'shape');
    });

  doc.begin();
  if (outIds.length === 0) {
    const out: AnyObj = {
      id: nid(),
      type: 'sticky',
      x: node.x + (node.w ?? 200) + 80,
      y: node.y,
      w: 260,
      h: Math.max(160, node.h ?? 160),
      rotation: 0,
      z: doc.nextZ(),
      color: '#A8D8EA',
      text: '',
      fontSize: 15,
    };
    doc.set(out);
    doc.set({
      id: nid(),
      type: 'connector',
      x: node.x,
      y: node.y,
      rotation: 0,
      z: doc.nextZ(),
      from: { objectId: node.id },
      to: { objectId: out.id },
      routing: 'curved',
      stroke: '#868e96',
      strokeWidth: 2,
      dash: 'dashed',
      startArrow: 'none',
      endArrow: 'triangle',
      opacity: 1,
    });
    outIds = [out.id];
  }

  if (urls.length === 0) {
    for (const id of outIds) setText(ctl, id, '⚠ No links found — wire in a sticky/field containing a URL, or put the URL in this node.');
    doc.commit();
    return;
  }
  for (const id of outIds) setText(ctl, id, `⏳ scraping ${urls.length} link${urls.length === 1 ? '' : 's'}…`);
  doc.commit();

  const instruction =
    promptSource(node).replace(RUN, '').replace(URL_RE, '').trim() ||
    'Summarize this page: what it is, the key points, and who it is for.';

  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `scrape failed (${res.status})`);
    if (data?.usage?.credits) useUI.getState().addUsage({ tavilyCredits: data.usage.credits });
    const pages: { url: string; raw_content?: string }[] = data?.results ?? [];
    if (pages.length === 0) throw new Error('No content extracted from those links.');
    // cap content per page so prompts stay sane
    const corpus = pages
      .map((p) => `### ${p.url}\n${(p.raw_content ?? '').slice(0, 6000)}`)
      .join('\n\n');

    const result = await chat(
      [
        {
          role: 'system',
          content: getBasePrompt('web'),
        },
        { role: 'user', content: `SCRAPED CONTENT:\n${corpus}\n\nINSTRUCTION: ${instruction}` },
      ],
      { temperature: 0.4 }
    );
    doc.begin();
    for (const id of outIds) setText(ctl, id, result.trim() || '(empty result)');
    doc.commit();
  } catch (err) {
    doc.begin();
    for (const id of outIds) setText(ctl, id, '⚠ ' + (err instanceof Error ? err.message : String(err)));
    doc.commit();
  }
}

// ---------- shared output plumbing for the function nodes ----------

function wireOutput(ctl: AnyObj, node: AnyObj, out: AnyObj) {
  ctl.doc.set(out);
  ctl.doc.set({
    id: nid(),
    type: 'connector',
    x: node.x,
    y: node.y,
    rotation: 0,
    z: ctl.doc.nextZ(),
    from: { objectId: node.id },
    to: { objectId: out.id },
    routing: 'curved',
    stroke: '#868e96',
    strokeWidth: 2,
    dash: 'dashed',
    startArrow: 'none',
    endArrow: 'triangle',
    opacity: 1,
  });
}

/** Wired text-ish outputs, or spawn one. Call inside a doc.begin()/commit(). */
function prepTextOutputs(ctl: AnyObj, node: AnyObj, opts: { color?: string; mono?: boolean; w?: number } = {}): string[] {
  const doc = ctl.doc;
  const outIds: string[] = doc
    .all()
    .filter((c: AnyObj) => c.type === 'connector' && c.from?.objectId === node.id && c.to?.objectId && c.to.objectId !== node.id)
    .map((c: AnyObj) => c.to.objectId)
    .filter((id: string) => {
      const t = doc.get(id);
      return t && (t.type === 'sticky' || t.type === 'text' || t.type === 'shape');
    });
  if (outIds.length) return outIds;
  const x = node.x + (node.w ?? 200) + 80;
  const out: AnyObj = opts.mono
    ? { id: nid(), type: 'text', x, y: node.y, w: opts.w ?? 380, h: 60, rotation: 0, z: doc.nextZ(), text: '', color: '#1a1a1a', fontSize: 13, fontFamily: 'jetbrains', fixedWidth: false }
    : { id: nid(), type: 'sticky', x, y: node.y, w: opts.w ?? 240, h: Math.max(140, node.h ?? 140), rotation: 0, z: doc.nextZ(), color: opts.color ?? '#F1F0EC', text: '', fontSize: 15 };
  wireOutput(ctl, node, out);
  return [out.id];
}

// ---------- search: web search via /api/search ----------

async function executeSearch(ctl: AnyObj, node: AnyObj) {
  const doc = ctl.doc;
  const typed = promptSource(node).replace(RUN, '').trim();
  const query = [typed, ...gatherInputs(ctl, node).map((o: AnyObj) => o.text)].filter(Boolean).join(' ').trim();

  doc.begin();
  const outIds = prepTextOutputs(ctl, node, { color: '#B5EAD7' });
  if (!query) {
    for (const id of outIds) setText(ctl, id, '⚠ No query — type one after "search:" or wire in a sticky.');
    doc.commit();
    return;
  }
  for (const id of outIds) setText(ctl, id, '⏳ searching…');
  doc.commit();

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `search failed (${res.status})`);
    if (data?.usage?.credits) useUI.getState().addUsage({ tavilyCredits: data.usage.credits });
    const results: { title?: string; url?: string; content?: string }[] = data?.results ?? [];
    const answer: string = data?.answer || '';
    const sources = results.map((r) => `• ${r.title || r.url}\n  ${r.url}`).join('\n');
    const out = [answer.trim(), sources && `Sources:\n${sources}`].filter(Boolean).join('\n\n') || '(no results)';
    doc.begin();
    for (const id of outIds) setText(ctl, id, out);
    doc.commit();
  } catch (err) {
    doc.begin();
    for (const id of outIds) setText(ctl, id, '⚠ ' + (err instanceof Error ? err.message : String(err)));
    doc.commit();
  }
}

// ---------- ask: answered web search (search → LLM synthesis with citations) ----------

async function executeAsk(ctl: AnyObj, node: AnyObj) {
  const doc = ctl.doc;
  const typed = promptSource(node).replace(RUN, '').trim();
  const question = [typed, ...gatherInputs(ctl, node).map((o: AnyObj) => o.text)].filter(Boolean).join(' ').trim();

  doc.begin();
  const outIds = prepTextOutputs(ctl, node, { color: '#C7CEEA', w: 300 });
  if (!question) {
    for (const id of outIds) setText(ctl, id, '⚠ No question — type one after "ask:" or wire one in.');
    doc.commit();
    return;
  }
  for (const id of outIds) setText(ctl, id, '⏳ searching the web…');
  doc.commit();

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: question }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `search failed (${res.status})`);
    if (data?.usage?.credits) useUI.getState().addUsage({ tavilyCredits: data.usage.credits });
    const results: { title?: string; url?: string; content?: string }[] = data?.results ?? [];
    if (results.length === 0 && !data?.answer) throw new Error('No web results found for that question.');

    const context = results
      .map((r, i) => `[${i + 1}] ${r.title || r.url}\nURL: ${r.url}\n${(r.content || '').slice(0, 1500)}`)
      .join('\n\n');

    doc.begin();
    for (const id of outIds) setText(ctl, id, '⏳ writing answer…');
    doc.commit();

    const answer = await chat(
      [
        {
          role: 'system',
          content:
            "You are a precise research assistant. Answer the user's question using ONLY the web results provided. " +
            'Be specific, accurate, and complete but concise. Cite sources inline as [1], [2]… matching the result numbers. ' +
            "If the results don't contain the answer, say so plainly. Never invent facts, numbers, or URLs.",
        },
        { role: 'user', content: `QUESTION: ${question}\n\nWEB RESULTS:\n${context || data?.answer || '(none)'}` },
      ],
      { temperature: 0.3 }
    );

    const sources = results.map((r, i) => `[${i + 1}] ${r.title || r.url}\n${r.url}`).join('\n');
    const out = [answer.trim() || '(no answer)', sources && `\nSources:\n${sources}`].filter(Boolean).join('\n');
    doc.begin();
    for (const id of outIds) setText(ctl, id, out);
    doc.commit();
  } catch (err) {
    doc.begin();
    for (const id of outIds) setText(ctl, id, '⚠ ' + (err instanceof Error ? err.message : String(err)));
    doc.commit();
  }
}

// ---------- data: HTTP fetch from any REST endpoint via /api/fetch ----------

export interface HttpHeader {
  key: string;
  value: string;
}
export interface HttpConfig {
  method: string; // GET | POST | PUT | PATCH | DELETE
  url: string;
  headers?: HttpHeader[];
  body?: string;
}

/** Is this a data: node? (used by the structured editor + edit guards) */
export function isDataNode(o: AnyObj | undefined): boolean {
  return !!o && (o.type === 'sticky' || o.type === 'text') && typeof o.text === 'string' && DATA.test(o.text.split('\n')[0]);
}

/** Parse a free-text data: node ("[METHOD] URL\nbody") into a structured config — used to migrate typed nodes. */
export function parseDataText(text: string): HttpConfig {
  const raw = String(text ?? '').replace(RUN, '').trim();
  const lines = raw.split('\n');
  const firstLine = (lines.shift() ?? '').trim();
  const body = lines.join('\n').trim();
  const tokens = firstLine.split(/\s+/).filter(Boolean);
  let method = 'GET';
  if (/^(get|post|put|patch|delete)$/i.test(tokens[0] ?? '')) method = tokens.shift()!.toUpperCase();
  return { method, url: tokens.join(' ').trim(), headers: [], body };
}

/** A short canvas label reflecting a data node's structured config. */
export function dataSummary(cfg: HttpConfig): string {
  return `data: ${(cfg.method || 'GET').toUpperCase()} ${cfg.url || '(set endpoint)'}`.trim();
}

async function executeData(ctl: AnyObj, node: AnyObj) {
  const doc = ctl.doc;
  const cfg: HttpConfig = node.http && node.http.url !== undefined ? node.http : parseDataText(promptSource(node));
  const method = (cfg.method || 'GET').toUpperCase();
  const url = (cfg.url || '').trim();
  // body: configured first; otherwise, for write methods, the wired-in text
  const wired = gatherInputs(ctl, node).map((o: AnyObj) => o.text).join('\n').trim();
  const body = (cfg.body || '').trim() || (method !== 'GET' ? wired : '');
  const headers: Record<string, string> = {};
  for (const h of cfg.headers ?? []) if (h.key?.trim()) headers[h.key.trim()] = h.value ?? '';

  doc.begin();
  const outIds = prepTextOutputs(ctl, node, { mono: true, w: 360 });
  if (!url) {
    for (const id of outIds) setText(ctl, id, '⚠ No endpoint set — select the node and fill in the URL.');
    doc.commit();
    return;
  }
  for (const id of outIds) setText(ctl, id, `⏳ ${method} ${url}…`);
  doc.commit();

  try {
    const res = await fetch('/api/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, method, body, headers }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `fetch failed (${res.status})`);
    const out = formatFetchResult(data);
    doc.begin();
    for (const id of outIds) setText(ctl, id, out);
    doc.commit();
    // if the response *is* an image, or *contains* an image URL, render it on the canvas
    try {
      if (data.image && data.base64) {
        await renderDataImage(ctl, node, `data:${data.contentType || 'image/png'};base64,${data.base64}`);
      } else {
        const imgUrl = findImageUrl(data);
        if (imgUrl) {
          const dataUrl = await fetchImageDataUrl(imgUrl);
          if (!dataUrl) throw new Error(`image fetch returned no data for ${imgUrl}`);
          await renderDataImage(ctl, node, dataUrl);
        }
      }
    } catch (e) {
      // surface why an image didn't render instead of silently showing only JSON
      doc.begin();
      doc.set({
        id: nid(),
        type: 'sticky',
        x: node.x,
        y: node.y + (node.h ?? 160) + 16,
        w: 260,
        h: 80,
        rotation: 0,
        z: doc.nextZ(),
        color: '#FFD9A8',
        text: '⚠ image: ' + (e instanceof Error ? e.message : String(e)),
        fontSize: 13,
      });
      doc.commit();
    }
  } catch (err) {
    doc.begin();
    for (const id of outIds) setText(ctl, id, '⚠ ' + (err instanceof Error ? err.message : String(err)));
    doc.commit();
  }
}

/** Render an /api/fetch payload as readable text: a status header + pretty JSON or raw text. */
function formatFetchResult(d: AnyObj): string {
  const head = `// HTTP ${d.status ?? '?'}${d.contentType ? ` · ${String(d.contentType).split(';')[0]}` : ''}`;
  let body = 'json' in d && d.json !== undefined ? JSON.stringify(d.json, null, 2) : String(d.text ?? '');
  if (body.length > 8000) body = body.slice(0, 8000) + `\n… (truncated, ${body.length} chars)`;
  else if (d.truncated) body += '\n… (response truncated by server)';
  return `${head}\n${body}`.trim();
}

const IMG_URL_RE = /https?:\/\/[^\s"'<>)]+\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:\?[^\s"'<>)]*)?/i;

/** Find the first image URL in a fetch result (deep-scans JSON, or matches raw text). */
function findImageUrl(d: AnyObj): string | null {
  if (typeof d.text === 'string') {
    const m = d.text.match(IMG_URL_RE);
    return m ? m[0] : null;
  }
  if (d.json !== undefined) {
    let found: string | null = null;
    const walk = (v: unknown) => {
      if (found) return;
      if (typeof v === 'string') {
        const m = v.match(IMG_URL_RE);
        if (m) found = m[0];
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(d.json);
    return found;
  }
  return null;
}

/** Fetch an image URL through the proxy and return it as a data URL (avoids CORS). */
async function fetchImageDataUrl(url: string): Promise<string | null> {
  const res = await fetch('/api/fetch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const d = await res.json();
  if (res.ok && d.image && d.base64) return `data:${d.contentType || 'image/png'};base64,${d.base64}`;
  return null;
}

/** Render a data URL into the data node's wired image output (reuses or spawns one). */
async function renderDataImage(ctl: AnyObj, node: AnyObj, dataUrl: string) {
  const doc = ctl.doc;
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const blobId = await putBlob(blob);
  const scale = Math.min(1, 360 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  let outId: string | null =
    doc
      .all()
      .filter((c: AnyObj) => c.type === 'connector' && c.from?.objectId === node.id && c.to?.objectId)
      .map((c: AnyObj) => c.to.objectId)
      .find((id: string) => doc.get(id)?.type === 'image') ?? null;

  doc.begin();
  if (outId) {
    doc.update(outId, { blobId, w, h });
  } else {
    const out: AnyObj = {
      id: nid(),
      type: 'image',
      x: node.x + (node.w ?? 200) + 80,
      y: node.y + (node.h ?? 160) + 24,
      w,
      h,
      rotation: 0,
      z: doc.nextZ(),
      blobId,
      opacity: 1,
      radius: 6,
    };
    wireOutput(ctl, node, out);
    outId = out.id;
  }
  doc.commit();
}

// ---------- condition: yes/no branch — routes the flow down a labeled arrow ----------

async function executeCondition(ctl: AnyObj, node: AnyObj) {
  const doc = ctl.doc;
  const question = promptSource(node).replace(RUN, '').trim();
  const context = gatherInputs(ctl, node)
    .map((o: AnyObj) => o.text)
    .filter(Boolean)
    .join('\n---\n')
    .trim();

  let verdict: 'yes' | 'no' = 'no';
  let detail = '';
  if (!question) {
    detail = 'no question';
  } else {
    try {
      const ans = await chat(
        [
          { role: 'system', content: 'You decide a yes/no question from the given context. Reply with exactly one word: YES or NO.' },
          {
            role: 'user',
            content: `Question: ${question}` + (context ? `\n\nContext:\n${context}` : '\n\n(No context provided — answer from the question alone.)'),
          },
        ],
        { temperature: 0, maxTokens: 5 } // structural: a one-word yes/no — not a budget the user should tune
      );
      const a = ans.trim().toLowerCase();
      verdict = a.startsWith('yes') || (/\byes\b/.test(a) && !/\bno\b/.test(a)) ? 'yes' : 'no';
      detail = ans.trim();
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }
  }

  doc.begin();
  doc.update(node.id, { conditionResult: verdict });
  // feedback for standalone runs: if a plain (unlabeled) text output is wired, show the verdict there
  const plainOut = doc
    .all()
    .filter((c: AnyObj) => c.type === 'connector' && c.from?.objectId === node.id && c.to?.objectId && branchOf(c.label) === null)
    .map((c: AnyObj) => doc.get(c.to.objectId))
    .find((o: AnyObj) => o && (o.type === 'sticky' || o.type === 'text') && !isAINode(o));
  if (plainOut) {
    const tag = verdict === 'yes' ? '✓ YES' : '✗ NO';
    setText(ctl, plainOut.id, detail && detail.length < 40 && detail.toLowerCase() !== verdict ? `${tag} — ${detail}` : tag);
  }
  doc.commit();
}

// ---------- research: deep multi-step agent (LangGraph on /api/research) ----------

async function executeResearch(ctl: AnyObj, node: AnyObj) {
  const doc = ctl.doc;
  const typed = promptSource(node).replace(RUN, '').trim();
  const query = [typed, ...gatherInputs(ctl, node).map((o: AnyObj) => o.text)].filter(Boolean).join(' ').trim();

  doc.begin();
  const outIds = prepTextOutputs(ctl, node, { color: '#A8D8EA', w: 320 });
  if (!query) {
    for (const id of outIds) setText(ctl, id, '⚠ No question — type one after "research:" or wire one in.');
    doc.commit();
    return;
  }
  for (const id of outIds) setText(ctl, id, '⏳ researching… (planning · searching · synthesizing)');
  doc.commit();

  const { getOpenRouterKey, getOpenRouterModel } = await import('../ai/llm');
  const apiKey = getOpenRouterKey();
  if (!apiKey) {
    doc.begin();
    for (const id of outIds) setText(ctl, id, '⚠ Research needs an OpenRouter key — add one in ⚙ Settings.');
    doc.commit();
    return;
  }

  try {
    const res = await fetch('/api/research', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, apiKey, model: getOpenRouterModel() }),
    });
    // Don't assume JSON: a platform-level 500 (timeout, crashed function) returns
    // a plaintext error page, which would otherwise blow up as "Unexpected token".
    const raw = await res.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`research failed (${res.status}): ${raw.slice(0, 200) || 'no response body'}`);
    }
    if (!res.ok) throw new Error(data?.error || `research failed (${res.status})`);
    doc.begin();
    for (const id of outIds) setText(ctl, id, String(data?.report || '(no report)').trim());
    doc.commit();
  } catch (err) {
    doc.begin();
    for (const id of outIds) setText(ctl, id, '⚠ ' + (err instanceof Error ? err.message : String(err)));
    doc.commit();
  }
}

// ---------- extract: structured data → table ----------

async function executeExtract(ctl: AnyObj, node: AnyObj) {
  const doc = ctl.doc;
  const instruction = promptSource(node).replace(RUN, '').trim() || 'Extract the key structured fields.';
  const corpus = gatherInputs(ctl, node).map((o: AnyObj) => o.text).join('\n---\n');

  doc.begin();
  const outIds = prepTextOutputs(ctl, node, { mono: true, w: 460 });
  if (!corpus.trim()) {
    for (const id of outIds) setText(ctl, id, '⚠ Nothing to extract — wire in some content.');
    doc.commit();
    return;
  }
  for (const id of outIds) setText(ctl, id, '⏳ extracting…');
  doc.commit();

  try {
    const result = await chat(
      [
        {
          role: 'system',
          content:
            'Extract the requested structured data from the content. Reply with ONLY a GitHub-flavored markdown table (header row, separator row, then data rows). No prose, no code fences. Keep cell text short.',
        },
        { role: 'user', content: `CONTENT:\n${corpus.slice(0, 12000)}\n\nEXTRACT: ${instruction}` },
      ],
      { temperature: 0.2 }
    );
    doc.begin();
    for (const id of outIds) setText(ctl, id, result.replace(/```/g, '').trim() || '(nothing extracted)');
    doc.commit();
  } catch (err) {
    doc.begin();
    for (const id of outIds) setText(ctl, id, '⚠ ' + (err instanceof Error ? err.message : String(err)));
    doc.commit();
  }
}

// ---------- business: tool-using analytics agent ----------

const BUSINESS_SYSTEM = `You are a meticulous business data analyst working over a single table.

You have deterministic tools that compute EXACT statistics. Rules:
- NEVER do arithmetic in your head. To get any number — an average, total, count, rate, percentile, correlation — you MUST call a tool. Do not estimate or eyeball values.
- For rates and shares (e.g. % active, cancellation rate), use value_counts: it returns each value's count AND percentage, so you never divide yourself.
- Use exact column names from the table summary. If a tool reports the column doesn't exist, re-read the summary and retry with the right name.
- ANSWER THE QUESTION ACTUALLY ASKED, using its standard business meaning — do not silently substitute an easier metric. In particular "churn" means CUSTOMER churn: the share of customers who stopped coming back. When the table has a customer-id column (name/email/phone/client) and a date column, you MUST use the customer_recency tool to compute it — that is true customer churn. Only fall back to a booking-level cancellation/no-show rate if there is genuinely no customer id or no date column, and if you do, say plainly that it is booking churn, not customer churn. When the data makes the real metric computable, attempt it rather than excusing it away.
- When asked to LIST or RANK individual customers ("top N customers", "which customers churned", "biggest spenders"), use the list_customers tool — it returns the actual per-customer rows. customer_recency only gives the churn RATE/counts, not the list. For "top N churned customers by value" call list_customers with status="lapsed", a value_column, and sort_by="value".
- Call tools as many times as needed, then write a clear, concise briefing that answers the question. State each number you cite and, briefly, how it was derived. Use short markdown headings/bullets. No code fences.`;

async function executeBusiness(ctl: AnyObj, node: AnyObj) {
  const doc = ctl.doc;
  const instruction = promptSource(node).replace(RUN, '').trim() || 'Summarize the key metrics in this data.';
  const inputs = gatherInputs(ctl, node);

  doc.begin();
  const outIds = prepTextOutputs(ctl, node, { w: 460 });
  const fail = (msg: string) => {
    doc.begin();
    for (const id of outIds) setText(ctl, id, msg);
    doc.commit();
  };

  if (!hasOpenRouter()) {
    fail('⚠ business: needs an OpenRouter API key (set one in ⚙ Settings).');
    return;
  }
  // Read the FULL file for each input. Large CSVs keep their complete contents in
  // the blob store (the in-doc text is only a capped preview), so analytics runs
  // over every row instead of silently understating counts/sums/revenue.
  const texts: string[] = [];
  let incomplete = false; // a capped file whose full data we could NOT recover
  for (const o of inputs as AnyObj[]) {
    const f = o.file;
    if (f?.kind === 'csv' && f.blobId) {
      try {
        const blob = await getBlob(f.blobId);
        if (blob) {
          texts.push(await blob.text());
          continue;
        }
      } catch {
        /* fall through to the preview below */
      }
      incomplete = true; // blob missing/unreadable — preview is all we have
    } else if (f?.truncated) {
      incomplete = true; // truncated and no blob (e.g. a non-CSV) — genuinely partial
    }
    texts.push(String(o.text ?? ''));
  }

  const table = pickTable(texts);
  if (!table) {
    fail('⚠ No table found — wire in an upload: node (CSV) or pasted CSV/TSV with a header row.');
    doc.commit();
    return;
  }
  // Only caveat when data is genuinely missing. With full data (the normal case)
  // the agent reports exact numbers, not hedged understatements.
  const truncNote = incomplete
    ? `\n\nDATA NOTICE: the full file could not be loaded, so the table below holds only the first ${table.rows.length.toLocaleString()} rows. Absolute counts, sums and revenue totals are UNDERSTATED — state this caveat and prefer rates/percentages over raw totals.`
    : '';
  for (const id of outIds) setText(ctl, id, '⏳ analyzing…');
  doc.commit();

  try {
    const { defs, run } = makeBusinessTools(table);
    const result = await chatWithTools(
      [
        { role: 'system', content: BUSINESS_SYSTEM },
        { role: 'user', content: `Table summary:\n${tableSummary(table)}${truncNote}\n\nTask: ${instruction}` },
      ],
      defs,
      run,
      { temperature: 0.1 }
    );
    const { text, trace } = result;
    const report = text.trim() || `⚠ No answer — ${explainEmptyToolResult(result)}`;
    const footer = trace.length ? `\n\n— computed with ${trace.length} tool call${trace.length === 1 ? '' : 's'} —` : '';
    doc.begin();
    for (const id of outIds) setText(ctl, id, report + footer);
    doc.commit();
  } catch (err) {
    fail('⚠ ' + (err instanceof Error ? err.message : String(err)));
  }
}

// ---------- fix: prompt improver ----------

async function executeFix(ctl: AnyObj, node: AnyObj) {
  const doc = ctl.doc;
  const typed = promptSource(node).replace(RUN, '').trim();
  const source = [typed, ...gatherInputs(ctl, node).map((o: AnyObj) => o.text)].filter(Boolean).join('\n').trim();

  doc.begin();
  const outIds = prepTextOutputs(ctl, node, { color: '#E2C2FF' });
  if (!source) {
    for (const id of outIds) setText(ctl, id, '⚠ No prompt to improve — type one or wire one in.');
    doc.commit();
    return;
  }
  for (const id of outIds) setText(ctl, id, '⏳ improving…');
  doc.commit();

  try {
    const result = await chat(
      [
        {
          role: 'system',
          content: getBasePrompt('fix'),
        },
        { role: 'user', content: source },
      ],
      { temperature: 0.5 }
    );
    doc.begin();
    for (const id of outIds) setText(ctl, id, result.trim() || '(no output)');
    doc.commit();
  } catch (err) {
    doc.begin();
    for (const id of outIds) setText(ctl, id, '⚠ ' + (err instanceof Error ? err.message : String(err)));
    doc.commit();
  }
}

// ---------- chart: data → rendered chart image ----------

interface ChartSpec {
  type: 'bar' | 'line' | 'pie';
  title?: string;
  labels: string[];
  values: number[];
}

const CHART_COLORS = ['#3c78ff', '#e64980', '#2f9e44', '#f08c00', '#6741d9', '#15aabf', '#e03131', '#ffd43b'];

async function drawChart(spec: ChartSpec): Promise<Blob> {
  const W = 720;
  const H = 460;
  const dpr = 2;
  const c = document.createElement('canvas');
  c.width = W * dpr;
  c.height = H * dpr;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '600 20px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  if (spec.title) ctx.fillText(spec.title, 32, 36);

  const padL = 56;
  const padR = 24;
  const padT = spec.title ? 58 : 32;
  const padB = 56;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const vals = spec.values;
  const labels = spec.labels;
  const max = Math.max(1, ...vals);

  ctx.font = '12px -apple-system, sans-serif';
  ctx.fillStyle = '#868e96';
  ctx.strokeStyle = '#e9ecef';

  if (spec.type === 'pie') {
    const cx = W / 2;
    const cy = padT + plotH / 2;
    const r = Math.min(plotW, plotH) / 2 - 10;
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();
      ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
      ctx.fill();
      const mid = (a0 + a1) / 2;
      ctx.fillStyle = '#1a1a1a';
      ctx.textAlign = 'center';
      ctx.fillText(`${labels[i] ?? ''}`, cx + Math.cos(mid) * (r + 24), cy + Math.sin(mid) * (r + 24));
      a0 = a1;
    });
    return canvasToBlob(c);
  }

  // axes
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();
  // y gridlines/labels
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - (plotH * i) / 4;
    ctx.strokeStyle = '#f1f3f5';
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillStyle = '#adb5bd';
    ctx.fillText(String(Math.round((max * i) / 4)), padL - 8, y + 4);
  }

  const n = vals.length || 1;
  const slot = plotW / n;
  ctx.textAlign = 'center';
  if (spec.type === 'bar') {
    const bw = Math.min(slot * 0.6, 64);
    vals.forEach((v, i) => {
      const x = padL + slot * i + slot / 2;
      const h = (v / max) * plotH;
      ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
      ctx.fillRect(x - bw / 2, padT + plotH - h, bw, h);
      ctx.fillStyle = '#868e96';
      ctx.fillText(labels[i] ?? '', x, padT + plotH + 18);
    });
  } else {
    ctx.strokeStyle = CHART_COLORS[0];
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = padL + slot * i + slot / 2;
      const y = padT + plotH - (v / max) * plotH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    vals.forEach((v, i) => {
      const x = padL + slot * i + slot / 2;
      const y = padT + plotH - (v / max) * plotH;
      ctx.fillStyle = CHART_COLORS[0];
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#868e96';
      ctx.fillText(labels[i] ?? '', x, padT + plotH + 18);
    });
  }
  return canvasToBlob(c);
}

function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('chart render failed'))), 'image/png'));
}

async function executeChart(ctl: AnyObj, node: AnyObj) {
  const doc = ctl.doc;
  const instruction = promptSource(node).replace(RUN, '').trim() || 'Chart this data.';
  const corpus = [instruction, ...gatherInputs(ctl, node).map((o: AnyObj) => o.text)].join('\n');

  // find a wired image output or spawn one
  let outId: string | null = doc
    .all()
    .filter((c: AnyObj) => c.type === 'connector' && c.from?.objectId === node.id && c.to?.objectId)
    .map((c: AnyObj) => c.to.objectId)
    .find((id: string) => doc.get(id)?.type === 'image') ?? null;

  doc.begin();
  if (!outId) {
    const out: AnyObj = {
      id: nid(),
      type: 'image',
      x: node.x + (node.w ?? 200) + 80,
      y: node.y,
      w: 360,
      h: 230,
      rotation: 0,
      z: doc.nextZ(),
      blobId: 'pending-' + nid(),
      opacity: 1,
      radius: 6,
    };
    wireOutput(ctl, node, out);
    outId = out.id;
  }
  doc.commit();

  try {
    const reply = await chat(
      [
        {
          role: 'system',
          content:
            'Turn the user\'s request and data into a chart spec. Reply with ONLY JSON: {"type":"bar"|"line"|"pie","title":"...","labels":["..."],"values":[n,...]}. labels and values must be equal length. Infer sensible numbers if the data is approximate.',
        },
        { role: 'user', content: corpus.slice(0, 8000) },
      ],
      { temperature: 0.2, json: true }
    );
    const cleaned = reply.replace(/```(?:json)?/gi, '').trim();
    const spec = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1)) as ChartSpec;
    if (!Array.isArray(spec.labels) || !Array.isArray(spec.values) || spec.values.length === 0) {
      throw new Error('Could not derive chart data from the input.');
    }
    spec.type = ['bar', 'line', 'pie'].includes(spec.type) ? spec.type : 'bar';
    spec.values = spec.values.map((v) => Number(v) || 0);
    const blob = await drawChart(spec);
    const bmp = await createImageBitmap(blob);
    const blobId = await putBlob(blob);
    const scale = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
    doc.begin();
    doc.update(outId, { blobId, w: bmp.width * scale, h: bmp.height * scale });
    doc.commit();
  } catch (err) {
    doc.begin();
    doc.set({
      id: nid(),
      type: 'sticky',
      x: node.x + (node.w ?? 200) + 80,
      y: node.y + (node.h ?? 160) + 24,
      w: 220,
      h: 110,
      rotation: 0,
      z: doc.nextZ(),
      color: '#FFB3BA',
      text: '⚠ ' + (err instanceof Error ? err.message : String(err)),
      fontSize: 14,
    });
    doc.commit();
  }
}

function inputObjects(ctl: AnyObj, node: AnyObj): AnyObj[] {
  return ctl.doc
    .all()
    .filter((c: AnyObj) => c.type === 'connector' && c.to?.objectId === node.id && c.from?.objectId && c.from.objectId !== node.id)
    .map((c: AnyObj) => ctl.doc.get(c.from.objectId))
    .filter(Boolean)
    .sort((a: AnyObj, b: AnyObj) => a.y - b.y || a.x - b.x);
}

/** Text an AI node has produced (its first non-node output object). */
function nodeOutputText(ctl: AnyObj, node: AnyObj): string {
  const outs = ctl.doc
    .all()
    .filter((c: AnyObj) => c.type === 'connector' && c.from?.objectId === node.id && c.to?.objectId)
    .map((c: AnyObj) => ctl.doc.get(c.to.objectId))
    .filter(Boolean);
  for (const o of outs) {
    if ((o.type === 'sticky' || o.type === 'text' || o.type === 'shape') && !isAINode(o) && typeof o.text === 'string' && o.text.trim()) {
      return o.text;
    }
  }
  return '';
}

const UPLOAD = /^(▶ ?)?(📎 ?)?upload:/i;

/** An "upload:" node carrying a file's extracted text (used to feed AI nodes). */
export function isUploadNode(o: AnyObj): boolean {
  return o?.type === 'sticky' && o.file && typeof o.file.text === 'string';
}

/** A node that IS or WANTS TO BE an upload node — has a file, or the user typed
 *  "upload:" into it. These get a 📎 file-picker button instead of ▶ run. */
export function isUploadIntent(o: AnyObj | undefined): boolean {
  return (
    !!o &&
    (o.type === 'sticky' || o.type === 'text') &&
    (isUploadNode(o) || (typeof o.text === 'string' && UPLOAD.test(o.text.split('\n')[0])))
  );
}

/** Attach a freshly-read file to an existing node: store the payload and swap the
 *  text to the human summary, in one undo step. */
export function applyUploadToNode(ctl: AnyObj, id: string, file: UploadFile) {
  if (!ctl.doc.get(id)) return;
  ctl.doc.begin();
  ctl.doc.update(id, { file });
  setText(ctl, id, uploadLabel(file));
  ctl.doc.commit();
}

function gatherInputs(ctl: AnyObj, node: AnyObj): AnyObj[] {
  return inputObjects(ctl, node)
    .map((o: AnyObj) => {
      // upload nodes feed their file's CONTENT, not the "📎 upload: …" label
      if (isUploadNode(o)) {
        const t = String(o.file.text ?? '').trim();
        return t ? { ...o, text: t } : null;
      }
      // when an AI node is wired straight into another node, feed its RESULT,
      // not its prompt — this is what makes node→node chains and loops work
      if (isAINode(o)) {
        const t = nodeOutputText(ctl, o);
        return t ? { ...o, text: t } : null;
      }
      return typeof o.text === 'string' && o.text.trim() ? o : null;
    })
    .filter(Boolean) as AnyObj[];
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** Data URLs of all image objects wired into the node. */
async function gatherImageInputs(ctl: AnyObj, node: AnyObj): Promise<string[]> {
  const out: string[] = [];
  for (const o of inputObjects(ctl, node)) {
    if (o.type !== 'image' || !o.blobId || String(o.blobId).startsWith('pending-')) continue;
    try {
      const blob = await getBlob(o.blobId);
      if (blob) out.push(await blobToDataUrl(blob));
    } catch {
      /* skip unreadable blobs */
    }
  }
  return out.slice(0, 6); // keep payloads sane
}

/** Render any FRAME wired into the node to a PNG data URL (a screenshot of its region).
 *  A frame counts as wired when an incoming connector either targets the frame OR
 *  starts from a free point that lands inside the frame's bounds (draw the arrow
 *  starting on your sketch inside the frame, ending at the node). */
async function gatherFrameSnapshots(ctl: AnyObj, node: AnyObj): Promise<string[]> {
  const frames: AnyObj[] = ctl.doc.all().filter((o: AnyObj) => o.type === 'frame');
  if (frames.length === 0) return [];
  const inFrame = (pt: { x: number; y: number }, f: AnyObj) =>
    pt && pt.x >= f.x && pt.x <= f.x + f.w && pt.y >= f.y && pt.y <= f.y + f.h;

  const incoming = ctl.doc
    .all()
    .filter((c: AnyObj) => c.type === 'connector' && c.to?.objectId === node.id);

  const picked = new Map<string, AnyObj>();
  for (const c of incoming) {
    if (c.from?.objectId) {
      const o = ctl.doc.get(c.from.objectId);
      if (o?.type === 'frame') picked.set(o.id, o);
    } else if (c.from?.point) {
      const f = frames.find((fr) => inFrame(c.from.point, fr));
      if (f) picked.set(f.id, f);
    }
  }

  const out: string[] = [];
  for (const f of picked.values()) {
    try {
      const box = { x: f.x, y: f.y, w: f.w, h: f.h };
      const scale = Math.min(2, 1400 / Math.max(box.w, box.h, 1));
      const blob = await exportPng(ctl.doc, box, scale, false);
      out.push(await blobToDataUrl(blob));
    } catch {
      /* skip a frame that fails to render */
    }
  }
  return out.slice(0, 4);
}

async function executeImage(ctl: AnyObj, node: AnyObj) {
  const doc = ctl.doc;
  const inputs = gatherInputs(ctl, node);
  const imageInputs = [...(await gatherImageInputs(ctl, node)), ...(await gatherFrameSnapshots(ctl, node))];
  // every wired image output gets its own generation; spawn one if none
  const outIds: string[] = doc
    .all()
    .filter((c: AnyObj) => c.type === 'connector' && c.from?.objectId === node.id && c.to?.objectId)
    .map((c: AnyObj) => c.to.objectId)
    .filter((id: string) => doc.get(id)?.type === 'image');
  let outId: string | null = outIds[0] ?? null;

  doc.begin();
  if (!outId) {
    const out: AnyObj = {
      id: nid(),
      type: 'image',
      x: node.x + (node.w ?? 200) + 80,
      y: node.y,
      w: 320,
      h: 320,
      rotation: 0,
      z: doc.nextZ(),
      blobId: 'pending-' + nid(), // renders as the gray placeholder until the image lands
      opacity: 1,
      radius: 8,
    };
    doc.set(out);
    doc.set({
      id: nid(),
      type: 'connector',
      x: node.x,
      y: node.y,
      rotation: 0,
      z: doc.nextZ(),
      from: { objectId: node.id },
      to: { objectId: out.id },
      routing: 'curved',
      stroke: '#868e96',
      strokeWidth: 2,
      dash: 'dashed',
      startArrow: 'none',
      endArrow: 'triangle',
      opacity: 1,
    });
    outId = out.id;
    outIds.push(out.id);
  }
  doc.commit();

  const instruction = promptSource(node).replace(RUN, '').trim();
  const prompt =
    (inputs.length > 0
      ? `${instruction}\n\nContext / subject:\n${inputs.map((o: AnyObj) => o.text).join('\n')}`
      : instruction) + brandImageAddon();
  const logo = await brandLogoDataUrl();
  const refImages = logo ? [...imageInputs, logo] : imageInputs;
  try {
    const many = outIds.length > 1;
    await Promise.all(
      outIds.map(async (id: string, i: number) => {
        const p = many ? `${prompt}\n\n(Variation ${i + 1} of ${outIds.length} — make it clearly distinct from the others.)` : prompt;
        const blob = await generateImage(p, { inputImages: refImages });
        const bmp = await createImageBitmap(blob);
        const blobId = await putBlob(blob);
        const scale = Math.min(1, 420 / Math.max(bmp.width, bmp.height));
        doc.begin();
        doc.update(id, { blobId, w: bmp.width * scale, h: bmp.height * scale });
        doc.commit();
      })
    );
  } catch (err) {
    doc.begin();
    doc.set({
      id: nid(),
      type: 'sticky',
      x: node.x + (node.w ?? 200) + 80,
      y: node.y + (node.h ?? 160) + 24,
      w: 220,
      h: 120,
      rotation: 0,
      z: doc.nextZ(),
      color: '#FFB3BA',
      text: '⚠ ' + (err instanceof Error ? err.message : String(err)),
      fontSize: 14,
    });
    doc.commit();
  }
}

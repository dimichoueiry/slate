// AI function nodes: a sticky/text whose text starts with "ai:" becomes a
// runnable node (auto-prefixed with a clickable RUN glyph). Inputs = objects
// wired INTO it with connectors; outputs = objects it points AT. Clicking the
// glyph gathers input texts, runs the instruction through the LLM, and writes
// the result into the output objects (creating one if none is wired).
import { chat, generateImage } from '../ai/llm';
import { useUI } from '../store/ui';
import { getBlob, putBlob } from '../store/db';
import { exportPng } from '../export/export';
import { lineHeight, textBlockSize } from '../engine/text';

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

// ai: text · img: image · web: scrape · search: query · research: deep agent · extract: table · chart: graph · fix: better prompt
const RUN = /^(▶ ?)?(ai|img|web|search|research|extract|chart|fix):/i;
const IMG = /^(▶ ?)?img:/i;
const WEB = /^(▶ ?)?web:/i;
const SEARCH = /^(▶ ?)?search:/i;
const RESEARCH = /^(▶ ?)?research:/i;
const EXTRACT = /^(▶ ?)?extract:/i;
const CHART = /^(▶ ?)?chart:/i;
const FIX = /^(▶ ?)?fix:/i;
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
  if (RESEARCH.test(head)) return executeResearch(ctl, node);
  if (EXTRACT.test(head)) return executeExtract(ctl, node);
  if (CHART.test(head)) return executeChart(ctl, node);
  if (FIX.test(head)) return executeFix(ctl, node);
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

/** Execute a specific flow's nodes in dependency order, awaiting each. */
export async function runFlow(
  ctl: AnyObj,
  nodes: AnyObj[],
  onProgress?: (done: number, total: number, node: AnyObj) => void
): Promise<{ ran: number }> {
  for (let i = 0; i < nodes.length; i++) {
    onProgress?.(i, nodes.length, nodes[i]);
    try {
      await runAINode(ctl, nodes[i]);
    } catch {
      // individual node failures already surface in their own output; keep going
    }
  }
  onProgress?.(nodes.length, nodes.length, nodes[nodes.length - 1]);
  return { ran: nodes.length };
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
          content:
            'You are a function node on a visual whiteboard. Use the INPUTS (text and/or attached images) to produce what the INSTRUCTION asks for. Reply with plain text only (or the exact JSON shape when versions are requested) — no markdown, no preamble. Keep it concise enough to read on a sticky note unless asked otherwise.' +
            brandTextAddon(),
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
      { temperature: wantVersions ? 0.9 : 0.5, maxTokens: 4000, json: wantVersions }
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
    'Summarize into a clear description of the business: what they do, who they serve, and their key offerings.';

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
          content:
            'You are a research node on a whiteboard. You receive scraped web page content and an instruction. Produce the requested output as plain text — no markdown fences, no preamble. Be concise and concrete; base everything only on the provided content.',
        },
        { role: 'user', content: `SCRAPED CONTENT:\n${corpus}\n\nINSTRUCTION: ${instruction}` },
      ],
      { temperature: 0.4, maxTokens: 2000 }
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
    const data = await res.json();
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
      { temperature: 0.2, maxTokens: 2000 }
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
          content:
            'You are a prompt engineer. Rewrite the user\'s prompt into a clearer, more specific, higher-quality prompt: add helpful structure, constraints, role, and desired output format where useful, but keep the original intent. Reply with ONLY the improved prompt — no commentary, no quotes.',
        },
        { role: 'user', content: source },
      ],
      { temperature: 0.5, maxTokens: 1500 }
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
      { temperature: 0.2, maxTokens: 1000, json: true }
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

function gatherInputs(ctl: AnyObj, node: AnyObj): AnyObj[] {
  return inputObjects(ctl, node).filter((o: AnyObj) => typeof o.text === 'string' && o.text.trim());
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

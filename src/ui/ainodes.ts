// AI function nodes: a sticky/text whose text starts with "ai:" becomes a
// runnable node (auto-prefixed with a clickable RUN glyph). Inputs = objects
// wired INTO it with connectors; outputs = objects it points AT. Clicking the
// glyph gathers input texts, runs the instruction through the LLM, and writes
// the result into the output objects (creating one if none is wired).
import { chat, generateImage } from '../ai/llm';
import { getBlob, putBlob } from '../store/db';
import { exportPng } from '../export/export';
import { lineHeight, textBlockSize } from '../engine/text';

type AnyObj = Record<string, any>;

const RUN = /^(▶ ?)?(ai|img|web):/i; // ai: text · img: image · web: scrape + summarize
const IMG = /^(▶ ?)?img:/i;
const WEB = /^(▶ ?)?web:/i;
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
  return execute(ctl, node);
}

/** First line marks an AI node? */
export function isAINode(o: AnyObj): boolean {
  return (
    (o?.type === 'sticky' || o?.type === 'text') &&
    typeof o.text === 'string' &&
    RUN.test(o.text.split('\n')[0])
  );
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
            'You are a function node on a visual whiteboard. Use the INPUTS (text and/or attached images) to produce what the INSTRUCTION asks for. Reply with plain text only (or the exact JSON shape when versions are requested) — no markdown, no preamble. Keep it concise enough to read on a sticky note unless asked otherwise.',
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
    inputs.length > 0
      ? `${instruction}\n\nContext / subject:\n${inputs.map((o: AnyObj) => o.text).join('\n')}`
      : instruction;
  try {
    const many = outIds.length > 1;
    await Promise.all(
      outIds.map(async (id: string, i: number) => {
        const p = many ? `${prompt}\n\n(Variation ${i + 1} of ${outIds.length} — make it clearly distinct from the others.)` : prompt;
        const blob = await generateImage(p, { inputImages: imageInputs });
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

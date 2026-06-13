// Interactive checkboxes: any line in a sticky or text object that starts with
// "☐ " or "☑ " toggles when its box glyph is clicked. State lives in the text
// itself, so it persists, exports, and undoes like everything else.
import { wrapText, lineHeight } from '../engine/text';

type AnyObj = Record<string, any>;

const GLYPH = /^[☐☑]/;
const last = { id: '', line: -1, t: 0 };

interface HitInfo {
  obj: AnyObj;
  srcIdx: number;
}

/** Map a wrapped-row index back to its source line; glyphs only live on a source line's first row. */
function sourceLineAt(text: string, fontSize: number, maxW: number, weight: number, fontFamily: string | undefined, row: number): { srcIdx: number; firstRow: boolean } | null {
  const srcLines = text.split('\n');
  let count = 0;
  for (let i = 0; i < srcLines.length; i++) {
    const rows = wrapText(srcLines[i], fontSize, maxW, weight, fontFamily);
    if (row < count + rows.length) return { srcIdx: i, firstRow: row === count };
    count += rows.length;
  }
  return null;
}

function checkboxAt(ctl: AnyObj, world: { x: number; y: number }): HitInfo | null {
  // topmost sticky/text under the pointer
  const candidates = ctl.doc
    .search({ x: world.x - 1, y: world.y - 1, w: 2, h: 2 })
    .filter((o: AnyObj) => (o.type === 'sticky' || o.type === 'text') && !o.locked && typeof o.text === 'string' && o.text.includes('☐') || (o.type === 'sticky' || o.type === 'text') && !o.locked && typeof o.text === 'string' && o.text.includes('☑'))
    .sort((a: AnyObj, b: AnyObj) => b.z - a.z);
  for (const o of candidates) {
    const pad = o.type === 'sticky' ? 12 : 0;
    const weight = o.type === 'sticky' ? 500 : 400;
    const maxW = o.type === 'sticky' ? o.w - 24 : o.fixedWidth ? o.w : Number.MAX_SAFE_INTEGER;
    const startX = o.x + pad;
    const startY = o.y + pad;
    const lh = lineHeight(o.fontSize);
    if (world.y < startY || world.x < startX) continue;
    const glyphW = o.fontSize * 1.4;
    if (world.x > startX + glyphW) continue;
    const row = Math.floor((world.y - startY) / lh);
    if (row < 0) continue;
    const info = sourceLineAt(o.text, o.fontSize, maxW, weight, o.fontFamily, row);
    if (!info || !info.firstRow) continue;
    const srcLine = o.text.split('\n')[info.srcIdx];
    if (!GLYPH.test(srcLine.trim())) continue;
    return { obj: o, srcIdx: info.srcIdx };
  }
  return null;
}

/** Toggle the checkbox under the pointer. Returns true if the event was consumed. */
export function tryToggleCheckbox(ctl: AnyObj, e: { clientX: number; clientY: number }): boolean {
  try {
    const ui = (window as any).__slateUI?.getState?.();
    const world = ctl.toWorld(e);
    const hit = checkboxAt(ctl, world);
    if (!hit) return false;
    void ui;
    const now = Date.now();
    if (last.id === hit.obj.id && last.line === hit.srcIdx && now - last.t < 350) {
      return true; // swallow double-click's second toggle so dblclick doesn't undo itself / open the editor
    }
    last.id = hit.obj.id;
    last.line = hit.srcIdx;
    last.t = now;
    const lines = hit.obj.text.split('\n');
    const line = lines[hit.srcIdx];
    const trimmedStart = line.match(/^\s*/)?.[0] ?? '';
    const body = line.slice(trimmedStart.length);
    lines[hit.srcIdx] = trimmedStart + (body.startsWith('☑') ? '☐' + body.slice(1) : '☑' + body.slice(1));
    ctl.doc.update(hit.obj.id, { text: lines.join('\n') });
    return true;
  } catch {
    return false;
  }
}

const BRACKET = /^(\s*)\[( |x|X)?\]\s?/;

/** Convert typed "[]", "[ ]", "[x]" line prefixes into checkbox glyphs. */
export function normalizeChecklistText(text: string): string | null {
  if (!/\[( |x|X)?\]/.test(text)) return null;
  let changed = false;
  const lines = text.split('\n').map((line) => {
    const m = line.match(BRACKET);
    if (!m) return line;
    changed = true;
    const box = m[2] === 'x' || m[2] === 'X' ? '\u2611' : '\u2610';
    return m[1] + box + ' ' + line.slice(m[0].length);
  });
  return changed ? lines.join('\n') : null;
}

/** Watch the document and normalize bracket-checkboxes as text gets committed. */
export function attachChecklistNormalizer(ctl: AnyObj) {
  ctl.doc.subscribe((changedIds: Set<string>) => {
    for (const id of changedIds) {
      const o = ctl.doc.get(id);
      if (!o || (o.type !== 'sticky' && o.type !== 'text' && o.type !== 'shape')) continue;
      if (typeof o.text !== 'string') continue;
      if (normalizeChecklistText(o.text) === null) continue;
      setTimeout(() => {
        try {
          const ui = (window as any).__slateUIState?.();
          if (ui?.editingTextId === id) return; // do not fight the open editor
          const fresh = ctl.doc.get(id);
          if (!fresh || typeof fresh.text !== 'string') return;
          const norm = normalizeChecklistText(fresh.text);
          if (norm !== null) ctl.doc.update(id, { text: norm });
        } catch {
          /* never break editing */
        }
      }, 0);
    }
  });
}

/** True when the pointer sits on a checkbox glyph (used to suppress the dblclick editor). */
export function isOnCheckbox(ctl: AnyObj, e: { clientX: number; clientY: number }): boolean {
  try {
    return checkboxAt(ctl, ctl.toWorld(e)) !== null;
  } catch {
    return false;
  }
}

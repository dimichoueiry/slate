// Deterministic layout passes for agent-created diagrams (PRD §7.4).
// Both take the non-connector specs (with sizes already resolved) plus the
// connector edges among them, and assign x/y in place.

export interface LayoutItem {
  key: string; // spec ref or synthetic index key
  w: number;
  h: number;
  x?: number;
  y?: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

const GUTTER_X = 60;
const GUTTER_Y = 120;

/**
 * Layered DAG layout, top-to-bottom: roots on the first row, each node one row
 * below its deepest parent. Cycles fall back to insertion order. Guarantees no
 * overlaps by construction (rows spaced by tallest node, columns by widths).
 */
export function layoutLayered(items: LayoutItem[], edges: LayoutEdge[], origin: { x: number; y: number }) {
  const byKey = new Map(items.map((it) => [it.key, it]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (!byKey.has(e.from) || !byKey.has(e.to) || e.from === e.to) continue;
    (children.get(e.from) ?? children.set(e.from, []).get(e.from)!).push(e.to);
    (parents.get(e.to) ?? parents.set(e.to, []).get(e.to)!).push(e.from);
  }

  // longest-path layer assignment with cycle guard
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (key: string): number => {
    if (layer.has(key)) return layer.get(key)!;
    if (visiting.has(key)) return 0; // cycle — treat as root
    visiting.add(key);
    const ps = parents.get(key) ?? [];
    const d = ps.length ? Math.max(...ps.map(depth)) + 1 : 0;
    visiting.delete(key);
    layer.set(key, d);
    return d;
  };
  for (const it of items) depth(it.key);

  // group by layer, preserve input order within a layer
  const rows = new Map<number, LayoutItem[]>();
  for (const it of items) {
    const d = layer.get(it.key) ?? 0;
    (rows.get(d) ?? rows.set(d, []).get(d)!).push(it);
  }

  const sorted = [...rows.entries()].sort((a, b) => a[0] - b[0]);
  const totalW = Math.max(
    ...sorted.map(([, row]) => row.reduce((s, it) => s + it.w, 0) + GUTTER_X * (row.length - 1)),
  );
  let y = origin.y;
  for (const [, row] of sorted) {
    const rowW = row.reduce((s, it) => s + it.w, 0) + GUTTER_X * (row.length - 1);
    let x = origin.x + (totalW - rowW) / 2;
    let maxH = 0;
    for (const it of row) {
      it.x = Math.round(x);
      it.y = Math.round(y);
      x += it.w + GUTTER_X;
      maxH = Math.max(maxH, it.h);
    }
    y += maxH + GUTTER_Y;
  }
}

/** Simple row-major grid, near-square aspect. */
export function layoutGrid(items: LayoutItem[], origin: { x: number; y: number }) {
  if (!items.length) return;
  const cols = Math.ceil(Math.sqrt(items.length));
  const cellW = Math.max(...items.map((i) => i.w)) + GUTTER_X;
  const cellH = Math.max(...items.map((i) => i.h)) + GUTTER_X;
  items.forEach((it, i) => {
    it.x = Math.round(origin.x + (i % cols) * cellW);
    it.y = Math.round(origin.y + Math.floor(i / cols) * cellH);
  });
}

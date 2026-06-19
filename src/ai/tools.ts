// Deterministic business-analytics tools for the `business:` agent. The LLM
// orchestrates (decides WHAT to compute) but never does arithmetic itself — it
// calls these, which compute exact numbers in JS over a parsed table. Each tool
// has an OpenAI-style JSON-schema definition plus a pure implementation.
import type { ToolDef } from './llm';

export interface Table {
  columns: string[];
  rows: string[][]; // raw string cells, aligned to columns
}

// ---------- CSV / TSV parsing ----------

function parseDelimited(text: string, delim: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += c;
      continue;
    }
    if (c === '"') inQ = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\r') {
      /* skip */
    } else if (c === '\n') {
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/** Parse CSV/TSV text into a Table, or null if it doesn't look tabular. */
export function parseTable(text: string): Table | null {
  const head = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = (head.match(/\t/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? '\t' : ',';
  const grid = parseDelimited(text.trim(), delim);
  if (grid.length < 2) return null;
  const columns = grid[0].map((c) => c.trim());
  if (columns.length < 2) return null;
  const rows = grid.slice(1).map((r) => {
    const cells = r.slice(0, columns.length);
    while (cells.length < columns.length) cells.push('');
    return cells;
  });
  return { columns, rows };
}

/** From several text inputs, pick the richest parseable table (most cells). */
export function pickTable(texts: string[]): Table | null {
  let best: Table | null = null;
  let bestScore = 0;
  for (const t of texts) {
    const table = parseTable(t);
    if (!table) continue;
    const score = table.rows.length * table.columns.length;
    if (score > bestScore) {
      best = table;
      bestScore = score;
    }
  }
  return best;
}

// ---------- numeric helpers ----------

function toNum(s: string): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/[$,€£%\s]/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse a date cell to epoch ms, or null. Handles ISO (2024-03-15[ T…]) and
 *  common D/M/Y or M/D/Y slash/dot dates; falls back to Date.parse. */
function toDate(s: string): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (t === '') return null;
  // ISO-ish: YYYY-MM-DD (optionally followed by time) — unambiguous, parse first.
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const ms = Date.parse(t.length > 10 ? t : t + 'T00:00:00');
    return Number.isFinite(ms) ? ms : null;
  }
  // D/M/Y or M/D/Y (also . or -). Assume D/M/Y only when the first part can't be a month.
  const dmy = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (dmy) {
    let [, a, b, y] = dmy;
    let yr = Number(y);
    if (yr < 100) yr += yr < 70 ? 2000 : 1900;
    const first = Number(a);
    const second = Number(b);
    const day = first > 12 ? first : second; // pick the part that must be a day
    const month = first > 12 ? second : first;
    const ms = new Date(yr, month - 1, day).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

const DAY_MS = 86_400_000;

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const idx = (Math.max(0, Math.min(100, p)) / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
};

function colIndex(table: Table, name: string): number {
  const want = String(name ?? '').trim().toLowerCase();
  const i = table.columns.findIndex((c) => c.toLowerCase() === want);
  if (i < 0) throw new Error(`No column "${name}". Available: ${table.columns.join(', ')}`);
  return i;
}

function cells(table: Table, name: string): string[] {
  const i = colIndex(table, name);
  return table.rows.map((r) => r[i]).filter((v) => v != null && v.trim() !== '');
}

function numericCells(table: Table, name: string): number[] {
  return cells(table, name)
    .map(toNum)
    .filter((n): n is number => n != null);
}

/** Inferred column type + a couple of sample values, for the table summary. */
function describeColumn(table: Table, name: string) {
  const raw = cells(table, name);
  const nums = raw.map(toNum).filter((n): n is number => n != null);
  const numeric = raw.length > 0 && nums.length / raw.length >= 0.6;
  return {
    name,
    type: numeric ? 'numeric' : 'categorical',
    missing: table.rows.length - raw.length,
    sample: raw.slice(0, 3),
  };
}

/** A compact text summary the agent sees up front (row count, columns, types). */
export function tableSummary(table: Table): string {
  const cols = table.columns.map((c) => {
    const d = describeColumn(table, c);
    return `- ${c} (${d.type}${d.missing ? `, ${d.missing} missing` : ''}) e.g. ${d.sample.join(' | ')}`;
  });
  return `${table.rows.length} rows, ${table.columns.length} columns:\n${cols.join('\n')}`;
}

// ---------- the tool registry ----------

type Args = Record<string, any>;
const NUM_OPS = new Set(['mean', 'median', 'sum', 'min', 'max', 'stdev']);

function compare(cell: string, op: string, value: any): boolean {
  if (op === 'gt' || op === 'lt' || op === 'gte' || op === 'lte') {
    const a = toNum(cell);
    const b = typeof value === 'number' ? value : toNum(String(value));
    if (a == null || b == null) return false;
    return op === 'gt' ? a > b : op === 'lt' ? a < b : op === 'gte' ? a >= b : a <= b;
  }
  const a = String(cell).trim().toLowerCase();
  const b = String(value).trim().toLowerCase();
  if (op === 'contains') return a.includes(b);
  if (op === 'ne') return a !== b;
  return a === b; // eq (default)
}

function aggregateNums(xs: number[], op: string): number {
  switch (op) {
    case 'mean':
      return mean(xs);
    case 'median':
      return median(xs);
    case 'sum':
      return xs.reduce((a, b) => a + b, 0);
    case 'min':
      return Math.min(...xs);
    case 'max':
      return Math.max(...xs);
    case 'stdev':
      return stdev(xs);
    default:
      throw new Error(`Unknown numeric op "${op}"`);
  }
}

/** Build the tool defs + an executor bound to one table. */
export function makeBusinessTools(table: Table): { defs: ToolDef[]; run: (name: string, args: Args) => any } {
  const impl: Record<string, (a: Args) => any> = {
    aggregate: ({ column, op }) => {
      if (op === 'count') return { result: cells(table, column).length };
      if (op === 'distinct_count') return { result: new Set(cells(table, column).map((c) => c.trim().toLowerCase())).size };
      const xs = numericCells(table, column);
      if (!xs.length) throw new Error(`Column "${column}" has no numeric values`);
      return { result: round(aggregateNums(xs, op)), n: xs.length };
    },
    percentile: ({ column, p }) => {
      const xs = numericCells(table, column);
      if (!xs.length) throw new Error(`Column "${column}" has no numeric values`);
      return { result: round(percentile(xs, Number(p))), n: xs.length };
    },
    value_counts: ({ column, top }) => {
      const vals = cells(table, column);
      const counts = new Map<string, number>();
      for (const v of vals) counts.set(v.trim(), (counts.get(v.trim()) ?? 0) + 1);
      const total = vals.length;
      return {
        total,
        values: [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, Number(top) || 20)
          .map(([value, count]) => ({ value, count, pct: round((count / total) * 100) })),
      };
    },
    group_aggregate: ({ group_by, value_column, op }) => {
      const gi = colIndex(table, group_by);
      const groups = new Map<string, number[]>();
      const vi = op === 'count' ? -1 : colIndex(table, value_column);
      for (const r of table.rows) {
        const g = (r[gi] ?? '').trim();
        if (g === '') continue;
        const arr = groups.get(g) ?? [];
        if (vi >= 0) {
          const n = toNum(r[vi]);
          if (n != null) arr.push(n);
        } else arr.push(1);
        groups.set(g, arr);
      }
      const rows = [...groups.entries()].map(([group, xs]) => ({
        group,
        value: op === 'count' ? xs.length : round(aggregateNums(xs, op)),
      }));
      rows.sort((a, b) => b.value - a.value);
      return { groups: rows.slice(0, 50) };
    },
    filter_aggregate: ({ filters, value_column, op }) => {
      const fs: Array<{ column: string; op: string; value: any }> = Array.isArray(filters) ? filters : [];
      const idxs = fs.map((f) => ({ i: colIndex(table, f.column), op: f.op || 'eq', value: f.value }));
      const matched = table.rows.filter((r) => idxs.every((f) => compare(r[f.i] ?? '', f.op, f.value)));
      if (!value_column || !op || op === 'count') return { matched: matched.length, total: table.rows.length };
      const vi = colIndex(table, value_column);
      const xs = matched.map((r) => toNum(r[vi])).filter((n): n is number => n != null);
      if (!xs.length) throw new Error(`No numeric "${value_column}" values among matched rows`);
      return { matched: matched.length, result: round(aggregateNums(xs, op)), n: xs.length };
    },
    customer_recency: ({ customer_column, date_column, window_days }) => {
      const ci = colIndex(table, customer_column);
      const di = colIndex(table, date_column);
      // Most recent valid date per customer.
      const last = new Map<string, number>();
      let parsed = 0;
      let datedRows = 0;
      for (const r of table.rows) {
        const cust = (r[ci] ?? '').trim();
        if (cust === '') continue;
        const ms = toDate(r[di] ?? '');
        if (ms == null) continue;
        datedRows++;
        const key = cust.toLowerCase();
        if (!last.has(key) || ms > (last.get(key) as number)) last.set(key, ms);
      }
      parsed = last.size;
      if (parsed === 0) throw new Error(`Could not parse any dates in "${date_column}" or no customers in "${customer_column}"`);
      const dates = [...last.values()];
      const refDate = Math.max(...dates); // newest date in the file = "today"
      const win = Number(window_days) > 0 ? Number(window_days) : 180;
      let lapsed = 0;
      for (const ms of dates) if ((refDate - ms) / DAY_MS > win) lapsed++;
      const active = parsed - lapsed;
      const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      return {
        distinct_customers: parsed,
        window_days: win,
        reference_date: iso(refDate),
        earliest_last_visit: iso(Math.min(...dates)),
        lapsed_customers: lapsed,
        active_customers: active,
        churn_rate_pct: round((lapsed / parsed) * 100),
        active_rate_pct: round((active / parsed) * 100),
        dated_rows_used: datedRows,
      };
    },
    correlation: ({ column_a, column_b }) => {
      const ia = colIndex(table, column_a);
      const ib = colIndex(table, column_b);
      const pairs = table.rows
        .map((r) => [toNum(r[ia]), toNum(r[ib])])
        .filter((p): p is [number, number] => p[0] != null && p[1] != null);
      if (pairs.length < 2) throw new Error('Not enough numeric pairs to correlate');
      const xs = pairs.map((p) => p[0]);
      const ys = pairs.map((p) => p[1]);
      const mx = mean(xs);
      const my = mean(ys);
      let num = 0;
      let dx = 0;
      let dy = 0;
      for (let i = 0; i < pairs.length; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        dx += (xs[i] - mx) ** 2;
        dy += (ys[i] - my) ** 2;
      }
      const r = dx && dy ? num / Math.sqrt(dx * dy) : 0;
      return { r: round(r), n: pairs.length };
    },
    list_customers: ({ customer_column, date_column, value_column, window_days, status, sort_by, top }) => {
      const ci = colIndex(table, customer_column);
      const di = date_column ? colIndex(table, date_column) : -1;
      const vi = value_column ? colIndex(table, value_column) : -1;
      // Roll the table up to one record per customer.
      const agg = new Map<string, { name: string; last: number | null; value: number; rows: number }>();
      for (const r of table.rows) {
        const raw = (r[ci] ?? '').trim();
        if (raw === '') continue;
        const key = raw.toLowerCase();
        const cur = agg.get(key) ?? { name: raw, last: null, value: 0, rows: 0 };
        cur.rows++;
        if (di >= 0) {
          const ms = toDate(r[di] ?? '');
          if (ms != null && (cur.last == null || ms > cur.last)) cur.last = ms;
        }
        if (vi >= 0) {
          const v = toNum(r[vi]);
          if (v != null) cur.value += v;
        }
        agg.set(key, cur);
      }
      if (agg.size === 0) throw new Error(`No customers found in "${customer_column}"`);

      const wantStatus = (status as string) || 'all';
      if (wantStatus !== 'all' && di < 0)
        throw new Error(`status="${wantStatus}" needs date_column to tell lapsed from active customers`);

      // "today" = newest date across the file (matches customer_recency).
      let refDate = -Infinity;
      if (di >= 0) for (const c of agg.values()) if (c.last != null && c.last > refDate) refDate = c.last;
      const win = Number(window_days) > 0 ? Number(window_days) : 180;
      const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString().slice(0, 10));

      let rows = [...agg.values()].map((c) => {
        const daysSince = c.last != null && refDate > -Infinity ? Math.round((refDate - c.last) / DAY_MS) : null;
        const lapsed = daysSince != null ? daysSince > win : null;
        const rec: Record<string, any> = { customer: c.name, bookings: c.rows };
        if (di >= 0) {
          rec.last_visit = iso(c.last);
          rec.days_since_last = daysSince;
          rec.lapsed = lapsed;
        }
        if (vi >= 0) rec.value = round(c.value);
        return rec;
      });

      if (wantStatus === 'lapsed') rows = rows.filter((r) => r.lapsed === true);
      else if (wantStatus === 'active') rows = rows.filter((r) => r.lapsed === false);

      const by = (sort_by as string) || (vi >= 0 ? 'value' : 'recency');
      rows.sort((a, b) => {
        if (by === 'value') return (b.value ?? 0) - (a.value ?? 0);
        if (by === 'bookings') return (b.bookings ?? 0) - (a.bookings ?? 0);
        // 'recency' / default: longest since last visit first
        return (b.days_since_last ?? -1) - (a.days_since_last ?? -1);
      });

      const n = Math.min(Number(top) > 0 ? Number(top) : 20, 200);
      return {
        total_customers: agg.size,
        matched: rows.length,
        ...(di >= 0 ? { reference_date: iso(refDate === -Infinity ? null : refDate), window_days: win } : {}),
        sorted_by: by,
        customers: rows.slice(0, n),
      };
    },
  };

  const run = (name: string, args: Args) => {
    const fn = impl[name];
    if (!fn) throw new Error(`Unknown tool "${name}"`);
    return fn(args || {});
  };

  return { defs: TOOL_DEFS, run };
}

// ---------- schemas (static; the table is bound at runtime) ----------

const fn = (name: string, description: string, properties: Args, required: string[]): ToolDef => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const colProp = (desc = 'Exact column name from the table summary') => ({ type: 'string', description: desc });

const TOOL_DEFS: ToolDef[] = [
  fn(
    'aggregate',
    'Compute a single statistic over one column. Use for average price, total revenue, etc.',
    {
      column: colProp(),
      op: { type: 'string', enum: ['mean', 'median', 'sum', 'min', 'max', 'stdev', 'count', 'distinct_count'] },
    },
    ['column', 'op']
  ),
  fn(
    'percentile',
    'The p-th percentile of a numeric column (p from 0 to 100). p=50 is the median.',
    { column: colProp(), p: { type: 'number', description: '0–100' } },
    ['column', 'p']
  ),
  fn(
    'value_counts',
    'Count each distinct value in a column, with percentages of the total. Use this for churn rate, status breakdowns, category shares — the percentages avoid you doing division.',
    { column: colProp(), top: { type: 'number', description: 'max distinct values to return (default 20)' } },
    ['column']
  ),
  fn(
    'group_aggregate',
    'Group rows by one column and aggregate a value column per group (e.g. revenue by region). Use op="count" to count rows per group (then value_column is ignored).',
    {
      group_by: colProp(),
      value_column: colProp('Numeric column to aggregate (omit only when op=count)'),
      op: { type: 'string', enum: ['mean', 'median', 'sum', 'min', 'max', 'stdev', 'count'] },
    },
    ['group_by', 'op']
  ),
  fn(
    'filter_aggregate',
    'Count rows matching filters, or aggregate a value column over matched rows. Filters combine with AND. Use for "how many customers spent > 500", segment averages, etc.',
    {
      filters: {
        type: 'array',
        description: 'each filter compares a column to a value',
        items: {
          type: 'object',
          properties: {
            column: colProp(),
            op: { type: 'string', enum: ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains'] },
            value: { description: 'string or number to compare against' },
          },
          required: ['column', 'op', 'value'],
        },
      },
      value_column: colProp('optional numeric column to aggregate over matched rows'),
      op: { type: 'string', enum: ['count', 'mean', 'median', 'sum', 'min', 'max', 'stdev'] },
    },
    ['filters']
  ),
  fn(
    'customer_recency',
    'Customer churn / retention from a customer-id column + a visit/booking date column. Takes each customer\'s most recent date, treats the newest date in the file as "today", and counts customers whose last visit is older than window_days (lapsed/churned) vs. within it (active). Returns distinct_customers, lapsed/active counts and churn_rate_pct. THIS is true customer churn — use it instead of a status cancellation rate when asked about churn or retention.',
    {
      customer_column: colProp('Column identifying the customer (name, email, phone, client id)'),
      date_column: colProp('Column with the visit/booking/appointment date'),
      window_days: { type: 'number', description: 'days of inactivity after which a customer counts as lapsed (default 180)' },
    },
    ['customer_column', 'date_column']
  ),
  fn(
    'correlation',
    'Pearson correlation coefficient (r, from -1 to 1) between two numeric columns.',
    { column_a: colProp(), column_b: colProp() },
    ['column_a', 'column_b']
  ),
  fn(
    'list_customers',
    'Return an actual ranked LIST of individual customers (one row per customer), not just counts. Rolls the table up per customer: most recent visit, days since, lapsed/active flag (vs window_days), and the summed value_column (e.g. lifetime spend). Use this for any "top N customers" / "which customers…" / "list the churned customers" question — e.g. top 20 churned customers by lifetime value = status="lapsed", value_column=<spend>, sort_by="value", top=20.',
    {
      customer_column: colProp('Column identifying the customer (name, email, phone, client id)'),
      date_column: colProp('Visit/booking date column — required to compute lapsed/active and recency'),
      value_column: colProp('Numeric column to sum per customer (e.g. price/amount → lifetime value)'),
      window_days: { type: 'number', description: 'days of inactivity after which a customer is lapsed (default 180)' },
      status: { type: 'string', enum: ['all', 'lapsed', 'active'], description: 'filter customers (default all; lapsed/active need date_column)' },
      sort_by: { type: 'string', enum: ['value', 'recency', 'bookings'], description: 'ranking: value=highest summed value, recency=longest since last visit, bookings=most visits' },
      top: { type: 'number', description: 'how many customers to return (default 20, max 200)' },
    },
    ['customer_column']
  ),
];

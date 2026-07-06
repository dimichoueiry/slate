// SVG safety check for agent-authored graphics (PRD v1.1 §5.2).
// Strategy: REJECT on suspicion rather than mutate — the agent just writes a
// cleaner SVG. The tab re-checks with the same rules before storing.

const MAX_SVG_BYTES = 512 * 1024;

// each entry: [regex, human reason]
const FORBIDDEN = [
  [/<\s*script\b/i, 'contains a <script> element'],
  [/<\s*foreignObject\b/i, 'contains a <foreignObject> element'],
  [/\bon[a-z]+\s*=/i, 'contains an event-handler attribute (on*=...)'],
  [/javascript\s*:/i, 'contains a javascript: URL'],
  [/(?:href|xlink:href)\s*=\s*["']\s*(?:https?:)?\/\//i, 'references an external URL via href (inline everything instead)'],
  [/url\s*\(\s*["']?\s*(?:https?:)?\/\//i, 'references an external URL via css url() (inline everything instead)'],
  [/<\s*(?:iframe|embed|object|link|meta|style)\b[^>]*\bsrc\s*=/i, 'embeds external content'],
  [/@import/i, 'contains a css @import'],
  [/data:\s*text\/html/i, 'contains a data:text/html URL'],
];

/**
 * Validate agent-authored SVG markup. Returns { ok: true } or
 * { ok: false, reason } with a message the agent can act on.
 */
export function checkSvg(svg) {
  if (typeof svg !== 'string' || !svg.trim()) return { ok: false, reason: 'svg must be a non-empty string' };
  if (Buffer.byteLength(svg, 'utf8') > MAX_SVG_BYTES) {
    return { ok: false, reason: `svg source exceeds ${MAX_SVG_BYTES / 1024} KB — simplify the graphic` };
  }
  const trimmed = svg.trim();
  if (!/^<svg\b/i.test(trimmed) || !/<\/svg\s*>$/i.test(trimmed)) {
    return { ok: false, reason: 'svg must be a single <svg>…</svg> document' };
  }
  for (const [re, reason] of FORBIDDEN) {
    if (re.test(svg)) return { ok: false, reason: `unsafe svg: ${reason}` };
  }
  return { ok: true };
}

/**
 * Natural size from the root element's viewBox / width / height.
 * Returns { w, h } or null when the SVG declares no usable dimensions.
 */
export function svgNaturalSize(svg) {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const vb = root.match(/viewBox\s*=\s*["']\s*([\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)\s*["']/i);
  if (vb) {
    const w = Number(vb[3]);
    const h = Number(vb[4]);
    if (w > 0 && h > 0) return { w, h };
  }
  const dim = (name) => {
    const m = root.match(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(?:px)?\\s*["']`, 'i'));
    const n = m ? Number(m[1]) : NaN;
    return n > 0 ? n : null;
  };
  const w = dim('width');
  const h = dim('height');
  return w && h ? { w, h } : null;
}

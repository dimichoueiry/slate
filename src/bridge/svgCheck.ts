// Tab-side SVG safety re-check — mirrors slate-mcp/src/svg.js (the bridge
// process runs the authoritative, tested copy; this guards the WS boundary).
// Reject on suspicion rather than mutate.

const MAX_SVG_BYTES = 512 * 1024;

const FORBIDDEN: Array<[RegExp, string]> = [
  [/<\s*script\b/i, 'contains a <script> element'],
  [/<\s*foreignObject\b/i, 'contains a <foreignObject> element'],
  [/\bon[a-z]+\s*=/i, 'contains an event-handler attribute (on*=...)'],
  [/javascript\s*:/i, 'contains a javascript: URL'],
  [/(?:href|xlink:href)\s*=\s*["']\s*(?:https?:)?\/\//i, 'references an external URL via href'],
  [/url\s*\(\s*["']?\s*(?:https?:)?\/\//i, 'references an external URL via css url()'],
  [/<\s*(?:iframe|embed|object|link|meta|style)\b[^>]*\bsrc\s*=/i, 'embeds external content'],
  [/@import/i, 'contains a css @import'],
  [/data:\s*text\/html/i, 'contains a data:text/html URL'],
];

export function checkSvg(svg: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof svg !== 'string' || !svg.trim()) return { ok: false, reason: 'svg must be a non-empty string' };
  if (new TextEncoder().encode(svg).length > MAX_SVG_BYTES) {
    return { ok: false, reason: `svg source exceeds ${MAX_SVG_BYTES / 1024} KB — simplify the graphic` };
  }
  const trimmed = svg.trim();
  if (!/^<svg\b/i.test(trimmed) || !/<\/svg\s*>$/i.test(trimmed)) {
    return { ok: false, reason: 'svg must be a single <svg>…</svg> document' };
  }
  for (const [re, reason] of FORBIDDEN) {
    if (re.test(svg)) return { ok: false, reason: `unsafe svg: ${reason}` };
  }
  // must parse as XML with an svg root
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.nodeName.toLowerCase() !== 'svg') {
    return { ok: false, reason: 'svg is not well-formed XML' };
  }
  return { ok: true };
}

/** Natural size from viewBox / width / height on the root, or null. */
export function svgNaturalSize(svg: string): { w: number; h: number } | null {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const vb = root.match(/viewBox\s*=\s*["']\s*([\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)\s*["']/i);
  if (vb) {
    const w = Number(vb[3]);
    const h = Number(vb[4]);
    if (w > 0 && h > 0) return { w, h };
  }
  const dim = (name: string) => {
    const m = root.match(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(?:px)?\\s*["']`, 'i'));
    const n = m ? Number(m[1]) : NaN;
    return n > 0 ? n : null;
  };
  const w = dim('width');
  const h = dim('height');
  return w && h ? { w, h } : null;
}

/**
 * Ensure the root has explicit width/height so every decode path sizes it,
 * and an xmlns — browsers refuse to decode namespace-less SVG as an image.
 */
export function withExplicitSize(svg: string, w: number, h: number): string {
  return svg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    let a = attrs.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '');
    if (!/\bxmlns\s*=/i.test(a)) a += ' xmlns="http://www.w3.org/2000/svg"';
    if (/\bxlink:href\s*=/i.test(svg) && !/\bxmlns:xlink\s*=/i.test(a)) {
      a += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
    }
    return `<svg${a} width="${w}" height="${h}">`;
  });
}

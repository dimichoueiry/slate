// Serverless HTTP-fetch proxy for the `data:` node. Lets the canvas pull JSON
// (or text) from any public REST endpoint without CORS headaches — the request
// runs server-side. Works on Vercel as POST /api/fetch and is mirrored by the
// Vite dev server so the same code path runs in `npm run dev`.

interface FetchResult {
  status: number;
  body: unknown;
}

// SSRF guard: never let the proxy reach loopback / link-local / private ranges.
const BLOCKED_HOST =
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|fe80:|fc00:|fd[0-9a-f]{2}:)/i;

const ALLOWED_METHODS = /^(GET|POST|PUT|PATCH|DELETE)$/;
const MAX_BYTES = 200_000;
const TIMEOUT_MS = 12_000;

/** Framework-agnostic core: proxy one HTTP request and return its (capped) body. */
export async function proxyFetch(input: {
  url?: unknown;
  method?: unknown;
  body?: unknown;
  headers?: unknown;
}): Promise<FetchResult> {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url) return { status: 400, body: { error: 'Provide a url.' } };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 400, body: { error: 'Invalid URL.' } };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { status: 400, body: { error: 'Only http(s) URLs are allowed.' } };
  }
  if (BLOCKED_HOST.test(parsed.hostname)) {
    return { status: 403, body: { error: 'Requests to local/private addresses are blocked.' } };
  }

  const method = (typeof input.method === 'string' ? input.method : 'GET').toUpperCase();
  if (!ALLOWED_METHODS.test(method)) {
    return { status: 400, body: { error: `Unsupported method "${method}".` } };
  }

  const headers: Record<string, string> = { accept: 'application/json, text/*;q=0.9, */*;q=0.5' };
  if (input.headers && typeof input.headers === 'object') {
    for (const [k, v] of Object.entries(input.headers as Record<string, unknown>)) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    }
  }
  const bodyStr = typeof input.body === 'string' ? input.body.trim() : '';
  if (method !== 'GET' && bodyStr && !headers['content-type']) headers['content-type'] = 'application/json';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || !bodyStr ? undefined : bodyStr,
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const ct = r.headers.get('content-type') || '';
    const raw = await r.text();
    const capped = raw.length > MAX_BYTES ? raw.slice(0, MAX_BYTES) : raw;

    let json: unknown;
    let isJson = false;
    if (ct.includes('json') || /^\s*[[{]/.test(capped)) {
      try {
        json = JSON.parse(capped);
        isJson = true;
      } catch {
        /* not valid JSON after all — fall back to text */
      }
    }
    return {
      status: 200,
      body: {
        status: r.status,
        contentType: ct,
        truncated: raw.length > MAX_BYTES,
        ...(isJson ? { json } : { text: capped }),
      },
    };
  } catch (e) {
    return { status: 502, body: { error: describeFetchError(e) } };
  } finally {
    clearTimeout(timer);
  }
}

/** Turn Node/undici's vague "fetch failed" into something actionable by digging into error.cause. */
function describeFetchError(e: unknown): string {
  if ((e as { name?: string })?.name === 'AbortError') return `Request timed out after ${TIMEOUT_MS / 1000}s.`;
  const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
  const detail = cause?.code || cause?.message || (e instanceof Error ? e.message : String(e));
  const d = String(detail);
  if (/ENOTFOUND|EAI_AGAIN/.test(d)) return `Could not resolve host — check the URL or that the API still exists (DNS lookup failed: ${d}).`;
  if (/ECONNREFUSED/.test(d)) return `Connection refused by the server (${d}).`;
  if (/ECONNRESET|EPIPE/.test(d)) return `Connection dropped by the server (${d}).`;
  if (/ETIMEDOUT/.test(d)) return `The server took too long to respond (${d}).`;
  if (/CERT|SSL|TLS|DEPTH_ZERO/i.test(d)) return `TLS/certificate problem reaching the server (${d}).`;
  return `Fetch failed: ${d}`;
}

async function readJson(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c: any) => (d += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(d || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

/** Vercel serverless handler. */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  const body = await readJson(req);
  const { status, body: out } = await proxyFetch(body ?? {});
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(out));
}

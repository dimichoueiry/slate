// Serverless web-scrape endpoint (Tavily extract). Works in production on
// Vercel as POST /api/scrape, and is reused by the Vite dev server so the
// same code path runs in `npm run dev`. The API key stays server-side.

interface ScrapeResult {
  status: number;
  body: unknown;
}

/** Framework-agnostic core: scrape a list of URLs via Tavily's /extract API. */
export async function scrapeUrls(urls: unknown, apiKey?: string): Promise<ScrapeResult> {
  const key = apiKey || process.env.TAVILY_API_KEY || '';
  if (!key) {
    return { status: 400, body: { error: 'TAVILY_API_KEY is not set on the server.' } };
  }
  if (!Array.isArray(urls) || urls.length === 0) {
    return { status: 400, body: { error: 'Provide one or more URLs to scrape.' } };
  }
  const clean = urls.filter((u): u is string => typeof u === 'string').slice(0, 20);
  try {
    const r = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ urls: clean, format: 'markdown' }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { status: r.status, body: { error: (data as any)?.detail?.error || (data as any)?.error || `Tavily ${r.status}` } };
    }
    return { status: 200, body: data };
  } catch (e) {
    return { status: 502, body: { error: `Scrape failed: ${e instanceof Error ? e.message : String(e)}` } };
  }
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
  const { status, body: out } = await scrapeUrls(body?.urls);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(out));
}

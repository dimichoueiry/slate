// Serverless web-search endpoint (Tavily search). Production: POST /api/search.
// Reused by the Vite dev server so the same path runs in `npm run dev`.

interface SearchResult {
  status: number;
  body: unknown;
}

/** Framework-agnostic core: run a Tavily web search. */
export async function searchWeb(query: unknown, apiKey?: string): Promise<SearchResult> {
  const key = apiKey || process.env.TAVILY_API_KEY || '';
  if (!key) return { status: 400, body: { error: 'TAVILY_API_KEY is not set on the server.' } };
  if (typeof query !== 'string' || !query.trim()) {
    return { status: 400, body: { error: 'Provide a search query.' } };
  }
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query: query.trim(),
        search_depth: 'basic',
        max_results: 6,
        include_answer: true,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { status: r.status, body: { error: (data as any)?.detail?.error || (data as any)?.error || `Tavily ${r.status}` } };
    }
    return { status: 200, body: data };
  } catch (e) {
    return { status: 502, body: { error: `Search failed: ${e instanceof Error ? e.message : String(e)}` } };
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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  const body = await readJson(req);
  const { status, body: out } = await searchWeb(body?.query);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(out));
}

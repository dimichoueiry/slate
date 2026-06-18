// Deep research agent (server-side). A LangGraph StateGraph that plans
// sub-questions, searches the web (Tavily) for each, reflects on whether more
// is needed, then synthesizes a cited report. Production: POST /api/research;
// also reused by the Vite dev server. Uses the caller's OpenRouter key for the
// LLM and the server's TAVILY_API_KEY for search.
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { searchWeb } from './search';

interface Finding {
  q: string;
  answer: string;
  sources: { title: string; url: string }[];
}
interface ResearchResult {
  status: number;
  body: unknown;
}

const MAX_ROUNDS = 2;

function makeLLM(apiKey: string, model: string) {
  return new ChatOpenAI({
    model: model || 'openai/gpt-4o-mini',
    apiKey,
    temperature: 0.3,
    maxTokens: 2500,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'http://localhost:5180', 'X-Title': 'Slate' },
    },
  });
}

async function ask(llm: ChatOpenAI, system: string, user: string): Promise<string> {
  const r = await llm.invoke([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  return typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
}

function parseList(raw: string): string[] {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  try {
    const arr = JSON.parse(cleaned.slice(cleaned.indexOf('['), cleaned.lastIndexOf(']') + 1));
    if (Array.isArray(arr)) return arr.map((x) => String(x)).filter(Boolean);
  } catch {
    /* fall back to line parsing */
  }
  return cleaned
    .split('\n')
    .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

export async function runResearch(query: unknown, apiKey: unknown, model: unknown): Promise<ResearchResult> {
  const key = (typeof apiKey === 'string' && apiKey) || process.env.OPENROUTER_API_KEY || '';
  if (!key) return { status: 400, body: { error: 'Research needs an OpenRouter API key (set one in ⚙ Settings).' } };
  if (typeof query !== 'string' || !query.trim()) return { status: 400, body: { error: 'Provide a research question.' } };
  if (!process.env.TAVILY_API_KEY) return { status: 400, body: { error: 'TAVILY_API_KEY is not set on the server.' } };

  const llm = makeLLM(key, typeof model === 'string' ? model : '');

  const State = Annotation.Root({
    query: Annotation<string>,
    pending: Annotation<string[]>({ reducer: (_x, y) => y, default: () => [] }),
    findings: Annotation<Finding[]>({ reducer: (x, y) => x.concat(y), default: () => [] }),
    rounds: Annotation<number>({ reducer: (_x, y) => y, default: () => 0 }),
    report: Annotation<string>({ reducer: (_x, y) => y, default: () => '' }),
  });

  const plan = async (s: typeof State.State) => {
    const out = await ask(
      llm,
      'You are a research planner. Break the question into 3–5 focused, searchable sub-questions. Reply with ONLY a JSON array of strings.',
      s.query
    );
    return { pending: parseList(out).slice(0, 5) };
  };

  const search = async (s: typeof State.State) => {
    const found: Finding[] = await Promise.all(
      s.pending.map(async (q) => {
        const res = await searchWeb(q);
        const data = (res.body ?? {}) as any;
        const sources = (data.results ?? [])
          .slice(0, 4)
          .map((r: any) => ({ title: String(r.title ?? r.url ?? ''), url: String(r.url ?? '') }));
        return { q, answer: String(data.answer ?? ''), sources };
      })
    );
    return { findings: found, pending: [], rounds: s.rounds + 1 };
  };

  const reflect = async (s: typeof State.State) => {
    if (s.rounds >= MAX_ROUNDS) return { pending: [] };
    const digest = s.findings.map((f) => `Q: ${f.q}\nA: ${f.answer}`).join('\n\n');
    const out = await ask(
      llm,
      'You assess research coverage. Given the original question and findings so far, list 0–3 follow-up sub-questions that would fill important gaps. If coverage is sufficient, reply with an empty JSON array []. Reply with ONLY a JSON array of strings.',
      `Question: ${s.query}\n\nFindings:\n${digest}`
    );
    return { pending: parseList(out).slice(0, 3) };
  };

  const synthesize = async (s: typeof State.State) => {
    const digest = s.findings
      .map((f) => `### ${f.q}\n${f.answer}\nSources: ${f.sources.map((x) => x.url).join(', ')}`)
      .join('\n\n');
    const report = await ask(
      llm,
      'You are a research analyst. Write a clear, well-structured briefing that answers the original question using the findings. Use short sections and concrete points. Plain text (light markdown headings ok), no preamble.',
      `Question: ${s.query}\n\nFindings:\n${digest}`
    );
    return { report };
  };

  const graph = new (StateGraph as any)(State)
    .addNode('plan', plan)
    .addNode('search', search)
    .addNode('reflect', reflect)
    .addNode('synthesize', synthesize)
    .addEdge(START, 'plan')
    .addEdge('plan', 'search')
    .addEdge('search', 'reflect')
    .addConditionalEdges('reflect', (s: typeof State.State) =>
      s.pending.length > 0 && s.rounds < MAX_ROUNDS ? 'search' : 'synthesize'
    )
    .addEdge('synthesize', END)
    .compile();

  try {
    const out = await graph.invoke({ query });
    const allSources = Array.from(
      new Map(
        (out.findings as Finding[]).flatMap((f) => f.sources).filter((x) => x.url).map((x) => [x.url, x])
      ).values()
    );
    const sourcesBlock = allSources.length
      ? '\n\nSources:\n' + allSources.map((x) => `• ${x.title || x.url}\n  ${x.url}`).join('\n')
      : '';
    return { status: 200, body: { report: String(out.report ?? '').trim() + sourcesBlock } };
  } catch (e) {
    return { status: 502, body: { error: `Research failed: ${e instanceof Error ? e.message : String(e)}` } };
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

export const config = { maxDuration: 120 };

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  res.setHeader('content-type', 'application/json');
  try {
    const body = await readJson(req);
    const { status, body: out } = await runResearch(body?.query, body?.apiKey, body?.model);
    res.statusCode = status;
    res.end(JSON.stringify(out));
  } catch (e) {
    // Anything that escapes runResearch's own try/catch (e.g. makeLLM or the
    // StateGraph build) lands here — return JSON instead of a platform 500 page.
    res.statusCode = 500;
    res.end(JSON.stringify({ error: `Research crashed: ${e instanceof Error ? e.stack || e.message : String(e)}` }));
  }
}

// Shared command layer for the Assistant chat. Each command reuses the SAME
// endpoints/prompts the canvas nodes use, but returns text instead of writing to
// a sticky. The metadata list is the single source of truth for the slash menu.
import { chat, getOpenRouterKey, getOpenRouterModel } from './llm';
import { getBasePrompt } from './basePrompts';

export interface ChatCommandMeta {
  cmd: string;
  desc: string;
}

/** Every command available in the chat (drives the "/" autocomplete). */
export const CHAT_COMMANDS: ChatCommandMeta[] = [
  { cmd: 'ai', desc: 'Plain answer (default when you don’t use a slash)' },
  { cmd: 'ask', desc: 'Answer your question from the web, with sources' },
  { cmd: 'search', desc: 'Quick web search — links + snippets' },
  { cmd: 'research', desc: 'Deep multi-step research agent' },
  { cmd: 'web', desc: 'Scrape link(s) in your message and summarize' },
  { cmd: 'extract', desc: 'Pull a structured markdown table from context' },
  { cmd: 'chart', desc: 'Describe a chart spec from your data' },
  { cmd: 'fix', desc: 'Rewrite a prompt to be clearer' },
  { cmd: 'img', desc: 'Generate an image onto the canvas' },
  { cmd: 'data', desc: 'Fetch JSON from an API endpoint (METHOD URL)' },
  { cmd: 'business', desc: 'Analyze a CSV / upload with exact stats tools' },
  { cmd: 'clear', desc: 'Clear this conversation' },
  { cmd: 'help', desc: 'List commands' },
];

const URL_RE = /https?:\/\/[^\s)<>"']+/gi;

// ---------- web ----------

export async function quickSearch(query: string): Promise<string> {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `search failed (${res.status})`);
  const results: { title?: string; url?: string }[] = data?.results ?? [];
  const sources = results.map((r) => `• ${r.title || r.url}\n  ${r.url}`).join('\n');
  return [String(data?.answer || '').trim(), sources && `Sources:\n${sources}`].filter(Boolean).join('\n\n') || '(no results)';
}

export async function askWeb(question: string): Promise<string> {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: question }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `search failed (${res.status})`);
  const results: { title?: string; url?: string; content?: string }[] = data?.results ?? [];
  if (results.length === 0 && !data?.answer) throw new Error('No web results found.');
  const context = results
    .map((r, i) => `[${i + 1}] ${r.title || r.url}\nURL: ${r.url}\n${(r.content || '').slice(0, 1500)}`)
    .join('\n\n');
  const answer = await chat(
    [
      {
        role: 'system',
        content:
          "You are a precise research assistant. Answer the user's question using ONLY the web results provided. " +
          'Be specific and concise. Cite sources inline as [1], [2]… matching the result numbers. ' +
          "If the results don't contain the answer, say so. Never invent facts or URLs.",
      },
      { role: 'user', content: `QUESTION: ${question}\n\nWEB RESULTS:\n${context || data?.answer || '(none)'}` },
    ],
    { temperature: 0.3, maxTokens: 1200 }
  );
  const sources = results.map((r, i) => `[${i + 1}] ${r.title || r.url}\n${r.url}`).join('\n');
  return [answer.trim() || '(no answer)', sources && `\nSources:\n${sources}`].filter(Boolean).join('\n');
}

export async function scrapeAndSummarize(message: string): Promise<string> {
  const urls = Array.from(new Set(message.match(URL_RE) ?? [])).slice(0, 20);
  if (urls.length === 0) throw new Error('No link found — include a URL in your message.');
  const instruction = message.replace(URL_RE, '').trim() || 'Summarize this page: what it is, key points, who it’s for.';
  const res = await fetch('/api/scrape', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ urls }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `scrape failed (${res.status})`);
  const pages: { url: string; raw_content?: string }[] = data?.results ?? [];
  if (pages.length === 0) throw new Error('No content extracted from those links.');
  const corpus = pages.map((p) => `### ${p.url}\n${(p.raw_content ?? '').slice(0, 6000)}`).join('\n\n');
  const out = await chat(
    [
      { role: 'system', content: getBasePrompt('web') },
      { role: 'user', content: `SCRAPED CONTENT:\n${corpus}\n\nINSTRUCTION: ${instruction}` },
    ],
    { temperature: 0.4, maxTokens: 2000 }
  );
  return out.trim() || '(empty result)';
}

// ---------- LLM-over-context ----------

export async function extractTable(instruction: string, corpus: string): Promise<string> {
  if (!corpus.trim()) throw new Error('Nothing to extract — reference content with @ or select objects.');
  const out = await chat(
    [
      {
        role: 'system',
        content:
          'Extract the requested structured data from the content. Reply with ONLY a GitHub-flavored markdown table (header row, separator row, then data rows). No prose, no code fences. Keep cells short.',
      },
      { role: 'user', content: `CONTENT:\n${corpus.slice(0, 12000)}\n\nEXTRACT: ${instruction || 'the key structured fields'}` },
    ],
    { temperature: 0.2, maxTokens: 2000 }
  );
  return out.replace(/```/g, '').trim() || '(nothing extracted)';
}

export async function chartSpec(instruction: string, corpus: string): Promise<string> {
  const out = await chat(
    [
      {
        role: 'system',
        content:
          'You turn data into a clear chart description. Given the data and request, state the best chart type (bar/line/pie), the x/y fields, and the series — then list the plotted values. Plain text, concise.',
      },
      { role: 'user', content: `DATA:\n${corpus.slice(0, 8000)}\n\nREQUEST: ${instruction || 'chart this data'}` },
    ],
    { temperature: 0.2, maxTokens: 900 }
  );
  return out.trim() || '(could not build a chart spec)';
}

export async function fixPrompt(source: string): Promise<string> {
  if (!source.trim()) throw new Error('Nothing to improve — type a prompt or reference one with @.');
  const out = await chat(
    [
      { role: 'system', content: getBasePrompt('fix') },
      { role: 'user', content: source },
    ],
    { temperature: 0.4, maxTokens: 1200 }
  );
  return out.trim() || '(no output)';
}

// ---------- data / research ----------

export async function fetchData(message: string): Promise<string> {
  const tokens = message.trim().split(/\s+/);
  let method = 'GET';
  if (/^(get|post|put|patch|delete)$/i.test(tokens[0] ?? '')) method = tokens.shift()!.toUpperCase();
  const url = (message.match(URL_RE) ?? [])[0] || tokens.join(' ');
  if (!url) throw new Error('Provide an endpoint, e.g. /data GET https://api.example.com/x');
  const res = await fetch('/api/fetch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, method, body: '', headers: {} }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `fetch failed (${res.status})`);
  const payload = data?.json ?? data?.body ?? data;
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return text.slice(0, 6000);
}

export async function deepResearch(query: string): Promise<string> {
  const res = await fetch('/api/research', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, apiKey: getOpenRouterKey(), model: getOpenRouterModel() }),
  });
  const raw = await res.text();
  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`research failed (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(data?.error || `research failed (${res.status})`);
  return String(data?.report || '(no report)');
}

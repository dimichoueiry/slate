// Unified LLM client for Slate's AI features.
// Routes to OpenRouter when the user has saved an API key, otherwise falls
// back to a local Ollama server — callers never need to care which.
//
// Wiring: import { chat, chatStream, hasOpenRouter, setOpenRouterKey } from './ai/llm'
// (adjust the relative path). To set a key quickly for testing:
//   localStorage.setItem('slate-openrouter-key', 'sk-or-...')

import { useUI } from '../store/ui';

/** Record an OpenRouter or Ollama usage object into the session cost meter. */
function recordUsage(u: any) {
  if (!u) return;
  useUI.getState().addUsage({
    calls: 1,
    promptTokens: u.prompt_tokens ?? u.prompt_eval_count ?? 0,
    completionTokens: u.completion_tokens ?? u.eval_count ?? 0,
    costUsd: typeof u.cost === 'number' ? u.cost : typeof u.total_cost === 'number' ? u.total_cost : 0,
  });
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

/** Ollama wants {content, images[base64]} instead of OpenAI-style content parts. */
function toOllamaMessage(m: ChatMessage): Record<string, unknown> {
  if (typeof m.content === 'string') return { role: m.role, content: m.content };
  const text = m.content
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
  const images = m.content
    .filter((p): p is Extract<ContentPart, { type: 'image_url' }> => p.type === 'image_url')
    .map((p) => p.image_url.url.replace(/^data:[^;]+;base64,/, ''));
  return images.length ? { role: m.role, content: text, images } : { role: m.role, content: text };
}

export interface LLMOptions {
  /** override the configured model for this call */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** ask the provider to force valid JSON output where supported */
  json?: boolean;
}

// ---------- settings (localStorage) ----------

const OR_KEY = 'slate-openrouter-key';
const OR_MODEL = 'slate-openrouter-model';
const OLLAMA_URL = 'slate-ollama-url';
const OLLAMA_MODEL = 'slate-ollama-model';
const MAX_TOKENS = 'slate-max-tokens';

export const DEFAULT_OPENROUTER_MODEL = 'openrouter/auto';
export const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';
const OR_IMG_MODEL = 'slate-openrouter-image-model';
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'llama3.2';

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string | null) => {
  try {
    if (v === null || v === '') localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // storage unavailable — settings just won't persist
  }
};

export const getOpenRouterKey = () => get(OR_KEY);
export const setOpenRouterKey = (key: string | null) => set(OR_KEY, key);
export const getOpenRouterModel = () => get(OR_MODEL) ?? DEFAULT_OPENROUTER_MODEL;
export const getImageModel = () => get(OR_IMG_MODEL) ?? DEFAULT_IMAGE_MODEL;
export const setImageModel = (m: string | null) => set(OR_IMG_MODEL, m);
export const setOpenRouterModel = (m: string | null) => set(OR_MODEL, m);
export const getOllamaUrl = () => get(OLLAMA_URL) ?? DEFAULT_OLLAMA_URL;
export const setOllamaUrl = (u: string | null) => set(OLLAMA_URL, u);
export const getOllamaModel = () => get(OLLAMA_MODEL) ?? DEFAULT_OLLAMA_MODEL;
export const setOllamaModel = (m: string | null) => set(OLLAMA_MODEL, m);

/** User-configured response-length budget (max output tokens). `undefined` means
 *  no limit — let the model use its full output budget. Per-call `opts.maxTokens`
 *  still overrides this where a specific size is structurally required. */
export const getMaxTokens = (): number | undefined => {
  const v = Number(get(MAX_TOKENS));
  return Number.isFinite(v) && v > 0 ? v : undefined;
};
export const setMaxTokens = (n: number | null) => set(MAX_TOKENS, n && n > 0 ? String(Math.round(n)) : null);

// How many tool-call rounds an agent (chatWithTools) may take before it must
// stop. Unlike token budget this has a finite default — an unbounded agent loop
// could run (and bill) forever — but it's generous and user-tunable.
const MAX_ROUNDS = 'slate-max-rounds';
export const DEFAULT_MAX_ROUNDS = 25;
export const getMaxRounds = (): number => {
  const v = Number(get(MAX_ROUNDS));
  return Number.isFinite(v) && v > 0 ? Math.round(v) : DEFAULT_MAX_ROUNDS;
};
export const setMaxRounds = (n: number | null) => set(MAX_ROUNDS, n && n > 0 ? String(Math.round(n)) : null);

/** true when an OpenRouter key is configured — the router prefers it over Ollama */
export const hasOpenRouter = () => !!getOpenRouterKey();

/** which backend a call will use right now */
export const activeProvider = (): 'openrouter' | 'ollama' => (hasOpenRouter() ? 'openrouter' : 'ollama');

// ---------- OpenRouter ----------

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

function openRouterHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    'HTTP-Referer': 'http://localhost:5180',
    'X-Title': 'Slate',
  };
}

async function openRouterChat(messages: ChatMessage[], opts: LLMOptions): Promise<string> {
  const key = getOpenRouterKey();
  if (!key) throw new Error('No OpenRouter API key configured');
  const call = async (withJsonMode: boolean) =>
    fetch(OPENROUTER_API, {
      method: 'POST',
      headers: openRouterHeaders(key),
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model ?? getOpenRouterModel(),
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens ?? getMaxTokens(),
        usage: { include: true }, // ask OpenRouter to report token usage + cost
        ...(withJsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  let res = await call(!!opts.json);
  if (!res.ok && opts.json) {
    // some models reject response_format — retry without it
    res = await call(false);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  recordUsage(data?.usage);
  return data?.choices?.[0]?.message?.content ?? '';
}

async function* openRouterStream(messages: ChatMessage[], opts: LLMOptions): AsyncGenerator<string> {
  const key = getOpenRouterKey();
  if (!key) throw new Error('No OpenRouter API key configured');
  const res = await fetch(OPENROUTER_API, {
    method: 'POST',
    headers: openRouterHeaders(key),
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model ?? getOpenRouterModel(),
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens ?? getMaxTokens(),
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // partial/comment line — skip
      }
    }
  }
}

/** Generate an image via OpenRouter (image-capable models return data-URL images). */
export async function generateImage(
  prompt: string,
  opts: { signal?: AbortSignal; inputImages?: string[] } = {}
): Promise<Blob> {
  const key = getOpenRouterKey();
  if (!key) throw new Error('Image generation needs an OpenRouter API key (add one in ⚙ settings)');
  const content: string | ContentPart[] = opts.inputImages?.length
    ? [
        { type: 'text', text: prompt },
        ...opts.inputImages.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      ]
    : prompt;
  const res = await fetch(OPENROUTER_API, {
    method: 'POST',
    headers: openRouterHeaders(key),
    signal: opts.signal,
    body: JSON.stringify({
      model: getImageModel(),
      messages: [{ role: 'user', content }],
      modalities: ['image', 'text'],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  recordUsage(data?.usage);
  const url = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) {
    throw new Error(`No image returned — make sure the image model (⚙ settings, currently "${getImageModel()}") supports generation`);
  }
  return await (await fetch(url)).blob();
}

// ---------- tool calling (agent loop) ----------

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export type ToolRunner = (name: string, args: any) => unknown | Promise<unknown>;

export interface ToolChatResult {
  text: string;
  /** one line per tool call: "name(args) → result", for transparency/debug */
  trace: string[];
  /** OpenRouter finish_reason of the final turn ('length' = hit token cap, etc.),
   *  or 'tool_rounds_exhausted' when the loop ended without a final answer. */
  finishReason?: string;
}

/** Human-readable reason a tool run came back with no answer, so the UI can say
 *  WHY instead of an opaque "(no answer)". */
export function explainEmptyToolResult(r: ToolChatResult): string {
  const calls = r.trace.length;
  const model = getOpenRouterModel();
  if (r.finishReason === 'tool_rounds_exhausted')
    return `the agent used all its tool rounds (${calls} call${calls === 1 ? '' : 's'}) without finishing — raise “Max agent steps” in ⚙ Settings, or ask something more specific.`;
  if (r.finishReason === 'length')
    return `the model hit its response-length limit before answering${calls ? ` (after ${calls} tool call${calls === 1 ? '' : 's'})` : ''} — raise “Max response length” in ⚙ Settings, or ask something shorter.`;
  if (calls === 0)
    return `the model (${model}) returned nothing and called no tools — it may not support tool calling well. Try a different model in ⚙ Settings.`;
  return `the model returned an empty answer after ${calls} tool call${calls === 1 ? '' : 's'} (finished: ${r.finishReason ?? 'unknown'}).`;
}

/**
 * Run an OpenRouter chat with tools, executing tool calls locally and looping
 * until the model returns a final answer (or `maxRounds` is hit). Tool calling
 * needs OpenRouter — it throws if only the local Ollama fallback is available.
 */
export async function chatWithTools(
  messages: ChatMessage[],
  tools: ToolDef[],
  run: ToolRunner,
  opts: LLMOptions & { maxRounds?: number } = {}
): Promise<ToolChatResult> {
  const key = getOpenRouterKey();
  if (!key) throw new Error('Tool-using agents need an OpenRouter API key (add one in ⚙ Settings).');
  const maxRounds = opts.maxRounds ?? getMaxRounds();
  const msgs: any[] = [...messages];
  const trace: string[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const lastRound = round === maxRounds - 1;
    const res = await fetch(OPENROUTER_API, {
      method: 'POST',
      headers: openRouterHeaders(key),
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model ?? getOpenRouterModel(),
        messages: msgs,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens ?? getMaxTokens(),
        usage: { include: true },
        // on the final allowed round, stop offering tools so it must answer
        ...(lastRound ? {} : { tools, tool_choice: 'auto' }),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    recordUsage(data?.usage);
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error('OpenRouter returned no message');
    msgs.push(msg);

    const calls = msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;
    if (!calls?.length) return { text: msg.content ?? '', trace, finishReason: data?.choices?.[0]?.finish_reason };

    for (const tc of calls) {
      let args: any = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        /* leave args empty — the tool will likely error, which guides the model */
      }
      let result: unknown;
      try {
        result = await run(tc.function.name, args);
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) };
      }
      const json = JSON.stringify(result);
      trace.push(`${tc.function.name}(${tc.function.arguments}) → ${json.slice(0, 240)}`);
      msgs.push({ role: 'tool', tool_call_id: tc.id, content: json });
    }
  }
  // exhausted rounds without a final assistant message
  return { text: '', trace, finishReason: 'tool_rounds_exhausted' };
}

// ---------- Ollama (local fallback) ----------

async function ollamaChat(messages: ChatMessage[], opts: LLMOptions): Promise<string> {
  const res = await fetch(`${getOllamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model ?? getOllamaModel(),
      messages: messages.map(toOllamaMessage),
      stream: false,
      ...(opts.json ? { format: 'json' } : {}),
      options: { temperature: opts.temperature, num_predict: opts.maxTokens ?? getMaxTokens() },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  recordUsage(data);
  return data?.message?.content ?? '';
}

async function* ollamaStream(messages: ChatMessage[], opts: LLMOptions): AsyncGenerator<string> {
  const res = await fetch(`${getOllamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model ?? getOllamaModel(),
      messages: messages.map(toOllamaMessage),
      stream: true,
      options: { temperature: opts.temperature, num_predict: opts.maxTokens ?? getMaxTokens() },
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 300)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const chunk = JSON.parse(line);
        if (chunk?.message?.content) yield chunk.message.content;
        if (chunk?.done) return;
      } catch {
        // skip malformed line
      }
    }
  }
}

// ---------- unified entry points ----------

/** One-shot completion. Uses OpenRouter when a key is set, local Ollama otherwise. */
export async function chat(messages: ChatMessage[], opts: LLMOptions = {}): Promise<string> {
  return hasOpenRouter() ? openRouterChat(messages, opts) : ollamaChat(messages, opts);
}

/** Streaming completion (async generator of text deltas). Same routing as chat(). */
export function chatStream(messages: ChatMessage[], opts: LLMOptions = {}): AsyncGenerator<string> {
  return hasOpenRouter() ? openRouterStream(messages, opts) : ollamaStream(messages, opts);
}

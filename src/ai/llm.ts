// Unified LLM client for Slate's AI features.
// Routes to OpenRouter when the user has saved an API key, otherwise falls
// back to a local Ollama server — callers never need to care which.
//
// Wiring: import { chat, chatStream, hasOpenRouter, setOpenRouterKey } from './ai/llm'
// (adjust the relative path). To set a key quickly for testing:
//   localStorage.setItem('slate-openrouter-key', 'sk-or-...')

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

/** Ollama wants {content, images[base64]} instead of OpenAI-style content parts. */
function toOllamaMessage(m: ChatMessage): Record<string, unknown> {
  if (typeof m.content === 'string') return m;
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
        max_tokens: opts.maxTokens,
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
      max_tokens: opts.maxTokens,
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
  const url = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) {
    throw new Error(`No image returned — make sure the image model (⚙ settings, currently "${getImageModel()}") supports generation`);
  }
  return await (await fetch(url)).blob();
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
      options: { temperature: opts.temperature, num_predict: opts.maxTokens },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
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
      options: { temperature: opts.temperature, num_predict: opts.maxTokens },
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

// Editable base system prompts for the free-form AI node types. Defaults match
// the built-in behavior; users can override them in ⚙ Settings (persisted).
// Format-locked nodes (extract → table, chart → JSON) are intentionally not
// editable so their output contracts can't be broken.
export type PromptNode = 'ai' | 'web' | 'fix';

export const BASE_PROMPT_LABELS: Record<PromptNode, string> = {
  ai: 'ai: — text generation',
  web: 'web: — summarize scraped pages',
  fix: 'fix: — improve a prompt',
};

export const DEFAULT_BASE_PROMPTS: Record<PromptNode, string> = {
  ai: 'You are a function node on a visual whiteboard. Use the INPUTS (text and/or attached images) to produce what the INSTRUCTION asks for. Reply with plain text only (or the exact JSON shape when versions are requested) — no markdown, no preamble. Keep it concise enough to read on a sticky note unless asked otherwise.',
  web: 'You are a research node on a whiteboard. You receive scraped web page content and an instruction. Produce the requested output as plain text — no markdown fences, no preamble. Be concise and concrete; base everything only on the provided content.',
  fix: "You are a prompt engineer. Rewrite the user's prompt into a clearer, more specific, higher-quality prompt: add helpful structure, constraints, role, and desired output format where useful, but keep the original intent. Reply with ONLY the improved prompt — no commentary, no quotes.",
};

const KEY = 'slate-base-prompts';

function loadOverrides(): Partial<Record<PromptNode, string>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** The effective base prompt for a node type (override if set, else default). */
export function getBasePrompt(node: PromptNode): string {
  const o = loadOverrides()[node];
  return typeof o === 'string' && o.trim() ? o : DEFAULT_BASE_PROMPTS[node];
}

export function getAllBasePrompts(): Record<PromptNode, string> {
  const o = loadOverrides();
  return {
    ai: typeof o.ai === 'string' ? o.ai : DEFAULT_BASE_PROMPTS.ai,
    web: typeof o.web === 'string' ? o.web : DEFAULT_BASE_PROMPTS.web,
    fix: typeof o.fix === 'string' ? o.fix : DEFAULT_BASE_PROMPTS.fix,
  };
}

/** Save an override; pass null/empty to reset to the default. */
export function setBasePrompt(node: PromptNode, text: string | null) {
  const o = loadOverrides();
  if (!text || text.trim() === '' || text === DEFAULT_BASE_PROMPTS[node]) delete o[node];
  else o[node] = text;
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

export function isOverridden(node: PromptNode): boolean {
  const o = loadOverrides()[node];
  return typeof o === 'string' && o.trim() !== '' && o !== DEFAULT_BASE_PROMPTS[node];
}

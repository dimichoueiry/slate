import { useEffect, useMemo, useRef, useState } from 'react';
import type { Controller } from '../engine/controller';
import { useUI } from '../store/ui';
import {
  activeProvider,
  chatStream,
  chatWithTools,
  generateImage,
  hasOpenRouter,
  type ChatMessage,
  type ToolDef,
  type ToolRunner,
} from '../ai/llm';
import { makeBusinessTools, pickTable, tableSummary } from '../ai/tools';
import {
  CHAT_COMMANDS,
  askWeb,
  chartSpec,
  deepResearch,
  extractTable,
  fetchData,
  fixPrompt,
  quickSearch,
  scrapeAndSummarize,
} from '../ai/chatCommands';
import { putBlob } from '../store/db';

type OllamaModel = { name: string };
interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** tool calls made while producing this reply (for transparency) */
  trace?: string[];
}

const OLLAMA_BASE = 'http://localhost:11434';
const nid = () => Math.random().toString(36).slice(2, 9);

interface Mentionable {
  id: string;
  icon: string;
  label: string;
  kind: string;
  token: string;
}

function tokenize(core: string): string {
  const slug = core.trim().replace(/\s+/g, '_').replace(/[^\w.\-]/g, '').slice(0, 24);
  return '@' + (slug || 'ref');
}

/** Objects on the board the chat can reference, with a label + @token. */
function listMentionables(objs: any[]): Mentionable[] {
  const out: Mentionable[] = [];
  for (const o of objs) {
    let icon = '';
    let core = '';
    let kind = '';
    if (o.file && typeof o.file.text === 'string') {
      icon = '📎';
      core = o.file.name;
      kind = 'upload';
    } else if (o.type === 'frame') {
      icon = '⧉';
      core = o.name || 'Frame';
      kind = 'frame';
    } else if (o.type === 'sticky' || o.type === 'text' || o.type === 'shape') {
      const t = String(o.text ?? '').trim();
      if (!t) continue;
      icon = o.type === 'sticky' ? '🗒' : o.type === 'shape' ? '▭' : 'T';
      core = t.split('\n')[0];
      kind = o.type;
    } else continue;
    out.push({ id: o.id, icon, label: core, kind, token: tokenize(core) });
  }
  // uploads & frames first — the most useful references
  return out.sort((a, b) => {
    const w = (k: string) => (k === 'upload' ? 0 : k === 'frame' ? 1 : 2);
    return w(a.kind) - w(b.kind);
  });
}

/** Resolve a referenced object to text: upload content, frame contents, or text. */
function mentionContent(allObjs: any[], o: any): string {
  if (o.file && typeof o.file.text === 'string') return String(o.file.text);
  if (o.type === 'frame') {
    const inside = allObjs.filter((x) => {
      if (x.id === o.id || x.type === 'connector' || x.type === 'frame') return false;
      const cx = x.x + (x.w ?? 0) / 2;
      const cy = x.y + (x.h ?? 0) / 2;
      return cx >= o.x && cx <= o.x + o.w && cy >= o.y && cy <= o.y + o.h;
    });
    return inside.map((x) => String(x.text ?? x.label ?? '').trim()).filter(Boolean).join('\n');
  }
  return String(o.text ?? o.label ?? '');
}

const CANVAS_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'add_sticky',
      description:
        'Place a sticky note on the canvas with the given text. Use whenever the user asks to put something on a sticky, add it to the canvas, or save it visually. Keep the text concise.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_text',
      description: 'Place a plain text block on the canvas (no sticky background). Keep it concise.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  },
];

const HELP =
  'Commands:\n' +
  CHAT_COMMANDS.map((c) => `• /${c.cmd} — ${c.desc}`).join('\n') +
  '\n\nTip: type @ to reference a sticky, upload, or frame. With OpenRouter, ask me to “put that on a sticky” and I’ll add it.';

export default function LocalAiPanel({
  ctl,
  boardId,
  onInsertIntoNote,
}: {
  ctl: Controller;
  boardId: string;
  onInsertIntoNote: (text: string) => void;
}) {
  const model = useUI((s) => s.localAiModel);
  const systemPrompt = useUI((s) => s.localAiSystemPrompt);
  const selection = useUI((s) => s.selection);
  const docVersion = useUI((s) => s.docVersion);
  const set = useUI((s) => s.set);

  const [models, setModels] = useState<OllamaModel[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [customModel, setCustomModel] = useState('');
  const [slashSel, setSlashSel] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // slash-command menu: "/" then an optional filter, before the first space
  const slashMatch = /^\/(\w*)$/.exec(input);
  const slashItems = slashMatch && !slashDismissed
    ? CHAT_COMMANDS.filter((c) => c.cmd.startsWith(slashMatch[1].toLowerCase()))
    : [];
  const showSlash = slashItems.length > 0;
  const slashSelClamped = Math.min(slashSel, Math.max(0, slashItems.length - 1));

  const pickSlash = (cmd: string) => {
    const v = `/${cmd} `;
    setInput(v);
    setSlashDismissed(true);
    requestAnimationFrame(() => {
      const t = inputRef.current;
      if (t) {
        t.focus();
        t.setSelectionRange(v.length, v.length);
      }
    });
  };

  // @-mention menu: reference an object's content (since the chat has no arrows)
  const [mentionSel, setMentionSel] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [mentions, setMentions] = useState<{ token: string; id: string }[]>([]);

  // ---------- persistence: conversation is saved per board ----------
  const storeKey = `slate-chat-${boardId}`;
  const justLoaded = useRef(false);
  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(`slate-chat-${boardId}`) ?? 'null');
      setMessages(Array.isArray(parsed?.messages) ? parsed.messages : []);
      setMentions(Array.isArray(parsed?.mentions) ? parsed.mentions : []);
    } catch {
      setMessages([]);
      setMentions([]);
    }
    justLoaded.current = true;
  }, [boardId]);
  useEffect(() => {
    if (justLoaded.current) {
      justLoaded.current = false;
      return; // don't immediately re-save what we just loaded
    }
    try {
      localStorage.setItem(storeKey, JSON.stringify({ messages: messages.slice(-120), mentions }));
    } catch {
      /* storage full/unavailable — history just won't persist */
    }
  }, [messages, mentions, storeKey]);

  const mentionables = useMemo(() => listMentionables(ctl.doc.all()), [ctl, docVersion]);
  const mentionMatch = /(^|\s)@([\w.\-]*)$/.exec(input);
  const mentionFrag = (mentionMatch?.[2] ?? '').toLowerCase();
  const mentionItems =
    mentionMatch && !mentionDismissed
      ? mentionables.filter((m) => m.label.toLowerCase().includes(mentionFrag) || m.token.toLowerCase().includes(mentionFrag)).slice(0, 8)
      : [];
  const showMention = mentionItems.length > 0;
  const mentionSelClamped = Math.min(mentionSel, Math.max(0, mentionItems.length - 1));

  const pickMention = (item: Mentionable) => {
    let token = item.token;
    if (mentions.some((m) => m.token === token && m.id !== item.id)) {
      let n = 2;
      while (mentions.some((m) => m.token === `${token}_${n}`)) n++;
      token = `${token}_${n}`;
    }
    const v = input.replace(/(^|\s)@([\w.\-]*)$/, (_m, pre) => `${pre}${token} `);
    setInput(v);
    setMentions((prev) => (prev.some((m) => m.token === token) ? prev : [...prev, { token, id: item.id }]));
    setMentionDismissed(true);
    requestAnimationFrame(() => {
      const t = inputRef.current;
      if (t) {
        t.focus();
        t.setSelectionRange(v.length, v.length);
      }
    });
  };

  const provider = activeProvider();

  const selectedObjs = useMemo(() => ctl.selectedObjects(), [ctl, selection, docVersion]);
  const selectedText = useMemo(() => {
    const bits: string[] = [];
    for (const o of selectedObjs) {
      const any = o as any;
      if (o.type === 'text' || o.type === 'sticky') bits.push(String(any.text ?? '').trim());
      else if (o.type === 'shape') bits.push(String(any.text ?? '').trim());
      else if (o.type === 'connector') bits.push(String(any.label ?? '').trim());
    }
    return bits.filter(Boolean).join('\n');
  }, [selectedObjs]);

  const fetchModels = async () => {
    try {
      const r = await fetch(`${OLLAMA_BASE}/api/tags`);
      if (!r.ok) throw new Error(`Ollama unavailable (${r.status})`);
      const data = (await r.json()) as { models?: OllamaModel[] };
      const list = data.models ?? [];
      setModels(list);
      if (list.length > 0 && !list.some((m) => m.name === model)) set({ localAiModel: list[0].name });
    } catch {
      setModels([]);
    }
  };

  useEffect(() => {
    if (provider === 'ollama') void fetchModels();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const pushAssistant = (content: string, trace?: string[]) =>
    setMessages((m) => [...m, { id: nid(), role: 'assistant', content, trace }]);

  // build the LLM message list from our visible history + canvas context
  const buildMessages = (history: ChatMsg[], refContext = ''): ChatMessage[] => {
    const sys: string[] = [
      systemPrompt.trim() ||
        'You are a helpful assistant inside Slate, an infinite-canvas app. Keep answers practical and structured.',
    ];
    if (hasOpenRouter()) {
      sys.push(
        'You can act on the canvas: when the user asks you to make a sticky, put something on the canvas, or save it visually, call add_sticky or add_text. Otherwise just reply normally.'
      );
    }
    if (selectedText) sys.push(`The user currently has these canvas objects selected:\n${selectedText}`);
    if (refContext) sys.push(`The user referenced these canvas objects with @:\n${refContext}`);
    return [
      { role: 'system', content: sys.join('\n\n') },
      ...history.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    ];
  };

  /** Resolve @tokens still present in `text` to a context block + the objects. */
  const resolveMentions = (text: string) => {
    const all = ctl.doc.all();
    const used = mentions.filter((mn) => text.includes(mn.token));
    const objs = used.map((mn) => all.find((o) => o.id === mn.id)).filter(Boolean);
    const context = used
      .map((mn) => {
        const o = all.find((x) => x.id === mn.id);
        return o ? `${mn.token}:\n${mentionContent(all, o).slice(0, 8000)}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
    return { objs, context };
  };

  const canvasRunner: ToolRunner = (name, args) => {
    const text = String(args?.text ?? '').trim();
    if (!text) return { error: 'empty text' };
    if (name === 'add_sticky') {
      ctl.addPromptSticky(text);
      return { ok: true };
    }
    if (name === 'add_text') {
      ctl.addTextAtCenter(text);
      return { ok: true };
    }
    return { error: `unknown tool ${name}` };
  };

  // ---------- command handlers ----------

  const runImgCmd = async (prompt: string) => {
    if (!prompt.trim()) throw new Error('Describe the image you want, e.g. /img a minimalist logo for a nail salon');
    const blob = await generateImage(prompt);
    const blobId = await putBlob(blob);
    const bmp = await createImageBitmap(blob);
    ctl.addImage(blobId, { w: bmp.width, h: bmp.height });
  };

  const runBusinessCmd = async (question: string, refObjs: any[]) => {
    if (!hasOpenRouter()) throw new Error('/business needs an OpenRouter API key (⚙ Settings).');
    // prefer @-referenced objects, then the current selection
    const sources = [...refObjs, ...selectedObjs];
    const texts = sources.map((o) => String((o as any).file?.text ?? (o as any).text ?? ''));
    const table = pickTable(texts);
    if (!table) throw new Error('Reference a CSV with @, or select an upload node — /business needs a table.');
    const { defs, run } = makeBusinessTools(table);
    const { text, trace } = await chatWithTools(
      [
        {
          role: 'system',
          content:
            'You are a data analyst. NEVER do arithmetic yourself — always call a tool for any number. For rates/shares use value_counts. Use exact column names. Then answer concisely.',
        },
        { role: 'user', content: `Table summary:\n${tableSummary(table)}\n\nTask: ${question}` },
      ],
      defs,
      run,
      { temperature: 0.1, maxTokens: 1400 }
    );
    return { text: text.trim() || '(no answer)', trace };
  };

  // ---------- send ----------

  const send = async () => {
    const raw = input.trim();
    if (!raw || busy) return;

    // local-only commands
    if (raw === '/clear') {
      setMessages([]);
      setInput('');
      return;
    }
    if (raw === '/help') {
      setInput('');
      setMessages((m) => [...m, { id: nid(), role: 'user', content: raw }, { id: nid(), role: 'assistant', content: HELP }]);
      return;
    }

    const userMsg: ChatMsg = { id: nid(), role: 'user', content: raw };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setBusy(true);
    setError(null);

    try {
      const cmd = raw.match(/^\/(\w+)\s*([\s\S]*)$/);
      const verb = cmd?.[1]?.toLowerCase();
      const rest = cmd?.[2]?.trim() ?? '';
      const promptText = rest || raw;
      const { objs: refObjs, context: refContext } = resolveMentions(raw);
      const corpus = [refContext, selectedText].filter(Boolean).join('\n\n');

      // commands that produce a text (or canvas) result, reusing the node logic
      let handled: { text: string; trace?: string[] } | null = null;
      switch (verb) {
        case 'research':
          handled = { text: await deepResearch(promptText) };
          break;
        case 'ask':
          handled = { text: await askWeb(promptText) };
          break;
        case 'search':
          handled = { text: await quickSearch(promptText) };
          break;
        case 'web':
          handled = { text: await scrapeAndSummarize(promptText) };
          break;
        case 'extract':
          handled = { text: await extractTable(rest, corpus) };
          break;
        case 'chart':
          handled = { text: await chartSpec(rest, corpus) };
          break;
        case 'fix':
          handled = { text: await fixPrompt(rest || corpus) };
          break;
        case 'data':
          handled = { text: await fetchData(promptText) };
          break;
        case 'img':
          await runImgCmd(promptText);
          handled = { text: '🖼 Image added to the canvas.' };
          break;
        case 'business': {
          const r = await runBusinessCmd(promptText, refObjs);
          handled = { text: r.text, trace: r.trace };
          break;
        }
        default:
          handled = null; // fall through to conversational chat
      }

      if (handled) {
        pushAssistant(handled.text, handled.trace?.length ? handled.trace : undefined);
      } else if (provider === 'openrouter') {
        // agentic chat: can call canvas tools
        const msgs = buildMessages(verb === 'ai' ? [...messages, { ...userMsg, content: promptText }] : history, refContext);
        const { text, trace } = await chatWithTools(msgs, CANVAS_TOOLS, canvasRunner, { temperature: 0.3, maxTokens: 1200 });
        pushAssistant(text || '(done)', trace.length ? trace : undefined);
      } else {
        // ollama: stream a plain reply (no canvas tools)
        const id = nid();
        setMessages((m) => [...m, { id, role: 'assistant', content: '' }]);
        let acc = '';
        for await (const delta of chatStream(buildMessages(history, refContext), { temperature: 0.3 })) {
          acc += delta;
          setMessages((m) => m.map((x) => (x.id === id ? { ...x, content: acc } : x)));
        }
        if (!acc) setMessages((m) => m.map((x) => (x.id === id ? { ...x, content: '(no output)' } : x)));
      }
    } catch (e: any) {
      const msg = e?.message ?? 'Request failed.';
      setError(msg);
      pushAssistant('⚠ ' + msg);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (showSlash) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashSel((i) => (i + 1) % slashItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashSel((i) => (i - 1 + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickSlash(slashItems[slashSelClamped]!.cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }
    if (showMention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionSel((i) => (i + 1) % mentionItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionSel((i) => (i - 1 + mentionItems.length) % mentionItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(mentionItems[mentionSelClamped]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="local-ai local-ai-embedded chat-panel">
      <div className="chat-head">
        <strong>Assistant</strong>
        <span className="chat-provider">{provider === 'openrouter' ? 'OpenRouter' : 'Local (Ollama)'}</span>
        <button className="chrome-btn chat-gear" title="Model & system prompt" onClick={() => setShowSettings((v) => !v)}>
          ⚙
        </button>
      </div>

      {showSettings && (
        <div className="chat-settings">
          {provider === 'ollama' && (
            <>
              <div className="local-ai-row">
                <label>Model</label>
                <select
                  value={models.some((m) => m.name === model) ? model : '__custom__'}
                  onChange={(e) => e.target.value !== '__custom__' && set({ localAiModel: e.target.value })}
                >
                  {models.length === 0 && <option value="__custom__">No local models found</option>}
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                  <option value="__custom__">Custom model…</option>
                </select>
                <button className="chrome-btn" onClick={() => void fetchModels()}>
                  Refresh
                </button>
              </div>
              <div className="local-ai-row">
                <label>Custom</label>
                <input
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="e.g. qwen2.5:3b"
                  spellCheck={false}
                />
                <button className="chrome-btn" disabled={!customModel.trim()} onClick={() => set({ localAiModel: customModel.trim() })}>
                  Use
                </button>
              </div>
            </>
          )}
          <textarea
            className="local-ai-system"
            placeholder="System prompt (how the assistant should behave)"
            value={systemPrompt}
            onChange={(e) => set({ localAiSystemPrompt: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            Ask anything. <code>/</code> for commands, <code>@</code> to reference a sticky, upload, or frame.
            {provider === 'openrouter' && <> Ask me to “put that on a sticky” and I’ll add it to the canvas.</>}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            <div className="chat-bubble">{m.content || (busy ? '…' : '')}</div>
            {m.trace && m.trace.length > 0 && (
              <div className="chat-trace" title={m.trace.join('\n')}>
                🔧 {m.trace.length} tool call{m.trace.length === 1 ? '' : 's'}
              </div>
            )}
            {m.role === 'assistant' && m.content && (
              <div className="chat-msg-actions">
                <button className="chrome-btn" onClick={() => ctl.addPromptSticky(m.content)}>
                  📌 Sticky
                </button>
                <button className="chrome-btn" onClick={() => ctl.addTextAtCenter(m.content)}>
                  ＋ Canvas
                </button>
                <button className="chrome-btn" onClick={() => onInsertIntoNote(m.content)}>
                  → Note
                </button>
              </div>
            )}
          </div>
        ))}
        {busy && messages[messages.length - 1]?.role === 'user' && <div className="chat-msg assistant"><div className="chat-bubble">…</div></div>}
      </div>

      {selectedText && <div className="local-ai-hint">Using {selectedObjs.length} selected object(s) as context.</div>}
      {error && <div className="local-ai-error">{error}</div>}

      <div className="chat-input-row">
        {showSlash && (
          <div className="slash-menu chat-slash" onPointerDown={(e) => e.preventDefault()}>
            <div className="slash-hint">Commands</div>
            {slashItems.map((c, i) => (
              <button
                key={c.cmd}
                className={i === slashSelClamped ? 'active' : ''}
                onMouseEnter={() => setSlashSel(i)}
                onClick={() => pickSlash(c.cmd)}
              >
                <span className="slash-cmd">/{c.cmd}</span>
                <span className="slash-desc">{c.desc}</span>
              </button>
            ))}
          </div>
        )}
        {showMention && (
          <div className="slash-menu chat-slash" onPointerDown={(e) => e.preventDefault()}>
            <div className="slash-hint">Reference an object</div>
            {mentionItems.map((m, i) => (
              <button
                key={m.id}
                className={i === mentionSelClamped ? 'active' : ''}
                onMouseEnter={() => setMentionSel(i)}
                onClick={() => pickMention(m)}
              >
                <span className="slash-cmd">
                  {m.icon} {m.label.length > 28 ? m.label.slice(0, 28) + '…' : m.label}
                </span>
                <span className="slash-desc">{m.kind}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="Message the assistant…  (/ commands · @ reference · Enter to send)"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSlashDismissed(false);
            setSlashSel(0);
            setMentionDismissed(false);
            setMentionSel(0);
          }}
          onKeyDown={onKeyDown}
        />
        <button className="chrome-btn primary" disabled={busy || !input.trim()} onClick={() => void send()}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

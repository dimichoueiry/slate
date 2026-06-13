import { useEffect, useMemo, useState } from 'react';
import type { Controller } from '../engine/controller';
import { useUI } from '../store/ui';

type OllamaModel = { name: string };

const OLLAMA_BASE = 'http://localhost:11434';

export default function LocalAiPanel({
  ctl,
  onInsertIntoNote,
}: {
  ctl: Controller;
  onInsertIntoNote: (text: string) => void;
}) {
  const model = useUI((s) => s.localAiModel);
  const systemPrompt = useUI((s) => s.localAiSystemPrompt);
  const selection = useUI((s) => s.selection);
  const docVersion = useUI((s) => s.docVersion);
  const set = useUI((s) => s.set);

  const [models, setModels] = useState<OllamaModel[]>([]);
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState('');

  const selectedText = useMemo(() => {
    const bits: string[] = [];
    for (const o of ctl.selectedObjects()) {
      if (o.type === 'text' || o.type === 'sticky') bits.push(o.text.trim());
      else if (o.type === 'shape') bits.push((o.text ?? '').trim());
      else if (o.type === 'connector') bits.push((o.label ?? '').trim());
    }
    return bits.filter(Boolean).join('\n');
  }, [ctl, selection, docVersion]);

  const fetchModels = async () => {
    try {
      setError(null);
      const r = await fetch(`${OLLAMA_BASE}/api/tags`);
      if (!r.ok) throw new Error(`Ollama unavailable (${r.status})`);
      const data = (await r.json()) as { models?: OllamaModel[] };
      const list = data.models ?? [];
      setModels(list);
      if (list.length > 0 && !list.some((m) => m.name === model)) {
        set({ localAiModel: list[0].name });
      }
    } catch (e: any) {
      setModels([]);
      setError(
        e?.message ??
          'Could not reach Ollama. Start it with `ollama serve`, then pull a model like `ollama pull qwen2.5:3b`.'
      );
    }
  };

  useEffect(() => {
    void fetchModels();
  }, []);

  const requestModel = async (finalPrompt: string): Promise<string> => {
    const fullPrompt = selectedText
      ? `Selected canvas text:\n${selectedText}\n\nTask:\n${finalPrompt}`
      : finalPrompt;
    const r = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        system: systemPrompt.trim() || undefined,
        prompt: fullPrompt,
        stream: false,
        options: { temperature: 0.3 },
      }),
    });
    const data = (await r.json()) as { response?: string; error?: string };
    if (!r.ok || data.error) throw new Error(data.error || `Generation failed (${r.status})`);
    return (data.response ?? '').trim();
  };

  const run = async () => {
    const finalPrompt = prompt.trim();
    if (!finalPrompt || busy) return;
    setBusy(true);
    setError(null);
    setResult('');
    try {
      setResult(await requestModel(finalPrompt));
    } catch (e: any) {
      const msg = e?.message ?? 'Generation failed.';
      if (String(msg).toLowerCase().includes('model') && String(msg).toLowerCase().includes('not found')) {
        setError(`${msg} Pull it first, e.g. \`ollama pull ${model}\`.`);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="local-ai local-ai-embedded">
        <div className="local-ai-head">
          <strong>Local AI (Ollama)</strong>
        </div>
        <div className="local-ai-row">
          <label>Model</label>
          <select
            value={models.some((m) => m.name === model) ? model : '__custom__'}
            onChange={(e) => {
              const next = e.target.value;
              if (next === '__custom__') return;
              set({ localAiModel: next });
            }}
          >
            {models.length === 0 && <option value="__custom__">No local models found</option>}
            {models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
            <option value="__custom__">Custom model...</option>
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
            placeholder="Optional override, e.g. qwen2.5:3b"
            spellCheck={false}
          />
          <button className="chrome-btn" disabled={!customModel.trim()} onClick={() => set({ localAiModel: customModel.trim() })}>
            Use
          </button>
        </div>
        {models.length > 0 && (
          <div className="local-ai-models">
            {models.slice(0, 8).map((m) => (
              <button
                key={m.name}
                className={`chrome-btn ${m.name === model ? 'primary' : ''}`}
                onClick={() => set({ localAiModel: m.name })}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
        <textarea
          className="local-ai-system"
          placeholder="System prompt (how the assistant should behave)"
          value={systemPrompt}
          onChange={(e) => set({ localAiSystemPrompt: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <textarea
          className="local-ai-prompt"
          placeholder="Ask your local model anything…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="local-ai-actions">
          <button className="chrome-btn primary" disabled={busy || !prompt.trim()} onClick={() => void run()}>
            {busy ? 'Running…' : 'Run'}
          </button>
          <button className="chrome-btn" disabled={!result} onClick={() => ctl.addTextAtCenter(result)}>
            Insert on canvas
          </button>
          <button className="chrome-btn" disabled={!result} onClick={() => onInsertIntoNote(result)}>
            Insert into note
          </button>
        </div>
        {selectedText && <div className="local-ai-hint">Using selected object text as context.</div>}
        {error && <div className="local-ai-error">{error}</div>}
        <textarea
          className="local-ai-result"
          placeholder="Model output appears here…"
          value={result}
          onChange={(e) => setResult(e.target.value)}
        />
    </div>
  );
}

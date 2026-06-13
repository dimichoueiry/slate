import { useEffect, useMemo, useState } from 'react';
import {
  activeProvider,
  DEFAULT_IMAGE_MODEL,
  getImageModel,
  setImageModel,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
  getOllamaModel,
  getOllamaUrl,
  getOpenRouterKey,
  getOpenRouterModel,
  setOllamaModel,
  setOllamaUrl,
  setOpenRouterKey,
  setOpenRouterModel,
} from '../ai/llm';

interface ModelInfo {
  id: string;
  name: string;
  img?: boolean; // can output images
}

const FALLBACK_IMAGE_MODELS: ModelInfo[] = [
  { id: 'google/gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', img: true },
  { id: 'google/gemini-2.5-flash-image-preview', name: 'Gemini 2.5 Flash Image (preview)', img: true },
];

const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
  { id: 'mistralai/mistral-large', name: 'Mistral Large' },
  { id: 'openrouter/auto', name: 'Auto (router decides)' },
];

let modelCache: ModelInfo[] | null = null;

async function fetchModels(): Promise<ModelInfo[]> {
  if (modelCache) return modelCache;
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json();
  const models: ModelInfo[] = (data?.data ?? [])
    .map((m: any) => ({
      id: String(m.id),
      name: String(m.name ?? m.id),
      img: Array.isArray(m?.architecture?.output_modalities) && m.architecture.output_modalities.includes('image'),
    }))
    .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id));
  if (models.length) modelCache = models;
  return models;
}

const CSS = `
.slate-settings-fab{position:fixed;top:12px;right:12px;z-index:40;width:38px;height:38px;border:none;border-radius:10px;background:rgba(28,28,32,.92);color:#e8e8ea;font-size:17px;cursor:pointer;box-shadow:0 4px 24px rgba(0,0,0,.22);backdrop-filter:blur(12px)}
.slate-settings-fab:hover{background:#3c78ff}
.slate-settings-backdrop{position:fixed;inset:0;background:rgba(10,10,14,.35);z-index:120;display:flex;align-items:flex-start;justify-content:center;padding-top:8vh}
.slate-settings{width:min(460px,92vw);max-height:84vh;overflow-y:auto;background:rgba(28,28,32,.96);color:#e8e8ea;border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,.35);backdrop-filter:blur(16px);padding:18px;font-size:13px}
.slate-settings h2{margin:0 0 4px;font-size:16px}
.slate-settings .sub{color:#9a9aa2;font-size:12px;margin-bottom:14px}
.slate-settings h3{margin:16px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#9a9aa2}
.slate-settings label{display:block;font-size:11.5px;color:#9a9aa2;margin:8px 0 3px}
.slate-settings input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.08);border:none;border-radius:8px;color:#e8e8ea;padding:8px 10px;font-size:13px;outline:none}
.slate-settings input:focus{box-shadow:0 0 0 1.5px #3c78ff}
.slate-settings .row{display:flex;gap:8px;margin-top:14px;justify-content:flex-end}
.slate-settings button{border:none;border-radius:8px;padding:7px 12px;font-size:12.5px;cursor:pointer;background:rgba(255,255,255,.08);color:#e8e8ea}
.slate-settings button:hover{background:rgba(255,255,255,.16)}
.slate-settings button.primary{background:#3c78ff;color:#fff}
.slate-settings button.danger{background:rgba(224,49,49,.25)}
.slate-settings .badge{display:inline-block;padding:3px 8px;border-radius:6px;font-size:11px;background:rgba(47,158,68,.25);color:#7ce29a}
.slate-settings .badge.local{background:rgba(255,212,59,.18);color:#ffd43b}
.slate-model-list{margin-top:6px;max-height:180px;overflow-y:auto;border-radius:8px;background:rgba(255,255,255,.04)}
.slate-model-list button{display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;border-radius:0;background:transparent;padding:6px 10px;font-size:12px}
.slate-model-list button:hover{background:rgba(60,120,255,.25)}
.slate-model-list button.sel{background:rgba(60,120,255,.4);color:#fff}
.slate-model-list .mid{color:#9a9aa2;font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%}
.slate-model-count{font-size:10.5px;color:#9a9aa2;margin-top:4px}
`;

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState(false);
  const [model, setModel] = useState('');
  const [filter, setFilter] = useState('');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [imageModel, setImageModelState] = useState('');
  const [imgFilter, setImgFilter] = useState('');
  const [ollamaUrl, setOllamaUrlState] = useState('');
  const [ollamaModel, setOllamaModelState] = useState('');

  useEffect(() => {
    if (!open) return;
    setKey(getOpenRouterKey() ?? '');
    setSavedKey(!!getOpenRouterKey());
    setModel(getOpenRouterModel());
    setFilter('');
    setImageModelState(getImageModel());
    setImgFilter('');
    setOllamaUrlState(getOllamaUrl());
    setOllamaModelState(getOllamaModel());
    fetchModels()
      .then((m) => {
        setModels(m);
        setLoadErr(false);
      })
      .catch(() => {
        setModels(FALLBACK_MODELS);
        setLoadErr(true);
      });
  }, [open]);

  const imgList = useMemo(() => {
    const source = (models ?? []).filter((m) => m.img);
    const base = source.length ? source : FALLBACK_IMAGE_MODELS;
    const q = imgFilter.trim().toLowerCase();
    const filtered = q
      ? base.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      : base;
    return filtered.slice(0, 40);
  }, [models, imgFilter]);

  const list = useMemo(() => {
    const source = models ?? FALLBACK_MODELS;
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? source.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      : source;
    return filtered.slice(0, 60);
  }, [models, filter]);

  const save = () => {
    setOpenRouterKey(key.trim() || null);
    setOpenRouterModel(model.trim() || null);
    setImageModel(imageModel.trim() === DEFAULT_IMAGE_MODEL ? null : imageModel.trim() || null);
    setOllamaUrl(ollamaUrl.trim() === DEFAULT_OLLAMA_URL ? null : ollamaUrl.trim() || null);
    setOllamaModel(ollamaModel.trim() === DEFAULT_OLLAMA_MODEL ? null : ollamaModel.trim() || null);
    setOpen(false);
  };

  return (
    <>
      <style>{CSS}</style>
      <button className="slate-settings-fab" title="Settings (AI providers)" onClick={() => setOpen(true)}>
        ⚙
      </button>
      {open && (
        <div className="slate-settings-backdrop" onPointerDown={() => setOpen(false)}>
          <div
            className="slate-settings"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
            }}
          >
            <h2>Settings</h2>
            <div className="sub">
              AI provider:{' '}
              {activeProvider() === 'openrouter' ? (
                <span className="badge">OpenRouter</span>
              ) : (
                <span className="badge local">Local Ollama</span>
              )}
            </div>

            <h3>OpenRouter</h3>
            <label>API key {savedKey ? '(saved)' : ''}</label>
            <input type="password" placeholder="sk-or-v1-…" value={key} autoFocus onChange={(e) => setKey(e.target.value)} />

            <label>
              Model — selected: <b style={{ color: '#e8e8ea' }}>{model || 'none'}</b>
            </label>
            <input
              placeholder="Search models… (e.g. claude, gpt, llama)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="slate-model-list">
              {list.map((m) => (
                <button key={m.id} className={m.id === model ? 'sel' : ''} onClick={() => setModel(m.id)}>
                  <span>{m.name}</span>
                  <span className="mid">{m.id}</span>
                </button>
              ))}
              {list.length === 0 && <button disabled>No models match</button>}
            </div>
            <div className="slate-model-count">
              {models ? `${models.length} models from openrouter.ai` : 'loading model list…'}
              {loadErr ? ' (offline — showing common models)' : ''}
              {filter && ` · showing ${list.length}`}
            </div>

            <label>
              Image model (for img: nodes) — selected: <b style={{ color: '#e8e8ea' }}>{imageModel || DEFAULT_IMAGE_MODEL}</b>
            </label>
            <input
              placeholder="Search image-capable models…"
              value={imgFilter}
              onChange={(e) => setImgFilter(e.target.value)}
            />
            <div className="slate-model-list">
              {imgList.map((m) => (
                <button key={m.id} className={m.id === imageModel ? 'sel' : ''} onClick={() => setImageModelState(m.id)}>
                  <span>{m.name}</span>
                  <span className="mid">{m.id}</span>
                </button>
              ))}
              {imgList.length === 0 && <button disabled>No image models match</button>}
            </div>

            <h3>Local Ollama (fallback)</h3>
            <label>Server URL</label>
            <input placeholder={DEFAULT_OLLAMA_URL} value={ollamaUrl} onChange={(e) => setOllamaUrlState(e.target.value)} />
            <label>Model</label>
            <input placeholder={DEFAULT_OLLAMA_MODEL} value={ollamaModel} onChange={(e) => setOllamaModelState(e.target.value)} />

            <div className="row">
              {savedKey && (
                <button
                  className="danger"
                  onClick={() => {
                    setOpenRouterKey(null);
                    setKey('');
                    setSavedKey(false);
                  }}
                >
                  Remove key
                </button>
              )}
              <button onClick={() => setOpen(false)}>Cancel</button>
              <button className="primary" onClick={save}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

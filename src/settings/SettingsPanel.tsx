import { useEffect, useMemo, useState } from 'react';
import {
  activeProvider,
  DEFAULT_IMAGE_MODEL,
  getImageModel,
  setImageModel,
  DEFAULT_VIDEO_MODEL,
  getVideoModel,
  setVideoModel,
  listVideoModels,
  type VideoModelInfo,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
  getOllamaModel,
  getOllamaUrl,
  getOpenRouterKey,
  getOpenRouterModel,
  getMaxTokens,
  setMaxTokens,
  getMaxRounds,
  setMaxRounds,
  DEFAULT_MAX_ROUNDS,
  setOllamaModel,
  setOllamaUrl,
  setOpenRouterKey,
  setOpenRouterModel,
} from '../ai/llm';
import type { BrandKit } from '../types';
import { listBrandKits, getDefaultKitId, setDefaultKitId } from '../store/db';
import { BrandKitEditor, blankKit } from '../components/BrandKit';
import {
  BASE_PROMPT_LABELS,
  DEFAULT_BASE_PROMPTS,
  getAllBasePrompts,
  setBasePrompt,
  type PromptNode,
} from '../ai/basePrompts';

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
.slate-settings-fab{position:fixed;top:12px;right:12px;z-index:40;width:38px;height:38px;border:none;border-radius:10px;background:var(--surface);color:var(--text);font-size:17px;cursor:pointer;box-shadow:0 4px 24px rgba(0,0,0,.22);backdrop-filter:blur(12px)}
.slate-settings-fab:hover{background:var(--accent)}
.slate-settings-backdrop{position:fixed;inset:0;background:rgba(10,10,14,.35);z-index:120;display:flex;align-items:flex-start;justify-content:center;padding-top:8vh}
.slate-settings{width:min(460px,92vw);max-height:84vh;overflow-y:auto;background:var(--surface);color:var(--text);border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,.35);backdrop-filter:blur(16px);padding:18px;font-size:13px}
.slate-settings h2{margin:0 0 4px;font-size:16px}
.slate-settings .sub{color:var(--text-dim);font-size:12px;margin-bottom:14px}
.slate-settings h3{margin:16px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--text-dim)}
.slate-settings label{display:block;font-size:11.5px;color:var(--text-dim);margin:8px 0 3px}
.slate-settings input{width:100%;box-sizing:border-box;background:var(--surface-2);border:none;border-radius:8px;color:var(--text);padding:8px 10px;font-size:13px;outline:none}
.slate-settings input:focus{box-shadow:0 0 0 1.5px var(--accent)}
.slate-settings .row{display:flex;gap:8px;margin-top:14px;justify-content:flex-end}
.slate-settings button{border:none;border-radius:8px;padding:7px 12px;font-size:12.5px;cursor:pointer;background:var(--surface-2);color:var(--text)}
.slate-settings button:hover{background:rgba(255,255,255,.16)}
.slate-settings button.primary{background:var(--accent);color:#fff}
.slate-settings button.danger{background:rgba(224,49,49,.25)}
.slate-settings .badge{display:inline-block;padding:3px 8px;border-radius:6px;font-size:11px;background:rgba(47,158,68,.25);color:#7ce29a}
.slate-settings .badge.local{background:rgba(255,212,59,.18);color:#ffd43b}
.slate-model-trigger{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;background:var(--surface-2);border:none;border-radius:8px;color:var(--text);padding:8px 10px;font-size:13px;cursor:pointer;text-align:left}
.slate-model-trigger:hover{background:rgba(255,255,255,.14)}
.slate-model-trigger>span:first-child{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slate-model-trigger .mid{color:var(--text-dim);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:45%}
.slate-model-trigger .chev{color:var(--text-dim);font-size:9px;flex-shrink:0}
.slate-model-list{margin-top:6px;max-height:180px;overflow-y:auto;border-radius:8px;background:rgba(255,255,255,.04)}
.slate-model-list button{display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;border-radius:0;background:transparent;padding:6px 10px;font-size:12px}
.slate-model-list button:hover{background:rgba(60,120,255,.25)}
.slate-model-list button.sel{background:rgba(60,120,255,.4);color:#fff}
.slate-model-list .mid{color:var(--text-dim);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%}
.slate-model-count{font-size:10.5px;color:var(--text-dim);margin-top:4px}
.settings-kits{display:flex;flex-direction:column;gap:5px;margin-top:6px}
.settings-kit{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.05);border-radius:8px;padding:6px 9px;font-size:12.5px}
.settings-kit .kdot{width:11px;height:11px;border-radius:50%;flex-shrink:0}
.settings-kit .kname{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.settings-kit .kdef{font-size:10px;color:#7ce29a;background:rgba(47,158,68,.18);border-radius:6px;padding:1px 6px}
.settings-kit button{border:none;background:var(--surface-2);color:var(--text);border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer}
.settings-kit button:hover:not(:disabled){background:var(--accent)}
.settings-kit button:disabled{opacity:.4;cursor:default}
.settings-newkit{border:1px dashed rgba(255,255,255,.2);background:transparent;color:var(--text-dim);border-radius:8px;padding:7px;font-size:12px;cursor:pointer}
.settings-newkit:hover{border-color:var(--accent);color:var(--accent)}
.slate-settings textarea{width:100%;box-sizing:border-box;background:var(--border);border:none;border-radius:8px;color:var(--text);padding:8px 10px;font:12px/1.5 inherit;outline:none;resize:vertical}
.slate-settings textarea:focus{box-shadow:0 0 0 1.5px var(--accent)}
`;

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [imgOpen, setImgOpen] = useState(false);
  const [model, setModel] = useState('');
  const [filter, setFilter] = useState('');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [imageModel, setImageModelState] = useState('');
  const [imgFilter, setImgFilter] = useState('');
  const [vidOpen, setVidOpen] = useState(false);
  const [videoModel, setVideoModelState] = useState('');
  const [vidFilter, setVidFilter] = useState('');
  const [vidModels, setVidModels] = useState<VideoModelInfo[] | null>(null);
  const [ollamaUrl, setOllamaUrlState] = useState('');
  const [ollamaModel, setOllamaModelState] = useState('');
  const [maxTokens, setMaxTokensState] = useState('');
  const [maxRounds, setMaxRoundsState] = useState('');
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [defaultKit, setDefaultKit] = useState<string | null>(null);
  const [editingKit, setEditingKit] = useState<BrandKit | null>(null);
  const [basePrompts, setBasePrompts] = useState<Record<PromptNode, string>>(DEFAULT_BASE_PROMPTS);
  const [promptsOpen, setPromptsOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKey(getOpenRouterKey() ?? '');
    setSavedKey(!!getOpenRouterKey());
    setModel(getOpenRouterModel());
    setModelOpen(false);
    setImgOpen(false);
    setFilter('');
    setImageModelState(getImageModel());
    setImgFilter('');
    setVideoModelState(getVideoModel());
    setVidFilter('');
    setVidOpen(false);
    if (getOpenRouterKey()) listVideoModels().then(setVidModels).catch(() => setVidModels([]));
    else setVidModels([]);
    setOllamaUrlState(getOllamaUrl());
    setOllamaModelState(getOllamaModel());
    setMaxTokensState(getMaxTokens() != null ? String(getMaxTokens()) : '');
    setMaxRoundsState(String(getMaxRounds()));
    void listBrandKits().then(setKits);
    setDefaultKit(getDefaultKitId());
    setBasePrompts(getAllBasePrompts());
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

  const vidList = useMemo(() => {
    const base = vidModels ?? [];
    const q = vidFilter.trim().toLowerCase();
    const filtered = q
      ? base.filter((m) => m.id.toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q))
      : base;
    return filtered.slice(0, 40);
  }, [vidModels, vidFilter]);

  const selVidName = (vidModels ?? []).find((m) => m.id === (videoModel || DEFAULT_VIDEO_MODEL))?.name ?? (videoModel || DEFAULT_VIDEO_MODEL);

  const list = useMemo(() => {
    const source = models ?? FALLBACK_MODELS;
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? source.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      : source;
    return filtered.slice(0, 60);
  }, [models, filter]);

  const nameOf = (id: string, fallbacks: ModelInfo[]) =>
    (models ?? fallbacks).find((m) => m.id === id)?.name ?? id;
  const selModelName = model ? nameOf(model, FALLBACK_MODELS) : 'Select a model';
  const selImgName = nameOf(imageModel || DEFAULT_IMAGE_MODEL, FALLBACK_IMAGE_MODELS);

  const save = () => {
    setOpenRouterKey(key.trim() || null);
    setOpenRouterModel(model.trim() || null);
    setImageModel(imageModel.trim() === DEFAULT_IMAGE_MODEL ? null : imageModel.trim() || null);
    setVideoModel(videoModel.trim() === DEFAULT_VIDEO_MODEL ? null : videoModel.trim() || null);
    setOllamaUrl(ollamaUrl.trim() === DEFAULT_OLLAMA_URL ? null : ollamaUrl.trim() || null);
    setOllamaModel(ollamaModel.trim() === DEFAULT_OLLAMA_MODEL ? null : ollamaModel.trim() || null);
    setMaxTokens(maxTokens.trim() ? Number(maxTokens) : null);
    setMaxRounds(maxRounds.trim() && Number(maxRounds) !== DEFAULT_MAX_ROUNDS ? Number(maxRounds) : null);
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

            <label>Model</label>
            <button type="button" className="slate-model-trigger" onClick={() => setModelOpen((o) => !o)}>
              <span>{selModelName}</span>
              <span className="mid">{model || 'none'}</span>
              <span className="chev">{modelOpen ? '▲' : '▼'}</span>
            </button>
            {modelOpen && (
              <>
                <input
                  placeholder="Search models… (e.g. claude, gpt, llama)"
                  value={filter}
                  autoFocus
                  onChange={(e) => setFilter(e.target.value)}
                />
                <div className="slate-model-list">
                  {list.map((m) => (
                    <button
                      key={m.id}
                      className={m.id === model ? 'sel' : ''}
                      onClick={() => {
                        setModel(m.id);
                        setModelOpen(false);
                      }}
                    >
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
              </>
            )}

            <label>Image model (for img: nodes)</label>
            <button type="button" className="slate-model-trigger" onClick={() => setImgOpen((o) => !o)}>
              <span>{selImgName}</span>
              <span className="mid">{imageModel || DEFAULT_IMAGE_MODEL}</span>
              <span className="chev">{imgOpen ? '▲' : '▼'}</span>
            </button>
            {imgOpen && (
              <>
                <input
                  placeholder="Search image-capable models…"
                  value={imgFilter}
                  autoFocus
                  onChange={(e) => setImgFilter(e.target.value)}
                />
                <div className="slate-model-list">
                  {imgList.map((m) => (
                    <button
                      key={m.id}
                      className={m.id === imageModel ? 'sel' : ''}
                      onClick={() => {
                        setImageModelState(m.id);
                        setImgOpen(false);
                      }}
                    >
                      <span>{m.name}</span>
                      <span className="mid">{m.id}</span>
                    </button>
                  ))}
                  {imgList.length === 0 && <button disabled>No image models match</button>}
                </div>
              </>
            )}

            <label>Video model (for vid: nodes)</label>
            <button type="button" className="slate-model-trigger" onClick={() => setVidOpen((o) => !o)}>
              <span>{selVidName}</span>
              <span className="mid">{videoModel || DEFAULT_VIDEO_MODEL}</span>
              <span className="chev">{vidOpen ? '▲' : '▼'}</span>
            </button>
            {vidOpen && (
              <>
                <input placeholder="Search video models…" value={vidFilter} autoFocus onChange={(e) => setVidFilter(e.target.value)} />
                <div className="slate-model-list">
                  {vidList.map((m) => (
                    <button
                      key={m.id}
                      className={m.id === videoModel ? 'sel' : ''}
                      onClick={() => {
                        setVideoModelState(m.id);
                        setVidOpen(false);
                      }}
                    >
                      <span>{m.name ?? m.id}</span>
                      <span className="mid">
                        {m.id}
                        {m.pricing_skus?.generate ? ` · $${m.pricing_skus.generate}/clip` : ''}
                      </span>
                    </button>
                  ))}
                  {vidList.length === 0 && (
                    <button disabled>{getOpenRouterKey() ? 'No video models found' : 'Add an API key to load video models'}</button>
                  )}
                </div>
              </>
            )}

            <label>Max response length (tokens)</label>
            <input
              type="number"
              min={1}
              placeholder="No limit — use the model's full budget"
              value={maxTokens}
              onChange={(e) => setMaxTokensState(e.target.value)}
            />
            <div className="slate-model-count">
              Caps how long any single AI response can be. Leave blank for no limit. Higher = longer, more complete
              answers (and higher cost); too low can cut answers off — that's what was breaking /business.
            </div>

            <label>Max agent steps (tool rounds)</label>
            <input
              type="number"
              min={1}
              placeholder={String(DEFAULT_MAX_ROUNDS)}
              value={maxRounds}
              onChange={(e) => setMaxRoundsState(e.target.value)}
            />
            <div className="slate-model-count">
              How many tool calls a tool-using agent (e.g. /business) may make before it must stop and answer.
              Raise this for complex multi-step analysis; lower it to bound cost. Default {DEFAULT_MAX_ROUNDS}.
            </div>

            <h3>Local Ollama (fallback)</h3>
            <label>Server URL</label>
            <input placeholder={DEFAULT_OLLAMA_URL} value={ollamaUrl} onChange={(e) => setOllamaUrlState(e.target.value)} />
            <label>Model</label>
            <input placeholder={DEFAULT_OLLAMA_MODEL} value={ollamaModel} onChange={(e) => setOllamaModelState(e.target.value)} />

            <h3>Brand kits</h3>
            <div className="settings-kits">
              {kits.map((k) => (
                <div key={k.id} className="settings-kit">
                  <span className="kdot" style={{ background: k.palette[0] ?? '#555' }} />
                  <span className="kname">{k.name}</span>
                  {defaultKit === k.id && <span className="kdef">default</span>}
                  <button onClick={() => setEditingKit(k)}>Edit</button>
                  <button onClick={() => { setDefaultKitId(k.id); setDefaultKit(k.id); }} disabled={defaultKit === k.id}>
                    Set default
                  </button>
                </div>
              ))}
              {kits.length === 0 && <div style={{ color: '#8d8d96', fontSize: 12 }}>No brand kits yet.</div>}
              <button className="settings-newkit" onClick={() => setEditingKit(blankKit())}>＋ New brand kit</button>
            </div>

            <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setPromptsOpen((o) => !o)}>
              <span>{promptsOpen ? '▾' : '▸'} Node base prompts</span>
            </h3>
            {promptsOpen && (
              <div className="settings-prompts">
                <div style={{ color: '#8d8d96', fontSize: 11, marginBottom: 6 }}>
                  Tune the base system prompt for each free-form node type. Brand voice is still appended on top.
                </div>
                {(Object.keys(BASE_PROMPT_LABELS) as PromptNode[]).map((n) => (
                  <div key={n} style={{ marginBottom: 8 }}>
                    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{BASE_PROMPT_LABELS[n]}</span>
                      {basePrompts[n] !== DEFAULT_BASE_PROMPTS[n] && (
                        <button
                          style={{ border: 'none', background: 'transparent', color: '#7aa5ff', cursor: 'pointer', fontSize: 11 }}
                          onClick={() => {
                            setBasePrompt(n, null);
                            setBasePrompts((p) => ({ ...p, [n]: DEFAULT_BASE_PROMPTS[n] }));
                          }}
                        >
                          reset
                        </button>
                      )}
                    </label>
                    <textarea
                      style={{ minHeight: 64 }}
                      value={basePrompts[n]}
                      onChange={(e) => {
                        const v = e.target.value;
                        setBasePrompts((p) => ({ ...p, [n]: v }));
                        setBasePrompt(n, v);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

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
      {editingKit && (
        <BrandKitEditor
          kit={editingKit}
          onClose={() => setEditingKit(null)}
          afterChange={() => void listBrandKits().then(setKits)}
        />
      )}
    </>
  );
}

import { useState } from 'react';
import { useUI } from '../store/ui';
import type { ShapeObj } from '../types';
import type { Controller } from '../engine/controller';
import { activeProvider, getOpenRouterModel } from './llm';
import { aiEditSelection } from './aiEdit';

const CSS = `
.slate-ai-pill{position:fixed;bottom:64px;left:50%;transform:translateX(-50%);z-index:45;border:none;border-radius:50%;width:40px;height:40px;background:var(--accent);color:var(--on-accent);font-size:17px;cursor:pointer;box-shadow:var(--shadow);backdrop-filter:blur(14px);transition:background var(--dur) var(--ease-out)}
.slate-ai-pill:hover{background:var(--violet-2)}
.slate-ai-pill.input{margin-left:52px;font-size:15px;background:var(--surface);color:var(--text);border:1px solid var(--border)}
.slate-ai-pill.input:hover{background:var(--surface-hover)}
.slate-ai-bar{position:fixed;bottom:64px;left:50%;transform:translateX(-50%);z-index:45;display:flex;align-items:center;gap:8px;background:var(--surface);border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.28);backdrop-filter:blur(14px);padding:8px 10px;width:min(560px,92vw)}
.slate-ai-bar .spark{font-size:15px;flex-shrink:0}
.slate-ai-bar input{flex:1;background:transparent;border:none;outline:none;color:var(--text);font-size:13px}
.slate-ai-bar button{border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:12.5px;padding:6px 12px;cursor:pointer;flex-shrink:0}
.slate-ai-bar button:disabled{opacity:.5;cursor:default}
.slate-ai-bar .who{font-size:10px;color:var(--text-dim);flex-shrink:0}
.slate-ai-note{position:fixed;bottom:36px;left:50%;transform:translateX(-50%);z-index:45;font-size:11.5px;color:var(--text-dim);background:var(--surface);padding:3px 10px;border-radius:8px}
.slate-ai-note.err{color:#ff8787}
`;

export default function AIPanel({ ctl }: { ctl: Controller }) {
  const selCount = useUI((s) => s.selection.length);
  const editing = useUI((s) => s.editingTextId);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState<{ text: string; err?: boolean } | null>(null);

  if (editing) return null;
  if (selCount === 0 && !expanded && !busy) {
    return (
      <>
        <style>{CSS}</style>
        <button className="slate-ai-pill" title="Ask AI to create something (nothing selected = create mode)" onClick={() => setExpanded(true)}>
          ✨
        </button>
        <button
          className="slate-ai-pill input"
          title="Add an input field — a box you type into (great as ai:/img: node input)"
          onClick={() => {
            const cam = ctl.camera;
            const cx = cam.x + ctl.viewW / 2 / cam.zoom;
            const cy = cam.y + ctl.viewH / 2 / cam.zoom;
            const obj: ShapeObj = {
              id: Math.random().toString(36).slice(2, 10),
              type: 'shape',
              shape: 'roundedRect',
              x: cx - 140,
              y: cy - 32,
              w: 280,
              h: 64,
              rotation: 0,
              z: ctl.doc.nextZ(),
              fill: '#ffffff',
              stroke: '#c9c9cf',
              strokeWidth: 1.5,
              dash: 'solid',
              radius: 10,
              opacity: 1,
              text: '',
              textColor: '#1a1a1a',
              fontSize: 16,
            };
            ctl.doc.set(obj);
            ctl.selectIds([obj.id]);
            useUI.getState().set({ tool: 'select', editingTextId: obj.id });
          }}
        >
          ⌶
        </button>
        {note && <div className={`slate-ai-note${note.err ? ' err' : ''}`}>{note.text}</div>}
      </>
    );
  }

  const run = async () => {
    const instruction = prompt.trim();
    if (!instruction || busy) return;
    setBusy(true);
    setNote({ text: `Asking ${activeProvider() === 'openrouter' ? 'OpenRouter' : 'local model'}…` });
    try {
      const res = await aiEditSelection(ctl, instruction);
      const parts = [
        res.applied > 0 ? `edited ${res.applied}` : '',
        res.created > 0 ? `created ${res.created}` : '',
        res.deleted > 0 ? `deleted ${res.deleted}` : '',
      ].filter(Boolean);
      setNote({ text: parts.length ? `AI ${parts.join(' · ')} — ⌘Z undoes it` : 'AI made no changes' });
      setExpanded(false);
      setPrompt('');
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), err: true });
    } finally {
      setBusy(false);
      setTimeout(() => setNote(null), 6000);
    }
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="slate-ai-bar" onPointerDown={(e) => e.stopPropagation()}>
        <span className="spark">✨</span>
        <input
          placeholder={
            selCount > 0
              ? `Ask AI to edit or build on the ${selCount} selected object${selCount === 1 ? '' : 's'}…`
              : 'Ask AI to create something on the canvas…'
          }
          autoFocus={selCount === 0}
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') void run();
            if (e.key === 'Escape') setExpanded(false);
          }}
        />
        <span className="who">{activeProvider() === 'openrouter' ? getOpenRouterModel().split('/').pop() : 'Ollama'}</span>
        {selCount === 0 && (
          <button style={{ background: 'var(--surface-hover)' }} onClick={() => setExpanded(false)}>
            ✕
          </button>
        )}
        <button disabled={busy || !prompt.trim()} onClick={() => void run()}>
          {busy ? 'Thinking…' : 'Apply'}
        </button>
      </div>
      {note && <div className={`slate-ai-note${note.err ? ' err' : ''}`}>{note.text}</div>}
    </>
  );
}

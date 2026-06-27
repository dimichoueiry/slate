import { useState } from 'react';
import { useUI } from '../store/ui';

const CSS = `
.slate-usage{position:fixed;right:12px;bottom:56px;z-index:30}
.slate-usage-pill{display:flex;align-items:center;gap:6px;background:var(--surface);color:var(--text);border:none;border-radius:9px;box-shadow:0 4px 18px rgba(0,0,0,.22);backdrop-filter:blur(12px);padding:6px 10px;font-size:11.5px;cursor:pointer}
.slate-usage-pill:hover{background:var(--surface-hover)}
.slate-usage-pill .dot{width:6px;height:6px;border-radius:50%;background:#37b24d}
.slate-usage-pop{position:absolute;right:0;bottom:38px;width:230px;background:var(--surface);color:var(--text);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);backdrop-filter:blur(16px);padding:12px 14px;font-size:12px}
.slate-usage-pop h4{margin:0 0 8px;font-size:12px}
.slate-usage-row{display:flex;justify-content:space-between;padding:3px 0;color:var(--text-dim)}
.slate-usage-row b{color:var(--text);font-weight:600}
.slate-usage-pop .sep{height:1px;background:var(--surface-hover);margin:8px 0}
.slate-usage-pop button{width:100%;border:none;background:var(--surface-2);color:var(--text);border-radius:7px;padding:6px;font-size:11.5px;cursor:pointer;margin-top:4px}
.slate-usage-pop button:hover{background:rgba(224,49,49,.25)}
.slate-usage-pop .muted{color:var(--text-dim);font-size:10.5px;margin-top:8px;line-height:1.4}
`;

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

export default function UsageMeter() {
  const usage = useUI((s) => s.usage);
  const resetUsage = useUI((s) => s.resetUsage);
  const [open, setOpen] = useState(false);

  if (usage.calls === 0 && usage.tavilyCredits === 0) return null;
  const totalTokens = usage.promptTokens + usage.completionTokens;

  return (
    <>
      <style>{CSS}</style>
      <div className="slate-usage">
        {open && (
          <div className="slate-usage-pop" onPointerDown={(e) => e.stopPropagation()}>
            <h4>Session usage</h4>
            <div className="slate-usage-row"><span>AI calls</span><b>{usage.calls}</b></div>
            <div className="slate-usage-row"><span>Prompt tokens</span><b>{fmt(usage.promptTokens)}</b></div>
            <div className="slate-usage-row"><span>Output tokens</span><b>{fmt(usage.completionTokens)}</b></div>
            <div className="slate-usage-row"><span>Tavily credits</span><b>{usage.tavilyCredits}</b></div>
            {usage.costUsd > 0 && (
              <>
                <div className="sep" />
                <div className="slate-usage-row"><span>Est. cost</span><b>${usage.costUsd.toFixed(4)}</b></div>
              </>
            )}
            <button onClick={() => resetUsage()}>Reset counter</button>
            <div className="muted">Tracked locally this session. Cost shows when your model reports it (most OpenRouter models do).</div>
          </div>
        )}
        <button className="slate-usage-pill" title="AI usage this session" onClick={() => setOpen((o) => !o)}>
          <span className="dot" />
          {usage.costUsd > 0 ? `$${usage.costUsd.toFixed(3)}` : `${fmt(totalTokens)} tok`}
          {usage.tavilyCredits > 0 ? ` · ${usage.tavilyCredits}cr` : ''}
        </button>
      </div>
    </>
  );
}

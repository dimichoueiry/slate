// Frame title editor (injected): shows whenever the selection contains exactly
// one frame — works even though selecting a frame also selects its contents.
import { createRoot } from 'react-dom/client';
import { useUI } from '../store/ui';

const CSS = `
.slate-frame-title{position:fixed;top:60px;right:12px;z-index:40;display:flex;align-items:center;gap:7px;background:rgba(28,28,32,.94);border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.25);backdrop-filter:blur(12px);padding:7px 10px;font-size:12px;color:#9a9aa2}
.slate-frame-title input{background:rgba(255,255,255,.08);border:none;border-radius:7px;color:#e8e8ea;padding:6px 9px;font-size:12.5px;outline:none;width:160px}
.slate-frame-title input:focus{box-shadow:0 0 0 1.5px #3c78ff}
`;

function FrameTitle() {
  const selection = useUI((s) => s.selection);
  useUI((s) => s.docVersion); // re-render when the doc (incl. frame names) changes
  const editing = useUI((s) => s.editingTextId);

  const ctl = (window as any).__slateCtl;
  if (!ctl || editing) return null;
  const frames = selection
    .map((id: string) => ctl.doc.get(id))
    .filter((o: any) => o && o.type === 'frame');
  if (frames.length !== 1) return null;
  const frame = frames[0];

  return (
    <>
      <style>{CSS}</style>
      <div className="slate-frame-title" onPointerDown={(e) => e.stopPropagation()}>
        <span>⧈ Frame</span>
        <input
          value={frame.name}
          spellCheck={false}
          placeholder="Frame name"
          onChange={(e) => ctl.doc.update(frame.id, { name: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLElement).blur();
          }}
        />
      </div>
    </>
  );
}

const id = 'slate-frame-title-root';
if (!document.getElementById(id)) {
  const el = document.createElement('div');
  el.id = id;
  document.body.appendChild(el);
  createRoot(el).render(<FrameTitle />);
}

export {};

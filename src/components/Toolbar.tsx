import { useEffect, useRef, useState } from 'react';
import { useUI } from '../store/ui';
import type { ToolId } from '../types';
import { readUpload, uploadLabel } from '../ui/upload';
import { UPLOAD_ACCEPT } from '../ui/aiNodeButtons';

const POS_KEY = 'slate-toolbar-pos';
const ORIENT_KEY = 'slate-toolbar-horizontal';

function loadPos(): { x: number; y: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null');
    return v && typeof v.x === 'number' && typeof v.y === 'number' ? v : null;
  } catch {
    return null;
  }
}

const TOOLS: { id: ToolId; icon: string; label: string; key: string }[] = [
  { id: 'select', icon: '⬚', label: 'Select', key: 'V' },
  { id: 'hand', icon: '✋', label: 'Pan', key: 'H' },
  { id: 'pen', icon: '✏️', label: 'Pen', key: 'P' },
  { id: 'eraser', icon: '◌', label: 'Eraser', key: 'E' },
  { id: 'rect', icon: '▭', label: 'Rectangle', key: 'R' },
  { id: 'ellipse', icon: '◯', label: 'Ellipse', key: 'O' },
  { id: 'diamond', icon: '◇', label: 'Diamond', key: 'D' },
  { id: 'line', icon: '╱', label: 'Line', key: 'L' },
  { id: 'connector', icon: '⤳', label: 'Connector / arrow', key: 'C' },
  { id: 'sticky', icon: '🗒', label: 'Sticky note', key: 'S' },
  { id: 'text', icon: 'T', label: 'Text', key: 'T' },
  { id: 'frame', icon: '⧈', label: 'Frame', key: 'F' },
];

export default function Toolbar() {
  const tool = useUI((s) => s.tool);
  const iconTrayOpen = useUI((s) => s.iconTrayOpen);
  const set = useUI((s) => s.set);
  const [pos, setPos] = useState(loadPos);
  const [horizontal, setHorizontal] = useState(() => localStorage.getItem(ORIENT_KEY) === '1');
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggleOrient = () => {
    setHorizontal((h) => {
      const next = !h;
      try {
        localStorage.setItem(ORIENT_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const onUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const ctl = (window as any).__slateCtl;
    if (!file || !ctl) return;
    try {
      const payload = await readUpload(file);
      ctl.addUploadNode(payload, uploadLabel(payload));
    } catch (err) {
      ctl.addTextAtCenter?.(`⚠ Couldn't read ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  useEffect(() => {
    if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
  }, [pos]);

  const onGripDown = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onGripMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const r = ref.current!.getBoundingClientRect();
    setPos({
      x: Math.min(window.innerWidth - r.width - 4, Math.max(4, e.clientX - drag.current.dx)),
      y: Math.min(window.innerHeight - r.height - 4, Math.max(4, e.clientY - drag.current.dy)),
    });
  };
  const onGripUp = () => {
    drag.current = null;
  };

  return (
    <div
      ref={ref}
      className={`panel toolbar${horizontal ? ' horizontal' : ''}`}
      style={pos ? { left: pos.x, top: pos.y, transform: 'none' } : undefined}
    >
      <div
        className="toolbar-grip"
        title="Drag to move (double-click to reset)"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onDoubleClick={() => {
          setPos(null);
          localStorage.removeItem(POS_KEY);
        }}
      >
        ⋮⋮
      </div>
      <button
        className="tool-btn toolbar-rotate"
        title={horizontal ? 'Make toolbar vertical' : 'Make toolbar horizontal'}
        onClick={toggleOrient}
      >
        {horizontal ? '↕' : '↔'}
      </button>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool-btn ${tool === t.id ? 'active' : ''}`}
          title={`${t.label} (${t.key})`}
          onClick={() => set({ tool: t.id })}
        >
          {t.icon}
          <span className="kbd">{t.key}</span>
        </button>
      ))}
      <button
        className={`tool-btn ${iconTrayOpen ? 'active' : ''}`}
        title="Icon library (I)"
        onClick={() => set({ iconTrayOpen: !iconTrayOpen })}
      >
        ✦<span className="kbd">I</span>
      </button>
      <button
        className="tool-btn"
        title="Upload a file (CSV, PDF, text…) as a node AI can read"
        onClick={() => fileRef.current?.click()}
      >
        📎<span className="kbd">U</span>
      </button>
      <input ref={fileRef} type="file" accept={UPLOAD_ACCEPT} hidden onChange={(e) => void onUploadFile(e)} />
    </div>
  );
}

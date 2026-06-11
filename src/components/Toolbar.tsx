import { useEffect, useRef, useState } from 'react';
import { useUI } from '../store/ui';
import type { ToolId } from '../types';

const POS_KEY = 'slate-toolbar-pos';

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
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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
      className="panel toolbar"
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
    </div>
  );
}

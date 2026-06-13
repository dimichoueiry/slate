import { useEffect, useRef, useState } from 'react';

function loadPos(key: string): { x: number; y: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(`slate-panel-${key}`) ?? 'null');
    return v && typeof v.x === 'number' && typeof v.y === 'number' ? v : null;
  } catch {
    return null;
  }
}

/**
 * A chrome panel that can be dragged anywhere by its ⋮⋮ grip.
 * Position persists per panel id; double-click the grip to snap back to default.
 */
export default function FloatingPanel({
  id,
  className,
  children,
}: {
  id: string;
  className: string;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState(() => loadPos(id));
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    if (pos) localStorage.setItem(`slate-panel-${id}`, JSON.stringify(pos));
  }, [id, pos]);

  return (
    <div
      ref={ref}
      className={`panel ${className}`}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', transform: 'none' } : undefined}
    >
      <div
        className="panel-grip"
        title="Drag to move (double-click to reset)"
        onPointerDown={(e) => {
          const r = ref.current!.getBoundingClientRect();
          drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const r = ref.current!.getBoundingClientRect();
          setPos({
            x: Math.min(window.innerWidth - r.width - 4, Math.max(4, e.clientX - drag.current.dx)),
            y: Math.min(window.innerHeight - r.height - 4, Math.max(4, e.clientY - drag.current.dy)),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onDoubleClick={() => {
          setPos(null);
          localStorage.removeItem(`slate-panel-${id}`);
        }}
      >
        ⋮⋮
      </div>
      {children}
    </div>
  );
}

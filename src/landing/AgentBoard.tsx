import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Sticky, Wires, type Rect } from './board-kit';

/* The "Ask your agent" example board — a faithful simulation of the MCP bridge.
   The board opens empty with a docked prompt bar; "Draw the architecture of my
   app" types itself, you hit send, and the agent draws the diagram in front of
   you — object by object, camera following, exactly like the real bridge does.
   Same chrome and board-kit primitives as every other example board. */

const E = [0.16, 1, 0.3, 1] as const;
const ease = 'cubic-bezier(0.16,1,0.3,1)';

const PROMPT = 'Draw the architecture of my app';

type ANote = { id: string; x: number; y: number; w: number; color: string; title: string; body: string };

/* the agent draws Slate's own architecture — the same truth the #agent section tells */
const NOTES: ANote[] = [
  { id: 'app', x: 470, y: 40, w: 180, color: '#A8D8EA', title: 'Browser tab', body: 'The whole app — canvas, boards, everything runs here' },
  { id: 'db', x: 470, y: 230, w: 180, color: '#B5EAD7', title: 'IndexedDB', body: 'Every edit saved locally, instantly. Works offline' },
  { id: 'agent', x: 20, y: 40, w: 160, color: '#FFD6A5', title: 'Claude Code', body: 'Your agent, in the terminal' },
  { id: 'mcp', x: 240, y: 40, w: 170, color: '#FFE066', title: 'MCP bridge', body: 'localhost only · one-time pairing' },
  { id: 'vercel', x: 240, y: 230, w: 170, color: '#F1F0EC', title: 'Vercel', body: 'Ships the app code. Stores nothing' },
  { id: 'gh', x: 700, y: 230, w: 170, color: '#E6D9F2', title: 'Your GitHub repo', body: 'Boards as readable JSON — history, sync, yours' },
];

const WIRES: { from: string; to: string; dashed?: boolean }[] = [
  { from: 'agent', to: 'mcp' },
  { from: 'mcp', to: 'app' },
  { from: 'app', to: 'db' },
  { from: 'vercel', to: 'app', dashed: true },
  { from: 'db', to: 'gh', dashed: true },
];

type Stage = 'typing' | 'ready' | 'drawing' | 'done';

export default function AgentBoard({ onBack }: { onBack: () => void }) {
  const reduce = useReducedMotion();
  const boardRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [view, setView] = useState({ x: 0, y: 0, scale: 0.7 });
  const [grabbing, setGrabbing] = useState(false);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const [stage, setStage] = useState<Stage>(reduce ? 'ready' : 'typing');
  const [typed, setTyped] = useState(reduce ? PROMPT.length : 0);
  const [shown, setShown] = useState(0); // how many NOTES the agent has drawn

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => () => clearTimers(), []);

  // the prompt types itself, then the send button takes over
  useEffect(() => {
    if (stage !== 'typing') return;
    if (typed >= PROMPT.length) {
      setStage('ready');
      return;
    }
    const t = window.setTimeout(() => setTyped((n) => n + 1), 34);
    timers.current.push(t);
    return () => clearTimeout(t);
  }, [stage, typed]);

  const send = () => {
    if (stage !== 'ready') return;
    setStage('drawing');
    if (reduce) {
      setShown(NOTES.length);
      setStage('done');
      return;
    }
    NOTES.forEach((_, i) => {
      const t = window.setTimeout(() => {
        setShown(i + 1);
        if (i === NOTES.length - 1) {
          const done = window.setTimeout(() => setStage('done'), 700);
          timers.current.push(done);
        }
      }, 650 + i * 620);
      timers.current.push(t);
    });
  };
  const skip = () => {
    clearTimers();
    setShown(NOTES.length);
    setStage('done');
  };
  const replay = () => {
    clearTimers();
    setShown(0);
    setTyped(reduce ? PROMPT.length : 0);
    setStage(reduce ? 'ready' : 'typing');
  };

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // measure real sticky sizes so wires hit their actual borders (kit pattern)
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const next: Record<string, { w: number; h: number }> = {};
    let changed = false;
    el.querySelectorAll<HTMLElement>('[data-oid]').forEach((node) => {
      const id = node.dataset.oid;
      if (!id) return;
      next[id] = { w: node.offsetWidth, h: node.offsetHeight };
      const prev = sizesRef.current[id];
      if (!prev || prev.w !== next[id].w || prev.h !== next[id].h) changed = true;
    });
    if (changed) setSizes((s) => ({ ...s, ...next }));
  });

  const rects = useMemo(() => {
    const m: Record<string, Rect> = {};
    NOTES.forEach((n) => (m[n.id] = { x: n.x, y: n.y, w: sizes[n.id]?.w ?? n.w, h: sizes[n.id]?.h ?? 74 }));
    return m;
  }, [sizes]);

  const revealed = NOTES.slice(0, shown);
  const revealedIds = new Set(revealed.map((n) => n.id));
  const wires = WIRES.filter((w) => revealedIds.has(w.from) && revealedIds.has(w.to)).map((w) => ({
    from: rects[w.from],
    to: rects[w.to],
    dashed: w.dashed,
  }));

  // camera: frame what exists — the whole diagram footprint before the run
  // (so the empty paper reads calm), then follow the drawing as it grows
  const viewRef = useRef(view);
  viewRef.current = view;
  const fit = (ids: string[]) => {
    const rs = ids.map((id) => rects[id]).filter(Boolean);
    if (!rs.length || !size.w) return;
    const minX = Math.min(...rs.map((r) => r.x));
    const minY = Math.min(...rs.map((r) => r.y));
    const maxX = Math.max(...rs.map((r) => r.x + r.w));
    const maxY = Math.max(...rs.map((r) => r.y + r.h));
    const padX = 64;
    const padTop = 70;
    const padBottom = 158; // room for the prompt bar floating above the zoom row
    const w = maxX - minX;
    const h = maxY - minY;
    const scale = clamp(Math.min((size.w - 2 * padX) / w, (size.h - padTop - padBottom) / h), 0.4, 1);
    const x = padX + (size.w - 2 * padX - w * scale) / 2 - minX * scale;
    const y = padTop + (size.h - padTop - padBottom - h * scale) / 2 - minY * scale;
    setView({ x, y, scale });
  };
  useEffect(() => {
    fit(shown === 0 ? NOTES.map((n) => n.id) : revealed.map((n) => n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, size, sizes]);

  const zoom = (f: number) => {
    const cx = size.w / 2;
    const cy = size.h / 2;
    setView((v) => {
      const ns = clamp(v.scale * f, 0.3, 1.6);
      const k = ns / v.scale;
      return { scale: ns, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };
  const startPan = (e: React.PointerEvent) => {
    drag.current = { sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y };
    setGrabbing(true);
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
    };
    const up = () => {
      drag.current = null;
      setGrabbing(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  return (
    <div className={`lp-board lp-rb${grabbing ? ' grabbing' : ''}`} ref={boardRef} onPointerDown={startPan}>
      <div
        className="lp-world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0', transition: grabbing ? 'none' : `transform 0.85s ${ease}` }}
      >
        <Wires items={wires} />
        <AnimatePresence>
          {revealed.map((n) => (
            <motion.div
              key={n.id}
              initial={reduce ? false : { opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.45, ease: E }}
              style={{ position: 'absolute', left: 0, top: 0 }}
            >
              <Sticky dataId={n.id} x={n.x} y={n.y} w={n.w} color={n.color} title={n.title} body={n.body} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* chrome — identical to the other example boards */}
      <div className="lp-panel lp-topbar" onPointerDown={(e) => e.stopPropagation()}>
        <button className="lp-tb-btn" onClick={onBack} title="Back to boards" style={{ border: 0, padding: 0, cursor: 'pointer' }}>
          ←
        </button>
        <span className="lp-tb-name">Ask your agent</span>
        <span className="lp-tb-btn">↩</span>
        <span className="lp-tb-btn">↪</span>
        <span className="lp-tb-btn">☾</span>
        <span className="lp-tb-btn primary">Export</span>
      </div>
      <div className="lp-panel lp-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <span className="lp-grip">⋮⋮</span>
        {['⬚', '✏', '▭', '◯', '◇', '⤳', '🗒', 'T', '✦'].map((t, i) => (
          <span key={i} className={`lp-tool${i === 8 ? ' active' : ''}`}>
            {t}
          </span>
        ))}
      </div>
      <div className="lp-panel lp-zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button className="lp-z-btn" style={{ background: 'none', border: 0, color: 'inherit', padding: 0, cursor: 'pointer' }} onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">
          −
        </button>
        <span className="lp-z-pct">{Math.round(view.scale * 100)}%</span>
        <button className="lp-z-btn" style={{ background: 'none', border: 0, color: 'inherit', padding: 0, cursor: 'pointer' }} onClick={() => zoom(1.2)} aria-label="Zoom in">
          ＋
        </button>
        <button
          className="lp-z-btn"
          style={{ background: 'none', border: 0, color: 'inherit', padding: 0, cursor: 'pointer' }}
          onClick={() => fit(shown === 0 ? NOTES.map((n) => n.id) : revealed.map((n) => n.id))}
          aria-label="Reset view"
        >
          ⛶
        </button>
      </div>

      {/* the prompt bar — where the simulation lives */}
      <AnimatePresence>
        {(stage === 'typing' || stage === 'ready') && (
          <motion.div
            className="lp-panel lp-ask"
            onPointerDown={(e) => e.stopPropagation()}
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12, transition: { duration: 0.2 } }}
            transition={{ duration: 0.5, ease: E }}
          >
            <span className="lp-ask-chip">⚡ Claude connected over MCP</span>
            <div className="lp-ask-row">
              <span className="lp-ask-text">
                {PROMPT.slice(0, typed)}
                {stage === 'typing' && <span className="lp-ask-caret" />}
              </span>
              <button className={`lp-ask-send${stage === 'ready' ? ' live' : ''}`} onClick={send} aria-label="Send to your agent">
                ↑
              </button>
            </div>
          </motion.div>
        )}
        {stage === 'drawing' && (
          <motion.div
            className="lp-panel lp-ask lp-ask-status"
            key="drawing"
            onPointerDown={(e) => e.stopPropagation()}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.18 } }}
            transition={{ duration: 0.4, ease: E }}
          >
            <span className="lp-spin" />
            <span>
              Agent is drawing on your board… <i>{shown}/{NOTES.length} objects</i>
            </span>
            <button className="lp-coach-skip" onClick={skip}>
              Skip
            </button>
          </motion.div>
        )}
        {stage === 'done' && (
          <motion.div
            className="lp-panel lp-ask lp-ask-status done"
            key="done"
            onPointerDown={(e) => e.stopPropagation()}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: E }}
          >
            <span>
              ✓ Drawn — every object is editable, movable, undoable. <b>This is the real workflow.</b>
            </span>
            <button className="lp-coach-skip" onClick={replay}>
              ↻ Replay
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

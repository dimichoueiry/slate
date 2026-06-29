import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, useReducedMotion } from 'framer-motion';
import { AINode, Lock, OutputObject, Port, RunButton, Sticky, Wires, border, type Phase, type Rect } from './board-kit';

/* A real, runnable example board — same interaction model as the Growth board:
   DRAG the + out of a node to pull its output sticky onto the canvas, then hit
   ▶ to run and watch it fill. Outputs feed the next node so you can run a chain.
   A docked coach + spotlight guide each step; the camera auto-frames it. */

const E = [0.16, 1, 0.3, 1] as const;
const ease = 'cubic-bezier(0.16,1,0.3,1)';

export type RNote = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  title?: string;
  body?: string;
  img?: string; // an image context object (rendered bare) instead of a sticky
};
export type ROut = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  file?: string;
  bare?: boolean; // render without the yellow sticky wrapper (e.g. image outputs)
  color?: string; // sticky color when filled (defaults to yellow)
  render: (anim: boolean) => JSX.Element;
};
export type RNode = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cmd: string;
  rest: string;
  inputs: string[]; // note ids or upstream output ids
  out: ROut;
};
export type RScene = { id: string; name: string; notes: RNote[]; nodes: RNode[] };

/* staggered entrance for an output's children (used by ./outputs) */
export const pop = (anim: boolean, i: number, from: Record<string, number> = { y: 8 }) => ({
  initial: anim ? { opacity: 0, ...from } : false,
  animate: { opacity: 1, y: 0, x: 0, scale: 1 },
  transition: { duration: 0.42, ease: E, delay: anim ? 0.18 + i * 0.07 : 0 },
});

export default function RunnableBoard({ scene, onBack }: { scene: RScene; onBack: () => void }) {
  const reduce = useReducedMotion();
  const boardRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [view, setView] = useState({ x: 0, y: 0, scale: 0.7 });
  const [grabbing, setGrabbing] = useState(false);
  const [wireDrag, setWireDrag] = useState<{ fromId: string; x: number; y: number } | null>(null);
  const drag = useRef<{ type: 'pan' | 'wire'; nodeId?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const initPhase = () => {
    const p: Record<string, Phase> = {};
    scene.nodes.forEach((n) => (p[n.id] = reduce ? 'done' : 'idle'));
    return p;
  };
  const [phase, setPhase] = useState<Record<string, Phase>>(initPhase);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    setPhase(initPhase());
    timers.current.forEach(clearTimeout);
    timers.current = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id, reduce]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // measure real element sizes (text wraps, so declared h/w are only a fallback)
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
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      next[id] = { w, h };
      const prev = sizesRef.current[id];
      if (!prev || prev.w !== w || prev.h !== h) changed = true;
    });
    if (changed) setSizes((s) => ({ ...s, ...next }));
  });

  const rects = useMemo(() => {
    const m: Record<string, Rect> = {};
    const sz = (id: string, w: number, h: number) => ({ w: sizes[id]?.w ?? w, h: sizes[id]?.h ?? h });
    scene.notes.forEach((n) => (m[n.id] = { x: n.x, y: n.y, ...sz(n.id, n.w, n.h) }));
    scene.nodes.forEach((n) => {
      m[n.id] = { x: n.x, y: n.y, ...sz(n.id, n.w, n.h) };
      m[n.out.id] = { x: n.out.x, y: n.out.y, ...sz(n.out.id, n.out.w, n.out.h) };
    });
    return m;
  }, [scene, sizes]);

  const outOwner = useMemo(() => {
    const m: Record<string, string> = {};
    scene.nodes.forEach((n) => (m[n.out.id] = n.id));
    return m;
  }, [scene]);
  const noteIds = useMemo(() => new Set(scene.notes.map((n) => n.id)), [scene]);

  const exists = (id: string) => noteIds.has(id) || (outOwner[id] && phase[outOwner[id]] === 'done');
  const inputsReady = (n: RNode) => n.inputs.every(exists);
  const canPull = (n: RNode) => phase[n.id] === 'idle' && inputsReady(n);
  const canRun = (n: RNode) => phase[n.id] === 'pulled';

  const run = (n: RNode) => {
    if (!canRun(n)) return;
    setPhase((p) => ({ ...p, [n.id]: 'run' }));
    const t = window.setTimeout(() => setPhase((p) => ({ ...p, [n.id]: 'done' })), 1300);
    timers.current.push(t);
  };
  const skip = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const p: Record<string, Phase> = {};
    scene.nodes.forEach((n) => (p[n.id] = 'done'));
    setPhase(p);
  };
  const reset = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const p: Record<string, Phase> = {};
    scene.nodes.forEach((n) => (p[n.id] = 'idle'));
    setPhase(p);
  };

  // ── camera ──
  // Frame the active node WITH its inputs and its output, and hold that frame
  // through the whole idle → pull → run → done lifecycle. The camera only moves
  // when we advance to the next node — no twitching between micro-steps.
  const focusKey = useMemo(() => {
    const active = scene.nodes.find((n) => phase[n.id] !== 'done' && inputsReady(n));
    return active ? active.id : '__all__';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, scene]);
  const focus = useMemo(() => {
    if (focusKey === '__all__') return Object.keys(rects);
    const active = scene.nodes.find((n) => n.id === focusKey);
    return active ? [active.id, ...active.inputs, active.out.id] : Object.keys(rects);
  }, [focusKey, scene, rects]);

  const viewRef = useRef(view);
  viewRef.current = view;

  // frame a set of objects into the viewport (same approach as the Growth board)
  const fit = (ids: string[]) => {
    const rs = ids.map((id) => rects[id]).filter(Boolean);
    if (!rs.length || !size.w) return;
    const minX = Math.min(...rs.map((r) => r.x));
    const minY = Math.min(...rs.map((r) => r.y));
    const maxX = Math.max(...rs.map((r) => r.x + r.w));
    const maxY = Math.max(...rs.map((r) => r.y + r.h));
    const padX = 52;
    const padTop = 64;
    const padBottom = 88;
    const w = maxX - minX;
    const h = maxY - minY;
    const scale = clamp(Math.min((size.w - 2 * padX) / w, (size.h - padTop - padBottom) / h), 0.4, 1);
    const x = padX + (size.w - 2 * padX - w * scale) / 2 - minX * scale;
    const y = padTop + (size.h - padTop - padBottom - h * scale) / 2 - minY * scale;
    setView({ x, y, scale });
  };

  // auto-frame whatever's next whenever the step or size changes
  useEffect(() => {
    fit(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, size]);

  const zoom = (f: number) => {
    const el = boardRef.current;
    const cx = el ? el.clientWidth / 2 : 300;
    const cy = el ? el.clientHeight / 2 : 200;
    setView((v) => {
      const ns = clamp(v.scale * f, 0.3, 1.6);
      const k = ns / v.scale;
      return { scale: ns, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  // ── pan + drag-to-pull (identical mechanic to the Growth board) ──
  const toWorld = (cx: number, cy: number) => {
    const r = boardRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - (r?.left ?? 0) - v.x) / v.scale, y: (cy - (r?.top ?? 0) - v.y) / v.scale };
  };
  const startPan = (e: React.PointerEvent) => {
    drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y, moved: false };
    setGrabbing(true);
  };
  const startPull = (n: RNode) => (e: React.PointerEvent) => {
    if (!canPull(n)) return;
    e.stopPropagation();
    const w = toWorld(e.clientX, e.clientY);
    drag.current = { type: 'wire', nodeId: n.id, sx: e.clientX, sy: e.clientY, ox: 0, oy: 0, moved: false };
    setWireDrag({ fromId: n.id, x: w.x, y: w.y });
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      d.moved = true;
      if (d.type === 'pan') {
        setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
      } else {
        const w = toWorld(e.clientX, e.clientY);
        setWireDrag((wd) => (wd ? { ...wd, x: w.x, y: w.y } : wd));
      }
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      if (d?.type === 'wire' && d.moved && d.nodeId) {
        const dist = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
        if (dist > 22 && phaseRef.current[d.nodeId] === 'idle') {
          setPhase((p) => ({ ...p, [d.nodeId!]: 'pulled' }));
        }
      }
      drag.current = null;
      setGrabbing(false);
      setWireDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── coach + spotlight state ──
  const active = scene.nodes.find((n) => phase[n.id] !== 'done' && inputsReady(n));
  const allDone = scene.nodes.every((n) => phase[n.id] === 'done');
  const totalSteps = scene.nodes.length * 2;
  const doneSteps = scene.nodes.reduce(
    (a, n) => a + (phase[n.id] !== 'idle' ? 1 : 0) + (phase[n.id] === 'done' ? 1 : 0),
    0,
  );

  let coach = '';
  const activePhase = active ? phase[active.id] : undefined;
  if (active) {
    if (activePhase === 'idle') coach = 'Drag the <b>+</b> out';
    else if (activePhase === 'pulled') coach = 'Hit <b>▶</b> to run';
    else coach = '<b>Running…</b>';
  }
  // the spotlight is rendered inside the active node (see below), pinned to the
  // + / ▶ by the same CSS anchor — so it can't drift on wrap, zoom, or pan.
  const spotFor = (id: string) =>
    !reduce && active?.id === id && (activePhase === 'idle' || activePhase === 'pulled') ? activePhase : null;

  // ── wires ──
  const wires: { from: Rect; to: Rect; dashed?: boolean }[] = [];
  scene.nodes.forEach((n) => {
    n.inputs.forEach((src) => {
      if (exists(src)) wires.push({ from: rects[src], to: rects[n.id] });
    });
    if (phase[n.id] !== 'idle') wires.push({ from: rects[n.id], to: rects[n.out.id], dashed: true });
  });

  return (
    <div className={`lp-board lp-rb${grabbing ? ' grabbing' : ''}`} ref={boardRef} onPointerDown={startPan}>
      <div
        className="lp-world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0', transition: grabbing || wireDrag ? 'none' : `transform 0.85s ${ease}` }}
      >
        <Wires items={wires} />

        {/* live drag wire while pulling the + out */}
        {wireDrag &&
          (() => {
            const a = rects[wireDrag.fromId];
            if (!a) return null;
            const s = border(a, wireDrag.x, wireDrag.y);
            return (
              <svg className="lp-world-svg" width="1" height="1" style={{ overflow: 'visible' }} aria-hidden>
                <path d={`M${s.x} ${s.y} L${wireDrag.x} ${wireDrag.y}`} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="7 6" />
                <circle cx={wireDrag.x} cy={wireDrag.y} r="6" fill="#7c3aed" />
              </svg>
            );
          })()}

        {scene.notes.map((n) =>
          n.img ? (
            <div key={n.id} data-oid={n.id} className="lp-rb-img" style={{ position: 'absolute', left: n.x, top: n.y, width: n.w }}>
              <img className="lp-out-photo" src={n.img} alt="" />
            </div>
          ) : (
            <Sticky key={n.id} dataId={n.id} x={n.x} y={n.y} w={n.w} color={n.color ?? '#FFE066'} title={n.title} body={n.body} />
          ),
        )}

        {scene.nodes.map((n) => {
          const ph = phase[n.id];
          return (
            <AINode key={n.id} dataId={n.id} x={n.x} y={n.y} w={n.w} cmd={n.cmd} rest={n.rest} dim={ph === 'idle' && !inputsReady(n)}>
              <Lock />
              <RunButton phase={ph} runnable={canRun(n)} pulse={ph === 'pulled' && !reduce} onRun={() => run(n)} />
              <Port onPull={startPull(n)} pulse={canPull(n) && !reduce} />
              {spotFor(n.id) === 'idle' && <span className="lp-spot round lp-spot-port" aria-hidden />}
              {spotFor(n.id) === 'pulled' && <span className="lp-spot round lp-spot-run" aria-hidden />}
            </AINode>
          );
        })}

        <AnimatePresence>
          {scene.nodes
            .filter((n) => phase[n.id] !== 'idle')
            .map((n) => (
              <OutputObject key={n.out.id} out={n.out} phase={phase[n.id]} anim={!reduce} />
            ))}
        </AnimatePresence>
      </div>

      {/* chrome */}
      <div className="lp-panel lp-topbar" onPointerDown={(e) => e.stopPropagation()}>
        <button className="lp-tb-btn" onClick={onBack} title="Back to boards" style={{ border: 0, padding: 0, cursor: 'pointer' }}>
          ←
        </button>
        <span className="lp-tb-name">{scene.name}</span>
        <span className="lp-tb-btn">↩</span>
        <span className="lp-tb-btn">↪</span>
        <span className="lp-tb-btn">☾</span>
        <span className="lp-tb-btn primary">Export</span>
      </div>
      <div className="lp-panel lp-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <span className="lp-grip">⋮⋮</span>
        {['⬚', '✏', '▭', '◯', '◇', '⤳', '🗒', 'T', '✦'].map((t, i) => (
          <span key={i} className={`lp-tool${i === 6 ? ' active' : ''}`}>
            {t}
          </span>
        ))}
      </div>
      <div className="lp-panel lp-zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button className="lp-z-btn" style={{ background: 'none', border: 0, color: 'inherit', padding: 0, cursor: 'pointer' }} onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">
          −
        </button>
        <span className="lp-z-pct" style={{ cursor: 'pointer' }} onClick={() => fit(focus)}>
          {Math.round(view.scale * 100)}%
        </span>
        <button className="lp-z-btn" style={{ background: 'none', border: 0, color: 'inherit', padding: 0, cursor: 'pointer' }} onClick={() => zoom(1.2)} aria-label="Zoom in">
          ＋
        </button>
        <button className="lp-z-btn" style={{ background: 'none', border: 0, color: 'inherit', padding: 0, cursor: 'pointer' }} onClick={() => fit(focus)} aria-label="Reset view">
          ⛶
        </button>
      </div>
      <div className="lp-panel lp-minimap" onPointerDown={(e) => e.stopPropagation()}>
        <svg viewBox="0 0 104 70" aria-hidden>
          {(() => {
            const all = Object.values(rects);
            const minX = Math.min(...all.map((r) => r.x));
            const minY = Math.min(...all.map((r) => r.y));
            const maxX = Math.max(...all.map((r) => r.x + r.w));
            const maxY = Math.max(...all.map((r) => r.y + r.h));
            const pad = 9;
            const s = Math.min((104 - 2 * pad) / (maxX - minX), (70 - 2 * pad) / (maxY - minY));
            const map = (r: Rect) => ({ x: pad + (r.x - minX) * s, y: pad + (r.y - minY) * s, w: r.w * s, h: r.h * s });
            const cell = (id: string, fill: string, key: string) => {
              const m = map(rects[id]);
              return <rect key={key} x={m.x} y={m.y} width={m.w} height={m.h} rx={1.5} fill={fill} />;
            };
            return (
              <>
                {scene.notes.map((n) => cell(n.id, n.color ?? '#e9e6f0', n.id))}
                {scene.nodes.map((n) => cell(n.id, '#FFE066', n.id))}
                {scene.nodes.map((n) => (phase[n.id] !== 'idle' ? cell(n.out.id, 'rgba(255,255,255,0.9)', n.out.id) : null))}
              </>
            );
          })()}
        </svg>
      </div>

      {/* docked coach — identical to the Growth board */}
      {!reduce && !allDone && (
        <div className="lp-coach">
          <div className="lp-coach-dots">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <i key={i} className={i < doneSteps ? 'done' : i === doneSteps ? 'cur' : ''} />
            ))}
          </div>
          <div className="lp-coach-title" dangerouslySetInnerHTML={{ __html: coach }} />
          <div className="lp-coach-count">
            {doneSteps} / {totalSteps}
          </div>
          <button className="lp-coach-skip" onClick={skip}>
            Skip
          </button>
        </div>
      )}
      {!reduce && allDone && (
        <button className="lp-replay" onClick={reset}>
          ↻ Replay the walkthrough
        </button>
      )}
    </div>
  );
}

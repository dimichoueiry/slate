import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import infographic from './assets/referral-infographic.png';

/* An interactive, guided mini Slate board. It mirrors the real mechanic:
   an AI node's outputs are objects you wire to it. So you PULL a connector out
   of the node's "+" port to create empty output stickies, then hit ▶ to fill
   them (and, like the app, running a node with nothing wired auto-spawns one).
   Drag to pan, drag stickies to move. Outputs here are predefined. */

type Phase = 'idle' | 'run' | 'done';
type Status = 'empty' | 'thinking' | 'done';
type XY = { x: number; y: number };
type Rect = XY & { w: number; h: number };
type Created = { id: string; parentId: string; kind: 'idea' | 'post' | 'image'; status: Status; text: string };

const TOOLS = ['⬚', '✏', '▭', '◯', '◇', '⤳', '🗒', 'T', '✦'];

const IDEAS = [
  'A points-based onboarding quest — users unlock badges through bite-sized tutorials, and milestones trigger a referral prompt with bonus points.',
  "A weekly digest email that's also a gamified challenge: finishing its quick tutorial earns a streak multiplier on referral rewards.",
  'A tiered referral program where new users get a personalized onboarding flow based on who referred them, with progress alerts to the referrer.',
];
const POST =
  'Excited to share what we just shipped — our new Tiered Referral Program is live! 🎉\n\nWhen someone joins through your link, they land in a personalized onboarding flow tailored to who referred them —';

const NOTES = [
  { id: 'brainstorm', x: 40, y: 40, w: 188, color: '#FFD6A5', title: 'Brainstorm', body: 'Ideas:\n- Gamify onboarding\n- Referral program\n- Weekly digest emails\n- In-app tutorials' },
  { id: 'design', x: 268, y: 44, w: 196, color: '#B5EAD7', title: 'Design Review', body: '- Dashboard needs dark mode\n- Simplify nav bar\n- Icons too small on mobile\n- Revisit color palette' },
];

const NODES = [
  { id: 'ideate', x: 210, y: 330, w: 210, color: '#FFE066', text: 'ai: give me an idea on how i can do this', kind: 'idea' as const, texts: IDEAS },
  { id: 'linkedin', x: 820, y: 320, w: 210, color: '#FFE066', text: 'ai: create a LinkedIn post about this new referral program we have', kind: 'post' as const, texts: [POST] },
  { id: 'img', x: 1320, y: 330, w: 184, color: '#A8D8EA', text: 'img: make an image that goes with my LinkedIn post', kind: 'image' as const, texts: ['__IMAGE__'] },
];
const nodeById = (id: string) => NODES.find((n) => n.id === id);

const INPUTS = [
  { from: 'brainstorm', to: 'ideate' },
  { from: 'design', to: 'ideate' },
];

const INITIAL_VIEW = { x: 24, y: 28, scale: 0.74 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function border(r: Rect, tx: number, ty: number): XY {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = dx !== 0 ? r.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? r.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

export default function BoardShowcase() {
  const reduce = useReducedMotion();
  const boardRef = useRef<HTMLDivElement>(null);
  const elRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [view, setView] = useState(INITIAL_VIEW);
  const [pos, setPos] = useState<Record<string, XY>>(() => {
    const p: Record<string, XY> = {};
    [...NOTES, ...NODES].forEach((o) => (p[o.id] = { x: o.x, y: o.y }));
    return p;
  });
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [created, setCreated] = useState<Created[]>([]);
  const [phase, setPhase] = useState<Record<string, Phase>>({ ideate: 'idle', linkedin: 'idle', img: 'idle' });
  const [step, setStep] = useState<'pullout' | 'run' | 'explore'>('pullout');
  const [wireDrag, setWireDrag] = useState<{ fromId: string; x: number; y: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  // refs mirroring state for pointer handlers
  const viewRef = useRef(view);
  const posRef = useRef(pos);
  const createdRef = useRef(created);
  const stepRef = useRef(step);
  viewRef.current = view;
  posRef.current = pos;
  createdRef.current = created;
  stepRef.current = step;

  const drag = useRef<null | { type: 'pan' | 'obj' | 'wire'; id?: string; sx: number; sy: number; ox: number; oy: number; moved?: boolean }>(null);
  const timers = useRef<number[]>([]);
  const idc = useRef(0);
  const genId = () => `o${++idc.current}`;

  useLayoutEffect(() => {
    const next: Record<string, { w: number; h: number }> = {};
    let changed = false;
    Object.entries(elRefs.current).forEach(([id, el]) => {
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!sizes[id] || sizes[id].w !== w || sizes[id].h !== h) changed = true;
      next[id] = { w, h };
    });
    if (changed) setSizes((s) => ({ ...s, ...next }));
  });

  const toWorld = (clientX: number, clientY: number): XY => {
    const r = boardRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    const lx = clientX - (r?.left ?? 0);
    const ly = clientY - (r?.top ?? 0);
    return { x: (lx - v.x) / v.scale, y: (ly - v.y) / v.scale };
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      d.moved = true;
      if (d.type === 'pan') {
        setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
      } else if (d.type === 'obj' && d.id) {
        const id = d.id;
        const sc = viewRef.current.scale;
        setPos((p) => ({ ...p, [id]: { x: d.ox + (e.clientX - d.sx) / sc, y: d.oy + (e.clientY - d.sy) / sc } }));
      } else if (d.type === 'wire') {
        const w = toWorld(e.clientX, e.clientY);
        setWireDrag((wd) => (wd ? { ...wd, x: w.x, y: w.y } : wd));
      }
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      if (d?.type === 'wire' && d.id) {
        const w = toWorld(e.clientX, e.clientY);
        const node = nodeById(d.id);
        if (node && d.moved) {
          const id = genId();
          setPos((p) => ({ ...p, [id]: { x: w.x - 90, y: w.y - 30 } }));
          setCreated((prev) => [...prev, { id, parentId: d.id!, kind: node.kind, status: 'empty', text: '' }]);
          if (d.id === 'ideate' && stepRef.current === 'pullout') setStep('run');
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
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const startPan = (e: React.PointerEvent) => {
    drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    setGrabbing(true);
  };
  const startObj = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    drag.current = { type: 'obj', id, sx: e.clientX, sy: e.clientY, ox: pos[id].x, oy: pos[id].y };
  };
  const startPort = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const w = toWorld(e.clientX, e.clientY);
    drag.current = { type: 'wire', id, sx: e.clientX, sy: e.clientY, ox: 0, oy: 0 };
    setWireDrag({ fromId: id, x: w.x, y: w.y });
  };

  const nodeW = (id: string) => sizes[id]?.w ?? nodeById(id)?.w ?? 200;

  const run = (node: (typeof NODES)[number]) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const existing = createdRef.current.filter((o) => o.parentId === node.id && o.status !== 'done');
    let kids = existing;
    let spawn: Created | null = null;
    if (existing.length === 0) {
      const id = genId();
      const p = posRef.current[node.id];
      spawn = { id, parentId: node.id, kind: node.kind, status: 'empty', text: '' };
      setPos((pp) => ({ ...pp, [id]: { x: p.x + nodeW(node.id) + 70, y: p.y } }));
      kids = [spawn];
    }
    const assign = new Map<string, string>();
    kids.forEach((k, i) => assign.set(k.id, node.texts[i % node.texts.length]));
    setCreated((prev) => {
      const base = spawn ? [...prev, spawn] : prev;
      return base.map((o) => (assign.has(o.id) ? { ...o, status: 'thinking', text: assign.get(o.id)! } : o));
    });
    setPhase((p) => ({ ...p, [node.id]: 'run' }));
    if (node.id === 'ideate') setStep('run');
    const t = window.setTimeout(() => {
      setCreated((prev) => prev.map((o) => (assign.has(o.id) ? { ...o, status: 'done' } : o)));
      setPhase((p) => ({ ...p, [node.id]: 'done' }));
      if (node.id === 'ideate') setStep('explore');
    }, 1300);
    timers.current.push(t);
  };

  const zoom = (f: number) => {
    const rect = boardRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 320;
    const cy = rect ? rect.height / 2 : 220;
    setView((v) => {
      const ns = clamp(v.scale * f, 0.4, 1.4);
      const k = ns / v.scale;
      return { scale: ns, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  const rectOf = (id: string): Rect | null => {
    const s = sizes[id];
    const p = pos[id];
    if (!s || !p) return null;
    return { x: p.x, y: p.y, w: s.w, h: s.h };
  };
  const wires = [
    ...INPUTS.map((w) => ({ ...w, dashed: false })),
    ...created.map((o) => ({ from: o.parentId, to: o.id, dashed: true })),
  ];

  // coach-mark position (screen space), tracks the relevant node
  const screenRect = (id: string) => {
    const p = pos[id];
    if (!p) return null;
    const s = sizes[id] ?? { w: nodeById(id)?.w ?? 200, h: 70 };
    return { x: view.x + p.x * view.scale, y: view.y + p.y * view.scale, w: s.w * view.scale, h: s.h * view.scale };
  };
  let coach: { left: number; top: number; n: number; text: string } | null = null;
  const ir = screenRect('ideate');
  if (step === 'pullout' && ir) coach = { left: ir.x + ir.w + 16, top: ir.y + ir.h / 2 - 17, n: 1, text: 'Drag the + to pull out an output' };
  else if (step === 'run' && ir) coach = { left: ir.x + ir.w + 16, top: ir.y - 16, n: 2, text: 'Now hit ▶ to generate — pull out more first if you like' };
  else if (step === 'explore') {
    const lr = screenRect('linkedin');
    if (lr) coach = { left: lr.x - 30, top: lr.y - 46, n: 3, text: 'Pan right → run the next nodes' };
  }

  const renderOutput = (o: Created) => {
    const p = pos[o.id];
    if (!p) return null;
    const ref = (el: HTMLDivElement | null) => (elRefs.current[o.id] = el);
    const base = { ref, onPointerDown: startObj(o.id) };
    if (o.kind === 'image') {
      return (
        <div key={o.id} {...base} className="lp-imgout" style={{ position: 'absolute', left: p.x, top: p.y, width: 300 }}>
          {o.status === 'done' ? <img src={infographic} alt="" /> : <div className="lp-think" style={{ padding: 20 }}>{o.status === 'thinking' ? '✦ rendering…' : '⌁ output'}</div>}
        </div>
      );
    }
    if (o.kind === 'post') {
      return (
        <div key={o.id} {...base} className={`lp-postcard${o.status === 'empty' ? ' empty' : ''}`} style={{ position: 'absolute', left: p.x, top: p.y, width: 240 }}>
          {o.status === 'done' ? (
            <>
              <div className="lp-sk-body">{o.text}</div>
              <span className="lp-showmore">Show more · 160 words</span>
            </>
          ) : (
            <div className="lp-think">{o.status === 'thinking' ? '✍️ writing…' : ''}</div>
          )}
        </div>
      );
    }
    return (
      <div key={o.id} {...base} className={`lp-sticky${o.status === 'empty' ? ' empty' : ''}`} style={{ position: 'absolute', left: p.x, top: p.y, width: 210, background: o.status === 'empty' ? undefined : '#FFE066' }}>
        {o.status === 'done' ? <div className="lp-sk-body">{o.text}</div> : <div className="lp-think">{o.status === 'thinking' ? '⏳ thinking…' : ''}</div>}
      </div>
    );
  };

  return (
    <div className="lp-board-shell">
      <motion.div
        className={`lp-board${grabbing ? ' grabbing' : ''}`}
        ref={boardRef}
        onPointerDown={startPan}
        initial={reduce ? false : { opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <div
          className="lp-world"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: grabbing ? 'none' : 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          {/* connectors */}
          <svg className="lp-world-svg" width="2200" height="1300" viewBox="0 0 2200 1300" aria-hidden>
            <defs>
              <marker id="lp-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
                <path d="M0 0 L9 4.5 L0 9 z" fill="#868e96" />
              </marker>
            </defs>
            {wires.map((w, i) => {
              const a = rectOf(w.from);
              const b = rectOf(w.to);
              if (!a || !b) return null;
              const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
              const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
              const s = border(a, bc.x, bc.y);
              const e = border(b, ac.x, ac.y);
              const dx = e.x - s.x;
              const dy = e.y - s.y;
              const d = `M${s.x} ${s.y} C ${s.x + dx * 0.4} ${s.y + dy * 0.12}, ${s.x + dx * 0.6} ${e.y - dy * 0.12}, ${e.x} ${e.y}`;
              return <path key={`${w.from}-${w.to}-${i}`} d={d} fill="none" stroke="#868e96" strokeWidth="2" strokeLinecap="round" strokeDasharray={w.dashed ? '7 6' : undefined} markerEnd="url(#lp-arrow)" />;
            })}
            {wireDrag && (() => {
              const a = rectOf(wireDrag.fromId);
              if (!a) return null;
              const s = border(a, wireDrag.x, wireDrag.y);
              return (
                <g>
                  <path d={`M${s.x} ${s.y} L${wireDrag.x} ${wireDrag.y}`} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="7 6" />
                  <circle cx={wireDrag.x} cy={wireDrag.y} r="6" fill="#7c3aed" />
                </g>
              );
            })()}
          </svg>

          {/* notes */}
          {NOTES.map((n) => (
            <div key={n.id} ref={(el) => (elRefs.current[n.id] = el)} className="lp-sticky" style={{ position: 'absolute', left: pos[n.id].x, top: pos[n.id].y, width: n.w, background: n.color }} onPointerDown={startObj(n.id)}>
              <div className="lp-sk-title">{n.title}</div>
              <div className="lp-sk-body">{n.body}</div>
            </div>
          ))}

          {/* ai nodes */}
          {NODES.map((n) => (
            <div key={n.id} ref={(el) => (elRefs.current[n.id] = el)} className="lp-sticky" style={{ position: 'absolute', left: pos[n.id].x, top: pos[n.id].y, width: n.w, background: n.color }} onPointerDown={startObj(n.id)}>
              <div className="lp-sk-body">{n.text}</div>
              <div className="lp-lockbtn" style={{ top: -10, right: 20 }} aria-hidden>🔒</div>
              <button className={`lp-runbtn ${phase[n.id]}`} style={{ top: -12, right: -12, border: 0, padding: 0 }} onPointerDown={(e) => e.stopPropagation()} onClick={run(n)} aria-label={`Run ${n.text}`}>
                {phase[n.id] === 'run' ? (
                  <motion.span className="lp-spin" animate={{ rotate: 360 }} transition={{ repeat: Infinity, ease: 'linear', duration: 0.7 }} />
                ) : phase[n.id] === 'done' ? '✓' : '▶'}
              </button>
              <div className={`lp-port${n.id === 'ideate' && step === 'pullout' ? ' pulse' : ''}`} style={{ right: -11, top: '50%', marginTop: -11 }} onPointerDown={startPort(n.id)} title="Drag to add an output">
                +
              </div>
            </div>
          ))}

          {/* created / generated outputs */}
          {created.map(renderOutput)}
        </div>

        {/* ---- fixed chrome ---- */}
        <div className="lp-panel lp-topbar" onPointerDown={(e) => e.stopPropagation()}>
          <span className="lp-tb-btn">←</span>
          <span className="lp-tb-name">Growth board</span>
          <span className="lp-tb-btn">↩</span>
          <span className="lp-tb-btn">↪</span>
          <span className="lp-tb-btn">☾</span>
          <span className="lp-tb-btn primary">Export</span>
        </div>
        <div className="lp-panel lp-toolbar" onPointerDown={(e) => e.stopPropagation()}>
          <span className="lp-grip">⋮⋮</span>
          {TOOLS.map((t, i) => (
            <span key={i} className={`lp-tool${i === 6 ? ' active' : ''}`}>{t}</span>
          ))}
        </div>
        <div className="lp-panel lp-zoom" onPointerDown={(e) => e.stopPropagation()}>
          <button className="lp-z-btn" style={{ background: 'none', border: 0, color: 'inherit', padding: 0 }} onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">−</button>
          <span className="lp-z-pct" onClick={() => setView(INITIAL_VIEW)} style={{ cursor: 'pointer' }}>{Math.round(view.scale * 100)}%</span>
          <button className="lp-z-btn" style={{ background: 'none', border: 0, color: 'inherit', padding: 0 }} onClick={() => zoom(1.2)} aria-label="Zoom in">＋</button>
          <button className="lp-z-btn" style={{ background: 'none', border: 0, color: 'inherit', padding: 0 }} onClick={() => setView(INITIAL_VIEW)} aria-label="Reset view">⛶</button>
        </div>
        <div className="lp-panel lp-minimap" onPointerDown={(e) => e.stopPropagation()}>
          <svg viewBox="0 0 104 70" aria-hidden>
            <rect x="8" y="12" width="11" height="9" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="22" y="12" width="11" height="9" rx="2" fill="rgba(120,200,140,0.85)" />
            <rect x="24" y="34" width="10" height="8" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="56" y="32" width="10" height="8" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="84" y="34" width="12" height="8" rx="2" fill="rgba(168,216,234,0.85)" />
            <rect x="5" y="8" width="46" height="32" fill="none" stroke="#3c78ff" strokeWidth="1.5" />
          </svg>
        </div>

        {coach && (
          <div className="lp-coach" style={{ left: clamp(coach.left, 8, 1100), top: clamp(coach.top, 44, 999) }}>
            <span className="lp-step">{coach.n}</span>
            {coach.text}
          </div>
        )}
      </motion.div>
    </div>
  );
}

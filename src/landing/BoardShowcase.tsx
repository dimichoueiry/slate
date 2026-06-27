import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import infographic from './assets/referral-infographic.png';

/* A guided, gated mini Slate board that teaches the real mechanic step by step:
   1. pull 3 outputs out of the ai node's "+" port
   2. run it → each output fills with an idea
   3. pick the idea you want
   4. drag it into the next ai node (wire it as input)
   5. run that → LinkedIn post
   6. run the image node → matching art
   Only the active step is interactive; a coach mark + spotlight guide each one.
   Skippable (per UX best practice). Outputs are predefined. */

type Phase = 'idle' | 'run' | 'done';
type Status = 'empty' | 'thinking' | 'done';
type Step = 'pull' | 'run' | 'pick' | 'wire' | 'post' | 'image' | 'done';
type XY = { x: number; y: number };
type Rect = XY & { w: number; h: number };
type Created = { id: string; parentId: string; kind: 'idea' | 'post' | 'image'; status: Status; text: string };
type Link = { from: string; to: string; dashed: boolean };

const STEPS: Step[] = ['pull', 'run', 'pick', 'wire', 'post', 'image'];
const TOOLS = ['⬚', '✏', '▭', '◯', '◇', '⤳', '🗒', 'T', '✦'];

const IDEAS = [
  'A points-based onboarding quest — users unlock badges through bite-sized tutorials, and milestones trigger a referral prompt with bonus points.',
  "A weekly digest email that's also a gamified challenge: finishing its quick tutorial earns a streak multiplier on referral rewards.",
  'A tiered referral program where new users get a personalized onboarding flow based on who referred them, with progress alerts to the referrer.',
];
const POST =
  'Excited to share what we just shipped — our new Tiered Referral Program is live! 🎉\n\nWhen someone joins through your link, they land in a personalized onboarding flow tailored to who referred them —';

const NOTES = [
  { id: 'brainstorm', x: 60, y: 60, w: 188, color: '#FFD6A5', title: 'Brainstorm', body: 'Ideas:\n- Gamify onboarding\n- Referral program\n- Weekly digest emails\n- In-app tutorials' },
  { id: 'design', x: 288, y: 64, w: 196, color: '#B5EAD7', title: 'Design Review', body: '- Dashboard needs dark mode\n- Simplify nav bar\n- Icons too small on mobile\n- Revisit color palette' },
];
const NODES = [
  { id: 'ideate', x: 230, y: 350, w: 210, color: '#FFE066', text: 'ai: give me an idea on how i can do this', kind: 'idea' as const, texts: IDEAS },
  { id: 'linkedin', x: 920, y: 360, w: 210, color: '#FFE066', text: 'ai: create a LinkedIn post about this new referral program we have', kind: 'post' as const, texts: [POST] },
  { id: 'img', x: 1480, y: 380, w: 184, color: '#A8D8EA', text: 'img: make an image that goes with my LinkedIn post', kind: 'image' as const, texts: ['__IMAGE__'] },
];
const nodeById = (id: string) => NODES.find((n) => n.id === id);
const INITIAL_VIEW = { x: 24, y: 24, scale: 0.74 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function border(r: Rect, tx: number, ty: number): XY {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(dx !== 0 ? r.w / 2 / Math.abs(dx) : Infinity, dy !== 0 ? r.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * s, y: cy + dy * s };
}
const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

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
  const [links, setLinks] = useState<Link[]>([
    { from: 'brainstorm', to: 'ideate', dashed: false },
    { from: 'design', to: 'ideate', dashed: false },
  ]);
  const [phase, setPhase] = useState<Record<string, Phase>>({ ideate: 'idle', linkedin: 'idle', img: 'idle' });
  const [step, setStep] = useState<Step>('pull');
  const [selected, setSelected] = useState<string | null>(null);
  const [wireDrag, setWireDrag] = useState<{ fromId: string; x: number; y: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  const viewRef = useRef(view);
  const posRef = useRef(pos);
  const createdRef = useRef(created);
  const stepRef = useRef(step);
  const selRef = useRef(selected);
  viewRef.current = view;
  posRef.current = pos;
  createdRef.current = created;
  stepRef.current = step;
  selRef.current = selected;

  const drag = useRef<null | { type: 'pan' | 'obj' | 'wire'; id?: string; sx: number; sy: number; ox: number; oy: number; moved?: boolean }>(null);
  const timers = useRef<number[]>([]);
  const idc = useRef(0);
  const genId = () => `o${++idc.current}`;
  const ideaCount = () => createdRef.current.filter((o) => o.parentId === 'ideate').length;

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

  const rectOf = (id: string): Rect | null => {
    const s = sizes[id];
    const p = pos[id];
    if (!s || !p) return null;
    return { x: p.x, y: p.y, w: s.w, h: s.h };
  };
  const toWorld = (clientX: number, clientY: number): XY => {
    const r = boardRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - (r?.left ?? 0) - v.x) / v.scale, y: (clientY - (r?.top ?? 0) - v.y) / v.scale };
  };

  // frame a set of objects into the viewport
  const fit = (ids: string[]) => {
    const r = boardRef.current?.getBoundingClientRect();
    if (!r) return;
    const rects = ids.map((id) => {
      const s = sizes[id];
      const p = pos[id];
      return s && p ? { x: p.x, y: p.y, w: s.w, h: s.h } : null;
    }).filter(Boolean) as Rect[];
    if (!rects.length) return;
    const minX = Math.min(...rects.map((q) => q.x));
    const minY = Math.min(...rects.map((q) => q.y));
    const maxX = Math.max(...rects.map((q) => q.x + q.w));
    const maxY = Math.max(...rects.map((q) => q.y + q.h));
    // reserve room: top bar above, docked coach bar below, gutters on the sides
    const padX = 64;
    const padTop = 58;
    const padBottom = 96;
    const availW = r.width - 2 * padX;
    const availH = r.height - padTop - padBottom;
    const scale = clamp(Math.min(availW / (maxX - minX), availH / (maxY - minY)), 0.4, 0.95);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setView({ scale, x: padX + availW / 2 - cx * scale, y: padTop + availH / 2 - cy * scale });
  };

  // auto-frame on step change
  useEffect(() => {
    const ideas = createdRef.current.filter((o) => o.parentId === 'ideate').map((o) => o.id);
    let ids: string[] = [];
    if (step === 'run' || step === 'pick') ids = ['ideate', ...ideas];
    else if (step === 'wire') ids = [selected || ideas[ideas.length - 1] || 'ideate', 'linkedin'];
    else if (step === 'post') ids = ['linkedin'];
    else if (step === 'image') ids = ['img'];
    if (ids.length) requestAnimationFrame(() => fit(ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selected]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      d.moved = true;
      if (d.type === 'pan') setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
      else if (d.type === 'obj' && d.id) {
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
      if (d?.type === 'wire' && d.id && d.moved) {
        const w = toWorld(e.clientX, e.clientY);
        const st = stepRef.current;
        if (st === 'pull' && d.id === 'ideate' && ideaCount() < 3) {
          const id = genId();
          setPos((p) => ({ ...p, [id]: { x: w.x - 95, y: w.y - 30 } }));
          setCreated((prev) => [...prev, { id, parentId: 'ideate', kind: 'idea', status: 'empty', text: '' }]);
          if (ideaCount() + 1 >= 3) setStep('run');
        } else if (st === 'wire' && d.id === selRef.current) {
          const lr = rectOf('linkedin');
          if (lr && inside(lr, w.x, w.y)) {
            setLinks((prev) => [...prev, { from: d.id!, to: 'linkedin', dashed: false }]);
            setStep('post');
          }
        } else if (st === 'done') {
          const node = nodeById(d.id);
          if (node) {
            const id = genId();
            setPos((p) => ({ ...p, [id]: { x: w.x - 95, y: w.y - 30 } }));
            setCreated((prev) => [...prev, { id, parentId: d.id!, kind: node.kind, status: 'empty', text: '' }]);
          }
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
  const runnable = (id: string) =>
    step === 'done' || (id === 'ideate' && step === 'run') || (id === 'linkedin' && step === 'post') || (id === 'img' && step === 'image');

  const run = (node: (typeof NODES)[number]) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!runnable(node.id)) return;
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
    setCreated((prev) => (spawn ? [...prev, spawn] : prev).map((o) => (assign.has(o.id) ? { ...o, status: 'thinking', text: assign.get(o.id)! } : o)));
    setPhase((p) => ({ ...p, [node.id]: 'run' }));
    const t = window.setTimeout(() => {
      setCreated((prev) => prev.map((o) => (assign.has(o.id) ? { ...o, status: 'done' } : o)));
      setPhase((p) => ({ ...p, [node.id]: 'done' }));
      if (node.id === 'ideate') setStep((s) => (s === 'run' ? 'pick' : s));
      else if (node.id === 'linkedin') {
        setStep((s) => (s === 'post' ? 'image' : s));
        requestAnimationFrame(() => fit(['linkedin', ...kids.map((k) => k.id)]));
      } else if (node.id === 'img') {
        setStep((s) => (s === 'image' ? 'done' : s));
        requestAnimationFrame(() => fit(['img', ...kids.map((k) => k.id)]));
      }
    }, 1300);
    timers.current.push(t);
  };

  const pickIdea = (id: string) => () => {
    if (step === 'pick') {
      setSelected(id);
      setStep('wire');
    }
  };

  const zoom = (f: number) => {
    const r = boardRef.current?.getBoundingClientRect();
    const cx = r ? r.width / 2 : 320;
    const cy = r ? r.height / 2 : 220;
    setView((v) => {
      const ns = clamp(v.scale * f, 0.4, 1.4);
      const k = ns / v.scale;
      return { scale: ns, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  const reset = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setCreated([]);
    setLinks([
      { from: 'brainstorm', to: 'ideate', dashed: false },
      { from: 'design', to: 'ideate', dashed: false },
    ]);
    setPhase({ ideate: 'idle', linkedin: 'idle', img: 'idle' });
    setSelected(null);
    setPos((p) => ({ ...p, ideate: { x: 230, y: 350 }, linkedin: { x: 920, y: 360 }, img: { x: 1480, y: 380 } }));
    setStep('pull');
    setView(INITIAL_VIEW);
  };

  const wires: Link[] = [...links, ...created.map((o) => ({ from: o.parentId, to: o.id, dashed: true }))];

  // ---- guide overlay (screen space) ----
  const sRect = (id: string): Rect | null => {
    const p = pos[id];
    if (!p) return null;
    const s = sizes[id] ?? { w: nodeById(id)?.w ?? 200, h: 70 };
    return { x: view.x + p.x * view.scale, y: view.y + p.y * view.scale, w: s.w * view.scale, h: s.h * view.scale };
  };
  const ideaScreenRects = () => created.filter((o) => o.parentId === 'ideate').map((o) => sRect(o.id)).filter(Boolean) as Rect[];
  let spot: (Rect & { round?: boolean }) | null = null;
  let coachText = '';
  let coachCount: string | null = null;
  const nr = sRect('ideate');
  if (step === 'pull' && nr) {
    spot = { x: nr.x + nr.w - 13, y: nr.y + nr.h / 2 - 13, w: 26, h: 26, round: true };
    coachText = 'Drag from the <b>+</b> to pull an output out of the node — do it <b>3×</b>.';
    coachCount = `${ideaCount()} / 3`;
  } else if (step === 'run' && nr) {
    spot = { x: nr.x + nr.w - 18, y: nr.y - 18, w: 32, h: 32, round: true };
    coachText = 'Hit <b>▶</b> — Slate runs the node and writes an idea into each output.';
  } else if (step === 'pick') {
    const rs = ideaScreenRects();
    if (rs.length) {
      const minX = Math.min(...rs.map((q) => q.x));
      const minY = Math.min(...rs.map((q) => q.y));
      const maxX = Math.max(...rs.map((q) => q.x + q.w));
      const maxY = Math.max(...rs.map((q) => q.y + q.h));
      spot = { x: minX - 6, y: minY - 6, w: maxX - minX + 12, h: maxY - minY + 12 };
    }
    coachText = '<b>Click</b> the idea you want to build on.';
  } else if (step === 'wire') {
    const lr = sRect('linkedin');
    if (lr) spot = { x: lr.x - 6, y: lr.y - 6, w: lr.w + 12, h: lr.h + 12 };
    coachText = "Drag from your idea's <b>+</b> into this node to wire it in as input.";
  } else if (step === 'post') {
    const lr = sRect('linkedin');
    if (lr) spot = { x: lr.x + lr.w - 18, y: lr.y - 18, w: 32, h: 32, round: true };
    coachText = 'Run it to <b>draft the LinkedIn post</b> from your idea.';
  } else if (step === 'image') {
    const gr = sRect('img');
    if (gr) spot = { x: gr.x + gr.w - 18, y: gr.y - 18, w: 32, h: 32, round: true };
    coachText = 'Run the image node for <b>matching art</b>.';
  }

  const stepIdx = STEPS.indexOf(step);

  const renderOutput = (o: Created) => {
    const p = pos[o.id];
    if (!p) return null;
    const ref = (el: HTMLDivElement | null) => (elRefs.current[o.id] = el);
    const sel = selected === o.id;
    const showPort = step === 'wire' && sel;
    const base: React.HTMLAttributes<HTMLDivElement> & { ref: (el: HTMLDivElement | null) => void } = {
      ref,
      onPointerDown: startObj(o.id),
      onClick: o.kind === 'idea' ? pickIdea(o.id) : undefined,
    };
    const port = showPort ? (
      <div className="lp-port pulse" style={{ right: -11, top: '50%', marginTop: -11 }} onPointerDown={startPort(o.id)}>+</div>
    ) : null;
    if (o.kind === 'image') {
      return (
        <div key={o.id} {...base} className={`lp-imgout${sel ? ' sel' : ''}`} style={{ position: 'absolute', left: p.x, top: p.y, width: 300 }}>
          {o.status === 'done' ? <img src={infographic} alt="" /> : <div className="lp-think" style={{ padding: 20 }}>{o.status === 'thinking' ? '✦ rendering…' : '⌁ output'}</div>}
          {port}
        </div>
      );
    }
    if (o.kind === 'post') {
      return (
        <div key={o.id} {...base} className={`lp-postcard${o.status === 'empty' ? ' empty' : ''}${sel ? ' sel' : ''}`} style={{ position: 'absolute', left: p.x, top: p.y, width: 240 }}>
          {o.status === 'done' ? (<><div className="lp-sk-body">{o.text}</div><span className="lp-showmore">Show more · 160 words</span></>) : <div className="lp-think">{o.status === 'thinking' ? '✍️ writing…' : ''}</div>}
          {port}
        </div>
      );
    }
    return (
      <div key={o.id} {...base} className={`lp-sticky${o.status === 'empty' ? ' empty' : ''}${sel ? ' sel' : ''}${step === 'pick' ? ' pick' : ''}`} style={{ position: 'absolute', left: p.x, top: p.y, width: 210, background: o.status === 'empty' ? undefined : '#FFE066', cursor: step === 'pick' ? 'pointer' : undefined }}>
        {o.status === 'done' ? <div className="lp-sk-body">{o.text}</div> : <div className="lp-think">{o.status === 'thinking' ? '⏳ thinking…' : ''}</div>}
        {port}
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
        <div className="lp-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: grabbing ? 'none' : 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)' }}>
          <svg className="lp-world-svg" width="2400" height="1400" viewBox="0 0 2400 1400" aria-hidden>
            <defs>
              <marker id="lp-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
                <path d="M0 0 L9 4.5 L0 9 z" fill="#868e96" />
              </marker>
            </defs>
            {wires.map((w, i) => {
              const a = rectOf(w.from);
              const b = rectOf(w.to);
              if (!a || !b) return null;
              const s = border(a, b.x + b.w / 2, b.y + b.h / 2);
              const e = border(b, a.x + a.w / 2, a.y + a.h / 2);
              const dx = e.x - s.x;
              const dy = e.y - s.y;
              const d = `M${s.x} ${s.y} C ${s.x + dx * 0.4} ${s.y + dy * 0.12}, ${s.x + dx * 0.6} ${e.y - dy * 0.12}, ${e.x} ${e.y}`;
              return <path key={`${w.from}-${w.to}-${i}`} d={d} fill="none" stroke="#868e96" strokeWidth="2" strokeLinecap="round" strokeDasharray={w.dashed ? '7 6' : undefined} markerEnd="url(#lp-arrow)" />;
            })}
            {wireDrag && (() => {
              const a = rectOf(wireDrag.fromId);
              if (!a) return null;
              const s = border(a, wireDrag.x, wireDrag.y);
              return (<g><path d={`M${s.x} ${s.y} L${wireDrag.x} ${wireDrag.y}`} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="7 6" /><circle cx={wireDrag.x} cy={wireDrag.y} r="6" fill="#7c3aed" /></g>);
            })()}
          </svg>

          {NOTES.map((n) => (
            <div key={n.id} ref={(el) => (elRefs.current[n.id] = el)} className="lp-sticky" style={{ position: 'absolute', left: pos[n.id].x, top: pos[n.id].y, width: n.w, background: n.color }} onPointerDown={startObj(n.id)}>
              <div className="lp-sk-title">{n.title}</div>
              <div className="lp-sk-body">{n.body}</div>
            </div>
          ))}

          {NODES.map((n) => {
            const showPort = step === 'done' || (n.id === 'ideate' && step === 'pull');
            const dim = step !== 'done' && !runnable(n.id) && !(n.id === 'ideate' && (step === 'pull' || step === 'run'));
            return (
              <div key={n.id} ref={(el) => (elRefs.current[n.id] = el)} className="lp-sticky" style={{ position: 'absolute', left: pos[n.id].x, top: pos[n.id].y, width: n.w, background: n.color, opacity: dim ? 0.55 : 1 }} onPointerDown={startObj(n.id)}>
                <div className="lp-sk-body">{n.text}</div>
                <div className="lp-lockbtn" style={{ top: -10, right: 20 }} aria-hidden>🔒</div>
                <button className={`lp-runbtn ${phase[n.id]}`} style={{ top: -12, right: -12, border: 0, padding: 0, opacity: runnable(n.id) ? 1 : 0.6 }} onPointerDown={(e) => e.stopPropagation()} onClick={run(n)} aria-label={`Run ${n.text}`}>
                  {phase[n.id] === 'run' ? <motion.span className="lp-spin" animate={{ rotate: 360 }} transition={{ repeat: Infinity, ease: 'linear', duration: 0.7 }} /> : phase[n.id] === 'done' ? '✓' : '▶'}
                </button>
                {showPort && <div className={`lp-port${n.id === 'ideate' && step === 'pull' ? ' pulse' : ''}`} style={{ right: -11, top: '50%', marginTop: -11 }} onPointerDown={startPort(n.id)}>+</div>}
              </div>
            );
          })}

          {created.map(renderOutput)}
        </div>

        {/* chrome */}
        <div className="lp-panel lp-topbar" onPointerDown={(e) => e.stopPropagation()}>
          <span className="lp-tb-btn">←</span><span className="lp-tb-name">Growth board</span><span className="lp-tb-btn">↩</span><span className="lp-tb-btn">↪</span><span className="lp-tb-btn">☾</span><span className="lp-tb-btn primary">Export</span>
        </div>
        <div className="lp-panel lp-toolbar" onPointerDown={(e) => e.stopPropagation()}>
          <span className="lp-grip">⋮⋮</span>{TOOLS.map((t, i) => (<span key={i} className={`lp-tool${i === 6 ? ' active' : ''}`}>{t}</span>))}
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

        {/* guide overlay */}
        {spot && step !== 'done' && <div className={`lp-spot${spot.round ? ' round' : ''}`} style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h }} />}
        {step !== 'done' && (
          <div className="lp-coach" onPointerDown={(e) => e.stopPropagation()}>
            <div className="lp-coach-dots">
              {STEPS.map((s, i) => (<i key={s} className={i < stepIdx ? 'done' : i === stepIdx ? 'cur' : ''} />))}
            </div>
            <div className="lp-coach-title" dangerouslySetInnerHTML={{ __html: coachText }} />
            {coachCount && <div className="lp-coach-count">{coachCount}</div>}
            <button className="lp-coach-skip" onClick={() => setStep('done')}>Skip</button>
          </div>
        )}
        {step === 'done' && (
          <button className="lp-replay" onPointerDown={(e) => e.stopPropagation()} onClick={reset}>↻ Replay the walkthrough</button>
        )}
      </motion.div>
    </div>
  );
}

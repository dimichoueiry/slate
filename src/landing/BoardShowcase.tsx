import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import infographic from './assets/referral-infographic.png';

/* An interactive mini Slate board: drag to pan, drag the stickies around, and
   hit the ▶ run button on any AI node to watch a (predefined) output generate
   on the canvas — exactly how the real product feels, minus the API calls. */

type Phase = 'idle' | 'run' | 'done';
type XY = { x: number; y: number };
type Rect = XY & { w: number; h: number };

const TOOLS = ['⬚', '✏', '▭', '◯', '◇', '⤳', '🗒', 'T', '✦'];

/* ---- scene definition (world coordinates, px) ---- */
const NOTES = [
  { id: 'brainstorm', x: 40, y: 40, w: 188, color: '#FFD6A5', title: 'Brainstorm', body: 'Ideas:\n- Gamify onboarding\n- Referral program\n- Weekly digest emails\n- In-app tutorials' },
  { id: 'design', x: 268, y: 44, w: 196, color: '#B5EAD7', title: 'Design Review', body: '- Dashboard needs dark mode\n- Simplify nav bar\n- Icons too small on mobile\n- Revisit color palette' },
];

const NODES = [
  { id: 'ideate', x: 210, y: 330, w: 210, color: '#FFE066', text: 'ai: give me an idea on how i can do this', outputs: ['idea1', 'idea2', 'idea3'] },
  { id: 'linkedin', x: 760, y: 320, w: 210, color: '#FFE066', text: 'ai: create a LinkedIn post about this new referral program we have', outputs: ['post'] },
  { id: 'img', x: 1300, y: 330, w: 184, color: '#A8D8EA', text: 'img: make an image that goes with my LinkedIn post', outputs: ['image'] },
];

const OUTPUTS = [
  { id: 'idea1', src: 'ideate', x: 40, y: 540, w: 210, kind: 'idea', text: 'A points-based onboarding quest — users unlock badges through bite-sized tutorials, and milestones trigger a referral prompt with bonus points.' },
  { id: 'idea2', src: 'ideate', x: 300, y: 580, w: 210, kind: 'idea', text: "A weekly digest email that's also a gamified challenge: finishing its quick tutorial earns a streak multiplier on referral rewards." },
  { id: 'idea3', src: 'ideate', x: 560, y: 540, w: 210, kind: 'idea', text: 'A tiered referral program where new users get a personalized onboarding flow based on who referred them, with progress alerts to the referrer.' },
  { id: 'post', src: 'linkedin', x: 1010, y: 300, w: 240, kind: 'post', text: 'Excited to share what we just shipped — our new Tiered Referral Program is live! 🎉\n\nWhen someone joins through your link, they land in a personalized onboarding flow tailored to who referred them —' },
  { id: 'image', src: 'img', x: 1180, y: 540, w: 300, kind: 'image', text: '' },
];

const WIRES = [
  { from: 'brainstorm', to: 'ideate' },
  { from: 'ideate', to: 'idea1' },
  { from: 'ideate', to: 'idea2' },
  { from: 'ideate', to: 'idea3' },
  { from: 'idea3', to: 'linkedin' },
  { from: 'linkedin', to: 'post' },
  { from: 'post', to: 'img' },
  { from: 'img', to: 'image' },
];

const INITIAL_VIEW = { x: 24, y: 30, scale: 0.72 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* point on rect border in the direction of a target point */
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
    [...NOTES, ...NODES, ...OUTPUTS].forEach((o) => (p[o.id] = { x: o.x, y: o.y }));
    return p;
  });
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [phase, setPhase] = useState<Record<string, Phase>>({ ideate: 'idle', linkedin: 'idle', img: 'idle' });
  const [produced, setProduced] = useState<Set<string>>(new Set());
  const [grabbing, setGrabbing] = useState(false);
  const [hint, setHint] = useState(true);

  const drag = useRef<null | { type: 'pan' | 'obj'; id?: string; sx: number; sy: number; ox: number; oy: number }>(null);
  const timers = useRef<number[]>([]);

  // measure object box sizes (for connector anchors) once visible
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

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (d.type === 'pan') {
        setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
      } else if (d.id) {
        const id = d.id;
        setPos((p) => ({ ...p, [id]: { x: d.ox + (e.clientX - d.sx) / view.scale, y: d.oy + (e.clientY - d.sy) / view.scale } }));
      }
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
  }, [view.scale]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // auto-hide the hint after a few seconds even without interaction
  useEffect(() => {
    const t = window.setTimeout(() => setHint(false), 5000);
    return () => clearTimeout(t);
  }, []);

  const startPan = (e: React.PointerEvent) => {
    drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    setGrabbing(true);
    setHint(false);
  };
  const startObj = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    drag.current = { type: 'obj', id, sx: e.clientX, sy: e.clientY, ox: pos[id].x, oy: pos[id].y };
    setHint(false);
  };

  const run = (node: (typeof NODES)[number]) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setHint(false);
    setPhase((p) => ({ ...p, [node.id]: 'run' }));
    setProduced((s) => new Set([...s, ...node.outputs])); // reveal as "generating…"
    // glide the view to reveal the fresh outputs (ideas fan out below the node)
    if (node.id === 'ideate') setView((v) => ({ ...v, y: v.y - 150 }));
    const t = window.setTimeout(() => setPhase((p) => ({ ...p, [node.id]: 'done' })), 1300);
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

  const visible = (id: string) => !!(NOTES.find((n) => n.id === id) || NODES.find((n) => n.id === id) || produced.has(id));
  const rectOf = (id: string): Rect | null => {
    const s = sizes[id];
    const p = pos[id];
    if (!s || !p) return null;
    return { x: p.x, y: p.y, w: s.w, h: s.h };
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
        {/* world */}
        <div
          className="lp-world"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: grabbing ? 'none' : 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* connectors */}
          <svg className="lp-world-svg" width="1700" height="1100" viewBox="0 0 1700 1100" aria-hidden>
            <defs>
              <marker id="lp-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
                <path d="M0 0 L9 4.5 L0 9 z" fill="#868e96" />
              </marker>
            </defs>
            {WIRES.map((w, i) => {
              if (!visible(w.from) || !visible(w.to)) return null;
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
              return <path key={i} d={d} fill="none" stroke="#868e96" strokeWidth="2" strokeLinecap="round" markerEnd="url(#lp-arrow)" />;
            })}
          </svg>

          {/* notes */}
          {NOTES.map((n) => (
            <div
              key={n.id}
              ref={(el) => (elRefs.current[n.id] = el)}
              className="lp-sticky"
              style={{ position: 'absolute', left: pos[n.id].x, top: pos[n.id].y, width: n.w, background: n.color }}
              onPointerDown={startObj(n.id)}
            >
              <div className="lp-sk-title">{n.title}</div>
              <div className="lp-sk-body">{n.body}</div>
            </div>
          ))}

          {/* ai nodes */}
          {NODES.map((n) => (
            <div
              key={n.id}
              ref={(el) => (elRefs.current[n.id] = el)}
              className="lp-sticky"
              style={{ position: 'absolute', left: pos[n.id].x, top: pos[n.id].y, width: n.w, background: n.color }}
              onPointerDown={startObj(n.id)}
            >
              <div className="lp-sk-body">{n.text}</div>
              <div className="lp-lockbtn" style={{ top: -10, right: 20 }} aria-hidden>
                🔒
              </div>
              <button
                className={`lp-runbtn ${phase[n.id]}`}
                style={{ top: -12, right: -12, border: 0, padding: 0 }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={run(n)}
                aria-label={`Run ${n.text}`}
              >
                {phase[n.id] === 'run' ? (
                  <motion.span className="lp-spin" animate={{ rotate: 360 }} transition={{ repeat: Infinity, ease: 'linear', duration: 0.7 }} />
                ) : phase[n.id] === 'done' ? (
                  '✓'
                ) : (
                  '▶'
                )}
              </button>
            </div>
          ))}

          {/* outputs */}
          {OUTPUTS.map((o) => {
            if (!produced.has(o.id)) return null;
            const ready = phase[o.src] === 'done';
            const common = {
              ref: (el: HTMLDivElement | null) => (elRefs.current[o.id] = el),
              style: { position: 'absolute' as const, left: pos[o.id].x, top: pos[o.id].y, width: o.w },
              onPointerDown: startObj(o.id),
            };
            if (o.kind === 'image') {
              return (
                <div key={o.id} {...common} className="lp-imgout">
                  {ready ? <img src={infographic} alt="" /> : <div className="lp-think" style={{ padding: 18 }}>✦ rendering…</div>}
                </div>
              );
            }
            if (o.kind === 'post') {
              return (
                <div key={o.id} {...common} className="lp-postcard">
                  {ready ? (
                    <>
                      <div className="lp-sk-body">{o.text}</div>
                      <span className="lp-showmore">Show more · 160 words</span>
                    </>
                  ) : (
                    <div className="lp-think">✍️ writing…</div>
                  )}
                </div>
              );
            }
            return (
              <div key={o.id} {...common} className="lp-sticky" style={{ ...common.style, background: '#FFE066' }}>
                {ready ? <div className="lp-sk-body">{o.text}</div> : <div className="lp-think">⏳ thinking…</div>}
              </div>
            );
          })}
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
            <span key={i} className={`lp-tool${i === 6 ? ' active' : ''}`}>
              {t}
            </span>
          ))}
        </div>

        <div className="lp-panel lp-zoom" onPointerDown={(e) => e.stopPropagation()}>
          <button className="lp-z-btn" style={{ background: 'none', border: 0, color: 'inherit', padding: 0 }} onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">
            −
          </button>
          <span className="lp-z-pct" onClick={() => setView(INITIAL_VIEW)} style={{ cursor: 'pointer' }}>
            {Math.round(view.scale * 100)}%
          </span>
          <button className="lp-z-btn" style={{ background: 'none', border: 0, color: 'inherit', padding: 0 }} onClick={() => zoom(1.2)} aria-label="Zoom in">
            ＋
          </button>
          <button className="lp-z-btn" style={{ background: 'none', border: 0, color: 'inherit', padding: 0 }} onClick={() => setView(INITIAL_VIEW)} aria-label="Reset view">
            ⛶
          </button>
        </div>

        <div className="lp-panel lp-minimap" onPointerDown={(e) => e.stopPropagation()}>
          <svg viewBox="0 0 104 70" aria-hidden>
            <rect x="8" y="10" width="11" height="9" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="22" y="10" width="11" height="9" rx="2" fill="rgba(120,200,140,0.85)" />
            <rect x="26" y="32" width="10" height="8" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="16" y="50" width="10" height="8" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="34" y="50" width="10" height="8" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="50" y="46" width="10" height="8" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="66" y="32" width="10" height="8" rx="2" fill="rgba(168,216,234,0.85)" />
            <rect x="82" y="34" width="12" height="8" rx="2" fill="rgba(103,65,217,0.7)" />
            <rect x="5" y="6" width="46" height="32" fill="none" stroke="#3c78ff" strokeWidth="1.5" />
          </svg>
        </div>

        {hint && (
          <div className="lp-hint">
            <b>Drag</b> to explore · <b>drag</b> a sticky · hit <b>▶</b> to run
          </div>
        )}
      </motion.div>
    </div>
  );
}

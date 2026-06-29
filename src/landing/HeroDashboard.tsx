import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { goHome } from '../App';
import BoardShowcase from './BoardShowcase';
import RunnableBoard, { type RScene } from './RunnableBoard';
import { cobblestoneScene, competitorScene, receiptlyScene } from './examples';

/* The hero showcase = the real Slate dashboard. A grid of example boards (the
   same cards you'd see in "My boards"); click one and it opens right here —
   the flagship "Growth board" becomes the live, interactive walkthrough, the
   rest open as a faithful static board preview. Back returns to the grid.
   Every surface mirrors the real app chrome (tokens from src/styles.css). */

const E = [0.16, 1, 0.3, 1] as const;

type SObj = {
  id: string;
  x: number;
  y: number;
  w: number;
  kind?: 'note' | 'node' | 'out';
  color?: string;
  title?: string;
  body?: string;
};
type SWire = { from: string; to: string; dashed?: boolean };
type Scene = {
  id: string;
  name: string;
  date: string;
  kind?: 'growth' | 'runnable' | 'static';
  runnable?: RScene;
  objects: SObj[];
  wires: SWire[];
};

const estH = (o: SObj) =>
  o.kind === 'node'
    ? 50
    : o.kind === 'out'
      ? o.body
        ? 78
        : 60
      : 30 + (o.body ? o.body.split('\n').length : 0) * 13;

const SCENES: Scene[] = [
  {
    id: 'growth',
    name: 'Growth board',
    date: '2 days ago',
    kind: 'growth',
    objects: [
      { id: 'b', x: 40, y: 24, w: 176, color: '#FFD6A5', title: 'Brainstorm', body: 'Gamify onboarding\nReferral program\nWeekly digest' },
      { id: 'd', x: 256, y: 30, w: 180, color: '#B5EAD7', title: 'Design review', body: 'Dark mode\nSimpler nav\nBigger icons' },
      { id: 'n', x: 150, y: 220, w: 210, kind: 'node', color: '#FFE066', body: 'ai: give me an idea' },
    ],
    wires: [
      { from: 'b', to: 'n' },
      { from: 'd', to: 'n' },
    ],
  },
  {
    id: 'receiptly',
    name: 'Launch board',
    date: 'today',
    kind: 'runnable',
    runnable: receiptlyScene,
    objects: [
      { id: 'pos', x: 24, y: 24, w: 150, color: '#FFD6A5', title: 'Positioning', body: '“Expensify for\npeople who hate it”' },
      { id: 'flow', x: 24, y: 150, w: 150, color: '#A8D8EA', title: 'Flow', body: '📷 → OCR → PDF' },
      { id: 'priv', x: 24, y: 256, w: 150, color: '#F2D3D3', title: '🔒 Private', body: 'pivot idea' },
      { id: 'h', x: 210, y: 40, w: 180, kind: 'node', color: '#FFE066', body: 'ai: 3 hero options' },
      { id: 'ho', x: 432, y: 40, w: 150, kind: 'out', title: 'Heroes', body: '3 headlines' },
      { id: 'c', x: 210, y: 230, w: 180, kind: 'node', color: '#FFE066', body: 'chart: MRR' },
      { id: 'co', x: 432, y: 230, w: 150, kind: 'out', title: 'MRR', body: 'wk 2 → 12' },
    ],
    wires: [
      { from: 'pos', to: 'h' },
      { from: 'flow', to: 'h' },
      { from: 'h', to: 'ho', dashed: true },
      { from: 'flow', to: 'c' },
      { from: 'c', to: 'co', dashed: true },
    ],
  },
  {
    id: 'competitors',
    name: 'Competitor teardown',
    date: '3 days ago',
    kind: 'runnable',
    runnable: competitorScene,
    objects: [
      { id: 'a', x: 28, y: 22, w: 150, color: '#FFD6A5', title: 'Notion', body: 'docs + DB\ncanvas bolted on' },
      { id: 'b', x: 28, y: 150, w: 150, color: '#B5EAD7', title: 'Miro', body: 'canvas\nno real AI' },
      { id: 'c', x: 28, y: 278, w: 150, color: '#A8D8EA', title: 'tldraw', body: 'drawing only' },
      { id: 'n', x: 228, y: 150, w: 200, kind: 'node', color: '#FFE066', body: 'ai: where do we win?' },
      { id: 'f', x: 470, y: 150, w: 164, kind: 'out', title: 'Angles', body: 'agents · data\nlocal-first' },
    ],
    wires: [
      { from: 'a', to: 'n' },
      { from: 'b', to: 'n' },
      { from: 'c', to: 'n' },
      { from: 'n', to: 'f', dashed: true },
    ],
  },
  {
    id: 'content',
    name: 'Content calendar',
    date: 'yesterday',
    objects: [
      { id: 'w', x: 30, y: 26, w: 184, color: '#B5EAD7', title: 'This week', body: 'Mon  launch\nWed  how-to\nFri  demo' },
      { id: 'n', x: 108, y: 218, w: 206, kind: 'node', color: '#FFE066', body: 'ai: draft these posts' },
      { id: 'd', x: 376, y: 210, w: 156, kind: 'out', title: '3 drafts', body: 'ready to schedule' },
    ],
    wires: [
      { from: 'w', to: 'n' },
      { from: 'n', to: 'd', dashed: true },
    ],
  },
  {
    id: 'cobblestone',
    name: 'Cobblestone rebrand',
    date: 'today',
    kind: 'runnable',
    runnable: cobblestoneScene,
    objects: [
      { id: 'bk', x: 24, y: 24, w: 150, color: '#EDE3CE', title: 'Brand kit', body: 'terracotta · cream\n· green' },
      { id: 's', x: 24, y: 150, w: 150, color: '#FFD6A5', title: 'Sketches', body: '8 thumbs → 3' },
      { id: 'a', x: 210, y: 36, w: 180, kind: 'node', color: '#FFE066', body: 'ai: 3 taglines' },
      { id: 't', x: 432, y: 36, w: 150, kind: 'out', title: 'Taglines', body: '3 options' },
      { id: 'i', x: 210, y: 220, w: 180, kind: 'node', color: '#FFE066', body: 'img: mark variations' },
      { id: 'iv', x: 432, y: 220, w: 150, kind: 'out', title: 'Marks', body: '3 variants' },
    ],
    wires: [
      { from: 'bk', to: 'a' },
      { from: 's', to: 'i' },
      { from: 'a', to: 't', dashed: true },
      { from: 'i', to: 'iv', dashed: true },
    ],
  },
];

const byId = (s: Scene, id: string) => s.objects.find((o) => o.id === id)!;

/* edge point on a rect facing a target (for wires) */
function border(o: SObj, tx: number, ty: number) {
  const cx = o.x + o.w / 2;
  const cy = o.y + estH(o) / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(
    dx !== 0 ? o.w / 2 / Math.abs(dx) : Infinity,
    dy !== 0 ? estH(o) / 2 / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * s, y: cy + dy * s };
}

function bbox(objs: SObj[], pad: number) {
  const minX = Math.min(...objs.map((o) => o.x));
  const minY = Math.min(...objs.map((o) => o.y));
  const maxX = Math.max(...objs.map((o) => o.x + o.w));
  const maxY = Math.max(...objs.map((o) => o.y + estH(o)));
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

function Wires({ scene }: { scene: Scene }) {
  return (
    <>
      <defs>
        <marker id="lp-dash-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
          <path d="M0 0 L9 4.5 L0 9 z" fill="#8a8f98" />
        </marker>
      </defs>
      {scene.wires.map((w, i) => {
        const a = byId(scene, w.from);
        const b = byId(scene, w.to);
        const bc = { x: b.x + b.w / 2, y: b.y + estH(b) / 2 };
        const ac = { x: a.x + a.w / 2, y: a.y + estH(a) / 2 };
        const s = border(a, bc.x, bc.y);
        const e = border(b, ac.x, ac.y);
        const dx = e.x - s.x;
        const dy = e.y - s.y;
        const d = `M${s.x} ${s.y} C ${s.x + dx * 0.4} ${s.y + dy * 0.15}, ${s.x + dx * 0.6} ${e.y - dy * 0.15}, ${e.x} ${e.y}`;
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="#8a8f98"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={w.dashed ? '7 6' : undefined}
            markerEnd="url(#lp-dash-arrow)"
          />
        );
      })}
    </>
  );
}

/* tiny abstract snapshot for a board card — scales free via viewBox */
function Thumb({ scene }: { scene: Scene }) {
  const b = bbox(scene.objects, 26);
  return (
    <svg className="lp-dash-thumb-svg" viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <Wires scene={scene} />
      {scene.objects.map((o) => {
        const h = estH(o);
        const isOut = o.kind === 'out';
        const fill = isOut ? '#ffffff' : o.color;
        const lines = o.body ? o.body.split('\n').length : 0;
        const accent = o.kind === 'node' ? '#7c3aed' : 'rgba(0,0,0,0.5)';
        return (
          <g key={o.id}>
            <rect
              x={o.x}
              y={o.y}
              width={o.w}
              height={h}
              rx={o.kind === 'note' ? 5 : 8}
              fill={fill}
              stroke={isOut ? 'rgba(0,0,0,0.08)' : 'none'}
            />
            <rect x={o.x + 12} y={o.y + 12} width={o.w * (o.kind === 'node' ? 0.7 : 0.46)} height={5} rx={2.5} fill={accent} />
            {Array.from({ length: o.kind === 'node' ? 0 : Math.min(lines, 3) }).map((_, i) => (
              <rect key={i} x={o.x + 12} y={o.y + 26 + i * 9} width={o.w * (0.66 - i * 0.08)} height={3.5} rx={1.75} fill="rgba(0,0,0,0.2)" />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/* full static board preview (real sticky/post HTML), auto-fit into the frame */
function StaticBoard({ scene, onBack }: { scene: Scene; onBack: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ tx: 0, ty: 0, s: 0.6 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      const padX = 56;
      const padTop = 70;
      const padBottom = 64;
      const b = bbox(scene.objects, 0);
      const s = Math.min((W - 2 * padX) / b.w, (H - padTop - padBottom) / b.h, 1.05);
      const tx = padX + (W - 2 * padX - b.w * s) / 2 - b.x * s;
      const ty = padTop + (H - padTop - padBottom - b.h * s) / 2 - b.y * s;
      setView({ tx, ty, s });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scene]);

  return (
    <div className="lp-board lp-board-static" ref={ref}>
      <div className="lp-world" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, transformOrigin: '0 0' }}>
        <svg className="lp-world-svg" width="1" height="1" style={{ overflow: 'visible' }} aria-hidden>
          <Wires scene={scene} />
        </svg>
        {scene.objects.map((o) => {
          if (o.kind === 'out') {
            return (
              <div key={o.id} className="lp-postcard" style={{ position: 'absolute', left: o.x, top: o.y, width: o.w, padding: 0, overflow: 'hidden' }}>
                <div className="lp-dash-out-head">
                  <span className="lp-out-dot" />
                  {o.title}
                </div>
                <div className="lp-dash-out-body">{o.body}</div>
              </div>
            );
          }
          if (o.kind === 'node') {
            const m = o.body!.match(/^(\w+:)(.*)$/);
            return (
              <div key={o.id} className="lp-sticky" style={{ position: 'absolute', left: o.x, top: o.y, width: o.w, background: o.color }}>
                <div className="lp-dash-cmd">
                  <b>{m ? m[1] : ''}</b>
                  {m ? m[2] : o.body}
                </div>
                <div className="lp-runbtn done" style={{ top: -12, right: -12 }} aria-hidden>
                  ✓
                </div>
              </div>
            );
          }
          return (
            <div key={o.id} className="lp-sticky" style={{ position: 'absolute', left: o.x, top: o.y, width: o.w, background: o.color }}>
              <div className="lp-sk-title">{o.title}</div>
              <div className="lp-sk-body">{o.body}</div>
            </div>
          );
        })}
      </div>

      {/* chrome */}
      <div className="lp-panel lp-topbar">
        <button className="lp-tb-btn" onClick={onBack} title="Back to boards" style={{ border: 0, padding: 0, cursor: 'pointer' }}>
          ←
        </button>
        <span className="lp-tb-name">{scene.name}</span>
        <span className="lp-tb-btn">↩</span>
        <span className="lp-tb-btn">↪</span>
        <span className="lp-tb-btn">☾</span>
        <span className="lp-tb-btn primary">Export</span>
      </div>
      <div className="lp-panel lp-zoom">
        <span className="lp-z-btn">−</span>
        <span className="lp-z-pct">{Math.round(view.s * 100)}%</span>
        <span className="lp-z-btn">＋</span>
        <span className="lp-z-btn">⛶</span>
      </div>
    </div>
  );
}

function Hex() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M12 2l8.66 5v10L12 22l-8.66-5V7z" strokeLinejoin="round" />
    </svg>
  );
}

export default function HeroDashboard() {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState<string | null>(null);
  const scene = open ? SCENES.find((s) => s.id === open) ?? null : null;

  return (
    <div className="lp-dash-shell">
      <AnimatePresence mode="wait">
        {!scene ? (
          <motion.div
            key="grid"
            className="lp-dash"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.985, transition: { duration: 0.18 } }}
            transition={{ duration: 0.5, ease: E }}
          >
            <div className="lp-dash-top">
              <span className="lp-dash-brand">
                <Hex /> Slate
              </span>
              <span className="lp-dash-search" aria-hidden>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
                </svg>
                Search boards
              </span>
              <button className="lp-dash-new-top" onClick={() => goHome()}>
                ＋ New
              </button>
            </div>

            <div className="lp-dash-body">
              <div className="lp-dash-sub">My boards · {SCENES.length}</div>
              <div className="lp-dash-grid">
                <motion.button
                  className="lp-dash-new"
                  onClick={() => goHome()}
                  initial={reduce ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: E }}
                >
                  <span className="lp-dash-new-plus">＋</span>
                  New board
                </motion.button>
                {SCENES.map((s, i) => (
                  <motion.button
                    key={s.id}
                    className="lp-dash-card"
                    onClick={() => setOpen(s.id)}
                    initial={reduce ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: E, delay: reduce ? 0 : 0.04 * (i + 1) }}
                  >
                    <div className="lp-dash-thumb">
                      <Thumb scene={s} />
                      {(s.kind === 'growth' || s.kind === 'runnable') && (
                        <span className="lp-dash-live">▶ Try it</span>
                      )}
                    </div>
                    <div className="lp-dash-meta">
                      <div className="lp-dash-name">{s.name}</div>
                      <div className="lp-dash-date">{s.date}</div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={`open-${scene.id}`}
            className="lp-dash-open"
            initial={reduce ? false : { opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
            transition={{ duration: 0.45, ease: E }}
          >
            {scene.kind === 'growth' ? (
              <BoardShowcase onBack={() => setOpen(null)} />
            ) : scene.kind === 'runnable' && scene.runnable ? (
              <RunnableBoard scene={scene.runnable} onBack={() => setOpen(null)} />
            ) : (
              <StaticBoard scene={scene} onBack={() => setOpen(null)} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

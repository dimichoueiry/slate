import { motion, type MotionProps } from 'framer-motion';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

/* Shared, reusable Slate canvas primitives. Compose a board from these:
   <Sticky> (a context note), <AINode> (a command node) with a <RunButton>
   (▶ → spinner → ✓), a <Port> (the + you pull to create an output), a <Lock>,
   <Wires> (connectors), and <OutputCard> (what an agent writes back).
   Used by RunnableBoard, and available for any custom example board.
   Styling lives in landing.css. */

export type Rect = { x: number; y: number; w: number; h: number };
// idle → (pull the +) → pulled → (hit ▶) → run → done
export type Phase = 'idle' | 'pulled' | 'run' | 'done';
const EASE = 'cubic-bezier(0.16,1,0.3,1)';

/* ── a sticky note (the unit of context on a board) ── */
export function Sticky({
  x,
  y,
  w,
  color,
  title,
  body,
  children,
  style,
  dataId,
}: {
  x: number;
  y: number;
  w: number;
  color: string;
  title?: string;
  body?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
  dataId?: string;
}) {
  return (
    <div className="lp-sticky" data-oid={dataId} style={{ position: 'absolute', left: x, top: y, width: w, background: color, ...style }}>
      {title != null && <div className="lp-sk-title">{title}</div>}
      {body != null && <div className="lp-sk-body">{body}</div>}
      {children}
    </div>
  );
}

/* ── a yellow AI command node — drop a <RunButton>/<Port>/<Lock> inside ── */
export function AINode({
  x,
  y,
  w,
  cmd,
  rest,
  dim,
  children,
  dataId,
}: {
  x: number;
  y: number;
  w: number;
  cmd: string;
  rest: string;
  dim?: boolean;
  children?: ReactNode;
  dataId?: string;
}) {
  return (
    <div
      className="lp-sticky lp-kit-node"
      data-oid={dataId}
      style={{ position: 'absolute', left: x, top: y, width: w, background: '#FFE066', opacity: dim ? 0.62 : 1, transition: `opacity 0.4s ${EASE}` }}
    >
      <div className="lp-dash-cmd">
        <b>{cmd}</b> {rest}
      </div>
      {children}
    </div>
  );
}

/* ── the play button: ▶ → spinner → ✓ ── */
export function RunButton({
  phase,
  runnable = true,
  pulse,
  onRun,
}: {
  phase: Phase;
  runnable?: boolean;
  pulse?: boolean;
  onRun?: () => void;
}) {
  const live = runnable && (phase === 'idle' || phase === 'pulled');
  return (
    <button
      className={`lp-runbtn ${phase}${pulse ? ' pulse' : ''}`}
      style={{ top: -12, right: -12, border: 0, padding: 0, cursor: live ? 'pointer' : 'default' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => live && onRun?.()}
      aria-label="Run node"
    >
      {phase === 'run' ? <span className="lp-spin" /> : phase === 'done' ? '✓' : '▶'}
    </button>
  );
}

/* ── the + port you pull to create an output ── */
export function Port({
  onPull,
  pulse,
  style,
}: {
  onPull?: (e: ReactPointerEvent) => void;
  pulse?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      // centered on the node's right edge — same as the Growth board
      className={`lp-port${pulse ? ' pulse' : ''}`}
      style={{ right: -11, top: '50%', marginTop: -11, cursor: onPull ? 'crosshair' : undefined, ...style }}
      role={onPull ? 'button' : undefined}
      aria-label={onPull ? 'Pull out an output' : undefined}
      onPointerDown={(e) => onPull?.(e)}
    >
      +
    </div>
  );
}

/* ── the small dark lock chip ── */
export function Lock({ style }: { style?: CSSProperties }) {
  return (
    <div className="lp-lockbtn" style={{ top: -10, right: 20, ...style }} aria-hidden>
      🔒
    </div>
  );
}

/* ── connector geometry + layer ── */
export function border(r: Rect, tx: number, ty: number) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(dx !== 0 ? r.w / 2 / Math.abs(dx) : Infinity, dy !== 0 ? r.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * s, y: cy + dy * s };
}

export function wirePath(a: Rect, b: Rect) {
  const s = border(a, b.x + b.w / 2, b.y + b.h / 2);
  const e = border(b, a.x + a.w / 2, a.y + a.h / 2);
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  return `M${s.x} ${s.y} C ${s.x + dx * 0.4} ${s.y + dy * 0.15}, ${s.x + dx * 0.6} ${e.y - dy * 0.15}, ${e.x} ${e.y}`;
}

export function Wires({ items }: { items: { from: Rect; to: Rect; dashed?: boolean }[] }) {
  return (
    <svg className="lp-world-svg" width="1" height="1" style={{ overflow: 'visible' }} aria-hidden>
      <defs>
        <marker id="lp-kit-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
          <path d="M0 0 L9 4.5 L0 9 z" fill="#8a8f98" />
        </marker>
      </defs>
      {items.map((w, i) => (
        <path
          key={i}
          d={wirePath(w.from, w.to)}
          fill="none"
          stroke="#8a8f98"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={w.dashed ? '7 6' : undefined}
          markerEnd="url(#lp-kit-arrow)"
        />
      ))}
    </svg>
  );
}

/* ── a generated output object (white card written back onto the canvas) ── */
export function OutputCard({
  x,
  y,
  w,
  title,
  file,
  children,
  motionProps,
}: {
  x: number;
  y: number;
  w: number;
  title: string;
  file?: string;
  children: ReactNode;
  motionProps?: MotionProps;
}) {
  return (
    <motion.div className="lp-postcard lp-rb-out" style={{ position: 'absolute', left: x, top: y, width: w }} {...motionProps}>
      <div className="lp-rb-out-head">
        <span className="lp-out-dot" />
        <span className="lp-out-name">{title}</span>
        {file && <span className="lp-out-file">{file}</span>}
      </div>
      <div className="lp-rb-out-body">{children}</div>
    </motion.div>
  );
}

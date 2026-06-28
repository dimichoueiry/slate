import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
} from 'framer-motion';

/* "AI, on the canvas" — the flagship feature moment, rendered as the REAL
   Slate board (cream paper + dot grid, dark floating chrome, a yellow sticky
   AI node, a curved dashed connector with an arrowhead, and a white output
   object). The whole board pins to the viewport while the page scrolls, so it
   reads like one living node that re-runs a new agent each time you scroll a
   little further: the command types in, the run orb spins, the wire draws and
   a real output assembles. Same visual language as the hero BoardShowcase. */

const E = [0.16, 1, 0.3, 1] as const;

// fixed board coordinate space; scaled to fit the pane
const FLOW_W = 640;
const FLOW_H = 360;
const CTX = { x: 26, y: 18, w: 186 };
const NODE = { x: 128, y: 158, w: 222 };
const OUT = { x: 402, y: 150, w: 226 };
const PORT = { x: NODE.x + NODE.w, y: NODE.y + 46 }; // node right edge → output
const TOOLS = ['⬚', '✏', '▭', '◯', '◇', '⤳', '🗒', 'T', '✦'];

type Phase = 'run' | 'done';

type Ctx =
  | { kind: 'note'; color: string; title: string; body: string }
  | { kind: 'file'; name: string; badge: string };

type Cmd = {
  cmd: string;
  rest: string;
  label: string;
  title: string;
  file: string;
  desc: string;
  ctx: Ctx;
  out: (anim: boolean) => JSX.Element;
};

/* entrance props for a staggered child of an output card */
const pop = (anim: boolean, i: number, from: Record<string, number> = { y: 8 }) => ({
  initial: anim ? { opacity: 0, ...from } : false,
  animate: { opacity: 1, y: 0, x: 0, scale: 1 },
  transition: { duration: 0.42, ease: E, delay: anim ? 0.16 + i * 0.07 : 0 },
});

const COMMANDS: Cmd[] = [
  {
    cmd: 'ai:',
    rest: 'draft a launch post from these notes',
    label: 'Write copy',
    title: 'Launch post',
    file: 'launch.md',
    desc: 'Wire in a few rough notes and get copy that sounds like you on your sharpest day.',
    ctx: {
      kind: 'note',
      color: '#FFD6A5',
      title: 'v2 release notes',
      body: '• infinite canvas\n• local-first\n• AI agents built in\n• ships today',
    },
    out: (anim) => (
      <motion.div className="lp-out-copy" {...pop(anim, 0)}>
        <strong>Your whiteboard grew a brain.</strong>
        <br />
        Slate v2 is live — an infinite, local-first canvas with AI agents on tap. →
      </motion.div>
    ),
  },
  {
    cmd: 'research:',
    rest: 'how do the best teams fix this?',
    label: 'Deep research',
    title: 'Findings',
    file: 'research.md',
    desc: 'Drop in the problem — get sourced findings, already wired into notes you can build on.',
    ctx: {
      kind: 'note',
      color: '#B5EAD7',
      title: 'The problem',
      body: 'Friday deploys keep\nbreaking prod.',
    },
    out: (anim) => (
      <>
        <div className="lp-out-pills">
          {['ship behind flags', 'canary first', 'no big merges 4pm+', '1-click rollback'].map(
            (p, i) => (
              <motion.span key={p} className="lp-pill" {...pop(anim, i, { scale: 0.6, y: 6 })}>
                {p}
              </motion.span>
            ),
          )}
        </div>
        <motion.div className="lp-out-foot" {...pop(anim, 4)}>
          ⌕ synthesized from 14 sources
        </motion.div>
      </>
    ),
  },
  {
    cmd: 'chart:',
    rest: 'weekly active users from this',
    label: 'Make a chart',
    title: 'Weekly active',
    file: 'wau.svg',
    desc: 'Point at a CSV and describe the metric in plain words — the chart draws itself.',
    ctx: { kind: 'file', name: 'signups.csv', badge: 'CSV' },
    out: (anim) => (
      <>
        <div className="lp-out-chart">
          {[34, 41, 39, 58, 63, 79, 100].map((h, i) => (
            <motion.i
              key={i}
              style={{ height: `${h}%`, transformOrigin: 'bottom' }}
              initial={anim ? { scaleY: 0, opacity: 0 } : false}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: E, delay: anim ? 0.18 + i * 0.06 : 0 }}
            />
          ))}
        </div>
        <motion.div className="lp-out-delta" {...pop(anim, 7)}>
          ▲ +38% WAU over 6 weeks
        </motion.div>
      </>
    ),
  },
  {
    cmd: 'business:',
    rest: 'why is trial conversion stalling?',
    label: 'Analyze data',
    title: 'Insights',
    file: 'trial-funnel.md',
    desc: 'Feed it the messy spreadsheet and surface the one number that actually moves things.',
    ctx: { kind: 'file', name: 'trials.csv', badge: 'CSV' },
    out: (anim) => (
      <div className="lp-out-lines">
        {[
          'Trials that invite a teammate convert 3.2× higher.',
          '82% of churn happens before the first published board.',
        ].map((t, i) => (
          <motion.div key={t} className="lp-out-line" {...pop(anim, i, { x: -8 })}>
            <span className="lp-out-bullet" />
            {t}
          </motion.div>
        ))}
      </div>
    ),
  },
  {
    cmd: 'extract:',
    rest: 'pull every line item + the totals',
    label: 'Pull a table',
    title: 'Line items',
    file: 'invoice.csv',
    desc: 'Drop a PDF, an invoice, a contract — clean, structured tables fall right out.',
    ctx: { kind: 'file', name: 'invoice.pdf', badge: 'PDF' },
    out: (anim) => (
      <table className="lp-out-table">
        <tbody>
          {[
            ['Design retainer', '$4,200'],
            ['Implementation', '$11,800'],
            ['Total due', '$16,000'],
          ].map((r, i) => (
            <motion.tr key={r[0]} {...pop(anim, i, { x: -10 })}>
              <td>{r[0]}</td>
              <td>{r[1]}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    ),
  },
  {
    cmd: 'img:',
    rest: 'generate the hero from this brief',
    label: 'Generate art',
    title: 'Image',
    file: 'hero.png',
    desc: 'Wire in a brief and an on-brand visual lands on the canvas. No tool-switching, no tabs.',
    ctx: {
      kind: 'note',
      color: '#A8D8EA',
      title: 'Image brief',
      body: 'hero for the v2 post —\ndark, aurora, our violet',
    },
    out: (anim) => (
      <>
        <motion.div
          className="lp-out-img"
          initial={anim ? { clipPath: 'inset(0 100% 0 0)', opacity: 0.4 } : false}
          animate={{ clipPath: 'inset(0 0% 0 0)', opacity: 1 }}
          transition={{ duration: 0.7, ease: E, delay: anim ? 0.16 : 0 }}
        />
        <motion.div className="lp-out-cap" {...pop(anim, 1)}>
          1024 × 1024 · on-brand palette
        </motion.div>
      </>
    ),
  },
];

/* the dark floating chrome that makes it read as the real app */
function Chrome() {
  return (
    <>
      <div className="lp-panel lp-topbar">
        <span className="lp-tb-btn">←</span>
        <span className="lp-tb-name">Agents</span>
        <span className="lp-tb-btn">↩</span>
        <span className="lp-tb-btn">↪</span>
        <span className="lp-tb-btn">☾</span>
        <span className="lp-tb-btn primary">Export</span>
      </div>
      <div className="lp-panel lp-toolbar">
        <span className="lp-grip">⋮⋮</span>
        {TOOLS.map((t, i) => (
          <span key={i} className={`lp-tool${i === 8 ? ' active' : ''}`}>
            {t}
          </span>
        ))}
      </div>
      <div className="lp-panel lp-zoom">
        <span className="lp-z-btn">−</span>
        <span className="lp-z-pct">100%</span>
        <span className="lp-z-btn">＋</span>
        <span className="lp-z-btn">⛶</span>
      </div>
      <div className="lp-panel lp-minimap">
        <svg viewBox="0 0 104 70" aria-hidden>
          <rect x="14" y="20" width="14" height="11" rx="2" fill="rgba(255,200,60,0.95)" />
          <rect x="58" y="34" width="16" height="11" rx="2" fill="rgba(255,255,255,0.9)" />
          <rect x="6" y="12" width="46" height="32" fill="none" stroke="#3c78ff" strokeWidth="1.5" />
        </svg>
      </div>
    </>
  );
}

/* the board itself — node + curved dashed connector + output, on cream paper */
function Stage({ active, phase, anim }: { active: number; phase: Phase; anim: boolean }) {
  const cur = COMMANDS[active];
  const boardRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [typed, setTyped] = useState(anim ? '' : cur.rest);

  // scale the fixed board space to fit the pane width
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const avail = el.clientWidth - 72;
      setScale(Math.min(1, Math.max(0.55, avail / FLOW_W)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // type the query in on each switch
  useEffect(() => {
    if (!anim) {
      setTyped(cur.rest);
      return;
    }
    setTyped('');
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(cur.rest.slice(0, i));
      if (i >= cur.rest.length) window.clearInterval(id);
    }, 22);
    return () => window.clearInterval(id);
  }, [active, cur.rest, anim]);

  // incoming wire: context source → node (solid, always present)
  const ctxLines = cur.ctx.kind === 'note' ? cur.ctx.body.split('\n').length : 1;
  const ctxH = cur.ctx.kind === 'file' ? 56 : 44 + ctxLines * 16;
  const inS = { x: CTX.x + CTX.w / 2, y: CTX.y + ctxH };
  const inE = { x: NODE.x + 38, y: NODE.y };
  const inDy = inE.y - inS.y;
  const ctxPath = `M${inS.x} ${inS.y} C ${inS.x} ${inS.y + inDy * 0.5}, ${inE.x - 26} ${inE.y - 24}, ${inE.x} ${inE.y}`;

  // outgoing wire: node → generated output (dashed, draws on run)
  const outS = PORT;
  const outE = { x: OUT.x, y: OUT.y + 30 };
  const outDx = outE.x - outS.x;
  const outPath = `M${outS.x} ${outS.y} C ${outS.x + outDx * 0.5} ${outS.y}, ${outE.x - outDx * 0.15} ${outE.y - 24}, ${outE.x} ${outE.y}`;

  return (
    <div className="lp-nd-board" ref={boardRef}>
      <Chrome />

      {/* console readout */}
      <div className="lp-nd-meta" aria-hidden>
        <span className="lp-nd-count">
          {String(active + 1).padStart(2, '0')}
          <i> / {String(COMMANDS.length).padStart(2, '0')}</i>
        </span>
        <span className={`lp-nd-status ${phase}`}>
          <span className="lp-nd-status-dot" />
          {phase === 'run' ? 'running' : 'done'}
        </span>
      </div>

      <div
        className="lp-nd-flow"
        style={{ width: FLOW_W, height: FLOW_H, transform: `scale(${scale})` }}
      >
        {/* connectors */}
        <svg className="lp-nd-wire" viewBox={`0 0 ${FLOW_W} ${FLOW_H}`} preserveAspectRatio="none" aria-hidden>
          <defs>
            <marker id="lp-nd-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
              <path d="M0 0 L9 4.5 L0 9 z" fill="#8a8f98" />
            </marker>
          </defs>
          {/* input: context → node (solid) */}
          <path
            d={ctxPath}
            fill="none"
            stroke="#8a8f98"
            strokeWidth="2"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            markerEnd="url(#lp-nd-arrow)"
          />
          {/* output: node → result (dashed, appears on done) */}
          <motion.path
            d={outPath}
            fill="none"
            stroke="#8a8f98"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="7 6"
            vectorEffect="non-scaling-stroke"
            markerEnd="url(#lp-nd-arrow)"
            initial={false}
            animate={{ opacity: phase === 'done' ? 1 : 0 }}
            transition={{ duration: 0.4, ease: E }}
          />
        </svg>

        {/* the context source object (note or file) wired into the node */}
        {cur.ctx.kind === 'file' ? (
          <motion.div
            className="lp-nd-file"
            key={`ctx-${active}`}
            style={{ position: 'absolute', left: CTX.x, top: CTX.y, width: CTX.w }}
            initial={anim ? { opacity: 0, y: -10 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: E }}
          >
            <span className="lp-nd-file-ico" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" strokeLinejoin="round" />
                <path d="M14 3v5h5" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="lp-nd-file-name">{cur.ctx.name}</span>
            <span className="lp-nd-file-badge">{cur.ctx.badge}</span>
          </motion.div>
        ) : (
          <motion.div
            className="lp-sticky lp-nd-ctx-note"
            key={`ctx-${active}`}
            style={{ position: 'absolute', left: CTX.x, top: CTX.y, width: CTX.w, background: cur.ctx.color }}
            initial={anim ? { opacity: 0, y: -10 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: E }}
          >
            <div className="lp-sk-title">{cur.ctx.title}</div>
            <div className="lp-sk-body">{cur.ctx.body}</div>
          </motion.div>
        )}

        {/* the yellow sticky AI node */}
        <motion.div
          className="lp-sticky lp-nd-node"
          key={`node-${active}`}
          style={{ left: NODE.x, top: NODE.y, width: NODE.w, background: '#FFE066' }}
          initial={anim ? { opacity: 0, y: 12 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: E }}
        >
          <div className="lp-nd-cmd">
            <b>{cur.cmd}</b> {typed}
            {anim && typed.length < cur.rest.length && <span className="lp-caret" />}
          </div>
          <div className="lp-lockbtn" style={{ top: -10, right: 22 }} aria-hidden>
            🔒
          </div>
          <div className={`lp-runbtn ${phase}`} style={{ top: -12, right: -12 }} aria-hidden>
            {phase === 'run' ? (
              <>
                <span className="lp-runbtn-ring" />
                <span className="lp-spin" />
              </>
            ) : (
              <motion.span
                initial={anim ? { scale: 0 } : false}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 16 }}
              >
                ✓
              </motion.span>
            )}
          </div>
          <div className="lp-port" style={{ right: -11, top: 35 }} aria-hidden>
            +
          </div>
        </motion.div>

        {/* the generated output object */}
        <AnimatePresence mode="wait">
          {phase === 'done' && (
            <motion.div
              className="lp-postcard lp-nd-out"
              key={`out-${active}`}
              style={{ left: OUT.x, top: OUT.y, width: OUT.w }}
              initial={anim ? { opacity: 0, scale: 0.95, y: 10 } : false}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.16 } }}
              transition={{ type: 'spring', stiffness: 240, damping: 24 }}
            >
              <div className="lp-nd-out-head">
                <span className="lp-out-dot" />
                <span className="lp-out-name">{cur.title}</span>
                <span className="lp-out-file">{cur.file}</span>
              </div>
              <div className="lp-nd-out-body">{cur.out(anim)}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="lp-nd-hint" aria-hidden>
        scroll to run
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

/* the narrative column (headline + rotating line + editorial index) */
function Narrative({
  active,
  onPick,
  rail,
  anim,
}: {
  active: number;
  onPick: (i: number) => void;
  rail?: ReturnType<typeof useSpring>;
  anim: boolean;
}) {
  return (
    <div className="lp-nd-narr">
      <p className="lp-kicker">AI, on the canvas</p>
      <h2 className="lp-nd-h2">
        Any note that starts
        <br />
        with a command <span className="lp-nd-grad">runs.</span>
      </h2>

      <div className="lp-nd-desc">
        <AnimatePresence mode="wait">
          <motion.p
            key={active}
            initial={anim ? { opacity: 0, y: 10 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
            transition={{ duration: 0.4, ease: E }}
          >
            {COMMANDS[active].desc}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="lp-nd-index" role="tablist" aria-label="AI commands">
        {rail && <motion.span className="lp-nd-rail" style={{ scaleY: rail }} aria-hidden />}
        {COMMANDS.map((c, i) => (
          <button
            key={c.cmd}
            role="tab"
            aria-selected={i === active}
            className={`lp-nd-cmd-row${i === active ? ' active' : ''}`}
            onClick={() => onPick(i)}
          >
            {i === active && (
              <motion.span
                layoutId="lp-nd-hi"
                className="lp-nd-hi"
                transition={{ type: 'spring', stiffness: 440, damping: 36 }}
                aria-hidden
              />
            )}
            <span className="lp-nd-num">{String(i + 1).padStart(2, '0')}</span>
            <code>{c.cmd}</code>
            <span className="lp-nd-label">{c.label}</span>
            <span className="lp-nd-arrow" aria-hidden>
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---- scroll-driven (pinned) variant ---- */
function NodeDemoScroll({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<Phase>('run');

  const { scrollYProgress } = useScroll({
    container: scrollRef,
    target: sectionRef,
    offset: ['start start', 'end end'],
  });
  const rail = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const n = COMMANDS.length;
    const raw = Math.min(n - 1e-4, Math.max(0, v * n));
    const i = Math.floor(raw);
    const done = raw - i > 0.4; // first slice of each segment "runs", then "done"
    setActive((p) => (p !== i ? i : p));
    setPhase((p) => {
      const next: Phase = done ? 'done' : 'run';
      return p !== next ? next : p;
    });
  });

  const pick = (i: number) => {
    const scroller = scrollRef.current;
    const sec = sectionRef.current;
    if (!scroller || !sec) return;
    const n = COMMANDS.length;
    const secTop =
      sec.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const top = secTop + ((i + 0.6) / n) * (sec.offsetHeight - scroller.clientHeight);
    scroller.scrollTo({ top, behavior: 'smooth' });
  };

  return (
    <div ref={sectionRef} className="lp-nd-scroll" style={{ height: `${COMMANDS.length * 64}vh` }}>
      <div className="lp-nd-sticky">
        <div className="lp-wrap lp-nd-grid">
          <Narrative active={active} onPick={pick} rail={rail} anim />
          <Stage active={active} phase={phase} anim />
        </div>
      </div>
    </div>
  );
}

/* ---- reduced-motion / no-scroll variant: click to switch, no pinning ---- */
function NodeDemoStatic() {
  const [active, setActive] = useState(1);
  return (
    <div className="lp-wrap lp-nd-grid lp-nd-static">
      <Narrative active={active} onPick={setActive} anim={false} />
      <Stage active={active} phase="done" anim={false} />
    </div>
  );
}

function useIsNarrow() {
  const [narrow, setNarrow] = useState(
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 960px)').matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 960px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export default function NodeDemo({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const reduce = useReducedMotion();
  const narrow = useIsNarrow();
  // pin + scroll-drive on desktop; tap-to-explore where motion/space is limited
  if (reduce || narrow) return <NodeDemoStatic />;
  return <NodeDemoScroll scrollRef={scrollRef} />;
}

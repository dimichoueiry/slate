import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

/* The real Slate AI-node UI: any sticky/text starting with a slash command
   becomes a runnable agent. Pick one (or let it auto-cycle) — the node's
   circular gradient run button spins, then writes a real output object back
   onto the canvas, connected by a gray connector. */

type Phase = 'idle' | 'run' | 'done';

type Cmd = {
  cmd: string;
  rest: string;
  label: string;
  head: string;
  out: () => JSX.Element;
};

const COMMANDS: Cmd[] = [
  {
    cmd: 'ai:',
    rest: 'tagline for an infinite canvas',
    label: 'Write copy',
    head: '✎ Draft',
    out: () => (
      <div style={{ fontSize: 13, lineHeight: 1.5, color: '#1f1d29' }}>
        “Never run out of page. Never run out of ideas.”
      </div>
    ),
  },
  {
    cmd: 'research:',
    rest: 'how teams plan launches',
    label: 'Deep research',
    head: '⌕ Findings',
    out: () => (
      <div>
        {['cadence', 'owners', 'checklists', 'retro loop'].map((p) => (
          <span key={p} className="lp-pill">
            {p}
          </span>
        ))}
      </div>
    ),
  },
  {
    cmd: 'chart:',
    rest: 'weekly signups',
    label: 'Make a chart',
    head: '◧ Signups',
    out: () => (
      <div className="lp-out-chart" style={{ height: 64 }}>
        {[38, 54, 47, 69, 61, 84, 92].map((h, n) => (
          <i key={n} style={{ height: `${h}%` }} />
        ))}
      </div>
    ),
  },
  {
    cmd: 'business:',
    rest: 'insights from sales.csv',
    label: 'Analyze data',
    head: '◭ Insights',
    out: () => (
      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: '#1f1d29' }}>
        <div>▲ Revenue +23% MoM, led by Pro tier.</div>
        <div>▲ Churn concentrated in week-1 signups.</div>
      </div>
    ),
  },
  {
    cmd: 'extract:',
    rest: 'line items from invoice.pdf',
    label: 'Pull a table',
    head: '▦ Table',
    out: () => (
      <table className="lp-out-table">
        <tbody>
          {[
            ['Design', '$1,200'],
            ['Build', '$3,400'],
            ['Total', '$4,600'],
          ].map((r) => (
            <tr key={r[0]}>
              <td>{r[0]}</td>
              <td>{r[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
  },
  {
    cmd: 'img:',
    rest: 'a violet-to-teal mark',
    label: 'Generate art',
    head: '✦ Image',
    out: () => (
      <div
        style={{
          height: 64,
          borderRadius: 6,
          background:
            'radial-gradient(120% 120% at 20% 10%, #8b5cf6, transparent 60%), linear-gradient(95deg,#7c3aed,#0891b2)',
        }}
      />
    ),
  },
];

export default function NodeDemo() {
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<Phase>('run');
  const reduce = useReducedMotion();
  const timers = useRef<number[]>([]);
  const paused = useRef(false);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const select = (i: number, auto = false) => {
    clear();
    setActive(i);
    if (reduce) {
      setPhase('done');
      return;
    }
    setPhase('run');
    timers.current.push(window.setTimeout(() => setPhase('done'), 1250));
    if (auto) {
      timers.current.push(
        window.setTimeout(() => {
          if (!paused.current) select((i + 1) % COMMANDS.length, true);
        }, 3800),
      );
    }
  };

  useEffect(() => {
    if (reduce) {
      setPhase('done');
      return;
    }
    select(0, true);
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  const cur = COMMANDS[active];

  return (
    <div
      className="lp-demo"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => {
        paused.current = false;
        if (!reduce) select(active, true);
      }}
    >
      <div className="lp-demo-list" role="tablist" aria-label="AI commands">
        {COMMANDS.map((c, i) => (
          <button
            key={c.cmd}
            role="tab"
            aria-selected={i === active}
            className={`lp-demo-cmd${i === active ? ' active' : ''}`}
            onClick={() => select(i)}
          >
            <code>{c.cmd}</code>
            {c.label}
          </button>
        ))}
      </div>

      <div className="lp-demo-stage">
        <div className="lp-demo-node">
          {/* the AI node (sticky-styled, command text, circular run button) */}
          <motion.div
            className="lp-ainode"
            key={`node-${active}`}
            style={{ position: 'relative', width: '100%' }}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="lp-cmd">
              <b>{cur.cmd}</b> {cur.rest}
            </div>
            <div className={`lp-runbtn ${phase}`} style={{ top: -12, right: -12 }} aria-hidden>
              {phase === 'run' ? (
                <motion.span
                  className="lp-spin"
                  animate={reduce ? {} : { rotate: 360 }}
                  transition={{ repeat: Infinity, ease: 'linear', duration: 0.7 }}
                />
              ) : phase === 'done' ? (
                '✓'
              ) : (
                '▶'
              )}
            </div>
          </motion.div>

          {/* connector + generated output */}
          <svg width="100%" height="34" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden style={{ display: 'block' }}>
            <motion.path
              d="M50 2 C 50 16, 50 18, 50 32"
              fill="none"
              stroke="#868e96"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              initial={false}
              animate={{ pathLength: phase === 'done' ? 1 : 0 }}
              transition={{ duration: 0.4 }}
            />
          </svg>

          <AnimatePresence mode="wait">
            {phase === 'done' && (
              <motion.div
                className="lp-out"
                key={`out-${active}`}
                style={{ position: 'relative', width: '100%' }}
                initial={reduce ? false : { opacity: 0, scale: 0.94, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 220, damping: 22 }}
              >
                <div className="lp-out-head">{cur.head}</div>
                <div className="lp-out-body">{cur.out()}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

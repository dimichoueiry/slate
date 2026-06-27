import { useEffect, useState } from 'react';
import { motion, useAnimate, useReducedMotion } from 'framer-motion';

/* A faithful, living recreation of the real Slate board — paper canvas + dot
   grid, the actual floating chrome (toolbar, top bar, zoom, minimap), sticky
   notes in the real palette, curved connectors, ink, and AI nodes whose
   circular gradient run button spins → turns green → writes a real output back
   onto the canvas. Chrome values mirror src/styles.css. */

type Phase = 'idle' | 'run' | 'done';
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const TOOLS = ['⬚', '✏', '▭', '◯', '◇', '⤳', '🗒', 'T', '✦'];

function RunBtn({ phase, style }: { phase: Phase; style: React.CSSProperties }) {
  return (
    <div className={`lp-runbtn ${phase}`} style={style} aria-hidden>
      {phase === 'run' ? (
        <motion.span
          className="lp-spin"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, ease: 'linear', duration: 0.7 }}
        />
      ) : phase === 'done' ? (
        '✓'
      ) : (
        '▶'
      )}
    </div>
  );
}

export default function BoardShowcase() {
  const [scope, animate] = useAnimate();
  const [res, setRes] = useState<Phase>('idle');
  const [cha, setCha] = useState<Phase>('idle');
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) {
      setRes('done');
      setCha('done');
      return;
    }
    let alive = true;
    const run = async () => {
      while (alive) {
        setRes('idle');
        setCha('idle');
        await animate('.lp-out-1', { opacity: 0, scale: 0.9, y: 8 }, { duration: 0 });
        await animate('.lp-out-2', { opacity: 0, scale: 0.9, y: 8 }, { duration: 0 });
        await animate('.lp-wire-2', { pathLength: 0 }, { duration: 0 });
        await animate('.lp-wire-3', { pathLength: 0 }, { duration: 0 });
        await animate('.lp-wire-1', { pathLength: 1 }, { duration: 0.5, ease: 'easeInOut' });
        await delay(650);
        if (!alive) break;

        setRes('run');
        await delay(1300);
        if (!alive) break;
        animate('.lp-wire-2', { pathLength: 1 }, { duration: 0.5, ease: 'easeInOut' });
        await animate('.lp-out-1', { opacity: 1, scale: 1, y: 0 }, { type: 'spring', stiffness: 210, damping: 20 });
        setRes('done');
        await delay(1500);
        if (!alive) break;

        setCha('run');
        await delay(1200);
        if (!alive) break;
        animate('.lp-wire-3', { pathLength: 1 }, { duration: 0.5, ease: 'easeInOut' });
        await animate('.lp-out-2', { opacity: 1, scale: 1, y: 0 }, { type: 'spring', stiffness: 210, damping: 20 });
        setCha('done');
        await delay(2000);
      }
    };
    void run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  return (
    <div className="lp-board-shell">
      <motion.div
        className="lp-board lp-board-tilt"
        ref={scope}
        initial={reduce ? false : { opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* ---- chrome ---- */}
        <div className="lp-panel lp-topbar">
          <span className="lp-tb-btn">←</span>
          <span className="lp-tb-name">Launch plan</span>
          <span className="lp-tb-btn">↩</span>
          <span className="lp-tb-btn">↪</span>
          <span className="lp-tb-btn">☾</span>
          <span className="lp-tb-btn primary">Export</span>
        </div>

        <div className="lp-panel lp-toolbar">
          <span className="lp-grip">⋮⋮</span>
          {TOOLS.map((t, i) => (
            <span key={i} className={`lp-tool${i === 1 ? ' active' : ''}`}>
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
          <svg viewBox="0 0 132 88" aria-hidden>
            <rect x="20" y="18" width="20" height="14" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="52" y="16" width="26" height="16" rx="2" fill="rgba(40,40,50,0.4)" />
            <rect x="92" y="14" width="24" height="18" rx="2" fill="rgba(103,65,217,0.7)" />
            <rect x="40" y="54" width="22" height="14" rx="2" fill="rgba(40,40,50,0.4)" />
            <rect x="74" y="52" width="24" height="16" rx="2" fill="rgba(103,65,217,0.7)" />
            <rect x="10" y="8" width="92" height="58" fill="none" stroke="#3c78ff" strokeWidth="1.5" />
          </svg>
        </div>

        {/* ---- connectors + ink (uniform 100x100 space, non-scaling strokes) ---- */}
        <svg className="lp-scene-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {/* connectors — gray #868e96 like auto-created ones */}
          <motion.path className="lp-wire-1" d="M31 33 C 34 33, 35 30, 38 29" fill="none" stroke="#868e96" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} />
          <motion.path className="lp-wire-2" d="M64 28 C 67 28, 68 25, 70 25" fill="none" stroke="#868e96" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} />
          <motion.path className="lp-wire-3" d="M51 66 C 56 66, 57 63, 60 63" fill="none" stroke="#868e96" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} />
          {/* hand-drawn ink doodles — #1a1a1a */}
          <path d="M18 52 q 4 4 8 0 q 4 -4 8 0" fill="none" stroke="#1a1a1a" strokeWidth="2.4" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
          <path d="M82 78 q 6 -3 12 0 q -3 -5 0 -10" fill="none" stroke="#1a1a1a" strokeWidth="2.4" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
        </svg>

        {/* ---- objects ---- */}
        <div className="lp-scene">
          {/* idea sticky */}
          <div className="lp-sticky" style={{ left: '11%', top: '23%', width: '20%', background: '#FFE066', transform: 'rotate(-2.5deg)' }}>
            <div className="lp-sk-label">Idea</div>
            <div className="lp-sticky-hand" style={{ fontSize: 18 }}>Plan launch week</div>
          </div>

          {/* research AI node */}
          <div className="lp-ainode" style={{ left: '37%', top: '17%', width: '27%' }}>
            <div className="lp-cmd">
              <b>research:</b> top rival pricing
            </div>
            <RunBtn phase={res} style={{ top: -12, right: -12 }} />
          </div>

          {/* research output — table */}
          <div className="lp-out lp-out-1" style={{ left: '70%', top: '13%', width: '26%' }}>
            <div className="lp-out-head">⌕ Rival pricing</div>
            <div className="lp-out-body">
              <table className="lp-out-table">
                <tbody>
                  {[
                    ['Miro', '$16'],
                    ['FigJam', '$5'],
                    ['Slate', '$0'],
                  ].map((r) => (
                    <tr key={r[0]}>
                      <td>{r[0]}</td>
                      <td>{r[1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* chart AI node */}
          <div className="lp-ainode" style={{ left: '25%', top: '56%', width: '25%' }}>
            <div className="lp-cmd">
              <b>chart:</b> weekly signups
            </div>
            <RunBtn phase={cha} style={{ top: -12, right: -12 }} />
          </div>

          {/* chart output */}
          <div className="lp-out lp-out-2" style={{ left: '60%', top: '52%', width: '27%' }}>
            <div className="lp-out-head">◧ Weekly signups</div>
            <div className="lp-out-body">
              <div className="lp-out-chart">
                {[38, 52, 47, 66, 61, 84, 92].map((h, n) => (
                  <i key={n} style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

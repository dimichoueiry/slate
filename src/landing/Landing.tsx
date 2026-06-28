import { useEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { goHome } from '../App';
import BoardShowcase from './BoardShowcase';
import NodeDemo from './NodeDemo';
import './landing.css';

/* tiny stroke icon set — consistent 1.6 weight, monochrome */
const ICON = {
  infinity:
    'M18.178 8c-2.071 0-3.535 1.45-4.95 3.182C11.59 9.276 9.974 8 8.178 8a4 4 0 100 8c1.796 0 3.412-1.276 5.05-3.182C14.643 14.55 16.107 16 18.178 16a4 4 0 000-8z',
  pen: 'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18zM2 2l7.586 7.586',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  link: 'M9 17H7A5 5 0 017 7h2M15 7h2a5 5 0 010 10h-2M8 12h8',
  type: 'M4 7V4h16v3M9 20h6M12 4v16',
  brand: 'M12 2l2.4 7.4H22l-6 4.4 2.3 7.2-6.3-4.6L5.7 21 8 14 2 9.6h7.6z',
  hex: 'M12 2l8.66 5v10L12 22l-8.66-5V7z',
} as const;

function Svg({ d, size = 24 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const Arrow = () => (
  <svg className="lp-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-90px' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const reduce = useReducedMotion();
  const lpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = lpRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 12);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const open = () => goHome();

  // scroll without touching location.hash (a hash change would trip App's router)
  const jump = (id: string) => (e: ReactMouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div className="lp" ref={lpRef}>
      {/* nav */}
      <nav className={`lp-nav${scrolled ? ' scrolled' : ''}`}>
        <div className="lp-wrap lp-nav-inner">
          <button className="lp-brand" onClick={open}>
            <Svg d={ICON.hex} size={22} />
            Slate
          </button>
          <div className="lp-nav-links">
            <a href="#how" onClick={jump('how')}>
              How it works
            </a>
            <a href="#nodes" onClick={jump('nodes')}>
              AI nodes
            </a>
            <a href="#features" onClick={jump('features')}>
              Features
            </a>
          </div>
          <button className="lp-btn lp-btn-primary lp-btn-sm lp-nav-cta" onClick={open}>
            Open Slate
          </button>
        </div>
      </nav>

      {/* hero */}
      <section className="lp-hero">
        <div className="lp-wrap lp-hero-grid">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="lp-eyebrow">Local-first · AI-native</p>
            <h1 className="lp-h1">The canvas that thinks with you.</h1>
            <p className="lp-lede">
              An infinite, local-first canvas where ink, notes and AI agents share one endless page.
              Sketch an idea, wire it up, and watch it become the real thing — right on the canvas.
            </p>
            <div className="lp-hero-cta">
              <button className="lp-btn lp-btn-primary" onClick={open}>
                Open Slate <Arrow />
              </button>
              <a className="lp-btn lp-btn-ghost" href="#nodes" onClick={jump('nodes')}>
                Watch it run
              </a>
            </div>
            <div className="lp-hero-tags">
              <span>
                <Svg d={ICON.shield} size={16} /> Runs offline
              </span>
              <span>
                <Svg d={ICON.infinity} size={16} /> Never runs out of page
              </span>
            </div>
          </motion.div>

          <BoardShowcase />
        </div>
      </section>

      {/* how it works */}
      <section className="lp-section" id="how">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-sec-head">
              <p className="lp-kicker">How it works</p>
              <h2 className="lp-h2">From a scribble to the real thing.</h2>
              <p className="lp-sec-lede">
                No mode-picking, no setup. Drop an idea anywhere, connect it, and let the canvas do the
                work.
              </p>
            </div>
          </Reveal>
          <div className="lp-steps">
            {[
              {
                t: 'Sketch it',
                b: (
                  <>
                    Freehand ink, sticky notes, diagrams, pasted images — whatever's in your head, onto
                    an unbounded surface. No page, never runs out.
                  </>
                ),
              },
              {
                t: 'Wire it',
                b: (
                  <>
                    Draw a connector from any object into another. Inputs flow in, outputs write back to
                    whatever you point at. The canvas becomes a graph.
                  </>
                ),
              },
              {
                t: 'Run it',
                b: (
                  <>
                    Start a note with <code>ai:</code>, <code>research:</code> or <code>chart:</code> and
                    it becomes a runnable agent. Hit run, watch it turn real.
                  </>
                ),
              },
            ].map((s, i) => (
              <Reveal key={s.t} delay={i * 0.08}>
                <div className="lp-step">
                  <div className="lp-step-num">0{i + 1}</div>
                  <h3>{s.t}</h3>
                  <p>{s.b}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* AI nodes */}
      <section className="lp-section lp-nodes" id="nodes">
        <NodeDemo scrollRef={lpRef} />
      </section>

      {/* features */}
      <section className="lp-section" id="features">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-sec-head">
              <p className="lp-kicker">Built for one mind</p>
              <h2 className="lp-h2">Miro's structure. Procreate's ink. No meeting attached.</h2>
            </div>
          </Reveal>
          <div className="lp-feats">
            {[
              {
                icon: ICON.infinity,
                t: 'Truly infinite canvas',
                p: 'One unbounded surface for sketches, plans, notes and images. Pan and zoom forever — you never run out of page.',
              },
              {
                icon: ICON.pen,
                t: 'Ink-first',
                p: 'Pressure-sensitive, low-latency pen with rough-shape recognition. It feels like drawing, not clicking.',
              },
              {
                icon: ICON.shield,
                t: 'Local-first & offline',
                p: 'Everything lives in your browser, IndexedDB-backed. No cloud required, no account — your work stays yours.',
              },
              {
                icon: ICON.link,
                t: 'Wire anything',
                p: 'Snapping connectors turn loose objects into a data graph that feeds your AI nodes.',
              },
              {
                icon: ICON.brand,
                t: 'Brand-kit aware',
                p: 'Set a voice, audience and palette once — every ai: and img: node writes on-brand.',
              },
              {
                icon: ICON.type,
                t: '40 fonts, bundled offline',
                p: 'Sans, serif, display, handwriting, mono and retro — shipped with the app, zero web-font fetches.',
              },
            ].map((c, i) => (
              <Reveal key={c.t} delay={(i % 3) * 0.07}>
                <div className="lp-feat">
                  <div className="lp-feat-ico">
                    <Svg d={c.icon} size={26} />
                  </div>
                  <h3>{c.t}</h3>
                  <p>{c.p}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* final CTA */}
      <section className="lp-final">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-final-inner">
              <h2>Open Slate. Never run out of page.</h2>
              <p>
                Your infinite sketchbook with AI built in — local, instant, offline. No sign-up, no
                meeting, no limits.
              </p>
              <button className="lp-btn lp-btn-primary" onClick={open}>
                Start sketching <Arrow />
              </button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* footer */}
      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <button className="lp-brand" onClick={open} style={{ fontSize: 16 }}>
            <Svg d={ICON.hex} size={20} />
            Slate
          </button>
          <div className="lp-footer-links">
            <a href="#how" onClick={jump('how')}>
              How it works
            </a>
            <a href="#nodes" onClick={jump('nodes')}>
              AI nodes
            </a>
            <a href="#features" onClick={jump('features')}>
              Features
            </a>
          </div>
          <span>Built entirely on MIT-licensed open source.</span>
        </div>
      </footer>
    </div>
  );
}

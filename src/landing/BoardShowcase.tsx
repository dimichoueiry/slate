import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import infographic from './assets/referral-infographic.png';

/* A living recreation of a REAL Slate workflow, shot with a panning camera that
   glides across the canvas as each stage runs:

     Brainstorm + Design Review notes
        → ai: give me an idea            (fans out 3 real ideas: thinking → filled)
        → ai: write a LinkedIn post      (drafts the post)
        → img: make a matching image     (generates the real infographic)

   Chrome (toolbar/top bar/zoom/minimap) is fixed over the viewport; the world
   pans behind it. Connectors live in a 300×110 space matching the world aspect,
   so strokes + arrowheads scale uniformly. */

type Phase = 'idle' | 'run' | 'done';
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const TOOLS = ['⬚', '✏', '▭', '◯', '◇', '⤳', '🗒', 'T', '✦'];

function NodeBtns({ phase }: { phase: Phase }) {
  return (
    <>
      <div className="lp-lockbtn" style={{ top: -9, right: 18 }} aria-hidden>
        🔒
      </div>
      <div className={`lp-runbtn ${phase}`} style={{ top: -11, right: -11 }} aria-hidden>
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
    </>
  );
}

/* connector — hidden (line + arrow) until `on`, then draws itself */
function Wire({ d, on, reduce }: { d: string; on: boolean; reduce: boolean | null }) {
  return (
    <motion.path
      d={d}
      fill="none"
      stroke="#868e96"
      strokeWidth="1.6"
      strokeLinecap="round"
      markerEnd="url(#lp-arrow)"
      initial={reduce ? false : { pathLength: 0, opacity: 0 }}
      animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
      transition={{ pathLength: { duration: 0.55, ease: 'easeInOut' }, opacity: { duration: 0.15 } }}
    />
  );
}

function Idea({ style, shown, filled, text }: { style: React.CSSProperties; shown: boolean; filled: boolean; text: string }) {
  return (
    <div
      className="lp-sticky"
      style={{
        background: '#FFE066',
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'scale(0.92)',
        transition: 'opacity .35s, transform .35s',
        ...style,
      }}
    >
      {filled ? <div className="lp-sk-body">{text}</div> : <div className="lp-think">⏳ thinking…</div>}
    </div>
  );
}

export default function BoardShowcase() {
  const reduce = useReducedMotion();
  const [cam, setCam] = useState('0%');
  const [ideate, setIdeate] = useState<Phase>('idle');
  const [ideasShown, setIdeasShown] = useState(false);
  const [ideasFilled, setIdeasFilled] = useState(false);
  const [linkedin, setLinkedin] = useState<Phase>('idle');
  const [postShown, setPostShown] = useState(false);
  const [img, setImg] = useState<Phase>('idle');
  const [imgShown, setImgShown] = useState(false);

  useEffect(() => {
    if (reduce) {
      setIdeate('done');
      setIdeasShown(true);
      setIdeasFilled(true);
      setLinkedin('done');
      setPostShown(true);
      setImg('done');
      setImgShown(true);
      setCam('-38%');
      return;
    }
    let alive = true;
    const run = async () => {
      while (alive) {
        setCam('0%');
        setIdeate('idle');
        setIdeasShown(false);
        setIdeasFilled(false);
        setLinkedin('idle');
        setPostShown(false);
        setImg('idle');
        setImgShown(false);
        await delay(1600);
        if (!alive) break;

        setCam('-10%');
        await delay(600);
        setIdeate('run');
        await delay(1350);
        if (!alive) break;
        setIdeasShown(true);
        await delay(1100);
        if (!alive) break;
        setIdeasFilled(true);
        setIdeate('done');
        await delay(2700);
        if (!alive) break;

        setCam('-38%');
        await delay(950);
        setLinkedin('run');
        await delay(1350);
        if (!alive) break;
        setPostShown(true);
        setLinkedin('done');
        await delay(2400);
        if (!alive) break;

        setCam('-46%');
        await delay(800);
        setImg('run');
        await delay(1400);
        if (!alive) break;
        setImgShown(true);
        setImg('done');
        await delay(3200);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [reduce]);

  return (
    <div className="lp-board-shell">
      <motion.div
        className="lp-board lp-board-tilt"
        initial={reduce ? false : { opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* ---- the panning world ---- */}
        <motion.div className="lp-world" animate={{ x: cam }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}>
          {/* connectors — 300×110 matches world aspect → uniform strokes + arrows */}
          <svg className="lp-world-svg" viewBox="0 0 300 110" preserveAspectRatio="none" aria-hidden>
            <defs>
              <marker id="lp-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0 0 L5 2.5 L0 5 z" fill="#868e96" />
              </marker>
            </defs>
            <Wire d="M57 42 C 70 45, 77 45, 82 45" on reduce={reduce} />
            <Wire d="M90 57 C 80 63, 72 68, 66 70" on={ideasShown} reduce={reduce} />
            <Wire d="M102 58 C 108 67, 113 73, 116 74" on={ideasShown} reduce={reduce} />
            <Wire d="M120 56 C 140 62, 152 66, 161 68" on={ideasShown} reduce={reduce} />
            <Wire d="M183 82 C 190 72, 188 58, 184 52" on={linkedin !== 'idle'} reduce={reduce} />
            <Wire d="M219 53 C 222 51, 223 50, 225 50" on={postShown} reduce={reduce} />
            <Wire d="M261 51 C 263 50, 265 50, 267 50" on={img !== 'idle'} reduce={reduce} />
            <Wire d="M279 54 C 277 63, 272 72, 268 78" on={imgShown} reduce={reduce} />
            {/* ink doodle */}
            <path d="M120 100 q 8 5 16 0 q 8 -5 16 0" fill="none" stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
          </svg>

          {/* source notes */}
          <div className="lp-sticky" style={{ left: '8%', top: '13%', width: '13%', background: '#FFD6A5' }}>
            <div className="lp-sk-title">Brainstorm</div>
            <div className="lp-sk-body">{'Ideas:\n- Gamify onboarding\n- Referral program\n- Weekly digest emails\n- In-app tutorials'}</div>
          </div>
          <div className="lp-sticky" style={{ left: '23%', top: '13%', width: '13%', background: '#B5EAD7' }}>
            <div className="lp-sk-title">Design Review</div>
            <div className="lp-sk-body">{'- Dashboard needs dark mode\n- Simplify nav bar\n- Icons too small on mobile\n- Revisit color palette'}</div>
          </div>

          {/* ai: ideate node */}
          <div className="lp-sticky" style={{ left: '28%', top: '41%', width: '13%', background: '#FFE066' }}>
            <div className="lp-sk-body">ai: give me an idea on how i can do this</div>
            <NodeBtns phase={ideate} />
          </div>

          {/* three fanned-out ideas */}
          <Idea style={{ left: '16%', top: '62%', width: '15%' }} shown={ideasShown} filled={ideasFilled} text="A points-based onboarding quest — users unlock badges through bite-sized tutorials, and milestones trigger a referral prompt with bonus points." />
          <Idea style={{ left: '33%', top: '68%', width: '15%' }} shown={ideasShown} filled={ideasFilled} text="A weekly digest email that's also a gamified challenge: finishing its quick tutorial earns a streak multiplier on referral rewards." />
          <Idea style={{ left: '48%', top: '62%', width: '14%' }} shown={ideasShown} filled={ideasFilled} text="A tiered referral program where new users get a personalized onboarding flow based on who referred them, with progress alerts to the referrer." />

          {/* ai: linkedin node */}
          <div className="lp-sticky" style={{ left: '61%', top: '38%', width: '12%', background: '#FFE066' }}>
            <div className="lp-sk-body">ai: create a LinkedIn post about this new referral program we have</div>
            <NodeBtns phase={linkedin} />
          </div>

          {/* generated post */}
          <div
            className="lp-postcard"
            style={{
              left: '75%',
              top: '33%',
              width: '12%',
              opacity: postShown ? 1 : 0,
              transform: postShown ? 'none' : 'translateY(8px) scale(0.96)',
              transition: 'opacity .4s, transform .4s',
            }}
          >
            <div className="lp-sk-body">{'Excited to share what we just shipped — our new Tiered Referral Program is live! 🎉\n\nWhen someone joins through your link, they land in a personalized onboarding flow tailored to who referred them —'}</div>
            <span className="lp-showmore">Show more · 160 words</span>
          </div>

          {/* img: node */}
          <div className="lp-sticky" style={{ left: '89%', top: '37%', width: '9%', background: '#A8D8EA' }}>
            <div className="lp-sk-body">img: make an image that goes with my LinkedIn post</div>
            <NodeBtns phase={img} />
          </div>

          {/* generated image — the real infographic */}
          <div
            className="lp-imgout"
            style={{
              left: '82%',
              top: '71%',
              width: '15%',
              opacity: imgShown ? 1 : 0,
              transform: imgShown ? 'none' : 'scale(0.92)',
              transition: 'opacity .45s, transform .45s',
            }}
          >
            <img src={infographic} alt="" />
          </div>
        </motion.div>

        {/* ---- fixed chrome over the viewport ---- */}
        <div className="lp-panel lp-topbar">
          <span className="lp-tb-btn">←</span>
          <span className="lp-tb-name">Growth board</span>
          <span className="lp-tb-btn">↩</span>
          <span className="lp-tb-btn">↪</span>
          <span className="lp-tb-btn">☾</span>
          <span className="lp-tb-btn primary">Export</span>
        </div>

        <div className="lp-panel lp-toolbar">
          <span className="lp-grip">⋮⋮</span>
          {TOOLS.map((t, i) => (
            <span key={i} className={`lp-tool${i === 6 ? ' active' : ''}`}>
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
            <rect x="10" y="16" width="13" height="11" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="27" y="16" width="13" height="11" rx="2" fill="rgba(120,200,140,0.85)" />
            <rect x="33" y="40" width="12" height="9" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="20" y="60" width="12" height="9" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="40" y="62" width="12" height="9" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="58" y="58" width="12" height="9" rx="2" fill="rgba(255,200,60,0.9)" />
            <rect x="80" y="42" width="12" height="9" rx="2" fill="rgba(168,216,234,0.85)" />
            <rect x="100" y="44" width="14" height="9" rx="2" fill="rgba(103,65,217,0.7)" />
            <rect x="6" y="10" width="58" height="40" fill="none" stroke="#3c78ff" strokeWidth="1.5" />
          </svg>
        </div>
      </motion.div>
    </div>
  );
}

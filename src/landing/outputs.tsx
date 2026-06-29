import { motion } from 'framer-motion';
import { pop } from './RunnableBoard';

/* Reusable output renderers for example boards. Drop one into a node's
   `out.render` so scenes stay data-like:

     out: { …, render: a => <Bars rows={[['Speed', 3], ['Offline', 2]]} anim={a} /> }

   Each handles its own staggered entrance. Styling lives in landing.css. */

/* horizontal ranked bars — [label, value][] */
export function Bars({ rows, anim = true }: { rows: [string, number][]; anim?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="lp-rb-themes">
      {rows.map(([label, value], i) => (
        <motion.div key={label} className="lp-rb-theme" {...pop(anim, i, { x: -8 })}>
          <span className="lp-rb-theme-label">{label}</span>
          <span className="lp-rb-bar">
            <i style={{ width: `${(value / max) * 100}%` }} />
          </span>
          <span className="lp-rb-count">{value}</span>
        </motion.div>
      ))}
    </div>
  );
}

/* bullet lines — string[] */
export function Bullets({ items, anim = true }: { items: string[]; anim?: boolean }) {
  return (
    <div className="lp-out-lines">
      {items.map((t, i) => (
        <motion.div key={t} className="lp-out-line" {...pop(anim, i, { x: -8 })}>
          <span className="lp-out-bullet" />
          {t}
        </motion.div>
      ))}
    </div>
  );
}

/* rounded tag pills — string[] */
export function Pills({ items, anim = true }: { items: string[]; anim?: boolean }) {
  return (
    <div className="lp-out-pills">
      {items.map((p, i) => (
        <motion.span key={p} className="lp-pill" {...pop(anim, i, { scale: 0.6, y: 6 })}>
          {p}
        </motion.span>
      ))}
    </div>
  );
}

/* two-column table — [left, right][] (right column is emphasized/numeric) */
export function TableOut({ rows, anim = true }: { rows: [string, string][]; anim?: boolean }) {
  return (
    <table className="lp-out-table">
      <tbody>
        {rows.map((r, i) => (
          <motion.tr key={r[0]} {...pop(anim, i, { x: -10 })}>
            <td>{r[0]}</td>
            <td>{r[1]}</td>
          </motion.tr>
        ))}
      </tbody>
    </table>
  );
}

/* a headline + supporting line of copy (tweets, taglines, posts) */
export function Copy({ lead, body, anim = true }: { lead: string; body?: string; anim?: boolean }) {
  return (
    <motion.div className="lp-out-copy" {...pop(anim, 0)}>
      <strong>{lead}</strong>
      {body && (
        <>
          <br />
          {body}
        </>
      )}
    </motion.div>
  );
}

/* a generated image (gradient placeholder) + optional caption */
export function ImageOut({ caption, anim = true }: { caption?: string; anim?: boolean }) {
  return (
    <>
      <motion.div
        className="lp-out-img"
        initial={anim ? { clipPath: 'inset(0 100% 0 0)', opacity: 0.4 } : false}
        animate={{ clipPath: 'inset(0 0% 0 0)', opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: anim ? 0.16 : 0 }}
      />
      {caption && (
        <motion.div className="lp-out-cap" {...pop(anim, 1)}>
          {caption}
        </motion.div>
      )}
    </>
  );
}

/* a long text/markdown output, clamped with a "Show more · N words" pill —
   the real thing the app writes back (verbatim text, not a summary) */
export function Doc({ text, words, anim = true }: { text: string; words?: number; anim?: boolean }) {
  return (
    <motion.div className="lp-out-doc" {...pop(anim, 0)}>
      <div className="lp-out-doc-text">{text}</div>
      {words ? <span className="lp-showmore">Show more · {words} words</span> : null}
    </motion.div>
  );
}

/* a real generated image (import a png and pass it as src) */
export function Photo({ src, anim = true }: { src: string; anim?: boolean }) {
  return (
    <motion.img
      className="lp-out-photo"
      src={src}
      alt=""
      initial={anim ? { opacity: 0, scale: 0.94 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: anim ? 0.15 : 0 }}
    />
  );
}

/* generated logo/mark variations — a row of tiles, each a line-mark on a brand color */
export function Marks({ items, anim = true }: { items: { bg: string; stroke: string; d: string }[]; anim?: boolean }) {
  return (
    <div className="lp-out-marks">
      {items.map((m, i) => (
        <motion.div key={i} className="lp-out-mark" style={{ background: m.bg }} {...pop(anim, i, { scale: 0.7, y: 6 })}>
          <svg viewBox="0 0 24 24" fill="none" stroke={m.stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d={m.d} />
          </svg>
        </motion.div>
      ))}
    </div>
  );
}

/* a small colored callout chip (deltas, stats) — append under another output */
export function Stat({ children, anim = true }: { children: React.ReactNode; anim?: boolean }) {
  return (
    <motion.div className="lp-out-delta" {...pop(anim, 0)}>
      {children}
    </motion.div>
  );
}

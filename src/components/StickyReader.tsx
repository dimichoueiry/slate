import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Controller } from '../engine/controller';
import type { StickyObj, TextObj } from '../types';
import { useUI } from '../store/ui';
import { textBlockSize } from '../engine/text';
import { clampGrowHeight } from '../engine/sticky';

type ReadObj = StickyObj | TextObj;

// Focused reader/editor for long canvas content (sticky notes or text objects).
// Design choices below are grounded in the ui-ux-pro-max skill's UX rules:
//  - line-length-control: constrain the reading column to ~68ch (65–75 chars)
//  - modal-motion / easing: scale+fade entrance with ease-out; reduced-motion respected
//  - focus-states + scale-feedback: visible focus rings, subtle press scale on buttons
//  - progressive reading: a thin scroll-progress bar; opens calm (no autofocus)
// Edits are written back on close as a single change (commit-on-blur behavior).
const CSS = `
@keyframes reader-scrim-in{from{opacity:0}to{opacity:1}}
.sticky-reader-bg{position:fixed;inset:0;z-index:150;background:var(--scrim);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding-top:9vh;animation:reader-scrim-in .18s var(--ease-out) both}
.sticky-reader-bg.closing{opacity:0;transition:opacity .2s ease-in}
.sticky-reader{width:min(720px,94vw);height:min(82vh,860px);display:flex;flex-direction:column;background:var(--elevated);color:var(--text);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--shadow-lg);overflow:hidden;will-change:transform,opacity}
.sticky-reader-head{display:flex;align-items:center;gap:11px;padding:15px 18px;border-bottom:1px solid var(--border)}
.sticky-reader-dot{width:11px;height:11px;border-radius:3px;flex-shrink:0;box-shadow:0 0 0 1px rgba(0,0,0,.25)}
.sticky-reader-title{font-size:13.5px;font-weight:600;letter-spacing:.01em}
.sticky-reader-meta{font-size:11.5px;color:var(--text-dim);margin-right:auto;font-variant-numeric:tabular-nums}
.sticky-reader-head button{border:none;border-radius:9px;padding:7px 13px;font-size:12.5px;font-weight:500;cursor:pointer;background:var(--surface-2);color:var(--text);transition:background var(--dur) var(--ease-out),transform var(--dur-fast) var(--ease-out)}
.sticky-reader-head button:hover{background:var(--surface-hover)}
.sticky-reader-head button:active{transform:scale(.96)}
.sticky-reader-head button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--accent)}
.sticky-reader-head button.primary{background:var(--accent);color:var(--on-accent)}
.sticky-reader-head button.primary:hover{background:var(--violet-2)}
.sticky-reader-progress{height:2px;background:transparent;flex-shrink:0}
.sticky-reader-progress > i{display:block;height:100%;background:var(--accent-grad);transition:width .08s linear}
.sticky-reader-text{flex:1;min-height:0;align-self:center;width:100%;max-width:68ch;box-sizing:border-box;overflow-y:auto;resize:none;border:none;outline:none;background:transparent;color:var(--text);padding:26px 28px 44px;font-size:16px;line-height:1.75;font-family:inherit}
.sticky-reader-text::selection{background:rgba(124,58,237,.4)}
@media (prefers-reduced-motion: reduce){.sticky-reader-bg,.sticky-reader{animation:none}.sticky-reader-head button:active{transform:none}}
`;

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function readingTime(words: number): string {
  return `${Math.max(1, Math.round(words / 220))} min read`;
}

/** Write changed text back to a sticky/text object, keeping its height within the cap. */
function commitText(ctl: Controller, o: ReadObj, text: string) {
  if (o.type === 'sticky') {
    const m = textBlockSize(text || ' ', o.fontSize, o.w - 24, 500, o.fontFamily);
    ctl.doc.update<StickyObj>(o.id, { text, h: clampGrowHeight(o.h, Math.max(o.h, m.h + 24)) });
  } else {
    const m = textBlockSize(text || ' ', o.fontSize, o.fixedWidth ? o.w : undefined, 400, o.fontFamily);
    ctl.doc.update<TextObj>(o.id, { text, w: o.fixedWidth ? o.w : m.w, h: clampGrowHeight(o.h, m.h) });
  }
}

export function StickyReader({ ctl, objectId }: { ctl: Controller; objectId: string }) {
  const o = ctl.doc.get(objectId) as ReadObj | undefined;
  const initial = o && (o.type === 'sticky' || o.type === 'text') ? o.text : '';
  const [text, setText] = useState(initial);
  const [progress, setProgress] = useState(0);

  // keep the latest text for the commit-on-unmount effect
  const textRef = useRef(text);
  textRef.current = text;

  // shared-element transition: grow from / shrink into the trigger's on-screen point
  const cardRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const originRef = useRef(useUI.getState().readerOrigin);
  const closingRef = useRef(false);
  const reduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const offsetToOrigin = (card: HTMLDivElement) => {
    const r = card.getBoundingClientRect();
    const o0 = originRef.current!;
    return { dx: o0.x - (r.left + r.width / 2), dy: o0.y - (r.top + r.height / 2) };
  };

  // entrance: from the note's point, scaled down, to the centered card
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !originRef.current || reduced) return;
    const { dx, dy } = offsetToOrigin(card);
    card.style.transition = 'none';
    card.style.transform = `translate(${dx}px, ${dy}px) scale(0.08)`;
    card.style.opacity = '0';
    void card.offsetWidth; // force reflow so the next styles animate
    card.style.transition = 'transform .34s var(--ease-out), opacity .22s ease-out';
    card.style.transform = 'none';
    card.style.opacity = '1';
  }, [reduced]);

  const finish = () => useUI.getState().set({ readerObjectId: null, readerOrigin: null });

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const card = cardRef.current;
    if (!card || !originRef.current || reduced) {
      finish();
      return;
    }
    bgRef.current?.classList.add('closing');
    const { dx, dy } = offsetToOrigin(card);
    // exit shorter than enter (~65%), shrinking back into the note
    card.style.transition = 'transform .22s var(--ease-out), opacity .18s ease-in';
    card.style.transform = `translate(${dx}px, ${dy}px) scale(0.08)`;
    card.style.opacity = '0';
    window.setTimeout(finish, 220);
  };

  // commit edits back when the modal closes
  useEffect(() => {
    return () => {
      const cur = ctl.doc.get(objectId) as ReadObj | undefined;
      if (cur && (cur.type === 'sticky' || cur.type === 'text') && textRef.current !== cur.text) {
        commitText(ctl, cur, textRef.current);
      }
    };
  }, [ctl, objectId]);

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!o || (o.type !== 'sticky' && o.type !== 'text')) return null;

  const words = countWords(text);
  const copy = () => {
    void navigator.clipboard?.writeText(text);
  };
  const title = o.type === 'sticky' ? 'Sticky note' : 'Text';

  const onScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="sticky-reader-bg" ref={bgRef} onPointerDown={close}>
        <div className="sticky-reader" ref={cardRef} onPointerDown={(e) => e.stopPropagation()}>
          <div className="sticky-reader-head">
            <span className="sticky-reader-dot" style={{ background: o.color }} />
            <span className="sticky-reader-title">{title}</span>
            <span className="sticky-reader-meta">
              {words} words · {readingTime(words)}
            </span>
            <button onClick={copy}>Copy</button>
            <button className="primary" onClick={close}>
              Done
            </button>
          </div>
          <div className="sticky-reader-progress">
            <i style={{ width: `${progress * 100}%` }} />
          </div>
          <textarea
            className="sticky-reader-text"
            value={text}
            spellCheck={false}
            onScroll={onScroll}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      </div>
    </>
  );
}

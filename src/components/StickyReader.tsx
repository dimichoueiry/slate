import { useEffect, useRef, useState } from 'react';
import type { Controller } from '../engine/controller';
import type { StickyObj, TextObj } from '../types';
import { useUI } from '../store/ui';
import { textBlockSize } from '../engine/text';
import { clampGrowHeight } from '../engine/sticky';

type ReadObj = StickyObj | TextObj;

// Centered reader/editor for long canvas content (sticky notes or text objects).
// Mirrors the BrandKit modal look (fixed dimmed backdrop + scrollable card). Edits
// are written back on close as a single change, matching the inline editor's
// commit-on-blur behavior.
const CSS = `
.sticky-reader-bg{position:fixed;inset:0;z-index:150;background:rgba(10,10,14,.45);display:flex;align-items:flex-start;justify-content:center;padding-top:9vh}
.sticky-reader{width:min(680px,92vw);max-height:80vh;display:flex;flex-direction:column;background:rgba(28,28,32,.98);color:#e8e8ea;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.45);overflow:hidden}
.sticky-reader-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)}
.sticky-reader-dot{width:11px;height:11px;border-radius:3px;flex-shrink:0;box-shadow:0 0 0 1px rgba(0,0,0,.25)}
.sticky-reader-title{font-size:13.5px;font-weight:600}
.sticky-reader-count{font-size:11.5px;color:#9a9aa2;margin-right:auto}
.sticky-reader-head button{border:none;border-radius:8px;padding:7px 12px;font-size:12.5px;cursor:pointer;background:rgba(255,255,255,.08);color:#e8e8ea}
.sticky-reader-head button:hover{background:rgba(255,255,255,.16)}
.sticky-reader-head button.primary{background:#3c78ff;color:#fff}
.sticky-reader-head button.primary:hover{background:#5288ff}
.sticky-reader-text{flex:1;overflow-y:auto;width:100%;box-sizing:border-box;resize:none;border:none;outline:none;background:transparent;color:#e8e8ea;padding:18px 20px;font-size:15px;line-height:1.6;font-family:inherit}
`;

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
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

  // keep the latest text for the commit-on-unmount effect
  const textRef = useRef(text);
  textRef.current = text;

  const close = () => useUI.getState().set({ readerObjectId: null });

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

  const copy = () => {
    void navigator.clipboard?.writeText(text);
  };
  const title = o.type === 'sticky' ? 'Sticky note' : 'Text';

  return (
    <>
      <style>{CSS}</style>
      <div className="sticky-reader-bg" onPointerDown={close}>
        <div className="sticky-reader" onPointerDown={(e) => e.stopPropagation()}>
          <div className="sticky-reader-head">
            <span className="sticky-reader-dot" style={{ background: o.color }} />
            <span className="sticky-reader-title">{title}</span>
            <span className="sticky-reader-count">{countWords(text)} words</span>
            <button onClick={copy}>Copy</button>
            <button className="primary" onClick={close}>
              Done
            </button>
          </div>
          <textarea
            className="sticky-reader-text"
            value={text}
            autoFocus
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      </div>
    </>
  );
}

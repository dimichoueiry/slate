import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { Controller } from '../engine/controller';
import type { ConnectorObj, ShapeObj, StickyObj, TextObj } from '../types';
import { fontStack } from '../types';
import { useUI } from '../store/ui';
import { lineHeight, textBlockSize } from '../engine/text';
import { polylineMidpoint, routeConnector } from '../engine/geometry';

const SLASH_COMMANDS: { cmd: string; label: string; desc: string }[] = [
  { cmd: 'ai', label: 'ai:', desc: 'Ask AI — text in, text out' },
  { cmd: 'img', label: 'img:', desc: 'Generate an image' },
  { cmd: 'search', label: 'search:', desc: 'Quick web search' },
  { cmd: 'research', label: 'research:', desc: 'Deep multi-step research agent' },
  { cmd: 'web', label: 'web:', desc: 'Scrape a link / sketch frame' },
  { cmd: 'extract', label: 'extract:', desc: 'Pull a structured table' },
  { cmd: 'chart', label: 'chart:', desc: 'Draw a bar / line / pie chart' },
  { cmd: 'fix', label: 'fix:', desc: 'Improve a prompt' },
  { cmd: 'data', label: 'data:', desc: 'Fetch JSON from any API endpoint' },
];

/**
 * Floating textarea positioned over the edited object. While open, the canvas
 * renders the object without its text (see renderer editingId). Commits one
 * undo step on close. Typing "/" at the start opens a command menu.
 */
export default function TextEditor({ ctl, objectId }: { ctl: Controller; objectId: string }) {
  const obj = ctl.doc.get(objectId) as ShapeObj | StickyObj | TextObj | ConnectorObj | undefined;
  const [value, setValue] = useState(obj ? (obj.type === 'connector' ? (obj.label ?? '') : obj.text) : '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const [, force] = useReducer((n) => n + 1, 0);
  const committed = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [slashSel, setSlashSel] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);

  // reposition while panning/zooming
  useEffect(() => ctl.onCamera(force), [ctl]);
  // restyle live when the object changes (e.g. text color picked while editing)
  useUI((s) => s.docVersion);

  const doCommit = (text: string) => {
    if (committed.current) return;
    committed.current = true;
    const o = ctl.doc.get(objectId) as ShapeObj | StickyObj | TextObj | ConnectorObj | undefined;
    if (o) {
      if (o.type === 'connector') {
        ctl.doc.update<ConnectorObj>(o.id, { label: text.trim() });
      } else if (o.type === 'text') {
        if (text.trim() === '') {
          ctl.doc.delete(o.id);
        } else {
          const m = textBlockSize(text, o.fontSize, o.fixedWidth ? o.w : undefined, 400, o.fontFamily);
          ctl.doc.update<TextObj>(o.id, { text, w: o.fixedWidth ? o.w : m.w, h: m.h });
        }
      } else if (o.type === 'sticky') {
        const m = textBlockSize(text || ' ', o.fontSize, o.w - 24, 500, o.fontFamily);
        ctl.doc.update<StickyObj>(o.id, { text, h: Math.max(o.h, m.h + 24) });
      } else {
        ctl.doc.update<ShapeObj>(o.id, { text });
      }
    }
    if (useUI.getState().editingTextId === objectId) {
      useUI.getState().set({ editingTextId: null });
    }
  };

  useEffect(() => {
    const t = ref.current;
    if (t) {
      t.focus();
      t.select();
    }
  }, []);

  useLayoutEffect(() => {
    const t = ref.current;
    if (t) {
      t.style.height = '0px';
      t.style.height = `${t.scrollHeight}px`;
    }
  });

  // commit on unmount (e.g. canvas click closed the editor before blur fired).
  // Deferred a tick so StrictMode's dev-only unmount/remount doesn't trigger it.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      setTimeout(() => {
        if (!mountedRef.current && !committed.current) doCommit(valueRef.current);
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!obj) return null;

  const zoom = ctl.camera.zoom;
  const fontSize = obj.type === 'connector' ? 13 : obj.fontSize;
  const lh = lineHeight(fontSize);
  const family = fontStack(obj.type === 'connector' ? undefined : obj.fontFamily);

  // slash-command menu: "/" then optional filter, at the very start, on non-connectors
  const slashMatch = obj.type !== 'connector' ? /^\/(\w*)$/.exec(value) : null;
  const slashFilter = slashMatch ? slashMatch[1].toLowerCase() : '';
  const slashItems =
    slashMatch && !slashDismissed
      ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(slashFilter) || c.label.includes(slashFilter))
      : [];
  const showSlash = slashItems.length > 0;
  const sel = Math.min(slashSel, slashItems.length - 1);

  const pickSlash = (cmd: string) => {
    const v = `${cmd}: `;
    setValue(v);
    valueRef.current = v;
    setSlashDismissed(true);
    requestAnimationFrame(() => {
      const t = ref.current;
      if (t) {
        t.focus();
        t.setSelectionRange(v.length, v.length);
      }
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (showSlash) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashSel((i) => (i + 1) % slashItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashSel((i) => (i - 1 + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickSlash(slashItems[sel]!.cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }
    if (e.key === 'Escape') doCommit(valueRef.current);
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) doCommit(valueRef.current);
  };

  // screen-space placement
  const tl = ctl.worldToScreenPt({ x: obj.x, y: obj.y });
  let style: React.CSSProperties = {
    fontSize: fontSize * zoom,
    lineHeight: `${lh * zoom}px`,
    fontFamily: family,
    color: obj.type === 'text' ? obj.color : obj.type === 'shape' ? obj.textColor : 'rgba(20,20,20,0.92)',
  };

  if (obj.type === 'connector') {
    const mid = ctl.worldToScreenPt(polylineMidpoint(routeConnector(obj, ctl.doc.resolve)));
    style = {
      ...style,
      left: mid.x - 60,
      top: mid.y - (lh * zoom) / 2,
      width: 120,
      textAlign: 'center',
      background: '#f3f2ef',
      borderRadius: 6,
      color: obj.stroke,
      fontWeight: 500,
    };
  } else if (obj.type === 'text') {
    style = {
      ...style,
      left: tl.x,
      top: tl.y,
      minWidth: 20,
      width: obj.fixedWidth ? obj.w * zoom : `${Math.max(2, value.length) + 2}ch`,
      background: 'transparent',
    };
  } else if (obj.type === 'sticky') {
    style = {
      ...style,
      left: tl.x + 12 * zoom,
      top: tl.y + 12 * zoom,
      width: (obj.w - 24) * zoom,
      fontWeight: 500,
      background: obj.color,
      outlineColor: 'rgba(0,0,0,0.25)',
    };
  } else {
    // shape: horizontally centered block
    const m = textBlockSize(value || ' ', fontSize, Math.max(8, obj.w - 16), 400, obj.fontFamily);
    const blockH = m.h;
    style = {
      ...style,
      left: tl.x + 8 * zoom,
      top: tl.y + ((obj.h - blockH) / 2) * zoom,
      width: (obj.w - 16) * zoom,
      textAlign: 'center',
      background: 'transparent',
    };
  }

  const menuLeft = typeof style.left === 'number' ? style.left : tl.x;
  const menuTop = (typeof style.top === 'number' ? style.top : tl.y) + lh * zoom + 6;

  return (
    <>
      <textarea
        ref={ref}
        className="text-editor"
        style={style}
        value={value}
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value);
          setSlashDismissed(false);
          setSlashSel(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!showSlash) doCommit(valueRef.current);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
      {showSlash && (
        <div className="slash-menu" style={{ left: menuLeft, top: menuTop }} onPointerDown={(e) => e.preventDefault()}>
          <div className="slash-hint">Insert a command</div>
          {slashItems.map((c, i) => (
            <button
              key={c.cmd}
              className={i === sel ? 'active' : ''}
              onMouseEnter={() => setSlashSel(i)}
              onClick={() => pickSlash(c.cmd)}
            >
              <span className="slash-cmd">{c.label}</span>
              <span className="slash-desc">{c.desc}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

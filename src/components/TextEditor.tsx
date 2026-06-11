import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { Controller } from '../engine/controller';
import type { ConnectorObj, ShapeObj, StickyObj, TextObj } from '../types';
import { fontStack } from '../types';
import { useUI } from '../store/ui';
import { lineHeight, textBlockSize } from '../engine/text';
import { polylineMidpoint, routeConnector } from '../engine/geometry';

/**
 * Floating textarea positioned over the edited object. While open, the canvas
 * renders the object without its text (see renderer editingId). Commits one
 * undo step on close.
 */
export default function TextEditor({ ctl, objectId }: { ctl: Controller; objectId: string }) {
  const obj = ctl.doc.get(objectId) as ShapeObj | StickyObj | TextObj | ConnectorObj | undefined;
  const [value, setValue] = useState(obj ? (obj.type === 'connector' ? (obj.label ?? '') : obj.text) : '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const [, force] = useReducer((n) => n + 1, 0);
  const committed = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  // reposition while panning/zooming
  useEffect(() => ctl.onCamera(force), [ctl]);

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

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
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

  return (
    <textarea
      ref={ref}
      className="text-editor"
      style={style}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => doCommit(valueRef.current)}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

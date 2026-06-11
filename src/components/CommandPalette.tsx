import { useEffect, useMemo, useRef, useState } from 'react';
import type { Controller } from '../engine/controller';
import { listBoards } from '../store/db';
import { useUI } from '../store/ui';
import type { BoardMeta } from '../types';
import { goHome, openBoard } from '../App';

interface Item {
  id: string;
  icon: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** ⌘K palette: search board content, frames and boards; run common commands. */
export default function CommandPalette({ ctl, boardId }: { ctl: Controller; boardId: string }) {
  const open = useUI((s) => s.paletteOpen);
  const set = useUI((s) => s.set);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      void listBoards().then(setBoards);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const close = () => set({ paletteOpen: false });

  const items = useMemo<Item[]>(() => {
    if (!open) return [];
    const ui = useUI.getState();
    const out: Item[] = [];

    for (const f of ctl.frames()) {
      out.push({
        id: `frame-${f.id}`,
        icon: '⧈',
        label: f.name || 'Untitled frame',
        hint: 'frame',
        run: () => ctl.zoomToFrame(f.id),
      });
    }
    for (const o of ctl.doc.allSorted()) {
      let text = '';
      if (o.type === 'text' || o.type === 'sticky') text = o.text;
      else if (o.type === 'shape') text = o.text;
      else if (o.type === 'connector') text = o.label ?? '';
      text = text.trim();
      if (!text) continue;
      const icon = o.type === 'sticky' ? '🗒' : o.type === 'shape' ? '▭' : o.type === 'connector' ? '⤳' : 'T';
      out.push({
        id: `obj-${o.id}`,
        icon,
        label: text.length > 60 ? text.slice(0, 60) + '…' : text.replace(/\n/g, ' '),
        hint: o.type,
        run: () => ctl.zoomToObject(o.id),
      });
    }
    for (const b of boards) {
      if (b.id === boardId) continue;
      out.push({
        id: `board-${b.id}`,
        icon: '▦',
        label: b.name,
        hint: 'board',
        run: () => openBoard(b.id),
      });
    }
    out.push(
      { id: 'cmd-fit', icon: '⛶', label: 'Zoom to fit', hint: '⇧1', run: () => ctl.zoomToFit() },
      { id: 'cmd-notes', icon: '🗒', label: ui.notesOpen ? 'Close notes' : 'Open notes', run: () => ui.set({ notesOpen: !ui.notesOpen }) },
      { id: 'cmd-icons', icon: '✦', label: 'Open icon library', hint: 'I', run: () => ui.set({ iconTrayOpen: true }) },
      { id: 'cmd-grid', icon: '⊞', label: 'Cycle grid style', run: () => {
        const next = ui.gridMode === 'dots' ? 'lines' : ui.gridMode === 'lines' ? 'none' : 'dots';
        ui.set({ gridMode: next });
        ctl.markSceneDirty();
      } },
      { id: 'cmd-home', icon: '←', label: 'All boards', run: () => goHome() }
    );
    return out;
  }, [open, boards, boardId, ctl]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filtered = (
    q
      ? items
          .filter((i) => i.label.toLowerCase().includes(q) || i.hint?.includes(q))
          .sort((a, b) => Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)))
      : items
  ).slice(0, 12);
  const active = Math.min(index, Math.max(0, filtered.length - 1));

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && filtered[active]) {
      filtered[active].run();
      close();
    }
  };

  return (
    <div className="palette-backdrop" onPointerDown={close}>
      <div className="palette" onPointerDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder="Search text, frames, boards — or run a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list">
          {filtered.map((item, i) => (
            <button
              key={item.id}
              className={i === active ? 'active' : ''}
              onPointerEnter={() => setIndex(i)}
              onClick={() => {
                item.run();
                close();
              }}
            >
              <span className="palette-icon">{item.icon}</span>
              <span className="palette-label">{item.label}</span>
              {item.hint && <span className="palette-hint">{item.hint}</span>}
            </button>
          ))}
          {filtered.length === 0 && <div className="palette-empty">No matches for “{query}”</div>}
        </div>
      </div>
    </div>
  );
}

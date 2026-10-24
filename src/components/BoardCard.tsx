// One dashboard board card. The whole card is a real <button> (Tab to it,
// Enter opens), and every action lives in an always-present "⋯" menu button —
// nothing is hover-only, so keyboard and touch users can reach all of it.
import { useEffect, useRef, useState } from 'react';
import type { BoardMeta, Project } from '../types';
import { duplicateBoard, restoreBoard, trashBoard, updateBoardMeta } from '../store/db';
import { exportSlateFileById, downloadBlob } from '../export/export';
import { fullTime, relativeTime } from '../store/relativeTime';
import { openBoard } from '../App';
import { promptDialog, toast } from './Dialogs';

interface Props {
  board: BoardMeta;
  projects: Project[];
  now: number;
  refresh: () => void;
}

export default function BoardCard({ board: b, projects, now, refresh }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);

  return (
    <div className={`board-card${menuOpen ? ' menu-open' : ''}`}>
      <button className="card-open" onClick={() => openBoard(b.id)} aria-label={`Open board ${b.name}`}>
        {b.thumb ? <img className="thumb" src={b.thumb} alt="" /> : <div className="thumb empty">empty board</div>}
        <div className="meta">
          <div className="name">
            {b.pinned ? <span title="Pinned">📌 </span> : ''}
            {b.name}
          </div>
          <div className="date">
            Edited <time dateTime={new Date(b.updatedAt).toISOString()} title={fullTime(b.updatedAt)}>{relativeTime(b.updatedAt, now)}</time>
          </div>
        </div>
      </button>
      <button
        ref={menuBtn}
        className="card-menu-btn"
        aria-label={`Actions for ${b.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
      >
        ⋯
      </button>
      {menuOpen && (
        <CardMenu
          board={b}
          projects={projects}
          refresh={refresh}
          anchor={menuBtn}
          onClose={(refocus) => {
            setMenuOpen(false);
            if (refocus) menuBtn.current?.focus();
          }}
        />
      )}
    </div>
  );
}

type Item =
  | { kind: 'action'; label: string; danger?: boolean; run: () => void | Promise<void> }
  | { kind: 'radio'; label: string; checked: boolean; run: () => void | Promise<void> }
  | { kind: 'sep' }
  | { kind: 'heading'; label: string };

function CardMenu({
  board: b,
  projects,
  refresh,
  anchor,
  onClose,
}: {
  board: BoardMeta;
  projects: Project[];
  refresh: () => void;
  anchor: React.RefObject<HTMLButtonElement | null>;
  onClose: (refocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const moveTo = (projectId: string | null) => async () => {
    await updateBoardMeta(b.id, { projectId });
    refresh();
  };

  const items: Item[] = [
    { kind: 'action', label: 'Open', run: () => openBoard(b.id) },
    {
      kind: 'action',
      label: 'Rename…',
      run: async () => {
        const name = await promptDialog({ title: 'Rename board', label: 'Board name', initial: b.name });
        if (name) {
          await updateBoardMeta(b.id, { name });
          refresh();
        }
      },
    },
    {
      kind: 'action',
      label: 'Duplicate',
      run: async () => {
        await duplicateBoard(b.id);
        refresh();
      },
    },
    {
      kind: 'action',
      label: b.pinned ? 'Unpin' : 'Pin to top',
      run: async () => {
        await updateBoardMeta(b.id, { pinned: !b.pinned });
        refresh();
      },
    },
    {
      kind: 'action',
      label: 'Export as .slate',
      run: async () => {
        const out = await exportSlateFileById(b.id);
        if (out) downloadBlob(out.blob, `${out.name}.slate`);
      },
    },
    { kind: 'sep' },
    { kind: 'heading', label: 'Move to project' },
    { kind: 'radio', label: 'Unfiled', checked: !projects.some((p) => p.id === b.projectId), run: moveTo(null) },
    ...projects.map((p): Item => ({ kind: 'radio', label: p.name, checked: b.projectId === p.id, run: moveTo(p.id) })),
    { kind: 'sep' },
    {
      kind: 'action',
      label: 'Move to Trash',
      danger: true,
      run: async () => {
        await trashBoard(b.id);
        refresh();
        toast(`“${b.name}” moved to Trash.`, {
          action: {
            label: 'Undo',
            run: async () => {
              await restoreBoard(b.id);
              refresh();
            },
          },
        });
      },
    },
  ];

  const menuItems = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];

  useEffect(() => {
    menuItems()[0]?.focus();
    // close on any pointer down outside the menu and its button
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = menuItems();
    const i = els.indexOf(document.activeElement as HTMLElement);
    const focusAt = (n: number) => els[(n + els.length) % els.length]?.focus();
    if (e.key === 'ArrowDown') focusAt(i + 1);
    else if (e.key === 'ArrowUp') focusAt(i - 1);
    else if (e.key === 'Home') focusAt(0);
    else if (e.key === 'End') focusAt(els.length - 1);
    else if (e.key === 'Escape') onClose(true);
    else if (e.key === 'Tab') return onClose(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={ref} className="card-menu" role="menu" aria-label={`Actions for ${b.name}`} onKeyDown={onKeyDown}>
      {items.map((it, i) => {
        if (it.kind === 'sep') return <div key={i} className="card-menu-sep" role="separator" />;
        if (it.kind === 'heading')
          return (
            <div key={i} className="card-menu-heading" role="presentation">
              {it.label}
            </div>
          );
        return (
          <button
            key={i}
            role={it.kind === 'radio' ? 'menuitemradio' : 'menuitem'}
            aria-checked={it.kind === 'radio' ? it.checked : undefined}
            tabIndex={-1}
            className={`card-menu-item${it.kind === 'action' && it.danger ? ' danger' : ''}`}
            onClick={() => {
              onClose(true);
              void it.run();
            }}
          >
            {it.kind === 'radio' && <span className="card-menu-check" aria-hidden="true">{it.checked ? '✓' : ''}</span>}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

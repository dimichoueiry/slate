import { useEffect, useRef, useState } from 'react';
import type { Controller } from '../engine/controller';
import { useUI } from '../store/ui';
import { db, updateBoardMeta } from '../store/db';
import { goHome } from '../App';
import { downloadBlob, exportBounds, exportPng, exportSlateFile, exportSvg } from '../export/export';
import { getFlows, runFlow, type Flow } from '../ui/ainodes';
import { setCanvasDark } from '../store/theme';
import BrandKitControl from './BrandKit';
import { DRAW_STYLES, DRAW_STYLE_LABELS, isDrawStyle } from '../engine/style';
import { takeNameRequest } from '../store/pendingName';
import { toast } from './Dialogs';
import { ArrowLeft, Contrast, Frame, NotebookText, Play, Grid3x3, Grip, Magnet, Moon, Redo2, Square, Sun, Undo2 } from 'lucide-react';

export default function TopBar({ ctl, boardId }: { ctl: Controller; boardId: string }) {
  const ui = useUI();
  const [menu, setMenu] = useState(false);
  const [framesMenu, setFramesMenu] = useState(false);
  const [flowMenu, setFlowMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flow, setFlow] = useState<{ done: number; total: number; loop?: { iter: number; total: number } } | null>(null);
  useUI((s) => s.docVersion); // keep the frames/flows list fresh
  const frames = ctl.frames();
  const flows = getFlows(ctl);

  const onRunFlow = async (f: Flow) => {
    if (flow) return;
    setFlowMenu(false);
    setFlow({ done: 0, total: f.nodes.length });
    try {
      await runFlow(ctl, f.nodes, (done, total, _node, loop) => setFlow({ done, total, loop }));
    } finally {
      setFlow(null);
    }
  };

  const rename = (name: string) => {
    ui.set({ boardName: name });
    void updateBoardMeta(boardId, { name });
  };

  // Name on create: a board just made from the dashboard opens with its name
  // selected — typing replaces it, Enter keeps what's there, Escape reverts.
  const nameRef = useRef<HTMLInputElement>(null);
  const nameAtFocus = useRef('');
  const [naming, setNaming] = useState(false);
  useEffect(() => {
    if (!takeNameRequest(boardId)) return;
    setNaming(true);
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [boardId]);
  const onNameKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (ui.boardName !== nameAtFocus.current) rename(nameAtFocus.current);
      e.currentTarget.blur();
    }
  };
  const onNameBlur = () => {
    setNaming(false);
    // an emptied field means "never mind", not a nameless board
    if (!ui.boardName.trim()) rename(nameAtFocus.current || 'Untitled board');
  };

  const doExport = async (
    format: 'png' | 'png2x' | 'svg' | 'slate',
    selectionOnly: boolean,
    frameId?: string
  ) => {
    setMenu(false);
    setBusy(true);
    try {
      let name = ui.boardName || 'board';
      if (format === 'slate') {
        const meta = await db.boards.get(boardId);
        if (meta) downloadBlob(await exportSlateFile(meta, ctl.doc), `${name}.slate`);
        return;
      }
      let box = exportBounds(ctl.doc, selectionOnly ? ctl.selection : undefined);
      if (frameId) {
        const f = ctl.doc.get(frameId);
        if (f && f.type === 'frame') {
          box = { x: f.x, y: f.y, w: f.w, h: f.h };
          name = f.name || name;
        }
      }
      if (!box) {
        toast('Nothing to export yet — the board is empty.');
        return;
      }
      if (format === 'svg') {
        const svg = await exportSvg(ctl.doc, box, false);
        downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
      } else {
        const scale = format === 'png2x' ? 2 : 1;
        downloadBlob(await exportPng(ctl.doc, box, scale, false), `${name}.png`);
      }
    } finally {
      setBusy(false);
    }
  };

  const hasSelection = ui.selection.length > 0;

  return (
    <>
      <div className="panel topbar">
        <button className="chrome-btn" title="All boards" aria-label="All boards" onClick={() => goHome()}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <span className="board-name-wrap">
          <input
            ref={nameRef}
            className={`board-name${naming ? ' naming' : ''}`}
            aria-label="Board name"
            value={ui.boardName}
            onChange={(e) => rename(e.target.value)}
            onFocus={() => (nameAtFocus.current = useUI.getState().boardName)}
            onKeyDown={onNameKey}
            onBlur={onNameBlur}
            spellCheck={false}
          />
          {naming && (
            <span className="name-hint" role="note">
              Name your board · <kbd>Enter</kbd> to save · <kbd>Esc</kbd> to keep “{nameAtFocus.current}”
            </span>
          )}
        </span>
        <button className="chrome-btn" disabled={!ui.canUndo} title="Undo (⌘Z)" aria-label="Undo" onClick={() => ctl.undo()}>
          <Undo2 size={16} aria-hidden="true" />
        </button>
        <button className="chrome-btn" disabled={!ui.canRedo} title="Redo (⌘⇧Z)" aria-label="Redo" onClick={() => ctl.redo()}>
          <Redo2 size={16} aria-hidden="true" />
        </button>
        <button
          className="chrome-btn"
          title="Cycle grid"
          onClick={() => {
            const next = ui.gridMode === 'dots' ? 'lines' : ui.gridMode === 'lines' ? 'none' : 'dots';
            ui.set({ gridMode: next });
            ctl.markSceneDirty();
          }}
        >
          {ui.gridMode === 'dots' ? <Grip size={16} aria-hidden="true" /> : ui.gridMode === 'lines' ? <Grid3x3 size={16} aria-hidden="true" /> : <Square size={16} aria-hidden="true" />}
        </button>
        <button
          className={`chrome-btn`}
          title="Toggle snapping"
          style={{ opacity: ui.snapEnabled ? 1 : 0.5 }}
          onClick={() => ui.set({ snapEnabled: !ui.snapEnabled })}
        >
          <Magnet size={16} aria-hidden="true" />
        </button>
        <button
          className="chrome-btn"
          title={ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => ui.toggleTheme()}
        >
          {ui.theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
        </button>
        <button
          className="chrome-btn"
          title={ui.canvasDark ? 'Light canvas for this board' : 'Dark canvas for this board'}
          aria-pressed={ui.canvasDark}
          style={{ background: ui.canvasDark ? 'var(--accent)' : undefined }}
          onClick={() => {
            const next = !ui.canvasDark;
            ui.set({ canvasDark: next });
            ui.syncCanvasInk(next);
            setCanvasDark(next);
            ctl.markSceneDirty();
            void updateBoardMeta(boardId, { canvasDark: next });
          }}
        >
          <Contrast size={16} aria-hidden="true" />
        </button>
        <select
          className="font-select board-style-select"
          title="Drawing style for this board"
          value={ui.boardStyle}
          onChange={(e) => {
            const next = e.target.value;
            if (!isDrawStyle(next)) return;
            ctl.setBoardStyle(next);
            void updateBoardMeta(boardId, { style: next });
          }}
        >
          {DRAW_STYLES.map((st) => (
            <option key={st} value={st}>
              {DRAW_STYLE_LABELS[st]}
            </option>
          ))}
        </select>
        <button
          className="chrome-btn"
          title="Reveal mode"
          style={{ background: ui.revealMode ? 'var(--accent)' : undefined }}
          onClick={() => ui.set({ revealMode: !ui.revealMode, presenting: false, presentationStep: 0 })}
        >
          Reveal
        </button>
        {flows.length > 0 && (
          <button
            className="chrome-btn"
            style={{ background: flow ? 'var(--accent)' : 'var(--ink)', color: '#fff' }}
            disabled={!!flow}
            title="Run a connected flow of nodes in dependency order"
            onClick={() => {
              if (flow) return;
              if (flows.length === 1) void onRunFlow(flows[0]);
              else {
                setFlowMenu((m) => !m);
                setMenu(false);
                setFramesMenu(false);
              }
            }}
          >
            {flow
              ? flow.loop
                ? `Loop ${flow.loop.iter}/${flow.loop.total} · ${flow.done}/${flow.total}…`
                : `Running ${flow.done}/${flow.total}…`
              : flows.length === 1
                ? <><Play size={14} aria-hidden="true" /> Run flow ({flows[0].nodes.length})</>
                : <><Play size={14} aria-hidden="true" /> Run flow ({flows.length} flows)</>}
          </button>
        )}
        <BrandKitControl ctl={ctl} boardId={boardId} />
        {frames.length > 0 && (
          <button
            className="chrome-btn"
            title="Jump to a frame"
            onClick={() => {
              setFramesMenu((m) => !m);
              setMenu(false);
            }}
          >
            <Frame size={14} aria-hidden="true" /> {frames.length}
          </button>
        )}
        <button
          className="chrome-btn"
          title="Markdown notes"
          style={{ background: ui.notesOpen ? 'var(--accent)' : undefined }}
          onClick={() => ui.set({ notesOpen: !ui.notesOpen })}
        >
          <NotebookText size={14} aria-hidden="true" /> Notes
        </button>
        <button
          className="chrome-btn primary"
          disabled={busy}
          onClick={() => {
            setMenu((m) => !m);
            setFramesMenu(false);
          }}
        >
          {busy ? 'Exporting…' : 'Export'}
        </button>
      </div>
      {framesMenu && (
        <div className="menu" style={{ top: 58, left: 12 }} onPointerLeave={() => setFramesMenu(false)}>
          <div className="menu-label">Jump to frame</div>
          {frames.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                ctl.zoomToFrame(f.id);
                setFramesMenu(false);
              }}
            >
              {f.name || 'Untitled frame'}
            </button>
          ))}
        </div>
      )}
      {flowMenu && (
        <div className="menu" style={{ top: 58, left: 12 }} onPointerLeave={() => setFlowMenu(false)}>
          <div className="menu-label">Run which flow?</div>
          {flows.map((f) => (
            <button key={f.id} onClick={() => void onRunFlow(f)}>
              {f.label} <span>{f.nodes.length} node{f.nodes.length === 1 ? '' : 's'}</span>
            </button>
          ))}
          <div className="sep" />
          <button
            onClick={async () => {
              setFlowMenu(false);
              for (const f of flows) {
                setFlow({ done: 0, total: f.nodes.length });
                await runFlow(ctl, f.nodes, (done, total, _node, loop) => setFlow({ done, total, loop }));
              }
              setFlow(null);
            }}
          >
            Run all flows <span>{flows.length}</span>
          </button>
        </div>
      )}
      {menu && (
        <div className="menu" style={{ top: 58, left: 12 }} onPointerLeave={() => setMenu(false)}>
          <div className="menu-label">Whole board</div>
          <button onClick={() => doExport('png', false)}>PNG <span>1×</span></button>
          <button onClick={() => doExport('png2x', false)}>PNG <span>2×</span></button>
          <button onClick={() => doExport('svg', false)}>SVG</button>
          {hasSelection && (
            <>
              <div className="sep" />
              <div className="menu-label">Selection only</div>
              <button onClick={() => doExport('png2x', true)}>PNG <span>2×</span></button>
              <button onClick={() => doExport('svg', true)}>SVG</button>
            </>
          )}
          {frames.length > 0 && (
            <>
              <div className="sep" />
              <div className="menu-label">Frames</div>
              {frames.slice(0, 8).map((f) => (
                <button key={f.id} onClick={() => doExport('png2x', false, f.id)}>
                  {f.name || 'Untitled frame'} <span>PNG 2×</span>
                </button>
              ))}
            </>
          )}
          <div className="sep" />
          <button onClick={() => doExport('slate', false)}>
            Backup as .slate <span>full fidelity</span>
          </button>
        </div>
      )}
    </>
  );
}

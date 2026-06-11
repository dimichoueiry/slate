import { useState } from 'react';
import type { Controller } from '../engine/controller';
import { useUI } from '../store/ui';
import { db, updateBoardMeta } from '../store/db';
import { goHome } from '../App';
import { downloadBlob, exportBounds, exportPng, exportSlateFile, exportSvg } from '../export/export';

export default function TopBar({ ctl, boardId }: { ctl: Controller; boardId: string }) {
  const ui = useUI();
  const [menu, setMenu] = useState(false);
  const [framesMenu, setFramesMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  useUI((s) => s.docVersion); // keep the frames list fresh
  const frames = ctl.frames();

  const rename = (name: string) => {
    ui.set({ boardName: name });
    void updateBoardMeta(boardId, { name });
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
        alert('Nothing to export yet — the board is empty.');
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
        <button className="chrome-btn" title="All boards" onClick={() => goHome()}>
          ←
        </button>
        <input value={ui.boardName} onChange={(e) => rename(e.target.value)} spellCheck={false} />
        <button className="chrome-btn" disabled={!ui.canUndo} title="Undo (⌘Z)" onClick={() => ctl.undo()}>
          ↩
        </button>
        <button className="chrome-btn" disabled={!ui.canRedo} title="Redo (⌘⇧Z)" onClick={() => ctl.redo()}>
          ↪
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
          {ui.gridMode === 'dots' ? '⋮⋮' : ui.gridMode === 'lines' ? '⊞' : '▢'}
        </button>
        <button
          className={`chrome-btn`}
          title="Toggle snapping"
          style={{ opacity: ui.snapEnabled ? 1 : 0.5 }}
          onClick={() => ui.set({ snapEnabled: !ui.snapEnabled })}
        >
          ⌖
        </button>
        {frames.length > 0 && (
          <button
            className="chrome-btn"
            title="Jump to a frame"
            onClick={() => {
              setFramesMenu((m) => !m);
              setMenu(false);
            }}
          >
            ⧈ {frames.length}
          </button>
        )}
        <button
          className="chrome-btn"
          title="Markdown notes"
          style={{ background: ui.notesOpen ? 'var(--accent)' : undefined }}
          onClick={() => ui.set({ notesOpen: !ui.notesOpen })}
        >
          🗒 Notes
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

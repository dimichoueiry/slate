import { useState } from 'react';
import type { Controller } from '../engine/controller';
import { useUI } from '../store/ui';
import { db, updateBoardMeta } from '../store/db';
import { goHome } from '../App';
import { downloadBlob, exportBounds, exportPng, exportSlateFile, exportSvg } from '../export/export';

export default function TopBar({ ctl, boardId }: { ctl: Controller; boardId: string }) {
  const ui = useUI();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);

  const rename = (name: string) => {
    ui.set({ boardName: name });
    void updateBoardMeta(boardId, { name });
  };

  const doExport = async (format: 'png' | 'png2x' | 'svg' | 'slate', selectionOnly: boolean) => {
    setMenu(false);
    setBusy(true);
    try {
      const name = ui.boardName || 'board';
      if (format === 'slate') {
        const meta = await db.boards.get(boardId);
        if (meta) downloadBlob(await exportSlateFile(meta, ctl.doc), `${name}.slate`);
        return;
      }
      const box = exportBounds(ctl.doc, selectionOnly ? ctl.selection : undefined);
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
        <button
          className="chrome-btn"
          title="Markdown notes"
          style={{ background: ui.notesOpen ? 'var(--accent)' : undefined }}
          onClick={() => ui.set({ notesOpen: !ui.notesOpen })}
        >
          🗒 Notes
        </button>
        <button className="chrome-btn primary" disabled={busy} onClick={() => setMenu((m) => !m)}>
          {busy ? 'Exporting…' : 'Export'}
        </button>
      </div>
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
          <div className="sep" />
          <button onClick={() => doExport('slate', false)}>
            Backup as .slate <span>full fidelity</span>
          </button>
        </div>
      )}
    </>
  );
}

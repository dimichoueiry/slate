import { useEffect, useRef, useState } from 'react';
import type { BoardMeta } from '../types';
import { createBoard, deleteBoard, duplicateBoard, listBoards, updateBoardMeta } from '../store/db';
import { importSlateFile } from '../export/export';
import { openBoard } from '../App';

export default function Home() {
  const [boards, setBoards] = useState<BoardMeta[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => listBoards().then(setBoards);
  useEffect(() => {
    refresh();
    // thumbnails are written asynchronously when a board closes; pick them up
    const t = setTimeout(refresh, 1200);
    return () => clearTimeout(t);
  }, []);

  const onNew = async () => {
    const b = await createBoard();
    openBoard(b.id);
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const board = await importSlateFile(file);
      openBoard(board.id);
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div className="home">
      <h1>
        <span className="logo">▱</span> Slate
      </h1>
      <p className="sub">
        Your infinite sketchbook — local, instant, offline.{' '}
        <button
          className="chrome-btn"
          style={{ marginLeft: 8 }}
          onClick={() => fileRef.current?.click()}
        >
          Import .slate
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".slate,application/json"
          hidden
          onChange={(e) => onImport(e.target.files?.[0])}
        />
      </p>
      <div className="board-grid">
        <button className="new-board" onClick={onNew}>
          <span className="plus">＋</span> New board
        </button>
        {(boards ?? []).map((b) => (
          <div key={b.id} className="board-card" onClick={() => openBoard(b.id)}>
            {b.thumb ? (
              <img className="thumb" src={b.thumb} alt="" />
            ) : (
              <div className="thumb empty">empty board</div>
            )}
            <div className="meta">
              <div className="name">
                {b.pinned ? '📌 ' : ''}
                {b.name}
              </div>
              <div className="date">{new Date(b.updatedAt).toLocaleString()}</div>
            </div>
            <div className="card-actions" onClick={(e) => e.stopPropagation()}>
              <button
                title={b.pinned ? 'Unpin' : 'Pin'}
                onClick={async () => {
                  await updateBoardMeta(b.id, { pinned: !b.pinned });
                  refresh();
                }}
              >
                📌
              </button>
              <button
                title="Rename"
                onClick={async () => {
                  const name = prompt('Rename board', b.name);
                  if (name) {
                    await updateBoardMeta(b.id, { name });
                    refresh();
                  }
                }}
              >
                ✏️
              </button>
              <button
                title="Duplicate"
                onClick={async () => {
                  await duplicateBoard(b.id);
                  refresh();
                }}
              >
                ⧉
              </button>
              <button
                title="Delete"
                onClick={async () => {
                  if (confirm(`Delete “${b.name}”? This cannot be undone.`)) {
                    await deleteBoard(b.id);
                    refresh();
                  }
                }}
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

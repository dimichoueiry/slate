import { useEffect, useRef, useState } from 'react';
import type { BoardMeta, Project } from '../types';
import {
  createBoard,
  createProject,
  deleteBoard,
  deleteProject,
  duplicateBoard,
  listBoards,
  listProjects,
  renameProject,
  updateBoardMeta,
} from '../store/db';
import { importSlateFile } from '../export/export';
import { openBoard } from '../App';

export default function Home() {
  const [boards, setBoards] = useState<BoardMeta[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    void listBoards().then(setBoards);
    void listProjects().then(setProjects);
  };
  useEffect(() => {
    refresh();
    const t = setTimeout(refresh, 1200); // catch async thumbnails
    return () => clearTimeout(t);
  }, []);

  const onNew = async (projectId: string | null = null) => {
    const b = await createBoard('Untitled board', projectId);
    openBoard(b.id);
  };

  const onNewProject = async () => {
    const name = prompt('Project name', 'New project');
    if (name) {
      await createProject(name);
      refresh();
    }
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

  const all = boards ?? [];
  const unfiled = all.filter((b) => !b.projectId);

  return (
    <div className="home">
      <h1>
        <span className="logo">▱</span> Slate
      </h1>
      <p className="sub">
        Your infinite sketchbook — local, instant, offline.{' '}
        <button className="chrome-btn" style={{ marginLeft: 8 }} onClick={() => fileRef.current?.click()}>
          Import .slate
        </button>
        <button className="chrome-btn" style={{ marginLeft: 6 }} onClick={onNewProject}>
          ＋ New project
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".slate,application/json"
          hidden
          onChange={(e) => onImport(e.target.files?.[0])}
        />
      </p>

      {/* standalone / unfiled boards */}
      <div className="board-grid">
        <button className="new-board" onClick={() => onNew(null)}>
          <span className="plus">＋</span> New board
        </button>
        {unfiled.map((b) => (
          <BoardCard key={b.id} board={b} projects={projects} refresh={refresh} />
        ))}
      </div>

      {/* projects */}
      {projects.map((p) => {
        const inProject = all.filter((b) => b.projectId === p.id);
        return (
          <div key={p.id} className="project-section">
            <div className="project-header">
              <span className="project-name">📁 {p.name}</span>
              <span className="project-count">{inProject.length}</span>
              <button
                className="proj-act"
                title="Rename project"
                onClick={async () => {
                  const name = prompt('Rename project', p.name);
                  if (name) {
                    await renameProject(p.id, name);
                    refresh();
                  }
                }}
              >
                ✏️
              </button>
              <button
                className="proj-act"
                title="Delete project (its boards become unfiled)"
                onClick={async () => {
                  if (confirm(`Delete project “${p.name}”? Its boards move to Unfiled.`)) {
                    await deleteProject(p.id);
                    refresh();
                  }
                }}
              >
                🗑
              </button>
            </div>
            <div className="board-grid">
              <button className="new-board small" onClick={() => onNew(p.id)}>
                <span className="plus">＋</span> New board
              </button>
              {inProject.map((b) => (
                <BoardCard key={b.id} board={b} projects={projects} refresh={refresh} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({ board: b, projects, refresh }: { board: BoardMeta; projects: Project[]; refresh: () => void }) {
  return (
    <div className="board-card" onClick={() => openBoard(b.id)}>
      {b.thumb ? <img className="thumb" src={b.thumb} alt="" /> : <div className="thumb empty">empty board</div>}
      <div className="meta">
        <div className="name">
          {b.pinned ? '📌 ' : ''}
          {b.name}
        </div>
        <div className="date">{new Date(b.updatedAt).toLocaleString()}</div>
      </div>
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        <select
          className="move-select"
          title="Move to project"
          value={b.projectId ?? ''}
          onChange={async (e) => {
            await updateBoardMeta(b.id, { projectId: e.target.value || null });
            refresh();
          }}
        >
          <option value="">📂 Unfiled</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              📁 {p.name}
            </option>
          ))}
        </select>
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
  );
}

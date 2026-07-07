import { useEffect, useRef, useState } from 'react';
import { useUI } from '../store/ui';
import type { BoardMeta, Project } from '../types';
import {
  createBoard,
  createProject,
  deleteBoard,
  deleteProject,
  duplicateBoard,
  listBoards,
  listBrandKits,
  listProjects,
  renameProject,
  saveBrandKit,
  setDefaultKitId,
  setProjectKit,
  updateBoardMeta,
} from '../store/db';
import { importAnySlateFile, exportArchive, exportSlateFileById, downloadBlob } from '../export/export';
import { useDurability, enableAutoBackup, regrantAutoBackup, disableAutoBackup } from '../store/durability';
import { openBoard } from '../App';
import { BRAND_PRESETS } from '../engine/brandPresets';
import { nanoid } from 'nanoid';
import type { BrandKit } from '../types';

const ONBOARD_KEY = 'slate-onboarded';

export default function Home() {
  const [boards, setBoards] = useState<BoardMeta[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [onboarded, setOnboarded] = useState(() => {
    try {
      return localStorage.getItem(ONBOARD_KEY) === '1';
    } catch {
      return true;
    }
  });
  const [dbError, setDbError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    // a failed read must NEVER render as an empty board list — that reads as
    // "all my boards got deleted" when the truth is "couldn't open storage"
    listBoards().then(setBoards, (e) => setDbError(String(e?.message ?? e)));
    void listProjects().then(setProjects).catch(() => undefined);
    void listBrandKits().then(setKits).catch(() => undefined);
  };
  useEffect(() => {
    refresh();
    const t = setTimeout(refresh, 1200); // catch async thumbnails
    return () => clearTimeout(t);
  }, []);

  const dismissOnboard = () => {
    try {
      localStorage.setItem(ONBOARD_KEY, '1');
    } catch {
      /* ignore */
    }
    setOnboarded(true);
  };

  const pickWorkspace = async (presetId: string | null) => {
    if (presetId) {
      const p = BRAND_PRESETS.find((x) => x.id === presetId);
      if (p) {
        const kit: BrandKit = {
          id: nanoid(10),
          name: p.name,
          voice: p.voice,
          audience: p.audience,
          donts: p.donts,
          palette: p.palette,
          fontFamily: 'hand',
          createdAt: Date.now(),
        };
        await saveBrandKit(kit);
        setDefaultKitId(kit.id);
      }
    }
    dismissOnboard();
    refresh();
  };

  const showOnboarding = !onboarded && kits.length === 0;

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
      const result = await importAnySlateFile(file);
      if (result.kind === 'board') openBoard(result.board.id);
      else {
        alert(`Restored ${result.boards} board${result.boards === 1 ? '' : 's'} and ${result.projects} project${result.projects === 1 ? '' : 's'} from the archive.`);
        refresh();
      }
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  const onExportAll = async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(await exportArchive(), `slate-all-${stamp}.slate`);
  };

  const all = boards ?? [];
  const unfiled = all.filter((b) => !b.projectId);

  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);

  if (dbError) {
    return (
      <div className="home">
        <h1>
          <span className="logo">▱</span> Slate
        </h1>
        <div className="durability warn" style={{ margin: '24px 0', maxWidth: 720 }}>
          <span>
            ⚠ Slate couldn't open its local storage — your boards are <b>not deleted</b>, this tab just lost its
            connection (usually after an update in another tab).{' '}
            <button className="chrome-btn" onClick={() => location.reload()}>
              Reload to reconnect
            </button>
          </span>
          <span style={{ opacity: 0.7, fontSize: 12 }}>({dbError})</span>
        </div>
      </div>
    );
  }

  return (
    <div className="home">
      <button
        className="home-theme-toggle"
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        onClick={() => toggleTheme()}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <h1>
        <span className="logo">▱</span> Slate
      </h1>
      <p className="sub">
        Your infinite sketchbook — local, instant, offline.{' '}
        <button className="chrome-btn" style={{ marginLeft: 8 }} onClick={() => fileRef.current?.click()}>
          Import .slate
        </button>
        <button className="chrome-btn" style={{ marginLeft: 6 }} title="Download every board, project and asset as one backup file" onClick={() => void onExportAll()}>
          ⬇ Export all
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

      <DurabilityBanner />

      {showOnboarding && (
        <div className="onboard-card">
          <div className="onboard-title">What will you use Slate for?</div>
          <div className="onboard-sub">
            We'll set a brand voice so AI nodes match your style. You can change or add more anytime in ⚙ Settings.
          </div>
          <div className="onboard-presets">
            {BRAND_PRESETS.map((p) => (
              <button key={p.id} className="onboard-preset" onClick={() => void pickWorkspace(p.id)}>
                <span className="oemoji">{p.emoji}</span>
                <span className="oname">{p.name}</span>
              </button>
            ))}
          </div>
          <button className="onboard-skip" onClick={() => void pickWorkspace(null)}>
            Skip for now
          </button>
        </div>
      )}

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
              <select
                className="move-select"
                title="Default brand kit for this project"
                value={p.brandKitId ?? ''}
                onChange={async (e) => {
                  await setProjectKit(p.id, e.target.value || null);
                  refresh();
                }}
              >
                <option value="">⬡ Brand: default</option>
                {kits.map((k) => (
                  <option key={k.id} value={k.id}>
                    ⬡ {k.name}
                  </option>
                ))}
              </select>
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

/**
 * One quiet row about data safety. Loud only when something is actually wrong:
 * the browser refused persistent storage, or backups stopped working.
 */
function DurabilityBanner() {
  const { persisted, backup, lastBackupAt, backupError } = useDurability();

  const atRisk = persisted === false;
  if (!atRisk && backup === 'unsupported') return null; // nothing actionable to say

  return (
    <div className={`durability ${atRisk || backup === 'needs-permission' || backupError ? 'warn' : ''}`}>
      {atRisk && (
        <span>
          ⚠ Your browser treats Slate's data as evictable — it can be deleted without warning.{' '}
          {backup === 'ok' ? 'Auto-backup has you covered.' : 'Export or set up auto-backup.'}
        </span>
      )}
      {backup === 'off' && (
        <span>
          🛟 Back up automatically to a folder on your disk —{' '}
          <button className="chrome-btn" onClick={() => void enableAutoBackup()}>
            Choose backup folder
          </button>
        </span>
      )}
      {backup === 'needs-permission' && (
        <span>
          🛟 Backups paused after browser restart —{' '}
          <button className="chrome-btn" onClick={() => void regrantAutoBackup()}>
            Resume backups
          </button>
        </span>
      )}
      {backup === 'ok' && (
        <span>
          🛟 Auto-backup on{lastBackupAt ? ` · last ${new Date(lastBackupAt).toLocaleTimeString()}` : ''}{' '}
          <button className="chrome-btn subtle" title="Stop writing backups (existing files stay)" onClick={() => void disableAutoBackup()}>
            turn off
          </button>
        </span>
      )}
      {backupError && <span>⚠ Last backup failed: {backupError}</span>}
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
          title="Export as .slate file"
          onClick={async () => {
            const out = await exportSlateFileById(b.id);
            if (out) downloadBlob(out.blob, `${out.name}.slate`);
          }}
        >
          ⬇
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

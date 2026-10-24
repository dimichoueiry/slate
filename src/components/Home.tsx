import { useEffect, useRef, useState } from 'react';
import { useUI } from '../store/ui';
import type { BoardMeta, Project } from '../types';
import {
  createBoard,
  createProject,
  listBoards,
  listBrandKits,
  listProjects,
  listTrashedBoards,
  listTrashedProjects,
  renameProject,
  restoreProject,
  saveBrandKit,
  setDefaultKitId,
  setProjectKit,
  trashProject,
} from '../store/db';
import { importAnySlateFile, exportArchive, downloadBlob } from '../export/export';
import { useDurability, enableAutoBackup, regrantAutoBackup, disableAutoBackup } from '../store/durability';
import { openBoard } from '../App';
import { BRAND_PRESETS } from '../engine/brandPresets';
import { nanoid } from 'nanoid';
import type { BrandKit } from '../types';
import { groupBoards } from '../store/boardGroups';
import { requestNameOnOpen } from '../store/pendingName';
import { alertDialog, promptDialog, toast } from './Dialogs';
import BoardCard from './BoardCard';
import TrashView from './TrashView';

const ONBOARD_KEY = 'slate-onboarded';

/** What the dashboard's main pane shows. A sidebar can drive this next. */
export type HomeSection = 'boards' | 'trash';

/** Re-render on a slow tick so "Edited 2m ago" labels stay true. */
function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export default function Home() {
  const [boards, setBoards] = useState<BoardMeta[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [trashedBoards, setTrashedBoards] = useState<BoardMeta[]>([]);
  const [trashedProjects, setTrashedProjects] = useState<Project[]>([]);
  const [section, setSection] = useState<HomeSection>('boards');
  const now = useNow();
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
    void listTrashedBoards().then(setTrashedBoards).catch(() => undefined);
    void listTrashedProjects().then(setTrashedProjects).catch(() => undefined);
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
    // still one click: the board opens at once with its name field selected —
    // type to name it, or Enter/Escape to keep the default
    const b = await createBoard('Untitled board', projectId);
    requestNameOnOpen(b.id);
    openBoard(b.id);
  };

  const onNewProject = async () => {
    const name = await promptDialog({ title: 'New project', label: 'Project name', initial: 'New project', confirmLabel: 'Create' });
    if (name) {
      await createProject(name);
      refresh();
    }
  };

  const onTrashProject = async (p: Project, boardCount: number) => {
    await trashProject(p.id);
    refresh();
    toast(
      boardCount
        ? `Project “${p.name}” moved to Trash. Its ${boardCount} board${boardCount === 1 ? '' : 's'} show under Unfiled until you restore it.`
        : `Project “${p.name}” moved to Trash.`,
      {
        action: {
          label: 'Undo',
          run: async () => {
            await restoreProject(p.id);
            refresh();
          },
        },
      }
    );
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await importAnySlateFile(file);
      if (result.kind === 'board') openBoard(result.board.id);
      else {
        toast(`Restored ${result.boards} board${result.boards === 1 ? '' : 's'} and ${result.projects} project${result.projects === 1 ? '' : 's'} from the archive.`);
        refresh();
      }
    } catch (err) {
      await alertDialog({ title: 'Import failed', body: err instanceof Error ? err.message : String(err) });
    }
  };

  const onExportAll = async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(await exportArchive(), `slate-all-${stamp}.slate`);
  };

  // a board whose project is missing or trashed lands in `unfiled` — never hidden
  const { unfiled, byProject } = groupBoards(boards ?? [], projects);
  const trashCount = trashedBoards.length + trashedProjects.length;

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
        <button
          className={`chrome-btn${section === 'trash' ? ' primary' : ''}`}
          style={{ marginLeft: 6 }}
          aria-pressed={section === 'trash'}
          onClick={() => setSection(section === 'trash' ? 'boards' : 'trash')}
        >
          🗑 Trash{trashCount ? ` (${trashCount})` : ''}
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

      {section === 'trash' ? (
        <TrashView
          boards={trashedBoards}
          projects={trashedProjects}
          liveProjects={projects}
          now={now}
          refresh={refresh}
          onBack={() => setSection('boards')}
        />
      ) : (
        <>
          {/* standalone / unfiled boards (incl. any whose project is missing or trashed) */}
          <div className="board-grid">
            <button className="new-board" onClick={() => onNew(null)}>
              <span className="plus" aria-hidden="true">＋</span> New board
            </button>
            {unfiled.map((b) => (
              <BoardCard key={b.id} board={b} projects={projects} now={now} refresh={refresh} />
            ))}
          </div>

          {/* projects */}
          {projects.map((p) => {
            const inProject = byProject.get(p.id) ?? [];
            return (
              <section key={p.id} className="project-section" aria-label={`Project ${p.name}`}>
                <div className="project-header">
                  <h2 className="project-name">📁 {p.name}</h2>
                  <span className="project-count">{inProject.length}</span>
                  <select
                    className="move-select"
                    title="Default brand kit for this project"
                    aria-label={`Default brand kit for ${p.name}`}
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
                    aria-label={`Rename project ${p.name}`}
                    onClick={async () => {
                      const name = await promptDialog({ title: 'Rename project', label: 'Project name', initial: p.name });
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
                    title="Move project to Trash (its boards stay, under Unfiled)"
                    aria-label={`Move project ${p.name} to Trash`}
                    onClick={() => void onTrashProject(p, inProject.length)}
                  >
                    🗑
                  </button>
                </div>
                <div className="board-grid">
                  <button className="new-board small" onClick={() => onNew(p.id)}>
                    <span className="plus" aria-hidden="true">＋</span> New board
                  </button>
                  {inProject.map((b) => (
                    <BoardCard key={b.id} board={b} projects={projects} now={now} refresh={refresh} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
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

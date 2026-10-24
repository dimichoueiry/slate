import React, { useEffect, useRef, useState } from 'react';
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
import {
  Clock,
  Download,
  Folder,
  FolderPlus,
  LayoutGrid,
  LifeBuoy,
  List,
  Menu,
  Moon,
  Pencil,
  Pin,
  Plus,
  Search,
  Sun,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';

const ONBOARD_KEY = 'slate-onboarded';
/** Recents = boards opened or edited in the last RECENT_DAYS, newest first, at most RECENT_MAX. */
const RECENT_DAYS = 14;
const RECENT_MAX = 20;
const DAY = 24 * 60 * 60 * 1000;
/** Last time a board was touched: opened or edited, whichever is newer. */
const lastActive = (b: BoardMeta) => Math.max(b.updatedAt, b.openedAt ?? 0);

/** What the dashboard's main pane shows, picked in the sidebar. */
export type Section = 'recents' | 'pinned' | 'all' | 'trash' | `project:${string}`;
type SortKey = 'edited' | 'name' | 'created';

function readPref(k: string): string | null {
  try {
    return localStorage.getItem(`slate-home-${k}`);
  } catch {
    return null;
  }
}

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
  const [section, setSection] = useState<Section>('recents');
  const [query, setQuery] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [sort, setSort] = useState<SortKey>(() => (readPref('sort') as SortKey) ?? 'edited');
  const [view, setView] = useState<'grid' | 'list'>(() => (readPref('view') === 'list' ? 'list' : 'grid'));
  const searchRef = useRef<HTMLInputElement>(null);
  const setPref = (k: 'sort' | 'view', v: string) => {
    if (k === 'sort') setSort(v as SortKey);
    else setView(v as 'grid' | 'list');
    try {
      localStorage.setItem(`slate-home-${k}`, v);
    } catch {
      /* ignore */
    }
  };
  // ⌘K / Ctrl+K focuses the search (it spans every board and project)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setNavOpen(true);
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
        ? `Project “${p.name}” moved to Trash. Its ${boardCount} board${boardCount === 1 ? '' : 's'} stay in All boards until you restore it.`
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
  const { byProject } = groupBoards(boards ?? [], projects);
  const trashCount = trashedBoards.length + trashedProjects.length;

  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);

  if (dbError) {
    return (
      <div className="home">
        <main className="lib-main">
          <h1 className="lib-title">Slate</h1>
          <div className="durability warn" style={{ margin: '24px 0', maxWidth: 720 }}>
            <span>
              <TriangleAlert size={16} aria-hidden="true" /> Slate couldn't open its local storage — your boards are{' '}
              <b>not deleted</b>, this tab just lost its connection (usually after an update in another tab).{' '}
              <button className="chrome-btn" onClick={() => location.reload()}>
                Reload to reconnect
              </button>
            </span>
            <span style={{ opacity: 0.7, fontSize: 12 }}>({dbError})</span>
          </div>
        </main>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = (b: BoardMeta) => !q || b.name.toLowerCase().includes(q);
  const projectName = (b: BoardMeta) => projects.find((p) => p.id === b.projectId)?.name;
  const sortFn = (a: BoardMeta, b: BoardMeta) =>
    sort === 'name'
      ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
      : sort === 'created'
        ? b.createdAt - a.createdAt
        : b.updatedAt - a.updatedAt;
  const pinnedFirst = (a: BoardMeta, b: BoardMeta) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || sortFn(a, b);

  const all = boards ?? [];
  const project = section.startsWith('project:') ? projects.find((p) => `project:${p.id}` === section) : undefined;
  // a project that just went to Trash (or vanished) falls back to All boards
  const current: Section = section.startsWith('project:') && !project ? 'all' : section;
  const pinnedCount = all.filter((b) => b.pinned).length;

  // a query searches the whole library (Trash only searches itself)
  const searching = !!q && current !== 'trash';
  const recentAll = all.filter((b) => lastActive(b) >= now - RECENT_DAYS * DAY).sort((a, b) => lastActive(b) - lastActive(a));
  const recentHidden = Math.max(0, recentAll.length - RECENT_MAX);

  let shown: BoardMeta[] = [];
  let projectHits: Project[] = [];
  if (searching) {
    // name hits first, then boards that match through their project's name
    const nameHit = (b: BoardMeta) => b.name.toLowerCase().includes(q);
    shown = all
      .filter((b) => nameHit(b) || !!projectName(b)?.toLowerCase().includes(q))
      .sort((a, b) => Number(nameHit(b)) - Number(nameHit(a)) || pinnedFirst(a, b));
    projectHits = projects.filter((p) => p.name.toLowerCase().includes(q));
  } else if (current === 'recents') shown = recentAll.slice(0, RECENT_MAX);
  else if (current === 'pinned') shown = all.filter((b) => b.pinned).sort(sortFn);
  else if (current === 'all') shown = [...all].sort(pinnedFirst);
  else if (project) shown = [...(byProject.get(project.id) ?? [])].sort(pinnedFirst);

  const title = searching
    ? 'Search'
    : current === 'recents'
      ? 'Recents'
      : current === 'pinned'
        ? 'Pinned'
        : current === 'all'
          ? 'All boards'
          : current === 'trash'
            ? 'Trash'
            : project?.name ?? '';

  const go = (s: Section) => {
    setSection(s);
    setQuery('');
    setNavOpen(false);
  };

  const navItem = (s: Section, label: string, icon: React.ReactNode, count?: number) => (
    <button
      className={`lib-nav-item${current === s && !searching ? ' active' : ''}`}
      aria-current={current === s && !searching ? 'page' : undefined}
      onClick={() => go(s)}
    >
      <span className="lib-nav-icon" aria-hidden="true">{icon}</span>
      <span className="lib-nav-label">{label}</span>
      {count != null && count > 0 && <span className="lib-count">{count}</span>}
    </button>
  );

  // Recents is always a timeline; search splits into the projects and boards it found
  const groups: { label: string | null; items: BoardMeta[] }[] = searching
    ? [{ label: projectHits.length ? 'Boards' : null, items: shown }]
    : current === 'recents'
      ? timeGroups(shown, now)
      : [{ label: null, items: shown }];
  const resultCount = shown.length + projectHits.length;

  return (
    <div className={`home lib${navOpen ? ' nav-open' : ''}`}>
      <aside className="lib-sidebar" aria-label="Library">
        <div className="lib-brand">
          <span className="lib-wordmark">Slate</span>
          <button
            className="lib-icon-btn"
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => toggleTheme()}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
        <button className="lib-new" onClick={() => void onNew(project?.id ?? null)}>
          <Plus size={16} aria-hidden="true" /> New board
        </button>
        <label className="lib-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search everything"
            aria-label="Search all boards and projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                e.currentTarget.blur();
              }
            }}
          />
          <kbd>⌘K</kbd>
        </label>
        <nav className="lib-nav">
          {navItem('recents', 'Recents', <Clock size={16} />)}
          {navItem('pinned', 'Pinned', <Pin size={16} />, pinnedCount)}
          {navItem('all', 'All boards', <LayoutGrid size={16} />, all.length)}
          <div className="lib-nav-heading">
            <span>Projects</span>
            <button className="lib-icon-btn sm" title="New project" aria-label="New project" onClick={onNewProject}>
              <Plus size={14} />
            </button>
          </div>
          {projects.map((p) => (
            <div key={p.id}>{navItem(`project:${p.id}`, p.name, <Folder size={16} />, byProject.get(p.id)?.length ?? 0)}</div>
          ))}
          <button className="lib-nav-item subtle" onClick={onNewProject}>
            <span className="lib-nav-icon" aria-hidden="true"><FolderPlus size={16} /></span>
            <span className="lib-nav-label">New project</span>
          </button>
          <div className="lib-nav-sep" />
          {navItem('trash', 'Trash', <Trash2 size={16} />, trashCount)}
        </nav>
        <div className="lib-foot">
          <button className="lib-foot-btn" onClick={() => fileRef.current?.click()}>
            <Upload size={14} aria-hidden="true" /> Import .slate
          </button>
          <button className="lib-foot-btn" title="Download every board, project and asset as one backup file" onClick={() => void onExportAll()}>
            <Download size={14} aria-hidden="true" /> Export all
          </button>
          <input ref={fileRef} type="file" accept=".slate,application/json" hidden onChange={(e) => onImport(e.target.files?.[0])} />
        </div>
      </aside>
      <div className="lib-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

      <main className="lib-main">
        <header className="lib-header">
          <button className="lib-icon-btn lib-menu-btn" aria-label="Open library menu" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
            <Menu size={18} />
          </button>
          <h1 className="lib-title">{title}</h1>
          {project && !searching && (
            <div className="lib-project-acts">
              <select
                className="lib-select"
                title="Default brand kit for this project"
                aria-label={`Default brand kit for ${project.name}`}
                value={project.brandKitId ?? ''}
                onChange={async (e) => {
                  await setProjectKit(project.id, e.target.value || null);
                  refresh();
                }}
              >
                <option value="">Brand: default</option>
                {kits.map((k) => (
                  <option key={k.id} value={k.id}>
                    Brand: {k.name}
                  </option>
                ))}
              </select>
              <button
                className="lib-icon-btn"
                title="Rename project"
                aria-label={`Rename project ${project.name}`}
                onClick={async () => {
                  const name = await promptDialog({ title: 'Rename project', label: 'Project name', initial: project.name });
                  if (name) {
                    await renameProject(project.id, name);
                    refresh();
                  }
                }}
              >
                <Pencil size={15} />
              </button>
              <button
                className="lib-icon-btn"
                title="Move project to Trash (its boards stay, under All boards)"
                aria-label={`Move project ${project.name} to Trash`}
                onClick={() => void onTrashProject(project, byProject.get(project.id)?.length ?? 0)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
          {searching && boards && (
            <p className="lib-sub" role="status">
              {resultCount} result{resultCount === 1 ? '' : 's'} for “{query.trim()}” across your library
            </p>
          )}
          {current !== 'trash' && (
            <div className="lib-controls">
              {(searching || current !== 'recents') && (
                <select className="lib-select" aria-label="Sort boards" value={sort} onChange={(e) => setPref('sort', e.target.value as SortKey)}>
                  <option value="edited">Last edited</option>
                  <option value="name">Name</option>
                  <option value="created">Created</option>
                </select>
              )}
              <div className="lib-seg" role="group" aria-label="View">
                <button className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} title="Grid" aria-label="Grid view" onClick={() => setPref('view', 'grid')}>
                  <LayoutGrid size={15} />
                </button>
                <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} title="List" aria-label="List view" onClick={() => setPref('view', 'list')}>
                  <List size={15} />
                </button>
              </div>
            </div>
          )}
        </header>

        <DurabilityBanner />

        {showOnboarding && (
          <div className="onboard-card">
            <div className="onboard-title">What will you use Slate for?</div>
            <div className="onboard-sub">
              We'll set a brand voice so AI nodes match your style. You can change or add more anytime in Settings.
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

        {current === 'trash' ? (
          <TrashView
            boards={trashedBoards.filter(matches)}
            projects={trashedProjects.filter((p) => !q || p.name.toLowerCase().includes(q))}
            liveProjects={projects}
            now={now}
            refresh={refresh}
          />
        ) : boards && resultCount === 0 ? (
          <div className="lib-empty">
            {searching ? (
              <>
                <Search className="lib-empty-icon" size={20} aria-hidden="true" />
                <p className="lib-empty-title">Nothing matches “{query.trim()}”</p>
                <p>Search looks at board and project names. Boards in Trash aren’t included.</p>
                <button
                  className="chrome-btn"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                >
                  Clear search
                </button>
              </>
            ) : current === 'recents' ? (
              <>
                <Clock className="lib-empty-icon" size={20} aria-hidden="true" />
                <p className="lib-empty-title">Nothing recent</p>
                <p>Boards you open or edit show up here for {RECENT_DAYS} days.</p>
                <div className="lib-empty-acts">
                  <button className="chrome-btn primary" onClick={() => void onNew(null)}>
                    <Plus size={14} aria-hidden="true" /> New board
                  </button>
                  {all.length > 0 && (
                    <button className="chrome-btn" onClick={() => go('all')}>
                      Browse all {all.length} board{all.length === 1 ? '' : 's'}
                    </button>
                  )}
                </div>
              </>
            ) : current === 'pinned' ? (
              <p>Nothing pinned yet. Use a board’s ⋯ menu → Pin to top.</p>
            ) : (
              <>
                <p>No boards here yet.</p>
                <button className="chrome-btn primary" onClick={() => void onNew(project?.id ?? null)}>
                  <Plus size={14} aria-hidden="true" /> New board
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {searching && projectHits.length > 0 && (
              <section className="lib-group" aria-label="Projects">
                <h2 className="lib-group-label">Projects</h2>
                <div className="lib-project-hits">
                  {projectHits.map((p) => {
                    const n = byProject.get(p.id)?.length ?? 0;
                    return (
                      <button key={p.id} className="lib-project-hit" onClick={() => go(`project:${p.id}`)}>
                        <Folder size={16} aria-hidden="true" />
                        <span className="lib-project-hit-name">{p.name}</span>
                        <span className="lib-count">
                          {n} board{n === 1 ? '' : 's'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            {groups
              .filter((g) => g.items.length)
              .map((g) => (
                <section key={g.label ?? 'all'} className="lib-group" aria-label={g.label ?? title}>
                  {g.label && <h2 className="lib-group-label">{g.label}</h2>}
                  <div className={`board-grid${view === 'list' ? ' list' : ''}`}>
                    {g.items.map((b) => (
                      <BoardCard
                        key={b.id}
                        board={b}
                        projects={projects}
                        now={now}
                        refresh={refresh}
                        projectName={searching ? projectName(b) ?? 'Unfiled' : project ? undefined : projectName(b)}
                        showOpened={current === 'recents' && !searching}
                        highlight={searching ? query.trim() : undefined}
                      />
                    ))}
                  </div>
                </section>
              ))}
            {current === 'recents' && !searching && recentHidden > 0 && (
              <p className="lib-more">
                {recentHidden} more board{recentHidden === 1 ? ' was' : 's were'} active in the last {RECENT_DAYS} days.{' '}
                <button className="lib-link" onClick={() => go('all')}>
                  See all boards
                </button>
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/** Today / This week / Earlier, by last activity — every board lands in exactly one group. */
function timeGroups(items: BoardMeta[], now: number): { label: string; items: BoardMeta[] }[] {
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const week = today - 6 * 24 * 60 * 60 * 1000;
  const out = [
    { label: 'Today', items: [] as BoardMeta[] },
    { label: 'This week', items: [] as BoardMeta[] },
    { label: 'Earlier', items: [] as BoardMeta[] },
  ];
  for (const b of items) {
    const t = lastActive(b);
    out[t >= today ? 0 : t >= week ? 1 : 2].items.push(b);
  }
  return out.filter((g) => g.items.length);
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
          <TriangleAlert size={14} aria-hidden="true" /> Your browser treats Slate's data as evictable — it can be deleted without warning.{' '}
          {backup === 'ok' ? 'Auto-backup has you covered.' : 'Export or set up auto-backup.'}
        </span>
      )}
      {backup === 'off' && (
        <span>
          <LifeBuoy size={14} aria-hidden="true" /> Back up automatically to a folder on your disk —{' '}
          <button className="chrome-btn" onClick={() => void enableAutoBackup()}>
            Choose backup folder
          </button>
        </span>
      )}
      {backup === 'needs-permission' && (
        <span>
          <LifeBuoy size={14} aria-hidden="true" /> Backups paused after browser restart —{' '}
          <button className="chrome-btn" onClick={() => void regrantAutoBackup()}>
            Resume backups
          </button>
        </span>
      )}
      {backup === 'ok' && (
        <span>
          <LifeBuoy size={14} aria-hidden="true" /> Auto-backup on{lastBackupAt ? ` · last ${new Date(lastBackupAt).toLocaleTimeString()}` : ''}{' '}
          <button className="chrome-btn subtle" title="Stop writing backups (existing files stay)" onClick={() => void disableAutoBackup()}>
            turn off
          </button>
        </span>
      )}
      {backupError && <span><TriangleAlert size={14} aria-hidden="true" /> Last backup failed: {backupError}</span>}
    </div>
  );
}

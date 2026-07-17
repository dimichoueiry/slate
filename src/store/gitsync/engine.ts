// Git Sync engine: mirrors IndexedDB boards into the user's GitHub repo.
// IndexedDB stays the live source of truth (saving ≠ syncing — local save is
// the safety net); this engine only moves already-safe data to the repo:
//   edit settles (10s)  → push that board
//   board opens         → pull it if the repo moved
//   app opens           → catch-up both ways
//   Sync now            → flush everything pending immediately
// Conflicts use GitHub's sha compare-and-swap: the active editor wins the
// canonical file, the superseded version is preserved as a full conflict-copy
// board. Nothing is ever merged, truncated, or silently dropped.

import { create } from 'zustand';
import { db } from '../db';
import { useUI } from '../ui';
import { GitClient, GitSyncError, textToBytes, bytesToText, type GitSyncConfig } from './client';
import {
  applyRemoteBoard,
  applyRemoteWorkspace,
  hashText,
  parseBoardFile,
  parseWorkspaceFile,
  saveConflictCopy,
  serializeBoard,
  serializeWorkspace,
} from './serialize';

const CONFIG_KEY = 'gitsync-config';
const STATE_KEY = 'gitsync-state';
const SETTLE_MS = 10_000; // push this long after the last edit to a board
const RETRY_MS = 60_000; // re-attempt pending work after a transient failure

const BOARDS_DIR = 'slate/boards';
const ASSETS_DIR = 'slate/assets';
const WORKSPACE_PATH = 'slate/workspace.json';
const boardPath = (id: string) => `${BOARDS_DIR}/${id}.json`;
const assetPath = (hash: string) => `${ASSETS_DIR}/${hash}`;

interface BoardSyncState {
  /** hash of the last board content we pushed or pulled */
  pushedHash: string;
  /** repo file sha we last saw — the compare-and-swap token */
  remoteSha: string;
}

interface SyncState {
  boards: Record<string, BoardSyncState>;
  workspace?: BoardSyncState;
  /** board ids deleted locally whose repo file still needs deleting */
  pendingDeletes: Record<string, true>;
  /** content hashes known to exist in the repo (assets are immutable) */
  assets: Record<string, true>;
}

export type GitSyncStatus = 'off' | 'synced' | 'pending' | 'syncing' | 'error';

interface GitSyncUI {
  status: GitSyncStatus;
  pending: number;
  lastSyncAt: number | null;
  error: { kind: string; message: string } | null;
  repo: { host: string; owner: string; repo: string } | null;
}

export const useGitSync = create<GitSyncUI>(() => ({
  status: 'off',
  pending: 0,
  lastSyncAt: null,
  error: null,
  repo: null,
}));

// ---------- engine internals ----------

let client: GitClient | null = null;
let cfg: GitSyncConfig | null = null;
let state: SyncState = { boards: {}, pendingDeletes: {}, assets: {} };
let restoring = false; // applying remote data — don't re-mark it dirty
let busy = 0; // in-flight API operations (drives the "syncing" status)
let started = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const dirtyBoards = new Set<string>();
let workspaceDirty = false;
const boardTimers = new Map<string, ReturnType<typeof setTimeout>>();
let workspaceTimer: ReturnType<typeof setTimeout> | null = null;

// All repo operations run sequentially: no concurrent CAS races, bounded load.
let chain: Promise<void> = Promise.resolve();
function enqueue(op: () => Promise<void>): Promise<void> {
  const run = chain.then(async () => {
    busy++;
    refreshStatus();
    try {
      await op();
      useGitSync.setState({ error: null });
    } catch (e) {
      onSyncError(e);
    } finally {
      busy--;
      refreshStatus();
    }
  });
  chain = run;
  return run;
}

function onSyncError(e: unknown) {
  const err = e instanceof GitSyncError ? e : new GitSyncError('api', String((e as Error)?.message ?? e));
  useGitSync.setState({ error: { kind: err.kind, message: err.message } });
  // transient failures retry on their own; the rest wait for the user to fix the cause
  if ((err.kind === 'network' || err.kind === 'rate-limit') && !retryTimer) {
    retryTimer = setTimeout(() => {
      retryTimer = null;
      flushAll();
    }, RETRY_MS);
  }
}

function pendingCount(): number {
  return dirtyBoards.size + (workspaceDirty ? 1 : 0) + Object.keys(state.pendingDeletes).length;
}

function refreshStatus() {
  if (!client) return;
  const s = useGitSync.getState();
  const pending = pendingCount();
  const status: GitSyncStatus = busy > 0 ? 'syncing' : s.error ? 'error' : pending > 0 ? 'pending' : 'synced';
  if (s.status !== status || s.pending !== pending) useGitSync.setState({ status, pending });
}

async function persistState() {
  await db.kv.put({ key: STATE_KEY, value: state });
}

function openBoardId(): string | null {
  const route = useUI.getState().route;
  return route.view === 'board' ? route.boardId : null;
}

// ---------- push ----------

function markBoardDirty(boardId: string | undefined) {
  if (!client || restoring || !boardId) return;
  dirtyBoards.add(boardId);
  clearTimeout(boardTimers.get(boardId));
  boardTimers.set(
    boardId,
    setTimeout(() => void enqueue(() => flushBoard(boardId)), SETTLE_MS)
  );
  refreshStatus();
}

function markWorkspaceDirty() {
  if (!client || restoring) return;
  workspaceDirty = true;
  if (workspaceTimer) clearTimeout(workspaceTimer);
  workspaceTimer = setTimeout(() => void enqueue(flushWorkspace), SETTLE_MS);
  refreshStatus();
}

function markBoardDeleted(boardId: string) {
  if (!client || restoring) return;
  dirtyBoards.delete(boardId);
  clearTimeout(boardTimers.get(boardId));
  if (state.boards[boardId]) {
    state.pendingDeletes[boardId] = true;
    void persistState().then(() => enqueue(() => flushDelete(boardId)));
  }
  refreshStatus();
}

/** Push every asset the board references that the repo doesn't have yet. */
async function pushAssets(assets: Map<string, { blobId: string; bytes: Uint8Array }>) {
  if (!client) return;
  for (const [hash, { bytes }] of assets) {
    if (state.assets[hash]) continue;
    if (!(await client.fileExists(assetPath(hash)))) {
      await client.putFile(assetPath(hash), bytes, `slate: add asset ${hash.slice(0, 12)}`, null);
    }
    state.assets[hash] = true;
  }
}

async function flushBoard(boardId: string): Promise<void> {
  if (!client) return;
  const timer = boardTimers.get(boardId);
  if (timer) clearTimeout(timer);
  boardTimers.delete(boardId);

  const ser = await serializeBoard(boardId);
  if (!ser) {
    // board vanished between dirty-mark and flush — treat as a delete
    dirtyBoards.delete(boardId);
    if (state.boards[boardId]) {
      state.pendingDeletes[boardId] = true;
      await persistState();
      await flushDelete(boardId);
    }
    return;
  }

  const known = state.boards[boardId];
  if (known && known.pushedHash === ser.hash) {
    dirtyBoards.delete(boardId);
    refreshStatus();
    return; // nothing actually changed
  }

  await pushAssets(ser.assets);
  const meta = await db.boards.get(boardId);
  const message = `slate: update "${meta?.name ?? boardId}"`;
  try {
    const sha = await client.putFile(boardPath(boardId), textToBytes(ser.json), message, known?.remoteSha ?? null);
    state.boards[boardId] = { pushedHash: ser.hash, remoteSha: sha };
  } catch (e) {
    if (!(e instanceof GitSyncError) || (e.kind !== 'conflict' && e.kind !== 'not-found')) throw e;
    // conflict: the file moved (or, with a stale sha, was deleted) under us
    const outcome = await handleConflict(boardId, ser.hash);
    if (outcome !== 'adopted') {
      // 'moved' → write over the fresh sha; 'gone' → recreate the file
      const sha = await client.putFile(boardPath(boardId), textToBytes(ser.json), message, outcome === 'gone' ? null : outcome);
      state.boards[boardId] = { pushedHash: ser.hash, remoteSha: sha };
    }
  }
  dirtyBoards.delete(boardId);
  useGitSync.setState({ lastSyncAt: Date.now() });
  await persistState();
  refreshStatus();
}

/**
 * The repo file moved under us. Preserve the remote version as a full conflict
 * copy (unless it's byte-identical to what we're about to push), and return the
 * fresh sha so the local version can take the canonical file — the active
 * editor wins, nothing is lost (PRD §5.4).
 */
async function handleConflict(boardId: string, localHash: string): Promise<string | 'gone' | 'adopted'> {
  if (!client) return 'adopted';
  const remote = await client.getFile(boardPath(boardId));
  if (!remote) return 'gone'; // deleted remotely while we edited — local wins, recreate the file
  const remoteJson = bytesToText(remote.bytes);
  if ((await hashText(remoteJson)) === localHash) {
    // same content (e.g. first connect with identical boards) — just adopt it
    state.boards[boardId] = { pushedHash: localHash, remoteSha: remote.sha };
    await persistState();
    return 'adopted';
  }
  const data = parseBoardFile(remoteJson);
  let copyId: string | null = null;
  restoring = true;
  try {
    const stamp = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const copy = await saveConflictCopy(data, `conflict, ${stamp}`, fetchAssetBytes);
    copyId = copy.id;
  } finally {
    restoring = false;
  }
  // the copy is a new board — sync it to the repo like any other (must be
  // marked AFTER the restoring guard drops, or the mark is a no-op)
  if (copyId) markBoardDirty(copyId);
  return remote.sha;
}

async function flushWorkspace(): Promise<void> {
  if (!client) return;
  if (workspaceTimer) {
    clearTimeout(workspaceTimer);
    workspaceTimer = null;
  }
  const ser = await serializeWorkspace();
  if (state.workspace && state.workspace.pushedHash === ser.hash) {
    workspaceDirty = false;
    refreshStatus();
    return;
  }
  await pushAssets(ser.assets);
  try {
    const sha = await client.putFile(WORKSPACE_PATH, textToBytes(ser.json), 'slate: update workspace', state.workspace?.remoteSha ?? null);
    state.workspace = { pushedHash: ser.hash, remoteSha: sha };
  } catch (e) {
    if (!(e instanceof GitSyncError) || e.kind !== 'conflict') throw e;
    // workspace collections merge safely by id: pull remote, upsert, re-push
    const remote = await client.getFile(WORKSPACE_PATH);
    if (remote) {
      restoring = true;
      try {
        await applyRemoteWorkspace(parseWorkspaceFile(bytesToText(remote.bytes)), fetchAssetBytes);
      } finally {
        restoring = false;
      }
      const merged = await serializeWorkspace();
      await pushAssets(merged.assets);
      const sha = await client.putFile(WORKSPACE_PATH, textToBytes(merged.json), 'slate: update workspace', remote.sha);
      state.workspace = { pushedHash: merged.hash, remoteSha: sha };
    }
  }
  workspaceDirty = false;
  useGitSync.setState({ lastSyncAt: Date.now() });
  await persistState();
  refreshStatus();
}

async function flushDelete(boardId: string): Promise<void> {
  if (!client || !state.pendingDeletes[boardId]) return;
  const known = state.boards[boardId];
  try {
    if (known?.remoteSha) {
      await client.deleteFile(boardPath(boardId), 'slate: delete board', known.remoteSha);
    }
  } catch (e) {
    if (e instanceof GitSyncError && e.kind === 'conflict') {
      // file moved since we saw it — the user still deleted the board; its
      // final state survives in git history, so delete with the fresh sha
      const fresh = await client.getFile(boardPath(boardId));
      if (fresh) await client.deleteFile(boardPath(boardId), 'slate: delete board', fresh.sha);
    } else if (!(e instanceof GitSyncError) || e.kind !== 'not-found') {
      throw e;
    }
  }
  delete state.pendingDeletes[boardId];
  delete state.boards[boardId];
  useGitSync.setState({ lastSyncAt: Date.now() });
  await persistState();
  refreshStatus();
}

async function fetchAssetBytes(hash: string): Promise<Uint8Array> {
  if (!client) throw new GitSyncError('api', 'not connected');
  const file = await client.getFile(assetPath(hash));
  if (!file) throw new GitSyncError('not-found', `Asset ${hash.slice(0, 12)}… is missing from the repo`);
  state.assets[hash] = true;
  return file.bytes;
}

// ---------- pull ----------

/**
 * Called by BoardView before it loads a board: bring in the repo version if it
 * moved and we have no local edits. With local edits, the local version stays
 * (it will win the file on its next push; the remote version becomes a conflict
 * copy then). Never blocks opening — errors surface on the indicator.
 */
export async function pullBoardOnOpen(boardId: string): Promise<void> {
  if (!client) return;
  await enqueue(async () => {
    const c = client;
    if (!c) return;
    const known = state.boards[boardId];
    const remote = await c.getFile(boardPath(boardId));
    if (!remote || remote.sha === known?.remoteSha) return;
    const json = bytesToText(remote.bytes);
    const ser = await serializeBoard(boardId);
    const hasLocalEdits = ser && (!known || ser.hash !== known.pushedHash);
    if (hasLocalEdits) return; // local wins; conflict resolves on push
    const data = parseBoardFile(json);
    restoring = true;
    try {
      await applyRemoteBoard(data, fetchAssetBytes);
    } finally {
      restoring = false;
    }
    state.boards[boardId] = { pushedHash: await hashText(json), remoteSha: remote.sha };
    useGitSync.setState({ lastSyncAt: Date.now() });
    await persistState();
  });
}

/** App-open reconciliation: pull what's new remotely, push what's new locally. */
async function catchUp(): Promise<void> {
  if (!client) return;
  const c = client;
  const remote = await c.listDir(BOARDS_DIR);
  const remoteByBoard = new Map<string, { sha: string }>();
  for (const e of remote) {
    if (e.type === 'file' && e.name.endsWith('.json')) remoteByBoard.set(e.name.slice(0, -5), { sha: e.sha });
  }
  const localBoards = await db.boards.toArray();
  const localIds = new Set(localBoards.map((b) => b.id));
  const open = openBoardId();

  // remote → local: new boards from other machines
  for (const [id, { sha }] of remoteByBoard) {
    if (localIds.has(id) || state.pendingDeletes[id]) continue;
    const file = await c.getFile(boardPath(id));
    if (!file) continue;
    let data;
    try {
      data = parseBoardFile(bytesToText(file.bytes));
    } catch (e) {
      onSyncError(new GitSyncError('api', `Repo file ${boardPath(id)} isn't a valid board: ${(e as Error).message}`));
      continue; // a malformed file must never crash the app or block other boards
    }
    restoring = true;
    try {
      await applyRemoteBoard(data, fetchAssetBytes);
    } finally {
      restoring = false;
    }
    state.boards[id] = { pushedHash: await hashText(bytesToText(file.bytes)), remoteSha: sha };
  }

  // local → remote, remote deletions, and remote updates
  for (const b of localBoards) {
    const rem = remoteByBoard.get(b.id);
    const known = state.boards[b.id];
    if (!rem) {
      if (known?.remoteSha) {
        // existed in the repo before and is gone now → deleted on another machine
        restoring = true;
        try {
          await db.transaction('rw', db.boards, db.objects, async () => {
            await db.objects.where('boardId').equals(b.id).delete();
            await db.boards.delete(b.id);
          });
        } finally {
          restoring = false;
        }
        delete state.boards[b.id];
      } else {
        await flushBoard(b.id); // brand new local board
      }
      continue;
    }
    const ser = await serializeBoard(b.id);
    const hasLocalEdits = ser && (!known || ser.hash !== known.pushedHash);
    if (hasLocalEdits) {
      await flushBoard(b.id); // CAS handles any remote movement (conflict copy)
    } else if (rem.sha !== known?.remoteSha && b.id !== open) {
      const file = await c.getFile(boardPath(b.id));
      if (!file) continue;
      let data;
      try {
        data = parseBoardFile(bytesToText(file.bytes));
      } catch (e) {
        onSyncError(new GitSyncError('api', `Repo file ${boardPath(b.id)} isn't a valid board: ${(e as Error).message}`));
        continue;
      }
      restoring = true;
      try {
        await applyRemoteBoard(data, fetchAssetBytes);
      } finally {
        restoring = false;
      }
      state.boards[b.id] = { pushedHash: await hashText(bytesToText(file.bytes)), remoteSha: rem.sha };
    }
  }

  // queued deletions from a previous session
  for (const id of Object.keys(state.pendingDeletes)) await flushDelete(id);

  // workspace: pull-merge if the repo moved, then push if we differ
  const remoteWs = await c.getFile(WORKSPACE_PATH);
  if (remoteWs && remoteWs.sha !== state.workspace?.remoteSha) {
    restoring = true;
    try {
      await applyRemoteWorkspace(parseWorkspaceFile(bytesToText(remoteWs.bytes)), fetchAssetBytes);
    } finally {
      restoring = false;
    }
    state.workspace = state.workspace
      ? { ...state.workspace, remoteSha: remoteWs.sha }
      : { pushedHash: '', remoteSha: remoteWs.sha };
  }
  await flushWorkspace();

  useGitSync.setState({ lastSyncAt: Date.now() });
  await persistState();
  // boards restored before the home screen rendered need a list refresh
  if (/^\/app\/?$/.test(location.pathname)) window.dispatchEvent(new PopStateEvent('popstate'));
}

// ---------- public API ----------

function flushAll() {
  for (const id of [...dirtyBoards]) void enqueue(() => flushBoard(id));
  if (workspaceDirty) void enqueue(flushWorkspace);
  for (const id of Object.keys(state.pendingDeletes)) void enqueue(() => flushDelete(id));
}

/** "Sync now": skip every debounce and push all pending work immediately. */
export function syncNow(): void {
  useGitSync.setState({ error: null });
  flushAll();
  void enqueue(catchUp);
}

export async function connectGitSync(config: GitSyncConfig): Promise<void> {
  const probe = new GitClient(config);
  await probe.validate(); // throws a named GitSyncError for the settings UI
  cfg = config;
  client = probe;
  state = { boards: {}, pendingDeletes: {}, assets: {} };
  await db.kv.put({ key: CONFIG_KEY, value: config });
  await persistState();
  useGitSync.setState({ repo: { host: config.host, owner: config.owner, repo: config.repo }, error: null, status: 'syncing' });
  void enqueue(catchUp);
}

export async function disconnectGitSync(): Promise<void> {
  client = null;
  cfg = null;
  for (const t of boardTimers.values()) clearTimeout(t);
  boardTimers.clear();
  if (workspaceTimer) clearTimeout(workspaceTimer);
  dirtyBoards.clear();
  workspaceDirty = false;
  state = { boards: {}, pendingDeletes: {}, assets: {} };
  await db.kv.delete(CONFIG_KEY);
  await db.kv.delete(STATE_KEY);
  useGitSync.setState({ status: 'off', pending: 0, error: null, repo: null, lastSyncAt: null });
}

export function getGitSyncConfig(): GitSyncConfig | null {
  return cfg;
}

/** Call once from App (after the welcome screen). Restores config and catches up. */
export function initGitSync(): void {
  if (started) return;
  started = true;

  // Dexie hooks: any committed write marks its board (or the workspace) dirty.
  db.objects.hook('creating', (_pk, obj) => markBoardDirty((obj as { boardId?: string })?.boardId));
  db.objects.hook('updating', (_mods, _pk, obj) => markBoardDirty((obj as { boardId?: string })?.boardId));
  db.objects.hook('deleting', (_pk, obj) => markBoardDirty((obj as { boardId?: string })?.boardId));
  db.boards.hook('creating', (pk) => markBoardDirty(String(pk)));
  db.boards.hook('updating', (_mods, pk) => markBoardDirty(String(pk)));
  db.boards.hook('deleting', (pk) => markBoardDeleted(String(pk)));
  for (const table of [db.projects, db.brandKits, db.components, db.prompts]) {
    table.hook('creating', () => markWorkspaceDirty());
    table.hook('updating', () => markWorkspaceDirty());
    table.hook('deleting', () => markWorkspaceDirty());
  }

  // best-effort flush when the tab goes to background — explicitly NOT relied
  // upon; the app-open catch-up is the real guarantee (PRD §5.2)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });

  void (async () => {
    const row = await db.kv.get(CONFIG_KEY).catch(() => undefined);
    const saved = row?.value as GitSyncConfig | undefined;
    if (!saved?.token || !saved.owner || !saved.repo) return;
    const stateRow = await db.kv.get(STATE_KEY).catch(() => undefined);
    if (stateRow?.value) state = stateRow.value as SyncState;
    cfg = saved;
    client = new GitClient(saved);
    useGitSync.setState({ repo: { host: saved.host, owner: saved.owner, repo: saved.repo }, status: 'syncing' });
    void enqueue(catchUp);
  })();
}

// Durability: keep board data alive. Three layers, all local:
//  1. navigator.storage.persist() — asks the browser to stop treating IndexedDB
//     as evictable cache (Safari otherwise deletes it after 7 days unvisited).
//  2. Export/import lives in export/export.ts (.slate files + whole archives).
//  3. Auto-backup — with one folder pick (File System Access API, Chromium),
//     Slate writes a rolling archive to disk whenever boards change, so losing
//     the browser profile loses nothing.

import { create } from 'zustand';
import { db } from './db';
import { exportArchive } from '../export/export';

const BACKUP_DIR_KEY = 'backup-dir';
const BACKUP_PREFIX = 'slate-backup-';
const KEEP_BACKUPS = 20; // rotation of complete snapshots — older files are pruned
const CHECK_EVERY_MS = 60_000;

type BackupStatus = 'unsupported' | 'off' | 'ok' | 'needs-permission';

interface DurabilityState {
  /** null = not asked yet; false = browser refused (data is evictable!) */
  persisted: boolean | null;
  backup: BackupStatus;
  lastBackupAt: number | null;
  backupError: string | null;
}

export const useDurability = create<DurabilityState>(() => ({
  persisted: null,
  backup: 'unsupported',
  lastBackupAt: null,
  backupError: null,
}));

type DirHandle = {
  queryPermission(o: { mode: string }): Promise<string>;
  requestPermission(o: { mode: string }): Promise<string>;
  getFileHandle(name: string, o?: { create: boolean }): Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;
  removeEntry(name: string): Promise<void>;
  values(): AsyncIterable<{ kind: string; name: string }>;
};

let dirHandle: DirHandle | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let lastSignature = '';
let started = false;

function backupSupported(): boolean {
  return typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/** Call once from App. Requests persistence, restores the backup folder, starts the loop. */
export function initDurability() {
  if (started) return;
  started = true;

  void (async () => {
    try {
      const persisted = (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false;
      useDurability.setState({ persisted });
    } catch {
      useDurability.setState({ persisted: false });
    }
  })();

  void (async () => {
    if (!backupSupported()) return; // Safari/Firefox: export is the manual fallback
    useDurability.setState({ backup: 'off' });
    const row = await db.kv.get(BACKUP_DIR_KEY).catch(() => undefined);
    const handle = row?.value as DirHandle | undefined;
    if (!handle) return;
    dirHandle = handle;
    const perm = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied');
    // granted → resume silently; anything else needs a user gesture to re-grant
    useDurability.setState({ backup: perm === 'granted' ? 'ok' : 'needs-permission' });
    startLoop();
  })();
}

/** User gesture: pick (or re-pick) the backup folder. */
export async function enableAutoBackup(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker(o: { mode: string }): Promise<DirHandle> }).showDirectoryPicker;
  try {
    dirHandle = await picker({ mode: 'readwrite' });
  } catch {
    return; // user cancelled the picker
  }
  await db.kv.put({ key: BACKUP_DIR_KEY, value: dirHandle });
  useDurability.setState({ backup: 'ok', backupError: null });
  lastSignature = ''; // force an immediate first snapshot
  startLoop();
  await backupNow();
}

/** User gesture: re-authorize the previously chosen folder after a browser restart. */
export async function regrantAutoBackup(): Promise<void> {
  if (!dirHandle) return;
  const perm = await dirHandle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
  if (perm === 'granted') {
    useDurability.setState({ backup: 'ok', backupError: null });
    lastSignature = '';
    startLoop();
    await backupNow();
  }
}

export async function disableAutoBackup(): Promise<void> {
  dirHandle = null;
  await db.kv.delete(BACKUP_DIR_KEY);
  useDurability.setState({ backup: backupSupported() ? 'off' : 'unsupported', lastBackupAt: null });
}

function startLoop() {
  if (timer) return;
  timer = setInterval(() => void backupNow(), CHECK_EVERY_MS);
}

/** Cheap change detector: board count + newest edit + project count. */
async function signature(): Promise<string> {
  const [count, newest, projects] = await Promise.all([
    db.boards.count(),
    db.boards.orderBy('updatedAt').last(),
    db.projects.count(),
  ]);
  return `${count}:${newest?.updatedAt ?? 0}:${projects}`;
}

async function backupNow(): Promise<void> {
  if (!dirHandle || useDurability.getState().backup !== 'ok') return;
  try {
    const sig = await signature();
    if (sig === lastSignature) return; // nothing changed since the last snapshot
    const blob = await exportArchive();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fh = await dirHandle.getFileHandle(`${BACKUP_PREFIX}${stamp}.slate`, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    lastSignature = sig;
    useDurability.setState({ lastBackupAt: Date.now(), backupError: null });
    await prune();
  } catch (e) {
    // e.g. folder deleted or drive unmounted — surface it, keep data intact
    useDurability.setState({ backupError: String((e as Error)?.message ?? e) });
  }
}

/** Keep the newest KEEP_BACKUPS snapshots; each file is a complete archive. */
async function prune(): Promise<void> {
  if (!dirHandle) return;
  const files: string[] = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && entry.name.startsWith(BACKUP_PREFIX)) files.push(entry.name);
  }
  files.sort(); // timestamp names sort chronologically
  for (const name of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) {
    await dirHandle.removeEntry(name).catch(() => undefined);
  }
}

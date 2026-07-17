// Always-visible Git Sync status pill (PRD §5.3). Trust UI: it never says
// "synced" unless the last known change is confirmed in the repo. Stacks in the
// bottom-right corner above the MCP bridge pill.

import { useState } from 'react';
import { syncNow, useGitSync } from '../store/gitsync/engine';

const pill: React.CSSProperties = {
  position: 'fixed',
  right: 12,
  // corner stack: zoom bar (12) → usage meter (56) → bridge pill (100) → this
  bottom: 144,
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 11px',
  borderRadius: 999,
  fontSize: 12.5,
  fontWeight: 600,
  background: 'var(--panel, #fff)',
  color: 'var(--ink, #1a1a1a)',
  border: '1px solid rgba(0,0,0,0.12)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
  cursor: 'pointer',
  userSelect: 'none',
};

export default function GitSyncIndicator() {
  const { status, pending, error, repo, lastSyncAt } = useGitSync();
  const [open, setOpen] = useState(false);
  if (!repo || status === 'off') return null;

  const label =
    status === 'syncing' ? '⟳ Syncing…'
    : status === 'error' ? '⚠ Sync error'
    : pending > 0 ? `● ${pending} pending`
    : '✓ Synced';
  const color = status === 'error' ? '#e03131' : pending > 0 || status === 'syncing' ? '#e8a33d' : '#2f9e44';

  return (
    <div style={pill} onClick={() => setOpen((o) => !o)} title={`Git sync — ${repo.owner}/${repo.repo}`}>
      <span style={{ color }}>{label}</span>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            bottom: 36,
            background: 'var(--panel, #fff)',
            border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
            padding: 10,
            minWidth: 220,
            fontSize: 12,
            fontWeight: 400,
            cursor: 'default',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            <a href={`https://${repo.host}/${repo.owner}/${repo.repo}`} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
              {repo.owner}/{repo.repo} ↗
            </a>
          </div>
          {lastSyncAt && <div style={{ opacity: 0.7 }}>Last sync {new Date(lastSyncAt).toLocaleTimeString()}</div>}
          {pending > 0 && <div style={{ opacity: 0.7 }}>{pending} change{pending === 1 ? '' : 's'} waiting to push</div>}
          {error && <div style={{ color: '#e03131', marginTop: 4 }}>{error.message}</div>}
          <button
            style={{
              marginTop: 8,
              width: '100%',
              border: '1px solid rgba(0,0,0,0.15)',
              borderRadius: 8,
              padding: '5px 0',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            onClick={() => {
              syncNow();
              setOpen(false);
            }}
          >
            Sync now
          </button>
        </div>
      )}
    </div>
  );
}

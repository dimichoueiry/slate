// Settings → Git Sync: connect a GitHub repo (github.com or Enterprise Server)
// and Slate mirrors every board into it. Reuses the SettingsPanel styles.
import { useState } from 'react';
import { connectGitSync, disconnectGitSync, syncNow, useGitSync } from '../store/gitsync/engine';
import { GitSyncError } from '../store/gitsync/client';

export default function GitSyncSettings() {
  const { status, repo, error, lastSyncAt, pending } = useGitSync();
  const [owner, setOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showHost, setShowHost] = useState(false);

  const connect = async () => {
    setConnectError(null);
    // accept "owner/repo" pasted into the owner field
    let o = owner.trim();
    let r = repoName.trim();
    if (o.includes('/') && !r) [o, r] = o.split('/', 2);
    if (!o || !r || !token.trim()) {
      setConnectError('Repo (owner and name) and a token are required.');
      return;
    }
    setConnecting(true);
    try {
      await connectGitSync({
        host: (host.trim() || 'github.com').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
        owner: o,
        repo: r,
        token: token.trim(),
      });
      setToken('');
    } catch (e) {
      setConnectError(e instanceof GitSyncError ? e.message : String((e as Error)?.message ?? e));
    } finally {
      setConnecting(false);
    }
  };

  if (repo) {
    return (
      <>
        <h3>Git sync</h3>
        <div className="slate-model-count" style={{ marginBottom: 6 }}>
          Boards mirror to{' '}
          <a
            href={`https://${repo.host}/${repo.owner}/${repo.repo}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#7aa5ff' }}
          >
            {repo.owner}/{repo.repo}
          </a>
          {repo.host !== 'github.com' ? ` on ${repo.host}` : ''} — every machine that connects this repo sees the
          same boards.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {status === 'error' ? (
            <span className="badge" style={{ background: 'rgba(224,49,49,.25)', color: '#ff8787' }}>sync error</span>
          ) : status === 'syncing' ? (
            <span className="badge local">syncing…</span>
          ) : pending > 0 ? (
            <span className="badge local">{pending} pending</span>
          ) : (
            <span className="badge">synced ✓</span>
          )}
          {lastSyncAt && (
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
              last sync {new Date(lastSyncAt).toLocaleTimeString()}
            </span>
          )}
          <button onClick={() => syncNow()}>Sync now</button>
          <button className="danger" onClick={() => void disconnectGitSync()}>
            Disconnect
          </button>
        </div>
        {error && (
          <div className="slate-model-count" style={{ color: '#ff8787', marginTop: 6 }}>
            {error.message}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <h3>Git sync</h3>
      <div className="slate-model-count" style={{ marginBottom: 6 }}>
        Mirror your boards into a GitHub repo you own: they survive anything, follow you to any machine, and
        every change is a commit. Slate talks straight to GitHub — no Slate server, no account.
      </div>
      <label>Repository (owner/name)</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input placeholder="you" value={owner} onChange={(e) => setOwner(e.target.value)} />
        <input placeholder="slate-boards" value={repoName} onChange={(e) => setRepoName(e.target.value)} />
      </div>
      <label>
        Fine-grained personal access token{' '}
        <a
          href={`https://${host.trim() || 'github.com'}/settings/personal-access-tokens/new`}
          target="_blank"
          rel="noreferrer"
          style={{ color: '#7aa5ff' }}
        >
          (create one)
        </a>
      </label>
      <input type="password" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />
      <div className="slate-model-count">
        Scope it to just this repo with <b>Contents: read &amp; write</b>. The token is stored only on this
        machine and never leaves it except to talk to GitHub.
      </div>
      {showHost ? (
        <>
          <label>GitHub host (Enterprise Server)</label>
          <input placeholder="github.acme-corp.com" value={host} onChange={(e) => setHost(e.target.value)} />
        </>
      ) : (
        <button
          style={{ border: 'none', background: 'transparent', color: '#7aa5ff', cursor: 'pointer', fontSize: 11, padding: '4px 0' }}
          onClick={() => setShowHost(true)}
        >
          Using GitHub Enterprise Server?
        </button>
      )}
      {connectError && (
        <div className="slate-model-count" style={{ color: '#ff8787', marginTop: 6 }}>
          {connectError}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <button className="primary" disabled={connecting} onClick={() => void connect()}>
          {connecting ? 'Checking access…' : 'Connect repo'}
        </button>
      </div>
    </>
  );
}

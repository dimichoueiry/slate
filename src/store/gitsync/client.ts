// GitHub REST client for Git Sync. Host-aware (github.com or GitHub Enterprise
// Server), browser-direct, contents-API based. This file is the ONLY place that
// knows about hosts, endpoints, or GitHub error shapes — everything above it is
// host-agnostic (PRD §7.3).

export interface GitSyncConfig {
  host: string; // 'github.com' or an Enterprise host like 'github.acme-corp.com'
  owner: string;
  repo: string;
  token: string;
  branch?: string; // omit = repo default branch
}

export type GitErrorKind =
  | 'auth' // token invalid / expired / revoked
  | 'permission' // token valid but can't write (read-only scope)
  | 'not-found' // repo or path missing
  | 'org-policy' // org requires token approval / SSO authorization / PATs disabled
  | 'rate-limit'
  | 'conflict' // SHA moved under us (compare-and-swap failed)
  | 'network' // host unreachable (offline, VPN down, CORS-blocked)
  | 'too-large' // file exceeds the API's blob ceiling
  | 'api'; // anything else GitHub said no to

export class GitSyncError extends Error {
  constructor(
    public kind: GitErrorKind,
    message: string
  ) {
    super(message);
    this.name = 'GitSyncError';
  }
}

export interface RepoFile {
  /** git blob sha of the file content (the compare-and-swap token) */
  sha: string;
  /** decoded file bytes — always complete, never truncated */
  bytes: Uint8Array;
}

export interface RepoEntry {
  path: string;
  name: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000; // avoid call-stack limits on large files
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const textToBytes = (s: string) => enc.encode(s);
export const bytesToText = (b: Uint8Array) => dec.decode(b);

function apiBase(host: string): string {
  return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}

export class GitClient {
  constructor(private cfg: GitSyncConfig) {}

  private url(path: string): string {
    const repo = `${apiBase(this.cfg.host)}/repos/${this.cfg.owner}/${this.cfg.repo}`;
    // no trailing slash on the bare-repo URL — GitHub 404s it (which the
    // browser reports as a failed CORS preflight, masking the real cause)
    return path ? `${repo}/${path}` : repo;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.cfg.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init?.headers ?? {}),
        },
      });
    } catch {
      throw new GitSyncError(
        'network',
        `Can't reach ${this.cfg.host} — check your connection${this.cfg.host === 'github.com' ? '' : ' (VPN?)'}.`
      );
    }
    if (res.ok) return res;
    throw await this.classify(res);
  }

  /** Turn a GitHub error response into a named, actionable GitSyncError (PRD §5.1). */
  private async classify(res: Response): Promise<GitSyncError> {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    const msg = body.message ?? `HTTP ${res.status}`;
    const lower = msg.toLowerCase();
    if (res.status === 401) {
      return new GitSyncError('auth', 'GitHub rejected the token — it may be expired or revoked. Reconnect with a fresh token.');
    }
    if (res.status === 403 || res.status === 429) {
      if (res.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
        const mins = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60_000)) : null;
        return new GitSyncError('rate-limit', `GitHub rate limit reached${mins ? ` — retrying after ~${mins} min` : ''}.`);
      }
      if (lower.includes('saml') || lower.includes('sso')) {
        return new GitSyncError('org-policy', `Authorize this token for the ${this.cfg.owner} organization (SAML SSO): ${msg}`);
      }
      if (lower.includes('personal access token') || lower.includes('fine-grained')) {
        return new GitSyncError('org-policy', `The ${this.cfg.owner} organization's token policy blocked this request: ${msg}`);
      }
      return new GitSyncError('permission', `The token can't do that on ${this.cfg.owner}/${this.cfg.repo}: ${msg}`);
    }
    if (res.status === 404) {
      return new GitSyncError('not-found', `Not found on ${this.cfg.host}: ${this.cfg.owner}/${this.cfg.repo} — check the repo name and that the token can see it.`);
    }
    if (res.status === 409 || (res.status === 422 && lower.includes('sha'))) {
      return new GitSyncError('conflict', 'The file changed in the repo since we last saw it.');
    }
    if (res.status === 422 && lower.includes('too large')) {
      return new GitSyncError('too-large', msg);
    }
    return new GitSyncError('api', msg);
  }

  /**
   * Read a file. Returns null if it doesn't exist. Files >1MB come back from the
   * contents API without inline content — those are re-fetched via the git blob
   * endpoint (complete either way; a partial read is never returned).
   */
  async getFile(path: string): Promise<RepoFile | null> {
    let res: Response;
    try {
      res = await this.request(`contents/${encodePath(path)}${this.ref()}`);
    } catch (e) {
      if (e instanceof GitSyncError && e.kind === 'not-found') return null;
      throw e;
    }
    const data = (await res.json()) as { sha: string; content?: string; encoding?: string; size: number };
    if (data.encoding === 'base64' && typeof data.content === 'string') {
      return { sha: data.sha, bytes: base64ToBytes(data.content) };
    }
    // >1MB: contents API omits the payload — fetch the full blob by sha
    const blobRes = await this.request(`git/blobs/${data.sha}`);
    const blob = (await blobRes.json()) as { content: string; encoding: string };
    if (blob.encoding !== 'base64') throw new GitSyncError('api', `Unexpected blob encoding "${blob.encoding}" for ${path}`);
    return { sha: data.sha, bytes: base64ToBytes(blob.content) };
  }

  /** Does a path exist? (cheap existence probe for content-addressed assets) */
  async fileExists(path: string): Promise<boolean> {
    try {
      const res = await this.request(`contents/${encodePath(path)}${this.ref()}`, { method: 'HEAD' });
      return res.ok;
    } catch (e) {
      if (e instanceof GitSyncError && e.kind === 'not-found') return false;
      throw e;
    }
  }

  /**
   * Write a file with compare-and-swap: pass the last-seen sha (or null for a
   * new file). Throws GitSyncError('conflict') if the remote moved. Returns the
   * new content sha.
   */
  async putFile(path: string, bytes: Uint8Array, message: string, lastSha: string | null): Promise<string> {
    const res = await this.request(`contents/${encodePath(path)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: bytesToBase64(bytes),
        ...(lastSha ? { sha: lastSha } : {}),
        ...(this.cfg.branch ? { branch: this.cfg.branch } : {}),
      }),
    });
    const data = (await res.json()) as { content: { sha: string } };
    return data.content.sha;
  }

  /** Delete a file (requires its current sha; conflict = it moved). */
  async deleteFile(path: string, message: string, sha: string): Promise<void> {
    await this.request(`contents/${encodePath(path)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message, sha, ...(this.cfg.branch ? { branch: this.cfg.branch } : {}) }),
    });
  }

  /** List a directory. Missing directory = empty list (a fresh repo has none). */
  async listDir(path: string): Promise<RepoEntry[]> {
    try {
      const res = await this.request(`contents/${encodePath(path)}${this.ref()}`);
      const data = (await res.json()) as RepoEntry[] | RepoEntry;
      return Array.isArray(data) ? data : [data];
    } catch (e) {
      if (e instanceof GitSyncError && e.kind === 'not-found') return [];
      throw e;
    }
  }

  /**
   * Connect-time validation: prove the token can see AND write the repo before
   * we accept the config. Distinguishes every failure mode by name (PRD §5.1).
   */
  async validate(): Promise<void> {
    const res = await this.request('');
    const repo = (await res.json()) as { permissions?: { push?: boolean } };
    if (repo.permissions && !repo.permissions.push) {
      throw new GitSyncError('permission', `The token can read ${this.cfg.owner}/${this.cfg.repo} but not write it — it needs Contents read/write.`);
    }
  }

  private ref(): string {
    return this.cfg.branch ? `?ref=${encodeURIComponent(this.cfg.branch)}` : '';
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

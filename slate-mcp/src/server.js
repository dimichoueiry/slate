// The bridge core. Every slate-mcp process calls createBridge(); the first one
// to bind the port becomes the LEADER — it owns the WebSocket server, the
// origin allowlist, the pairing handshake and the Slate tab (PRD §8.2–8.3).
// Every later process becomes a PEER: it connects to the leader over the same
// port, authenticates with the shared pairing token from ~/.slate-mcp, and
// forwards its tool calls. When the leader exits, surviving peers race to
// re-bind the port; the winner leads and the tab reconnects to it within ~5s.
// So any number of MCP sessions (Claude Code, Claude Desktop, …) share one
// Slate tab with no manual disconnect/reconnect.

import { WebSocket, WebSocketServer } from 'ws';
import { loadToken, saveToken, newToken, newPairingCode, tokensEqual } from './pairing.js';

const PROTOCOL_VERSION = 1;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const MAX_PAIR_ATTEMPTS = 3;
const PEER_HELLO_TIMEOUT_MS = 2_000;
const START_TIMEOUT_MS = 5_000;

/** Thrown when the user still has to enter the pairing code in Slate. */
export class PairingRequiredError extends Error {
  constructor(code, message) {
    super(message ?? `Pairing required — tell the user to enter pairing code ${code} in the Slate tab (a dialog is showing there now).`);
    this.code = code;
  }
}

export class NoTabError extends Error {
  constructor(message) {
    super(message ?? 'No Slate tab connected — open Slate in the browser to continue.');
  }
}

const DEFAULT_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  // the official deployed Slate (PRD §8.3: official domain + localhost)
  /^https:\/\/slate-iota-lac\.vercel\.app$/,
];

export function originAllowed(origin, extra = []) {
  // non-browser clients send no Origin; they're local processes, same trust as us
  if (origin === undefined || origin === null || origin === '') return true;
  if (DEFAULT_ORIGINS.some((re) => re.test(origin))) return true;
  return extra.includes(origin);
}

// ---------- leader: owns the port, the tab, and pairing ----------

function createLeader(opts) {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 8642;
  const allowedOrigins = opts.allowedOrigins ?? [];
  const configPath = opts.configPath;
  const log = opts.log;
  const onPairExhausted = opts.onPairExhausted ?? (() => process.exit(1));

  let token = loadToken(configPath);
  let tab = null; // the single authenticated tab socket
  let candidate = null; // a connected-but-unauthenticated tab
  let pairing = null; // { code, attempts }
  let nextId = 1;
  const pending = new Map(); // id -> {resolve, reject, timer}
  const peers = new Set(); // authenticated peer slate-mcp sessions

  const wss = new WebSocketServer({
    host,
    port,
    verifyClient: ({ origin }) => originAllowed(origin, allowedOrigins),
  });

  const ready = new Promise((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });

  function send(ws, msg) {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ slateBridge: PROTOCOL_VERSION, ...msg }));
  }

  function drop(ws) {
    if (tab === ws) {
      tab = null;
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new NoTabError());
        pending.delete(id);
      }
    }
    if (candidate === ws) candidate = null;
    peers.delete(ws);
  }

  /** A socket identified itself as a Slate tab; first paired tab wins (PRD §8.1). */
  function tabCandidate(ws) {
    if (tab && tab !== ws) {
      send(ws, { method: 'busy' });
      ws.close();
      return false;
    }
    candidate = ws;
    return true;
  }

  wss.on('connection', (ws) => {
    // assume a tab until the socket says otherwise — pairing must be reachable
    // the moment the tab connects; a peer relinquishes candidacy via peer.hello
    if (!tab && !candidate) candidate = ws;

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }

      // tool-call responses from the authed tab
      if (ws === tab && msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message ?? 'Slate returned an error'));
        else p.resolve(msg.result);
        return;
      }

      switch (msg.method) {
        case 'auth': {
          if (token && tokensEqual(msg.params?.token, token)) {
            if (!tabCandidate(ws)) return;
            tab = ws;
            candidate = null;
            send(ws, { method: 'auth.ok' });
            log('tab authenticated');
          } else {
            send(ws, { method: 'auth.fail' });
            tabCandidate(ws); // stale token — stays connected for pairing
          }
          return;
        }
        case 'hello':
          tabCandidate(ws); // connected, not yet paired — pairing starts on the first tool call
          return;
        case 'pair.complete': {
          if (!pairing || ws !== candidate) return;
          if (tokensEqual(String(msg.params?.code ?? ''), pairing.code)) {
            token = newToken();
            if (configPath) saveToken(configPath, token);
            pairing = null;
            tab = ws;
            candidate = null;
            send(ws, { method: 'pair.ok', params: { token } });
            log('paired with Slate tab');
          } else {
            pairing.attempts -= 1;
            send(ws, { method: 'pair.fail', params: { remaining: pairing.attempts } });
            if (pairing.attempts <= 0) {
              log('pairing failed 3 times — exiting');
              pairing = null;
              onPairExhausted();
            }
          }
          return;
        }
        case 'peer.hello': {
          if (candidate === ws) candidate = null; // not a tab after all
          // another slate-mcp session joins; possession of the paired token
          // (readable only from this user's ~/.slate-mcp) is its credential
          if (token && tokensEqual(msg.params?.token, token)) {
            peers.add(ws);
            send(ws, { method: 'peer.ok' });
            log('peer session attached');
          } else {
            send(ws, { method: 'peer.fail', params: { reason: token ? 'bad-token' : 'unpaired' } });
          }
          return;
        }
        case 'bridge.call': {
          if (msg.id === undefined) return;
          if (!peers.has(ws)) {
            send(ws, { id: msg.id, error: { message: 'peer not authorized', kind: 'peer-auth' } });
            return;
          }
          const { name, args, timeoutMs } = msg.params ?? {};
          callTab(String(name), args ?? {}, Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_CALL_TIMEOUT_MS).then(
            (result) => send(ws, { id: msg.id, result: result === undefined ? null : result }),
            (e) =>
              send(ws, {
                id: msg.id,
                error: {
                  message: String(e?.message ?? e),
                  kind: e instanceof PairingRequiredError ? 'pairing' : e instanceof NoTabError ? 'notab' : 'error',
                  ...(e instanceof PairingRequiredError ? { code: e.code } : {}),
                },
              }),
          );
          return;
        }
        default:
          return; // capability ceiling: everything else is ignored
      }
    });

    ws.on('close', () => drop(ws));
    ws.on('error', () => drop(ws));
  });

  /** Forward one tool call to the authenticated tab. */
  function callTab(method, params, timeoutMs = DEFAULT_CALL_TIMEOUT_MS) {
    if (!tab) {
      if (candidate) {
        // a tab is connected but not paired — start (or repeat) the handshake
        if (!pairing) pairing = { code: newPairingCode(), attempts: MAX_PAIR_ATTEMPTS };
        send(candidate, { method: 'pair.request' });
        return Promise.reject(new PairingRequiredError(pairing.code));
      }
      return Promise.reject(new NoTabError());
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Slate did not answer "${method}" within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      send(tab, { id, method, params });
    });
  }

  return ready.then(() => ({
    wss,
    callTab,
    get connected() {
      return !!tab;
    },
    close: () =>
      new Promise((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => resolve());
      }),
  }));
}

// ---------- peer: forwards calls to whichever process leads ----------

function createPeerConn({ host, port, configPath, log }) {
  return new Promise((resolveConn, rejectConn) => {
    const ws = new WebSocket(`ws://${host}:${port}`);
    const pending = new Map(); // id -> {resolve, reject, timer}
    let nextId = 1;
    let authed = false;
    let authWaiter = null;
    let downCb = null;
    let opened = false;

    function send(msg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ slateBridge: PROTOCOL_VERSION, ...msg }));
    }

    ws.on('open', () => {
      opened = true;
      resolveConn(peer);
    });
    ws.on('error', (e) => {
      if (!opened) rejectConn(e);
    });
    ws.on('close', () => {
      authed = false;
      authWaiter?.resolve(false);
      authWaiter = null;
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error('Lost the connection to the bridge — it is restarting, retry the call in a moment.'));
        pending.delete(id);
      }
      downCb?.();
    });
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.method === 'peer.ok') {
        authed = true;
        authWaiter?.resolve(true);
        authWaiter = null;
        return;
      }
      if (msg.method === 'peer.fail') {
        authed = false;
        authWaiter?.resolve(false);
        authWaiter = null;
        return;
      }
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) {
          const { message, kind, code } = msg.error;
          if (kind === 'pairing') p.reject(new PairingRequiredError(code, message));
          else if (kind === 'notab') p.reject(new NoTabError(message));
          else if (kind === 'peer-auth') p.reject(Object.assign(new Error(message ?? 'peer not authorized'), { peerAuth: true }));
          else p.reject(new Error(message ?? 'Slate returned an error'));
        } else p.resolve(msg.result);
      }
    });

    /**
     * Authenticate with the token on disk; re-reads it so a re-pairing rotation
     * is picked up. Concurrent callers share one in-flight handshake.
     */
    let authPromise = null;
    function ensureAuth() {
      if (authed) return Promise.resolve(true);
      if (authPromise) return authPromise;
      authPromise = new Promise((resolve) => {
        authWaiter = { resolve };
        send({ method: 'peer.hello', params: { token: loadToken(configPath) } });
        setTimeout(() => {
          if (authWaiter) {
            authWaiter = null;
            resolve(false);
          }
        }, PEER_HELLO_TIMEOUT_MS);
      });
      void authPromise.then(() => {
        authPromise = null;
      });
      return authPromise;
    }

    function rawCall(name, args, timeoutMs) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        // the leader enforces timeoutMs against the tab; this timer is the backstop
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Slate did not answer "${name}" within ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs + 5_000);
        pending.set(id, { resolve, reject, timer });
        send({ id, method: 'bridge.call', params: { name, args, timeoutMs } });
      });
    }

    async function call(name, args, timeoutMs) {
      if (!(await ensureAuth())) {
        throw new Error(
          'This session could not join the shared Slate bridge — pairing has not completed yet. Make one tool call from the first connected agent session (it will show the pairing code), enter the code in Slate, then retry here.',
        );
      }
      try {
        return await rawCall(name, args, timeoutMs);
      } catch (e) {
        // token rotated by a re-pairing — reload from disk and retry once
        if (e?.peerAuth && (await ensureAuth())) return rawCall(name, args, timeoutMs);
        throw e;
      }
    }

    const peer = {
      call,
      onDown(cb) {
        downCb = cb;
      },
      close() {
        downCb = null;
        try {
          ws.terminate();
        } catch {
          /* already gone */
        }
      },
    };
  });
}

// ---------- facade: leader election with takeover ----------

/**
 * Create the bridge. Options:
 *  - port, host (default 8642, 127.0.0.1)
 *  - allowedOrigins: string[] of extra exact origins (e.g. the deployed domain)
 *  - configPath: token store path
 *  - onPairExhausted: called after 3 wrong codes (default: process.exit(1))
 *  - log: (msg) => void for diagnostics (default: stderr)
 *
 * The returned bridge leads if the port is free, otherwise joins the existing
 * leader as a peer — callTab works identically either way.
 */
export function createBridge(opts = {}) {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 8642;
  const log = opts.log ?? ((m) => process.stderr.write(`[slate-mcp] ${m}\n`));

  let closed = false;
  let mode = 'starting'; // 'starting' | 'leader' | 'peer'
  let leader = null;
  let peer = null;
  let settle;
  let ready = new Promise((r) => (settle = r));

  async function start() {
    let attempt = 0;
    while (!closed) {
      try {
        leader = await createLeader({ ...opts, host, port, log });
        mode = 'leader';
        log(`leading the bridge on ws://${host}:${port} — waiting for a Slate tab`);
        settle();
        return;
      } catch (e) {
        if (e?.code !== 'EADDRINUSE') log(`bridge failed to bind port ${port}: ${e?.message ?? e} — retrying`);
      }
      try {
        peer = await createPeerConn({ host, port, configPath: opts.configPath, log });
        mode = 'peer';
        log(`joined the bridge already running on port ${port} as a peer session`);
        settle();
        peer.onDown(() => {
          if (closed) return;
          peer = null;
          mode = 'starting';
          ready = new Promise((r) => (settle = r));
          log('bridge leader went away — re-electing');
          void start();
        });
        return;
      } catch {
        // race: the leader died between our bind attempt and connect — loop
      }
      attempt += 1;
      await new Promise((r) => setTimeout(r, Math.min(1_000, 50 * attempt) + Math.random() * 100));
    }
  }
  void start();

  function awaitReady() {
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('The local bridge is still starting — retry in a moment.')),
        START_TIMEOUT_MS,
      );
      void ready.then(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  return {
    async callTab(method, params, timeoutMs = DEFAULT_CALL_TIMEOUT_MS) {
      if (closed) throw new Error('bridge closed');
      await awaitReady();
      if (mode === 'leader') return leader.callTab(method, params, timeoutMs);
      return peer.call(method, params, timeoutMs);
    },
    get mode() {
      return mode;
    },
    get connected() {
      return mode === 'leader' ? leader.connected : mode === 'peer';
    },
    close: async () => {
      closed = true;
      try {
        peer?.close();
      } catch {
        /* already gone */
      }
      if (leader) await leader.close();
    },
  };
}

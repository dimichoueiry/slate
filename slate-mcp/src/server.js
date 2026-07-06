// The bridge core: a WebSocket server on 127.0.0.1 that the Slate tab connects
// to. Enforces the origin allowlist, pairing-code handshake, and token auth
// (PRD §8.3), and forwards tool calls to the tab as JSON-RPC (PRD §8.2).

import { WebSocketServer } from 'ws';
import { loadToken, saveToken, newToken, newPairingCode, tokensEqual } from './pairing.js';

const PROTOCOL_VERSION = 1;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const MAX_PAIR_ATTEMPTS = 3;

/** Thrown when the user still has to enter the pairing code in Slate. */
export class PairingRequiredError extends Error {
  constructor(code) {
    super(`Pairing required — tell the user to enter pairing code ${code} in the Slate tab (a dialog is showing there now).`);
    this.code = code;
  }
}

export class NoTabError extends Error {
  constructor() {
    super('No Slate tab connected — open Slate in the browser to continue.');
  }
}

const DEFAULT_ORIGINS = [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/];

export function originAllowed(origin, extra = []) {
  // non-browser clients send no Origin; they're local processes, same trust as us
  if (origin === undefined || origin === null || origin === '') return true;
  if (DEFAULT_ORIGINS.some((re) => re.test(origin))) return true;
  return extra.includes(origin);
}

/**
 * Create the bridge. Options:
 *  - port, host (default 8642, 127.0.0.1)
 *  - allowedOrigins: string[] of extra exact origins (e.g. the deployed domain)
 *  - configPath: token store path
 *  - onPairExhausted: called after 3 wrong codes (default: process.exit(1))
 *  - log: (msg) => void for diagnostics (default: stderr)
 */
export function createBridge(opts = {}) {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 8642;
  const allowedOrigins = opts.allowedOrigins ?? [];
  const configPath = opts.configPath;
  const log = opts.log ?? ((m) => process.stderr.write(`[slate-mcp] ${m}\n`));
  const onPairExhausted = opts.onPairExhausted ?? (() => process.exit(1));

  let token = loadToken(configPath);
  let tab = null; // the single authenticated tab socket
  let candidate = null; // a connected-but-unauthenticated tab
  let pairing = null; // { code, attempts }
  let nextId = 1;
  const pending = new Map(); // id -> {resolve, reject, timer}

  const wss = new WebSocketServer({
    host,
    port,
    verifyClient: ({ origin }) => originAllowed(origin, allowedOrigins),
  });

  function send(ws, msg) {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ slateBridge: PROTOCOL_VERSION, ...msg }));
  }

  function dropTab(ws) {
    if (tab === ws) {
      tab = null;
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new NoTabError());
        pending.delete(id);
      }
    }
    if (candidate === ws) candidate = null;
  }

  wss.on('connection', (ws) => {
    if (tab) {
      // first paired tab wins (PRD §8.1)
      send(ws, { method: 'busy' });
      ws.close();
      return;
    }
    candidate = ws;

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
            tab = ws;
            candidate = null;
            send(ws, { method: 'auth.ok' });
            log('tab authenticated');
          } else {
            send(ws, { method: 'auth.fail' });
          }
          return;
        }
        case 'hello':
          return; // connected, not yet paired — pairing starts on the first tool call
        case 'pair.complete': {
          if (!pairing) return;
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
        default:
          return; // capability ceiling: everything else is ignored
      }
    });

    ws.on('close', () => dropTab(ws));
    ws.on('error', () => dropTab(ws));
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

  return {
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
  };
}

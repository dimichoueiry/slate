// WebSocket client for the slate-mcp local bridge. The tab connects OUT to
// ws://127.0.0.1:<port> (allowed from an https page because localhost is a
// trustworthy origin), authenticates with the pairing token, and serves the
// bridge methods (PRD §8.1–8.3). Holds no board data itself.

import { create } from 'zustand';
import { METHODS, BridgeError } from './methods';

const TOKEN_KEY = 'slate-bridge-token';
const PORT_KEY = 'slate-bridge-port';
const DISABLED_KEY = 'slate-bridge-disabled';
export const DEFAULT_PORT = 8642;
const PROTOCOL_VERSION = 1;

export type BridgeStatus = 'off' | 'connecting' | 'pairing' | 'connected';

interface BridgeState {
  status: BridgeStatus;
  /** true while the pairing dialog should be shown */
  pairRequested: boolean;
  pairError: string | null;
  lastActivity: string | null;
}

export const useBridge = create<BridgeState>(() => ({
  status: 'off',
  pairRequested: false,
  pairError: null,
  lastActivity: null,
}));

function port(): number {
  const p = Number(localStorage.getItem(PORT_KEY));
  return isFinite(p) && p > 0 ? p : DEFAULT_PORT;
}

let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function send(msg: Record<string, any>) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ slateBridge: PROTOCOL_VERSION, ...msg }));
}

async function handleToolCall(id: string | number, method: string, params: any) {
  const fn = METHODS[method];
  if (!fn) {
    send({ id, error: { message: `Unknown method "${method}"` } });
    return;
  }
  useBridge.setState({ lastActivity: method });
  try {
    const result = await fn(params ?? {});
    send({ id, result });
  } catch (e: any) {
    const message = e instanceof BridgeError ? e.message : `Internal error: ${String(e?.message ?? e)}`;
    send({ id, error: { message } });
  }
}

function onMessage(ev: MessageEvent) {
  let msg: any;
  try {
    msg = JSON.parse(String(ev.data));
  } catch {
    return;
  }
  switch (msg.method) {
    case 'pair.request':
      useBridge.setState({ status: 'pairing', pairRequested: true, pairError: null });
      return;
    case 'pair.ok':
      if (typeof msg.params?.token === 'string') localStorage.setItem(TOKEN_KEY, msg.params.token);
      useBridge.setState({ status: 'connected', pairRequested: false, pairError: null });
      return;
    case 'pair.fail':
      useBridge.setState({ pairError: `Wrong code${msg.params?.remaining != null ? ` — ${msg.params.remaining} attempts left` : ''}` });
      return;
    case 'auth.ok':
      useBridge.setState({ status: 'connected', pairRequested: false });
      return;
    case 'auth.fail':
      // stale token — forget it; the server will ask to pair on the next tool call
      localStorage.removeItem(TOKEN_KEY);
      useBridge.setState({ status: 'connecting' });
      return;
    default:
      if (msg.id !== undefined && typeof msg.method === 'string') void handleToolCall(msg.id, msg.method, msg.params);
  }
}

function connect() {
  if (localStorage.getItem(DISABLED_KEY) === '1') return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port()}`);
  } catch {
    scheduleRetry();
    return;
  }
  useBridge.setState({ status: 'connecting' });
  ws.onopen = () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) send({ method: 'auth', params: { token } });
    else send({ method: 'hello' });
  };
  ws.onmessage = onMessage;
  ws.onclose = () => {
    ws = null;
    if (useBridge.getState().status !== 'off') useBridge.setState({ status: 'off', pairRequested: false });
    scheduleRetry();
  };
  ws.onerror = () => {
    // onclose follows; nothing to do (no bridge running is the normal case)
  };
}

function scheduleRetry() {
  if (retryTimer || localStorage.getItem(DISABLED_KEY) === '1') return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, 5000);
}

/** Start the background connect loop (idempotent; called once from App). */
export function startBridge() {
  if (started) return;
  started = true;
  connect();
}

/** User typed the pairing code shown by the agent. */
export function submitPairingCode(code: string) {
  send({ method: 'pair.complete', params: { code: code.trim() } });
}

export function dismissPairing() {
  useBridge.setState({ pairRequested: false });
}

/** One-click disconnect (kill switch). Stays off for this session. */
export function disconnectBridge() {
  localStorage.setItem(DISABLED_KEY, '1');
  ws?.close();
  ws = null;
  useBridge.setState({ status: 'off', pairRequested: false });
}

export function reconnectBridge() {
  localStorage.removeItem(DISABLED_KEY);
  connect();
}

/** Forget the pairing entirely — the next agent call requires re-pairing. */
export function forgetPairing() {
  localStorage.removeItem(TOKEN_KEY);
  disconnectBridge();
}

export function bridgeEnabled(): boolean {
  return localStorage.getItem(DISABLED_KEY) !== '1';
}

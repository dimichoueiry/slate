// Security + protocol tests for the bridge core (PRD §8.3 item 6):
// wrong origin rejected, bad token rejected, pairing flow, exhausted pairing,
// no-tab fail-fast, and single-tab exclusivity.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createBridge, PairingRequiredError, NoTabError, originAllowed } from '../src/server.js';
import { loadToken } from '../src/pairing.js';

let nextPort = 18700 + Math.floor(Math.random() * 200);

function makeBridge(extra = {}) {
  const port = nextPort++;
  const configPath = join(mkdtempSync(join(tmpdir(), 'slate-mcp-test-')), 'config.json');
  const bridge = createBridge({ port, configPath, log: () => {}, ...extra });
  return { bridge, port, configPath };
}

async function connect(port, origin) {
  const ws = await new Promise((resolve, reject) => {
    const s = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {});
    // queue every message BEFORE 'open': ws can emit 'message' synchronously
    // right after 'open' when a frame arrives with the handshake packet
    s.queue = [];
    s.waiters = [];
    s.on('message', (d) => {
      const msg = JSON.parse(String(d));
      const w = s.waiters.shift();
      if (w) w(msg);
      else s.queue.push(msg);
    });
    s.on('open', () => resolve(s));
    s.on('error', reject);
  });
  // let the server's 'connection' handler run before the test issues tool calls
  await new Promise((r) => setTimeout(r, 25));
  return ws;
}

function nextMessage(ws) {
  if (ws.queue.length) return Promise.resolve(ws.queue.shift());
  return new Promise((resolve) => ws.waiters.push(resolve));
}

test('origin allowlist logic', () => {
  assert.ok(originAllowed('http://localhost:5173'));
  assert.ok(originAllowed('https://localhost'));
  assert.ok(originAllowed('http://127.0.0.1:8080'));
  assert.ok(originAllowed(undefined), 'non-browser clients (no Origin) are allowed');
  assert.ok(!originAllowed('https://evil.example.com'));
  assert.ok(!originAllowed('http://localhost.evil.com'));
  assert.ok(originAllowed('https://slate.example.com', ['https://slate.example.com']));
});

test('connection from a disallowed web origin is rejected', async () => {
  const { bridge, port } = makeBridge();
  await assert.rejects(connect(port, 'https://evil.example.com'));
  await bridge.close();
});

test('tool call with no tab fails fast with NoTabError', async () => {
  const { bridge } = makeBridge();
  await assert.rejects(bridge.callTab('list_boards', {}), NoTabError);
  await bridge.close();
});

test('pairing: code round trip issues a token and forwards tool calls', async () => {
  const { bridge, port, configPath } = makeBridge();
  const tab = await connect(port, 'http://localhost:5173');
  tab.send(JSON.stringify({ method: 'hello' }));

  // first tool call triggers pairing
  const pairMsg = nextMessage(tab);
  let code;
  try {
    await bridge.callTab('list_boards', {});
    assert.fail('expected PairingRequiredError');
  } catch (e) {
    assert.ok(e instanceof PairingRequiredError);
    code = e.code;
    assert.match(code, /^\d{4}$/);
  }
  assert.equal((await pairMsg).method, 'pair.request');

  // user types the right code → pair.ok with a persisted token
  tab.send(JSON.stringify({ method: 'pair.complete', params: { code } }));
  const ok = await nextMessage(tab);
  assert.equal(ok.method, 'pair.ok');
  assert.equal(ok.params.token.length, 64);
  assert.equal(loadToken(configPath), ok.params.token);

  // tool calls now reach the tab and its answers come back
  tab.on('message', (d) => {
    const msg = JSON.parse(String(d));
    if (msg.method === 'list_boards') tab.send(JSON.stringify({ id: msg.id, result: { boards: [] } }));
  });
  const result = await bridge.callTab('list_boards', {});
  assert.deepEqual(result, { boards: [] });

  tab.close();
  await bridge.close();
});

test('wrong pairing code 3 times calls onPairExhausted', async () => {
  let exhausted = false;
  const { bridge, port } = makeBridge({ onPairExhausted: () => (exhausted = true) });
  const tab = await connect(port, 'http://localhost:5173');
  tab.send(JSON.stringify({ method: 'hello' }));

  await assert.rejects(bridge.callTab('list_boards', {}), PairingRequiredError);
  assert.equal((await nextMessage(tab)).method, 'pair.request');
  for (let i = 0; i < 3; i++) {
    tab.send(JSON.stringify({ method: 'pair.complete', params: { code: 'nope' } }));
    const fail = await nextMessage(tab);
    assert.equal(fail.method, 'pair.fail');
    assert.equal(fail.params.remaining, 2 - i);
  }
  assert.ok(exhausted);

  tab.close();
  await bridge.close();
});

test('auth with a wrong token is rejected; tool calls do not reach an unauthenticated tab', async () => {
  const { bridge, port, configPath } = makeBridge();
  // pair a first tab to establish a real token, then drop it
  const first = await connect(port, 'http://localhost:5173');
  first.send(JSON.stringify({ method: 'hello' }));
  const pairReq = nextMessage(first);
  const code = await bridge.callTab('x', {}).catch((e) => e.code);
  await pairReq;
  first.send(JSON.stringify({ method: 'pair.complete', params: { code } }));
  await nextMessage(first); // pair.ok
  first.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(loadToken(configPath));

  // a new connection with a wrong token gets auth.fail and no tool traffic
  const evilTab = await connect(port, 'http://localhost:5173');
  evilTab.send(JSON.stringify({ method: 'auth', params: { token: 'f'.repeat(64) } }));
  const failMsg = await nextMessage(evilTab);
  assert.equal(failMsg.method, 'auth.fail');
  await assert.rejects(bridge.callTab('list_boards', {}), PairingRequiredError); // still unpaired socket → repair, never forwarded

  evilTab.close();
  await bridge.close();
});

test('a second connection while a tab is paired is turned away as busy', async () => {
  const { bridge, port } = makeBridge();
  const tab = await connect(port, 'http://localhost:5173');
  tab.send(JSON.stringify({ method: 'hello' }));
  const pairReq = nextMessage(tab);
  const code = await bridge.callTab('x', {}).catch((e) => e.code);
  await pairReq;
  tab.send(JSON.stringify({ method: 'pair.complete', params: { code } }));
  await nextMessage(tab); // pair.ok

  const second = await connect(port, 'http://localhost:5173');
  const busy = await nextMessage(second);
  assert.equal(busy.method, 'busy');

  tab.close();
  await bridge.close();
});

test('a paired token from a previous session authenticates directly', async () => {
  const { bridge, port, configPath } = makeBridge();
  const tab = await connect(port, 'http://localhost:5173');
  tab.send(JSON.stringify({ method: 'hello' }));
  const pairReq = nextMessage(tab);
  const code = await bridge.callTab('x', {}).catch((e) => e.code);
  await pairReq;
  tab.send(JSON.stringify({ method: 'pair.complete', params: { code } }));
  const { params } = await nextMessage(tab);
  tab.close();
  await new Promise((r) => setTimeout(r, 50));

  const again = await connect(port, 'http://localhost:5173');
  again.send(JSON.stringify({ method: 'auth', params: { token: params.token } }));
  const ok = await nextMessage(again);
  assert.equal(ok.method, 'auth.ok');
  assert.equal(loadToken(configPath), params.token);

  again.close();
  await bridge.close();
});

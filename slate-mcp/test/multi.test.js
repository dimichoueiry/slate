// Multi-session bridge tests: a second slate-mcp process joins the first as a
// peer (leader election by port bind), its tool calls forward through the
// leader to the tab, unpaired/wrong-token peers are refused, pairing errors
// propagate to peers, and a peer takes over the port when the leader exits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createBridge, PairingRequiredError } from '../src/server.js';
import { saveToken, newToken, loadToken } from '../src/pairing.js';

let nextPort = 19200 + Math.floor(Math.random() * 200);

function tmpConfig() {
  return join(mkdtempSync(join(tmpdir(), 'slate-mcp-multi-')), 'config.json');
}

async function connectTab(port, { token, retryFor = 0 } = {}) {
  const deadline = Date.now() + retryFor;
  // takeover races the port bind — retry until the new leader is listening
  for (;;) {
    try {
      const ws = await new Promise((resolve, reject) => {
        const s = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'http://localhost:5173' });
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
      await new Promise((r) => setTimeout(r, 25));
      ws.send(JSON.stringify(token ? { method: 'auth', params: { token } } : { method: 'hello' }));
      return ws;
    } catch (e) {
      if (Date.now() >= deadline) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

function nextMessage(ws) {
  if (ws.queue.length) return Promise.resolve(ws.queue.shift());
  return new Promise((resolve) => ws.waiters.push(resolve));
}

function answerListBoards(ws) {
  ws.on('message', (d) => {
    const msg = JSON.parse(String(d));
    if (msg.method === 'list_boards') ws.send(JSON.stringify({ id: msg.id, result: { boards: ['b1'] } }));
  });
}

/** Leader on `port` with a pre-seeded token + an authenticated tab answering list_boards. */
async function pairedLeader(port, configPath) {
  saveToken(configPath, newToken());
  const leader = createBridge({ port, configPath, log: () => {} });
  const tab = await connectTab(port, { token: loadToken(configPath) });
  assert.equal((await nextMessage(tab)).method, 'auth.ok');
  answerListBoards(tab);
  return { leader, tab };
}

test('a second bridge on the same port joins as a peer and its calls reach the tab', async () => {
  const port = nextPort++;
  const configPath = tmpConfig();
  const { leader, tab } = await pairedLeader(port, configPath);

  const peer = createBridge({ port, configPath, log: () => {} });
  const result = await peer.callTab('list_boards', {});
  assert.deepEqual(result, { boards: ['b1'] });
  assert.equal(peer.mode, 'peer');
  assert.equal(leader.mode, 'leader');

  tab.close();
  await peer.close();
  await leader.close();
});

test('both sessions can call concurrently through one tab', async () => {
  const port = nextPort++;
  const configPath = tmpConfig();
  const { leader, tab } = await pairedLeader(port, configPath);
  const peer = createBridge({ port, configPath, log: () => {} });

  const results = await Promise.all([
    leader.callTab('list_boards', {}),
    peer.callTab('list_boards', {}),
    peer.callTab('list_boards', {}),
  ]);
  for (const r of results) assert.deepEqual(r, { boards: ['b1'] });

  tab.close();
  await peer.close();
  await leader.close();
});

test('a peer without the paired token is refused', async () => {
  const port = nextPort++;
  const configPath = tmpConfig();
  const { leader, tab } = await pairedLeader(port, configPath);

  // different config dir — no token, like a process from another (untrusted) context
  const stranger = createBridge({ port, configPath: tmpConfig(), log: () => {} });
  await assert.rejects(stranger.callTab('list_boards', {}), /could not join the shared Slate bridge/);

  tab.close();
  await stranger.close();
  await leader.close();
});

test('pairing-required propagates to a peer with the code', async () => {
  const port = nextPort++;
  const configPath = tmpConfig();
  saveToken(configPath, newToken()); // token exists (peer can join) …
  const leader = createBridge({ port, configPath, log: () => {} });
  const tab = await connectTab(port); // … but the tab lost its token → hello, unpaired
  const peer = createBridge({ port, configPath, log: () => {} });

  const pairReq = nextMessage(tab);
  try {
    await peer.callTab('list_boards', {});
    assert.fail('expected PairingRequiredError');
  } catch (e) {
    assert.ok(e instanceof PairingRequiredError);
    assert.match(e.code, /^\d{4}$/);
  }
  assert.equal((await pairReq).method, 'pair.request');

  tab.close();
  await peer.close();
  await leader.close();
});

test('when the leader exits, a peer takes over the port and serves the reconnecting tab', async () => {
  const port = nextPort++;
  const configPath = tmpConfig();
  const { leader, tab } = await pairedLeader(port, configPath);

  const peer = createBridge({ port, configPath, log: () => {} });
  assert.deepEqual(await peer.callTab('list_boards', {}), { boards: ['b1'] });

  await leader.close(); // kills the port and the tab connection

  // the tab reconnects (the real tab retries every 5s; here we retry fast)
  const tab2 = await connectTab(port, { token: loadToken(configPath), retryFor: 4000 });
  assert.equal((await nextMessage(tab2)).method, 'auth.ok');
  answerListBoards(tab2);

  assert.deepEqual(await peer.callTab('list_boards', {}), { boards: ['b1'] });
  assert.equal(peer.mode, 'leader');

  tab.terminate();
  tab2.close();
  await peer.close();
});

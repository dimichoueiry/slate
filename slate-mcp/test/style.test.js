// Drawing-style param: schema exposure, enum validation, and a full round trip
// through the real stdio MCP server to a (fake) Slate tab and back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { checkStyleArgs, DRAW_STYLES } from '../src/style.js';
import { saveToken, newToken } from '../src/pairing.js';

const INDEX = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

test('checkStyleArgs accepts the enum, absence, and null on update', () => {
  assert.deepEqual(DRAW_STYLES, ['sketch', 'handdrawn', 'messy']);
  for (const style of DRAW_STYLES) {
    assert.equal(checkStyleArgs('create_board', { name: 'b', style }), null);
    assert.equal(checkStyleArgs('add_objects', { objects: [{ type: 'shape', style }] }), null);
    assert.equal(checkStyleArgs('update_objects', { edits: [{ id: 'a', patch: { style } }] }), null);
  }
  assert.equal(checkStyleArgs('create_board', { name: 'b' }), null);
  assert.equal(checkStyleArgs('add_objects', { objects: [{ type: 'shape' }] }), null);
  assert.equal(checkStyleArgs('update_objects', { edits: [{ id: 'a', patch: { style: null } }] }), null);
});

test('checkStyleArgs rejects anything outside the enum', () => {
  assert.match(checkStyleArgs('create_board', { name: 'b', style: 'crayon' }), /create_board: style must be one of sketch\|handdrawn\|messy/);
  assert.match(checkStyleArgs('create_board', { name: 'b', style: null }), /create_board/);
  assert.match(checkStyleArgs('add_objects', { objects: [{ type: 'shape' }, { type: 'text', style: 'Sketch' }] }), /objects\[1\]/);
  assert.match(checkStyleArgs('update_objects', { edits: [{ id: 'a', patch: { style: 3 } }] }), /edits\[0\]\.patch/);
});

// ---------- stdio server <-> fake tab ----------

/** A Slate tab stand-in that keeps boards in memory and answers the style-bearing tools. */
function fakeTab(ws) {
  const boards = new Map();
  const calls = [];
  let n = 0;
  ws.on('message', (d) => {
    const msg = JSON.parse(String(d));
    if (!msg.method || msg.id === undefined) return;
    calls.push(msg);
    const p = msg.params ?? {};
    let result;
    if (msg.method === 'create_board') {
      const id = `b${++n}`;
      boards.set(id, { id, name: p.name, style: p.style ?? 'sketch', objects: [] });
      result = { boardId: id, name: p.name, style: boards.get(id).style };
    } else if (msg.method === 'add_objects') {
      const b = boards.get(p.boardId);
      const ids = p.objects.map((o) => {
        const obj = { id: `o${++n}`, type: o.type, ...(o.style ? { style: o.style } : {}) };
        b.objects.push(obj);
        return obj.id;
      });
      result = { ids, created: ids.length };
    } else if (msg.method === 'update_objects') {
      const b = boards.get(p.boardId);
      result = {
        results: p.edits.map((e) => {
          const o = b.objects.find((x) => x.id === e.id);
          if (e.patch.style === null) delete o.style;
          else if (e.patch.style) o.style = e.patch.style;
          return { id: e.id, ok: true };
        }),
      };
    } else if (msg.method === 'read_board') {
      const b = boards.get(p.boardId);
      result = { board: { id: b.id, name: b.name, style: b.style }, objectCount: b.objects.length, objects: b.objects };
    }
    ws.send(JSON.stringify({ id: msg.id, result }));
  });
  return { calls };
}

async function connectTab(port, token) {
  for (let tries = 0; ; tries++) {
    try {
      const ws = await new Promise((resolve, reject) => {
        const s = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'http://localhost:5173' });
        s.once('message', (d) => {
          assert.equal(JSON.parse(String(d)).method, 'auth.ok');
          resolve(s);
        });
        s.on('open', () => s.send(JSON.stringify({ method: 'auth', params: { token } })));
        s.on('error', reject);
      });
      return ws;
    } catch (e) {
      if (tries > 100) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

function startServer(port, home) {
  const child = spawn(process.execPath, [INDEX, '--port', String(port)], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const pending = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });
  let nextId = 1;
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const call = async (name, args) => {
    const msg = await rpc('tools/call', { name, arguments: args });
    const text = msg.result.content[0].text;
    return { isError: msg.result.isError, text, json: msg.result.isError ? null : JSON.parse(text) };
  };
  return { child, rpc, call };
}

test('style round-trips through the MCP server: create_board, add_objects, update_objects, read_board', async () => {
  const home = mkdtempSync(join(tmpdir(), 'slate-mcp-style-'));
  mkdirSync(join(home, '.slate-mcp'), { recursive: true });
  const token = newToken();
  saveToken(join(home, '.slate-mcp', 'config.json'), token);
  const port = 19500 + Math.floor(Math.random() * 300);
  const server = startServer(port, home);
  const ws = await connectTab(port, token);
  const tab = fakeTab(ws);
  try {
    // schemas advertise the enum
    const list = await server.rpc('tools/list', {});
    const tools = Object.fromEntries(list.result.tools.map((t) => [t.name, t]));
    assert.deepEqual(tools.create_board.inputSchema.properties.style.enum, DRAW_STYLES);
    assert.deepEqual(tools.add_objects.inputSchema.properties.objects.items.properties.style.enum, DRAW_STYLES);
    assert.deepEqual(tools.update_objects.inputSchema.properties.edits.items.properties.patch.properties.style.enum, [...DRAW_STYLES, null]);
    assert.match(tools.update_objects.description, /patch\.style/);

    const created = await server.call('create_board', { name: 'Styled', style: 'messy' });
    assert.equal(created.isError, false);
    assert.equal(created.json.style, 'messy');
    assert.equal(tab.calls.at(-1).params.style, 'messy', 'style reached the tab unchanged');
    const boardId = created.json.boardId;

    const added = await server.call('add_objects', {
      boardId,
      objects: [{ type: 'shape', style: 'handdrawn' }, { type: 'sticky' }],
    });
    const [shapeId, stickyId] = added.json.ids;
    assert.equal(tab.calls.at(-1).params.objects[0].style, 'handdrawn');

    let read = await server.call('read_board', { boardId });
    assert.equal(read.json.board.style, 'messy');
    assert.equal(read.json.objects.find((o) => o.id === shapeId).style, 'handdrawn');
    assert.equal(read.json.objects.find((o) => o.id === stickyId).style, undefined, 'no override → follows the board');

    await server.call('update_objects', { boardId, edits: [{ id: stickyId, patch: { style: 'sketch' } }, { id: shapeId, patch: { style: null } }] });
    read = await server.call('read_board', { boardId });
    assert.equal(read.json.objects.find((o) => o.id === stickyId).style, 'sketch');
    assert.equal(read.json.objects.find((o) => o.id === shapeId).style, undefined);

    // invalid values are refused before reaching the tab
    const before = tab.calls.length;
    const bad1 = await server.call('create_board', { name: 'x', style: 'crayon' });
    const bad2 = await server.call('add_objects', { boardId, objects: [{ type: 'shape', style: 'MESSY' }] });
    const bad3 = await server.call('update_objects', { boardId, edits: [{ id: shapeId, patch: { style: 'pencil' } }] });
    for (const r of [bad1, bad2, bad3]) {
      assert.equal(r.isError, true);
      assert.match(r.text, /style must be one of sketch\|handdrawn\|messy/);
    }
    assert.equal(tab.calls.length, before);
  } finally {
    ws.close();
    server.child.kill();
  }
});

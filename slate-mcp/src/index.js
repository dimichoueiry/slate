#!/usr/bin/env node
// slate-mcp — MCP server (stdio) that lets a coding agent draw on and read
// from a Slate canvas. Speaks newline-delimited JSON-RPC 2.0 on stdio to the
// MCP client and forwards the nine bridge tools to the Slate tab over a
// localhost WebSocket (see server.js). Zero cloud, zero telemetry.

import { createInterface } from 'node:readline';
import { createBridge, PairingRequiredError, NoTabError } from './server.js';
import { defaultConfigPath } from './pairing.js';

// ---------- CLI args ----------

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}
function argValues(flag) {
  const out = [];
  args.forEach((a, i) => {
    if (a === flag && args[i + 1]) out.push(args[i + 1]);
  });
  return out;
}

const port = Number(argValue('--port') ?? process.env.SLATE_MCP_PORT ?? 8642);
const allowedOrigins = [
  ...argValues('--allow-origin'),
  ...(process.env.SLATE_BRIDGE_ORIGINS ? process.env.SLATE_BRIDGE_ORIGINS.split(',') : []),
].map((s) => s.trim()).filter(Boolean);

const bridge = createBridge({ port, allowedOrigins, configPath: defaultConfigPath() });

// ---------- tool definitions (PRD §7 — exactly nine) ----------

const LAYOUT_GUIDE = [
  'Layout guidance: think like someone drawing on a whiteboard.',
  'Prefer autoLayout:"layered" for architecture/flow diagrams (top-to-bottom by dependency) and "grid" for collections; with autoLayout you may omit x/y.',
  'If you position manually: shapes ~180x90, stickies ~200x180, leave at least 40px gutters, never overlap objects, and lay out left-to-right or top-to-bottom in reading order.',
  'Use shape (roundedRect) + short label text for components, stickies for notes/explanations, frames to group sections, connectors with labels for relationships.',
].join(' ');

const objectSpec = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['sticky', 'text', 'shape', 'frame', 'connector'] },
    ref: { type: 'string', description: 'Optional handle so connectors in this same call can reference this object via {"ref": "..."}' },
    x: { type: 'number' },
    y: { type: 'number' },
    w: { type: 'number' },
    h: { type: 'number' },
    text: { type: 'string', description: 'Label/content for sticky, text and shape objects' },
    name: { type: 'string', description: 'Frame title' },
    shape: { type: 'string', enum: ['rect', 'roundedRect', 'ellipse', 'triangle', 'diamond', 'parallelogram'] },
    color: { type: 'string', description: 'Hex color — sticky background or text color' },
    fill: { type: 'string', description: 'Shape fill: hex or "transparent"' },
    stroke: { type: 'string', description: 'Hex border/line color' },
    textColor: { type: 'string' },
    fontSize: { type: 'number' },
    dash: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
    label: { type: 'string', description: 'Connector label drawn at its midpoint' },
    routing: { type: 'string', enum: ['straight', 'elbow', 'curved'] },
    endArrow: { type: 'string', enum: ['none', 'triangle'] },
    from: { description: 'Connector start: {"ref":"..."} (object in this call), {"id":"..."} (object already on the board) or {"x":..,"y":..}' },
    to: { description: 'Connector end: same forms as "from"' },
  },
  required: ['type'],
};

const TOOLS = [
  {
    name: 'list_boards',
    description: 'List all Slate boards with id, name, project, last-updated time and object count.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_board',
    description:
      'Read every object on a board (never truncated): positions, sizes, text, connector endpoints, frames. Ink strokes are summarized as bounding boxes. Use this to see what is on the canvas — including edits the user made by hand — before adding to it.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        frameId: { type: 'string', description: 'Optional: only objects inside this frame' },
      },
      required: ['boardId'],
    },
  },
  {
    name: 'get_node_output',
    description: 'Read the last output of a runnable AI node (a sticky/text whose first line is a prefix like "ai:", "chart:", "img:").',
    inputSchema: {
      type: 'object',
      properties: { boardId: { type: 'string' }, objectId: { type: 'string' } },
      required: ['boardId', 'objectId'],
    },
  },
  {
    name: 'create_board',
    description: 'Create a new Slate board (optionally inside a project) and open it in the tab. Returns the boardId.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, projectId: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'add_objects',
    description:
      `Add a batch of objects (stickies, text, shapes, frames, connectors) to a board in ONE call — one call is one undo step and the objects animate in. ${LAYOUT_GUIDE}`,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objects: { type: 'array', items: objectSpec, description: 'All objects for this diagram, connectors included' },
        autoLayout: {
          type: 'string',
          enum: ['layered', 'none', 'grid'],
          description: 'layered = top-to-bottom DAG layout from the connectors (best for architectures); grid = row-major grid; none = use the x/y you provide',
        },
      },
      required: ['boardId', 'objects'],
    },
  },
  {
    name: 'update_objects',
    description: 'Update existing objects (text, colors, position, size, labels). One call is one undo step. Only text/style/geometry props are editable.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, patch: { type: 'object' } },
            required: ['id', 'patch'],
          },
        },
      },
      required: ['boardId', 'edits'],
    },
  },
  {
    name: 'delete_objects',
    description: 'Delete objects from a board by id (never deletes boards). One call is one undo step.',
    inputSchema: {
      type: 'object',
      properties: { boardId: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } },
      required: ['boardId', 'ids'],
    },
  },
  {
    name: 'run_node',
    description:
      'Run a runnable AI node on the board (same as the user pressing ▶). Waits up to timeoutSeconds (default 60) and returns the output; slow nodes (video, deep research) return a runId to poll with get_run_status.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objectId: { type: 'string' },
        timeoutSeconds: { type: 'number' },
      },
      required: ['boardId', 'objectId'],
    },
  },
  {
    name: 'get_run_status',
    description: 'Poll a long-running node started by run_node. Returns status and, when done, the output.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] },
  },
];

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

// ---------- MCP stdio server (newline-delimited JSON-RPC 2.0) ----------

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function toolText(id, text, isError = false) {
  reply(id, { content: [{ type: 'text', text }], isError });
}

async function handleToolCall(id, name, args) {
  if (!TOOL_NAMES.has(name)) {
    replyError(id, -32602, `Unknown tool "${name}"`);
    return;
  }
  const timeoutMs = name === 'run_node' ? (Number(args?.timeoutSeconds) > 0 ? Number(args.timeoutSeconds) * 1000 + 10_000 : 70_000) : 30_000;
  try {
    const result = await bridge.callTab(name, args ?? {}, timeoutMs);
    toolText(id, JSON.stringify(result, null, 2));
  } catch (e) {
    if (e instanceof PairingRequiredError) {
      toolText(id, e.message, false); // an instruction for the user, not a failure
    } else if (e instanceof NoTabError) {
      toolText(id, e.message, true);
    } else {
      toolText(id, String(e?.message ?? e), true);
    }
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'slate-mcp', version: '0.1.0' },
      });
      return;
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return; // notifications need no reply
    case 'ping':
      reply(id, {});
      return;
    case 'tools/list':
      reply(id, { tools: TOOLS });
      return;
    case 'tools/call':
      await handleToolCall(id, params?.name, params?.arguments);
      return;
    default:
      if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  void handle(msg).catch((e) => {
    if (msg.id !== undefined) replyError(msg.id, -32603, String(e?.message ?? e));
  });
});
rl.on('close', () => {
  void bridge.close().then(() => process.exit(0));
});

process.stderr.write(`[slate-mcp] bridge listening on ws://127.0.0.1:${port} — waiting for a Slate tab\n`);

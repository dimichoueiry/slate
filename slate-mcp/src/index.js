#!/usr/bin/env node
// slate-mcp — MCP server (stdio) that lets a coding agent draw on and read
// from a Slate canvas. Speaks newline-delimited JSON-RPC 2.0 on stdio to the
// MCP client and forwards the bridge tools to the Slate tab over a
// localhost WebSocket (see server.js). Zero cloud, zero telemetry.

import { createInterface } from 'node:readline';
import { createBridge, PairingRequiredError, NoTabError } from './server.js';
import { defaultConfigPath } from './pairing.js';
import { checkSvg } from './svg.js';
import { ICON_NAMES } from './icons.js';

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

// ---------- tool definitions (PRD §7 + v1.1 §5 + v1.2 §5 — exactly thirteen) ----------

const LAYOUT_GUIDE = [
  'Layout guidance: think like someone drawing on a whiteboard.',
  'Prefer autoLayout:"layered" for architecture/flow diagrams (top-to-bottom by dependency) and "grid" for collections; with autoLayout you may omit x/y.',
  'If you position manually: shapes ~180x90, stickies ~200x180, leave at least 40px gutters, never overlap objects, and lay out left-to-right or top-to-bottom in reading order.',
  'Use shape (roundedRect) + short label text for components, stickies for notes/explanations, frames to group sections, connectors with labels for relationships.',
].join(' ');

const NODE_GUIDE = [
  'RUNNABLE AI NODES: a sticky or text object whose FIRST LINE starts with a prefix IS a live AI node the user (or run_node) can execute — you can create them with this tool.',
  'Prefixes: "ai:" (generate text), "img:" (generate an image), "vid:" (generate a video), "web:" (scrape wired URLs), "search:" (web search with citations), "research:" (deep research agent), "extract:" (extract a table), "chart:" (make a chart), "business:" (analytics over wired CSV uploads), "data:" (HTTP fetch), "condition:"/"if:" (yes/no branch), "interval:"/"every:" (re-run on a timer), "fix:" (improve a prompt).',
  'Example sticky text: "ai: rephrase the wired greeting in a friendly tone".',
  'WIRING: connectors INTO a node are its inputs (their text/images feed the prompt); objects a node points AT are its outputs (results are written there — wire an empty sticky as the output, or let the run spawn one).',
  'Chains of wired nodes form flows that run in dependency order.',
].join(' ');

const GRAPHICS_GUIDE = [
  'ICONS: {type:"icon", icon:"database", x, y, w?, color?} places a crisp vector icon from the registry (see the icon property for all names).',
  'CUSTOM SVG: {type:"image", svg:"<svg viewBox=\\"0 0 W H\\">…</svg>", x, y, w?, h?} renders SVG you author — logos, illustrations, mini-charts.',
  'SVG rules: single <svg> root with a viewBox; inline styles only; no scripts, event handlers, external hrefs/fonts/images (rejected); avoid pure-white or pure-black fills so it reads on light AND dark canvases.',
  'After drawing, call focus_on with the returned ids so the user sees the result.',
].join(' ');

const objectSpec = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['sticky', 'text', 'shape', 'frame', 'connector', 'icon', 'image'] },
    ref: { type: 'string', description: 'Optional handle so connectors in this same call can reference this object via {"ref": "..."}' },
    x: { type: 'number' },
    y: { type: 'number' },
    w: { type: 'number' },
    h: { type: 'number' },
    text: { type: 'string', description: 'Label/content for sticky, text and shape objects. Start the first line with an AI prefix ("ai:", "img:", "search:", …) to make the object a runnable AI node.' },
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
    fromAnchor: { type: 'string', enum: ['left', 'right', 'top', 'bottom'], description: 'Pin the connector start to a fixed side of the from-object. Omit for automatic (endpoint re-routes as objects move) — usually better for diagrams' },
    toAnchor: { type: 'string', enum: ['left', 'right', 'top', 'bottom'], description: 'Pin the connector end to a fixed side of the to-object. Omit for automatic' },
    icon: { type: 'string', description: `Icon name from the registry. All names: ${ICON_NAMES.join(' ')}` },
    svg: { type: 'string', description: 'For type:"image" — self-contained SVG markup (viewBox required unless w/h given; max 512 KB; no scripts/external refs)' },
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
      'Read every object on a board (never truncated): positions, sizes, text, connector endpoints, frames. Objects with "runnable": true are live AI nodes (executable via run_node). On the currently open board, objects the user has selected carry "selected": true. Ink strokes are summarized as bounding boxes. Use this to see what is on the canvas — including edits the user made by hand — before adding to it.',
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
    name: 'get_selection',
    description:
      'What the user currently has SELECTED on the open board — the canvas equivalent of pointing. Call this when the user\'s instruction says "this", "these", "that", "selected", "what I picked", or otherwise points at objects without naming them. Call it at instruction time, not preemptively — the selection changes as the user works. Returns the open boardId/boardName, the full selected objects (same shape as read_board, so a follow-up read_board is usually unnecessary before update_objects/delete_objects), and their combined bounding box (useful for placing new objects next to the selection). An empty selection is not an error — ask the user to select the objects they mean.',
    inputSchema: { type: 'object', properties: {} },
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
      `Add a batch of objects (stickies, text, shapes, frames, connectors, icons, custom SVG graphics) to a board in ONE call — one call is one undo step and the objects animate in. ${GRAPHICS_GUIDE} ${NODE_GUIDE} ${LAYOUT_GUIDE}`,
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
      'Run a runnable AI node on the board (same as the user pressing ▶) — including nodes you just created with add_objects. Waits up to timeoutSeconds (default 60) and returns the output; slow nodes (video, deep research) return a runId to poll with get_run_status.',
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
  {
    name: 'render_board',
    description:
      'SEE the board: render it (or a region) to a PNG image you can look at. Use this to check your own layout after drawing (fix overlaps/misalignment), and to read the user\'s freehand ink — pen circles, arrows and annotations are invisible to read_board but visible here. The accompanying text gives the world-coordinate mapping (region + scale) so positions in the image convert back to board coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        region: {
          description: 'Optional: {"x","y","w","h"} world rect, or {"objectIds":[...]} to frame specific objects. Defaults to everything on the board.',
        },
        maxDimension: { type: 'number', description: 'Long-edge pixel cap for the PNG (default 1568, max 4096)' },
      },
      required: ['boardId'],
    },
  },
  {
    name: 'focus_on',
    description:
      "Pan/zoom the user's viewport to frame the given objects (smooth 400ms animation). Call after add_objects so the user watches the result appear. Rate-limited to one move per second — excess calls return {coalesced:true} without moving. Never modifies the board.",
    inputSchema: {
      type: 'object',
      properties: { boardId: { type: 'string' }, objectIds: { type: 'array', items: { type: 'string' } } },
      required: ['boardId', 'objectIds'],
    },
  },
  {
    name: 'add_upload',
    description:
      'Create a real Slate upload node from text file content you have (csv, txt, json, md) — e.g. a CSV from the repo. The FULL content is stored (analytics nodes read every row; nothing is truncated) and the node can be wired into business:/extract:/chart: flows. Max 20 MB; larger files must be dropped into Slate by the user. Not for binary formats (no PDF).',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        filename: { type: 'string', description: 'Name with extension, e.g. "sales.csv" — the extension picks the parser' },
        content: { type: 'string', description: 'The complete file content, verbatim' },
        kind: { type: 'string', enum: ['csv', 'text', 'json', 'markdown'], description: 'Optional override when the filename has no extension' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['boardId', 'filename', 'content'],
    },
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

const SLOW_TOOLS = new Set(['render_board', 'add_upload']);

async function handleToolCall(id, name, args) {
  if (!TOOL_NAMES.has(name)) {
    replyError(id, -32602, `Unknown tool "${name}"`);
    return;
  }
  // authoritative SVG safety check happens here (tested in svg.test.js);
  // the tab re-checks cheaply at the WS boundary
  if (name === 'add_objects' && Array.isArray(args?.objects)) {
    for (let i = 0; i < args.objects.length; i++) {
      const spec = args.objects[i];
      if (spec?.type === 'image') {
        const check = checkSvg(spec.svg);
        if (!check.ok) {
          toolText(id, `objects[${i}]: ${check.reason}`, true);
          return;
        }
      }
    }
  }
  const timeoutMs =
    name === 'run_node'
      ? Number(args?.timeoutSeconds) > 0
        ? Number(args.timeoutSeconds) * 1000 + 10_000
        : 70_000
      : SLOW_TOOLS.has(name)
        ? 60_000
        : 30_000;
  try {
    const result = await bridge.callTab(name, args ?? {}, timeoutMs);
    if (name === 'render_board' && result?.imageBase64) {
      const { imageBase64, mimeType, ...meta } = result;
      reply(id, {
        content: [
          { type: 'image', data: imageBase64, mimeType: mimeType || 'image/png' },
          { type: 'text', text: `Rendered world region x=${meta.region.x} y=${meta.region.y} w=${meta.region.w} h=${meta.region.h} at scale ${meta.scale} (${meta.pixelWidth}x${meta.pixelHeight}px). To convert image pixels to board coordinates: world = region.xy + pixel/scale.` },
        ],
        isError: false,
      });
      return;
    }
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
        serverInfo: { name: 'slate-mcp', version: '0.3.0' },
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
// startup mode (leader vs peer) is logged by the bridge itself once elected

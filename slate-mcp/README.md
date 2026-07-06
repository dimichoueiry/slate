# slate-mcp

**Your coding agent finally has a whiteboard.**

`slate-mcp` is an MCP server that lets Claude Code — or any MCP client — draw on and read from your [Slate](../README.md) canvas. Ask your agent to *"map this repo's architecture on my board"* and watch the diagram animate onto the canvas. Rearrange it by hand, then ask the agent *"what did I change?"* — it reads your edits back.

Everything runs on your machine: the agent talks to this bridge over stdio, and the bridge talks to your open Slate tab over a localhost WebSocket. It works with both a local dev Slate and the deployed web app (browsers allow `https` pages to reach `ws://127.0.0.1`). No cloud, no accounts, no telemetry.

## Setup

```sh
claude mcp add slate -- npx slate-mcp
```

Then open Slate in your browser and ask your agent to draw something. On first use the agent shows you a 4-digit pairing code — type it into the dialog that appears in Slate. That's it; the pairing persists.

## What the agent can do

| Tool | What it does |
|---|---|
| `list_boards` | List your boards |
| `read_board` | Read every object on a board — including your hand edits |
| `create_board` | Create and open a new board |
| `add_objects` | Draw a batch of stickies/shapes/text/frames/connectors (one undo step, animates in; optional auto-layout). A sticky whose first line starts with `ai:`, `img:`, `search:`, … is a live runnable AI node — the agent can build entire flows |
| `update_objects` | Edit text, colors, positions |
| `delete_objects` | Delete objects (never boards) |
| `run_node` | Run a Slate AI node (`ai:`, `chart:`, `img:`, …) like pressing ▶ |
| `get_node_output` | Read a node's last output |
| `get_run_status` | Poll a slow run (video, deep research) |

Everything the agent draws is a normal Slate object: move it, restyle it, and undo any agent action with a single ⌘Z.

## What the agent can never do

Touch your settings or API keys, delete boards, act while no Slate tab is open, or connect without your one-time pairing confirmation. The bridge binds to `127.0.0.1` only, checks web origins against an allowlist, and authenticates every session with a 256-bit token stored in `~/.slate-mcp/`.

## Options

```sh
slate-mcp [--port 8642] [--allow-origin https://your-slate-domain.com]
```

- `--port` / `SLATE_MCP_PORT` — WebSocket port (set the same port in Slate if you change it)
- `--allow-origin` / `SLATE_BRIDGE_ORIGINS` — extra allowed web origins for self-hosted Slate deployments (localhost is always allowed)

## Development

```sh
npm test   # security + protocol tests (node --test)
```

MIT.

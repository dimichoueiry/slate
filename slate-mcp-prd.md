# Product Requirements Document — "Slate MCP Bridge"

**Your coding agent finally has a whiteboard.**

| | |
|---|---|
| **Document status** | Draft v0.1 |
| **Feature codename** | Slate MCP Bridge (`slate-mcp`) |
| **Parent product** | Slate (see `slate-prd.md`) |
| **Owner** | Dc |
| **Last updated** | July 6, 2026 |
| **Target release** | Open-source launch feature |

---

## 1. Summary

The Slate MCP Bridge lets a locally running coding agent — Claude Code first, any MCP client by construction — read and draw on the user's Slate canvas. The agent can create boards, lay down diagrams (shapes, connectors, stickies, text, frames), read what the user has drawn or edited, and run Slate's AI flow nodes and read their outputs.

The bridge is a small local process (`npx slate-mcp`) that speaks **MCP over stdio** to the agent on one side and a **localhost WebSocket** to the open Slate browser tab on the other. It works identically whether Slate is served from `localhost` in dev or from the deployed Vercel site, because the app itself always runs in the browser on the user's machine. No cloud, no accounts, no keys held by us.

This is the marquee feature of the open-source launch. The pitch is one GIF: a terminal on the left, Slate on the right, the user types *"map this repo's architecture on my canvas"*, and a laid-out diagram animates onto the board.

---

## 2. Problem & motivation

Coding agents produce structure — architecture maps, plans, dependency graphs, research findings — but their only output surface is a text stream in a terminal. Text is a bad medium for structure: you can't zoom out on it, rearrange it, annotate it, or hand it back annotated.

Slate is the missing surface, and it has a structural advantage nobody in the canvas space can copy: **Slate is local-first and the agent is local, so they can talk directly on the user's machine.** Miro, FigJam, and tldraw.com are cloud apps; connecting a local agent to them means auth, APIs, and rate limits. Connecting Claude Code to Slate means a WebSocket across localhost.

**Core insight:** the feature is not "AI generates a diagram" (Slate's `ai:` nodes already do that). The feature is a **bidirectional loop**: the agent drafts on the canvas → the human rearranges, annotates, deletes, adds → the agent reads the human's edits back and continues. The canvas becomes the shared working memory between a person and their agent.

---

## 3. Goal & end condition

### Goal

A developer with Claude Code and Slate open on the same machine can, with one setup command and zero cloud dependencies, have their agent draw on and read from their canvas — reliably enough to demo live and safely enough to leave connected all day.

### End condition (definition of done)

The feature is **done** when all of the following are true:

1. A user who has never seen the feature can go from `npx slate-mcp init` to a connected agent in **under 2 minutes**, following only on-screen instructions.
2. In one Claude Code session, the prompt *"Draw the architecture of this repository on my Slate board"* produces a **legible, laid-out diagram** (≥ 10 nodes, connectors attached, no overlapping objects) on the user's open board, with objects animating in as they are created.
3. The round trip works: the user moves/edits/annotates that diagram by hand, then asks the agent *"what did I change?"* — and the agent answers correctly from `read_board`.
4. The agent can run an existing runnable node (e.g. an `ai:` or `chart:` node) on the board and receive its output as a tool result.
5. The bridge refuses connections from non-allowlisted web origins and from any client that has not completed the one-time pairing handshake; this is covered by automated tests.
6. Everything the agent does on the canvas is **undoable with a single Cmd+Z sequence** per tool call, exactly like the user's own actions.
7. It works against both `localhost` dev Slate and the deployed Vercel Slate, in current Chrome, Firefox, Safari, and Edge.
8. `slate-mcp` is published to npm under an MIT license, with a README containing the demo GIF.

If any of these fail, the feature is not launchable.

---

## 4. Target user

One persona for v1: **the agent-native developer.** They run Claude Code (or Cursor/Codex/another MCP client) daily, they star open-source repos, they post on X and Hacker News. They already have the terminal open; Slate must slot into that muscle memory, not create a new one.

Explicitly *not* designing for in v1: non-technical users, remote-dev/SSH setups (agent on machine A, browser on machine B), and teams.

---

## 5. Jobs to be done

- "When my agent plans a refactor or maps a codebase, I want the plan on a canvas — not in scrollback — so I can see the whole shape of it."
- "When I disagree with the agent's structure, I want to just move the boxes and cross things out, and have the agent see my edits, so feedback costs me nothing."
- "When my agent researches something, I want the findings dropped onto my board as organized objects, so they land where my thinking already lives."
- "When I've wired an AI flow on my canvas, I want my agent to be able to run it and use the output, so my flows become tools."

---

## 6. User experience

### 6.1 Setup flow (first run)

1. User runs `claude mcp add slate -- npx slate-mcp` (or copies the JSON snippet from Slate's settings panel, which shows it ready to paste).
2. On the first tool call from the agent, the bridge starts its localhost WebSocket server and prints/returns: *"Open Slate and enter pairing code **XXXX**."*
3. The open Slate tab detects the bridge, shows a **pairing dialog** with a code-entry field (or displays the code for the user to confirm — see §8.3). User confirms once; the pairing token is stored on both sides.
4. Slate's top bar shows a persistent **"⚡ Agent connected"** indicator while a bridge session is live, with a click-to-disconnect menu.

Setup happens once per machine. Subsequent sessions connect silently.

### 6.2 Steady state: what the user does and gets

| The user does | The user gets |
|---|---|
| Asks Claude Code to "draw / map / diagram X on my board" | A laid-out diagram **animates onto the visible canvas** (staggered ~150–250 ms per object), correctly using Slate shapes, stickies, text, frames, and attached connectors |
| Rearranges, edits, deletes, or annotates anything by hand | Nothing — their edits are just normal Slate edits |
| Asks the agent to continue / react ("what did I change?", "expand the auth box") | The agent reads the current board state, including the user's edits, and responds or draws accordingly |
| Asks the agent to run a flow node on the board | The node runs exactly as if the user pressed ▶; the agent receives the output text/table |
| Presses Cmd+Z after an agent action | The entire agent action (one tool call) reverts as one undo step |
| Closes the Slate tab | Agent tool calls fail fast with the message *"No Slate tab connected — open Slate to continue"* (no hang, no queue in v1) |
| Clicks "disconnect" in Slate | The bridge session ends immediately; further tool calls fail with a clear message |

### 6.3 What the agent can never do

- Touch anything outside the canvas: no access to other boards' data than what tools expose, no settings, no API keys, no localStorage, no exports, no deletion of boards.
- Act while no Slate tab is open or while disconnected.
- Bypass undo: every mutation goes through Slate's command/history model.

---

## 7. Functional requirements — the tool surface

v1 ships **exactly nine tools**. Anything not listed is out of scope (see §10).

### 7.1 Read tools

| Tool | Input | Output | Notes |
|---|---|---|---|
| `list_boards` | — | `[{id, name, projectName, updatedAt, objectCount}]` | All boards, no pagination in v1 |
| `read_board` | `boardId`, optional `frameId` | Structured JSON of all objects: id, type, geometry, text content, style summary, connector endpoints | This is the agent's "eyes." Ink strokes are summarized (bounding box + "ink" type), not vectorized. **Never truncated** — if a board is large, the full object list is returned (data-integrity rule) |
| `get_node_output` | `boardId`, `objectId` | Last run output of a runnable node (text / table / image ref), plus run status | Errors clearly if the node has never run |

### 7.2 Write tools

| Tool | Input | Output | Notes |
|---|---|---|---|
| `create_board` | `name`, optional `projectId` | `boardId` | Created board is opened in the tab if the user confirms via a toast (auto-open without prompt is fine if a board switch loses nothing) |
| `add_objects` | `boardId`, array of object specs (sticky, text, rect, roundedRect, ellipse, diamond, frame, connector), each with position/size/text/style; connectors reference other objects **by the IDs returned in the same call or already on the board** | Array of created object IDs, mapped 1:1 to input order | **Batched by design** — one diagram = one call = one undo step. Objects animate in staggered. Layout coordinates are the agent's responsibility; the tool description teaches spacing conventions (see §7.4) |
| `update_objects` | `boardId`, array of `{id, patch}` (position, size, text, style) | Per-object success/failure | One call = one undo step |
| `delete_objects` | `boardId`, array of object IDs | Per-object success/failure | Only objects, never boards |
| `run_node` | `boardId`, `objectId`, optional `timeoutSeconds` | The node's output on completion, or a job handle for async nodes (`vid:`, `research:`) | Runs through the exact same flow engine as the ▶ button — same models, same wiring, same cost metering |
| `get_run_status` | job handle | status / output | For async nodes only |

### 7.3 Behavioral requirements on all tools

- **Undo atomicity:** each mutating tool call is wrapped in a single history transaction (reuse the `aiEdit.ts` transaction pattern).
- **Validation:** object specs are schema-validated in the bridge *and* in the tab; invalid specs fail the whole call with a precise error naming the bad field — never partial application.
- **Fail fast:** if no tab is connected, every tool returns an actionable error within 2 s.
- **Attribution:** objects created by the agent carry a `createdBy: "agent"` marker in their metadata so future features (highlight agent work, filter, audit) are possible. Invisible in v1 UI.

### 7.4 Layout quality bar

The demo lives or dies on whether diagrams look *drawn*, not *dumped*. Requirements:

- Tool descriptions embed concrete layout guidance (grid spacing, sticky sizes, connector labeling conventions, "leave 40 px gutters", "lay out layered architectures top-to-bottom").
- `add_objects` supports an optional `autoLayout: "layered" | "grid" | "none"` hint; when set, the tab applies a deterministic layout pass (layered DAG layout for architecture diagrams) instead of trusting raw coordinates. v1 must ship at least `layered` and `grid`.
- Acceptance test: the §3.2 repo-mapping prompt must produce zero overlapping objects and no connector crossing through a node's interior, across 5 consecutive runs.

---

## 8. Technical architecture

### 8.1 High level

```
Claude Code / any MCP client
        │  MCP over stdio
        ▼
  slate-mcp (local Node process, npm package, MIT)
        │  WebSocket server on 127.0.0.1:<port>  (default 8642, configurable)
        ▼
  Slate tab (browser; served from localhost dev OR Vercel prod)
        │
        ▼
  Existing internals: command/history model, flow engine (ainodes.ts),
  aiEdit transaction pattern, Dexie/IndexedDB
```

- The **tab initiates** the WebSocket connection outward to `ws://127.0.0.1:<port>`. Browsers permit this from an `https` page because localhost is a trustworthy origin (verify Safari behavior early; it is the riskiest browser — if Safari blocks it, Safari support moves to a documented known-issue, not a blocker).
- The bridge holds **no board data**. It is a stateless translator: MCP request → JSON-RPC over WS → tab executes against IndexedDB/engine → response back. If the tab is closed, the bridge has nothing and says so.
- In-tab, a single `bridge.ts` module owns the WS client, schema validation, dispatch to engine commands, and the connected-indicator state. All mutations route through the existing command model — the bridge adds **no new write path** to the store.
- Multiple tabs: the first tab to pair wins; others show "bridge in use." Multiple boards: tools always take explicit `boardId`.

### 8.2 Protocol

JSON-RPC 2.0 over the WebSocket, one request per MCP tool call, correlation by id, 30 s default timeout (except `run_node`, which respects `timeoutSeconds` / returns a job handle). Protocol version field from day one (`slateBridge: 1`) so bridge and app can evolve independently — the npm package and the deployed app will version-skew.

### 8.3 Security model (launch-blocking, not optional)

Threat: any web page the user visits can attempt `new WebSocket("ws://127.0.0.1:8642")`; any local process can too.

1. **Bind to 127.0.0.1 only.** Never `0.0.0.0`.
2. **Origin allowlist.** The bridge accepts WS upgrade only from Origins: the official deployed domain, `http://localhost:*`, `http://127.0.0.1:*`. Configurable for self-hosters via `slate-mcp --allow-origin`.
3. **Pairing token.** First connection requires the user to confirm a 4-digit code shown in the terminal inside the Slate pairing dialog. On success both sides persist a random 256-bit token (bridge: config file `~/.slate-mcp/`; tab: localStorage). Every subsequent WS session authenticates with the token before any tool traffic. Mis-entered code 3× → bridge exits.
4. **Kill switch.** The "Agent connected" indicator always offers one-click disconnect + "forget pairing."
5. **Capability ceiling.** The tab-side dispatcher only exposes the nine §7 methods; anything else is rejected. The agent's reach is the tool surface, nothing more.
6. Automated tests cover: wrong origin rejected, missing/invalid token rejected, unknown method rejected.

### 8.4 Tech constraints

- MIT-licensed dependencies only (MCP TypeScript SDK: MIT; `ws`: MIT). No telemetry in `slate-mcp`.
- The bridge must run on Node ≥ 18, macOS / Linux / Windows.
- No changes to the persistence schema except the optional `createdBy` metadata field.

---

## 9. Non-goals (v1)

Deliberately **not** in this release:

- **Command queueing while the tab is closed** (fail fast instead; queueing is a fast-follow candidate).
- **Remote setups** (SSH dev boxes, agent and browser on different machines) — requires a relay; explicitly "later, paid-tier adjacent."
- **Agent-driven ink** — the agent creates structured objects only, never pen strokes.
- **An `agent:` canvas node that drives Claude Code from the canvas** (the reverse direction). This is the headline of v2, not v1.
- **Streaming partial diagrams** during one `add_objects` call — the stagger animation fakes this well enough.
- **Multi-client bridges** (two agents connected at once).
- **Screenshot/vision tools** (`read_board` returns structure, not pixels).
- **Write access to settings, brand kits, prompts, exports, or board deletion.**

---

## 10. Milestones

### M0 — Spike (risk burn-down)
Prove the scary parts in isolation: `https`-served page ⇄ `ws://127.0.0.1` in Chrome/Firefox/Safari/Edge; MCP stdio server round trip; one `add_objects` call creating a sticky through the command model. *Exit: a hardcoded diagram appears on the Vercel-served app via a Claude Code tool call.*

### M1 — The loop
All nine tools, schema validation, undo atomicity, `createdBy` attribution, fail-fast semantics. *Exit: end-condition items 2, 3, 4, 6 pass.*

### M2 — Trust & polish
Pairing flow, origin allowlist, token auth, security tests, connected indicator + kill switch, stagger animation, `layered`/`grid` auto-layout, layout acceptance test. *Exit: end-condition items 1, 5, and §7.4 pass.*

### M3 — Launch packaging
npm publish, README with demo GIF, Slate settings panel "Connect your agent" section with copy-paste config, docs page, the launch GIF itself (terminal + canvas, repo-mapping prompt). *Exit: end-condition items 7, 8 pass; GIF recorded.*

---

## 11. Success metrics

Launch-window (first 30 days, all measurable without telemetry — from npm, GitHub, and socials):

- `slate-mcp` npm installs and the repo-star delta attributable to launch week.
- ≥ 5 organic posts/demos by people we didn't ask (the "second wave" — the feature working as its own marketing).
- Qualitative: the demo GIF can be re-recorded from scratch, unrehearsed, in one take — the internal bar for "it actually works."

Product health (post-launch, if/when opt-in telemetry exists — none in v1):

- % of bridge sessions with ≥ 1 successful round trip (draw → human edit → read).
- Median tool-call failure rate < 2% excluding "tab not open."

---

## 12. Open questions

1. **Pairing UX direction** — code shown in terminal and typed into Slate, or shown in Slate and confirmed in terminal? (Pick during M2 based on which is less fumbly on camera.)
2. **Auto-open created boards** — silently switch the visible board on `create_board`, or toast-confirm? Leaning toast; switching under the user's cursor is rude.
3. **Default port** — 8642 is a placeholder; check for common conflicts before publish.
4. **Does `read_board` need object z-order and grouping info in v1** for the agent to reason about "what did I change"? Decide from real transcripts during M1.

# Product Requirements Document — "Slate MCP Bridge v1.1: Senses & Graphics"

**The agent gets eyes, an art supply box, and a hand on the camera.**

| | |
|---|---|
| **Document status** | Draft v0.1 |
| **Feature codename** | Bridge v1.1 (`senses-and-graphics`) |
| **Parent documents** | `slate-mcp-prd.md` (Bridge v1), `slate-prd.md` (Slate) |
| **Owner** | Dc |
| **Last updated** | July 6, 2026 |
| **Baseline** | Bridge v1 shipped: nine tools, pairing/token security, undo-atomic writes, layered/grid auto-layout, runnable-node creation |

---

## 1. Summary

Bridge v1 lets an agent build diagrams and flows out of Slate's structured primitives. v1.1 adds four capabilities, chosen for maximum impact-per-line:

1. **Icons** — expose Slate's existing icon library (`IconObj` + `ICONS` registry) through `add_objects`.
2. **Custom SVG graphics** — the agent authors SVG markup; the bridge stores it as an image blob and places it as a normal image object. Custom icons, logos, illustrations, mini-charts.
3. **Vision** — a new `render_board` tool returns a PNG of the board (or a region) as MCP image content, so the agent can *see* its own layout, and see the user's freehand ink.
4. **Camera** — a new `focus_on` tool pans/zooms the user's viewport to given objects, so the agent can direct attention and never draws somewhere the user isn't looking.

Plus one data capability that turns the bridge into a pipeline:

5. **Uploads** — a new `add_upload` tool creates a real Slate upload node from file content the agent has (e.g. a CSV from the repo), feeding Slate's data-integrity-locked analytics nodes (`business:`, `extract:`, `chart:`).

Tool count goes from nine to **twelve** (`render_board`, `focus_on`, `add_upload`); `add_objects` gains two spec types (`icon`, `image-from-svg`).

**Why these five and not others:** icons and SVG make the output beautiful (demo value); vision makes the agent *accurate* (it can check and correct its own work — quality compounds into every other feature); camera makes the experience *legible* (the user watches the work happen); uploads connect the agent's superpower (filesystem access) to Slate's superpower (trustworthy analytics). Live "draw-with-me" polling and raw ink strokes are explicitly deferred (§9).

---

## 2. Problem & motivation

Observed limits from real v1 sessions:

- **Diagrams are semantically right but visually plain.** Boxes and stickies only; no iconography, no custom graphics. Slate has an icon system the bridge simply doesn't expose.
- **The agent is flying on instruments.** It reasons about layout from JSON coordinates and cannot verify the result *looks* right. It also cannot read the user's ink at all — a circled region or a hand-drawn arrow is invisible in `read_board` (ink is summarized as bounding boxes by design).
- **The agent draws off-screen.** Objects land wherever coordinates say; the user pans around hunting for what the agent just did.
- **Slate's best analytics can't reach the agent's best data.** Claude Code sits on the repo's CSVs/logs; Slate's `business:`/`chart:` nodes only accept data through upload nodes the user drops in by hand.

**Core insight:** v1 gave the agent hands. v1.1 gives it eyes (render), taste (graphics), presence (camera), and reach (uploads). Eyes are the strategic one — a self-checking agent gets better at *everything else* for free.

---

## 3. Goal & end condition

### Goal

An agent connected through the bridge can produce boards that look hand-crafted (icons, custom graphics), verify and correct its own layouts by looking at them, direct the user's viewport to its work, and pipe file data from its environment into Slate's analytics flows — all with v1's security, undo, and data-integrity guarantees intact.

### End condition (definition of done)

1. **Icons:** the prompt *"add a database icon next to the storage box"* places a correctly chosen `IconObj` from the registry, positioned adjacent to (not overlapping) the target. The agent can discover valid icon names without guessing.
2. **SVG:** the prompt *"design a small logo for this project and put it on the board"* results in an image object rendering agent-authored SVG on the canvas, correctly sized, undoable with one ⌘Z. Malformed or oversized SVG is rejected with a precise error, never a broken image.
3. **SVG safety:** SVG containing `<script>`, event handlers, or external references is sanitized or rejected; covered by automated tests (§7.2).
4. **Vision loop:** the prompt *"draw X, then look at the board and fix anything that overlaps or looks misaligned"* works end-to-end: `render_board` returns a PNG the agent demonstrably acts on (it corrects a deliberately-seeded overlap in the acceptance test).
5. **Ink legibility:** the user circles a region in pen and asks *"improve what I circled"* — the agent identifies the circled objects correctly via `render_board`.
6. **Camera:** after any `add_objects` call, the agent can call `focus_on` with the returned ids and the user's viewport animates to frame those objects. `focus_on` never changes the document (nothing to undo).
7. **Uploads:** the prompt *"take data.csv from this repo, put it on my board and build a business: flow over it"* produces a genuine upload node — **byte-complete**: full file stored as a blob, true row count, `business:` results identical to a hand-uploaded copy of the same file. Verified by the acceptance test on a file large enough to trigger the inline-text cap.
8. All v1 guarantees hold for every new write path: one tool call = one undo step, `createdBy: 'agent'`, whole-call validation failure (no partial application), capability ceiling (only the twelve methods), all traffic behind the paired token.
9. v1's 8 security tests still pass; new tests cover SVG sanitization, upload byte-fidelity, and render size limits.

---

## 4. User stories

- *"When the agent maps my architecture, I want real icons — databases, queues, browsers, clouds — so the diagram reads at a glance like a professional one."*
- *"When I ask for a custom graphic — a logo sketch, a mascot, an annotated illustration — I want the agent to draw one, not tell me it can only make rectangles."*
- *"When the agent finishes drawing, I want it to look at the board like I would and fix what's ugly, so I don't have to be its layout QA."*
- *"When I circle something in pen and say 'this part', I want the agent to know what I mean."*
- *"When the agent draws, I want my viewport taken to the work, so I watch it happen instead of hunting for it."*
- *"When my repo has a CSV, I want to say 'analyze this on my board' and trust the numbers, because Slate never silently drops rows."*

---

## 5. Functional requirements

### 5.1 Icons (extend `add_objects`)

- New spec type `icon`: `{ type: 'icon', icon: '<registry-name>', x, y, w?, h?, color? }` → creates an `IconObj`. Default size 48×48; color defaults to the board-appropriate ink.
- **Discovery:** the full list of registry icon names is embedded in the `add_objects` tool description (the registry is small and static). If it outgrows the description, fall back to a `list_icons` section in `read_board`'s board payload — not a thirteenth tool.
- Unknown icon name → whole-call rejection naming the bad entry and the 5 closest matches (`no icon "postgres" — closest: database, server, hard-drive, …`).
- Icons participate in auto-layout like any other body.

### 5.2 Agent-authored SVG (extend `add_objects`)

- New spec type `image`: `{ type: 'image', svg: '<svg …>…</svg>', x, y, w?, h? }`.
- Tab-side pipeline: sanitize → `new Blob([svg], {type:'image/svg+xml'})` → `putBlob` → `ImageObj` with the returned `blobId`. Renders through the existing image pipeline; no new renderer work.
- Sizing: if `w`/`h` omitted, parse the SVG `viewBox`/`width`/`height`; cap the placed size at 1600px on the long edge (a canvas-sanity cap on *display size*, not a data cap — the full SVG source is stored).
- **Sanitization (launch-blocking):** strip or reject `<script>`, `<foreignObject>`, `on*` attributes, `href`/`xlink:href` to external URLs, and CSS `url()` to external hosts. Reject anything that survives sanitization malformed (unparseable XML). SVG source larger than 512 KB is rejected with a clear error. Covered by unit tests.
- The tool description teaches the craft: prefer `viewBox` with round numbers, inline styles only, no external fonts/images (CSP would block them anyway), design for both light and dark canvases (avoid pure-white/pure-black fills).

### 5.3 Vision — new tool `render_board`

- Input: `{ boardId, region?: {x,y,w,h} | {objectIds: [...]}, maxDimension?: number }`.
- Output: MCP **image content** (`{type:'image', data:<base64 png>, mimeType:'image/png'}`) plus a text part giving the world-coordinate mapping (`rendered region x,y,w,h at scale s`) so the agent can convert what it sees back into board coordinates.
- Rendering reuses `export.ts` (`exportPng`/`exportBounds`) — same output as user PNG export, including ink strokes.
- Default `maxDimension` 1568 px on the long edge (matches vision-model input sweet spot); hard cap 4096. Region defaults to the bounding box of all objects.
- Read-only; allowed on non-open boards **only if** the export path can render from a db-loaded doc — otherwise auto-open like the write tools (decide in M1, whichever is less code).
- The WS protocol and MCP framing must handle multi-hundred-KB payloads (raise the message size ceiling accordingly; measure, don't guess).

### 5.4 Camera — new tool `focus_on`

- Input: `{ boardId, objectIds: [...], }` → tab pans/zooms (existing `cameraToFit` + a short eased animation, ~400 ms) to frame the objects with the existing 96 px padding.
- Requires the board open (auto-switch like write tools). Never touches the doc; returns the resulting viewport.
- The `add_objects` tool description gains one line: *"after drawing, call focus_on with the returned ids so the user sees the result."*
- Abuse guard: at most one camera movement per second; excess calls return the current viewport without moving (prevents seasick users), noted in the response so the agent knows it was coalesced.

### 5.5 Uploads — new tool `add_upload`

- Input: `{ boardId, filename, content: <string>, kind?: csv|text|json|markdown, x?, y? }`. Binary formats (PDF) are out of scope — the agent has text.
- Tab-side: construct the exact `UploadFile` shape the app's own upload path produces — **full content stored via `putBlob` with `blobId` set whenever the inline text preview is capped; true `rows` count computed from the complete content; `truncated` flag semantics identical to `src/ui/upload.ts`.** Reuse the app's existing upload-parsing code; do not reimplement it.
- **Data-integrity requirement (non-negotiable):** analytics over an agent-created upload node must read every row of the provided content. Acceptance test: agent-upload vs hand-upload of the same >preview-cap CSV produce byte-identical `business:` tool inputs.
- Content arrives over stdio+WS as a string; size ceiling 20 MB per call — above that the tool errors with guidance (*"file too large for the bridge — ask the user to drop it into Slate directly"*). A stated, visible limit with an explicit error is acceptable; silent truncation is not.
- Created node is a normal upload sticky: `createdBy:'agent'`, one undo step, wireable into flows by the agent in the same session.

---

## 6. Technical architecture notes

- **No protocol changes** beyond raising the WS/stdio message-size ceilings for `render_board` (outbound images) and `add_upload` (inbound files). Same JSON-RPC envelope, same auth.
- **No new engine code paths:** icons use `IconObj`, SVG uses blob+`ImageObj`, render uses `export.ts`, camera uses `cameraToFit`, uploads use the existing upload parser. The bridge stays a thin adapter — this is the review bar for the implementation.
- `render_board` base64 encoding happens tab-side; the MCP server passes it through without re-encoding.
- MCP image content: verify Claude Code renders `image` content blocks from tool results early in M0; if a client limitation surfaces, fall back to returning a temp-file path written by the MCP server process (it runs on the user's machine) — decide by test, not assumption.

---

## 7. Security & safety

1. **SVG is untrusted input** (§5.2 sanitization; automated tests for script tags, event handlers, external refs, foreignObject).
2. `render_board` exposes board pixels to the agent — same trust level as `read_board` text; no new consent needed, but it respects the existing kill switch like every tool.
3. `add_upload` writes blobs — cap per-call size (20 MB) and reject non-string content; the blob store is the user's own IndexedDB.
4. Capability ceiling grows to exactly twelve methods; everything else in the dispatcher still rejects.
5. All v1 tests must stay green; new tests: SVG sanitizer (≥6 cases), upload fidelity (1 end-to-end), render size cap (1).

---

## 8. Milestones

### M0 — Risk spike (1 day-ish)
Prove: MCP image content renders in Claude Code from a tool result; a large base64 PNG survives the WS + stdio path; SVG-in-blob renders on the canvas. *Exit: agent sees a screenshot of a real board and describes it correctly.*

### M1 — Graphics
Icons + SVG in `add_objects`, sanitizer + tests, tool-description craft guidance. *Exit: end-conditions 1–3.*

### M2 — Senses
`render_board` + `focus_on`, size ceilings, camera rate-limit, coordinate-mapping text part. *Exit: end-conditions 4–6.*

### M3 — Pipeline
`add_upload` reusing the app's upload parser, fidelity acceptance test. *Exit: end-condition 7.*

### M4 — Polish & docs
README + tool-count updates, PRD v1 cross-references, full suite green. *Exit: end-conditions 8–9.*

Order rationale: M1 before M2 so the vision loop has richer boards to look at; M3 independent (can swap with M2 if analytics demos are the near-term priority).

---

## 9. Non-goals (v1.1)

- **Raw ink strokes from the agent** — LLM-generated freehand coordinates look bad; SVG covers the need. Permanent-lean non-goal.
- **Live `wait_for_changes` / draw-with-me polling** — real feature, needs loop-taming design; next PRD.
- **Binary uploads (PDF/xlsx)** — text formats only.
- **Video/animation generation via the bridge** — `run_node` on a `vid:` node already covers it.
- **A thirteenth+ tool for anything above** — if a capability can't fit the twelve, it waits.

---

## 10. Success metrics

- The launch GIF gets a sequel: agent draws → *looks* → fixes → pans the camera to present. One take, unrehearsed.
- In dogfooding transcripts: ≥ half of `add_objects` sessions also call `render_board` (evidence the vision loop is actually used, not decorative).
- Zero data-integrity discrepancies between agent uploads and hand uploads across test corpus.

---

## 11. Open questions

1. Should `render_board` down-weight (fade) `createdBy:'agent'` objects optionally, so the agent can isolate *the user's* additions visually? (Nice for "what did I change?" — decide from real transcripts.)
2. Icon registry size vs. tool-description budget — count tokens before choosing embed-vs-read_board discovery (§5.1).
3. `focus_on` while the user is mid-drag: skip the animation entirely, or queue it? (Lean: skip — never fight the user's hand for the camera.)

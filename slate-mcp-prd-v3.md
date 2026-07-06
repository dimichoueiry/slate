# Product Requirements Document — "Slate MCP Bridge v1.2: Selection"

**The user points, the agent sees where.**

| | |
|---|---|
| **Document status** | Draft v0.1 |
| **Feature codename** | Bridge v1.2 (`selection`) |
| **Parent documents** | `slate-mcp-prd.md` (Bridge v1), `slate-mcp-prd-v2.md` (Bridge v1.1), `slate-prd.md` (Slate) |
| **Owner** | Dc |
| **Last updated** | July 6, 2026 |
| **Baseline** | Bridge v1.1 shipped: twelve tools, pairing/token security, undo-atomic writes, vision (`render_board`), camera (`focus_on`), uploads |

---

## 1. Summary

Bridge v1.2 adds one read capability: the agent can ask **what the user currently has selected** on the canvas.

- **One new tool, `get_selection`** — returns the open board's id and the full objects in the user's current selection (same object shape as `read_board`). Tool count goes from twelve to **thirteen**.
- **One additive field** — objects returned by `read_board` gain `"selected": true` when they are in the live selection, so an agent already holding a board read doesn't need a second call.

That's the entire surface. No new write path, no new data class, no protocol change beyond one added method.

---

## 2. Problem & motivation

The bridge's core loop is *agent drafts → human edits → agent reads the edits back*. But the human half of that loop is missing its cheapest, most natural gesture: **pointing**.

Today, when a user wants the agent to act on specific objects, they must describe them in prose — "the blue sticky about pricing, top-right, next to the frame" — and the agent must fuzzy-match that description against `read_board` output (or burn a `render_board` call to look). This fails exactly when it matters: boards with many similar objects, objects with long or duplicated text, or users who think spatially rather than verbally. Meanwhile the user has *already pointed*: selection is the first thing anyone does on a canvas before acting on something. Every canvas user already has this muscle memory; the bridge just can't see it.

The workaround evidence is strong (playbook §18: gauge pain by workarounds): users today either paste object text into the terminal, describe positions in words, or circle things in ink so `render_board` can see the circle — three duct-tape versions of "look at what I'm holding."

**Core insight:** selection is deixis. "Make *these* red", "expand *this*", "wire *these three* into a flow", "translate *what I selected*" — the demonstrative pronoun is the highest-frequency instruction shape in pair work, and it is currently the one shape the bridge cannot resolve. One small read tool closes it.

What this is *not*: a new data-exposure decision. Everything in a selection is already fully readable via `read_board`; `get_selection` reveals only *which subset* the user is indicating — an intent signal, not new content.

---

## 3. Goal & end condition

### Goal

A user can select objects on the canvas by hand and give the agent an instruction containing "this / these / what I selected," and the agent resolves it correctly on the first try, with no verbal description of the objects.

### End condition (definition of done)

The feature is **done** when all of the following are true:

1. With 3 objects selected on the open board, the prompt *"make these blue"* results in exactly those 3 objects changing color (agent: `get_selection` → `update_objects`), as one undo step, on the first attempt.
2. `get_selection` with **nothing selected** returns `{boardId, selection: []}` plus a hint telling the agent to ask the user to select something — never an error, never a guess.
3. `get_selection` with **no Slate tab open** fails fast (< 2 s) with the standard "No Slate tab connected" message.
4. `read_board` output marks live-selected objects with `"selected": true` on the currently open board, and omits the field everywhere else (additive, no consumer breakage).
5. An **ink stroke** in the selection is returned the same way `read_board` summarizes it (type `"ink"` + bounding box), not dropped — a selection of 4 things must never come back as 3 (data-integrity rule: no silent truncation, ever).
6. Security posture unchanged: the method is served only over the paired, origin-checked WebSocket; existing wrong-origin / bad-token / unknown-method tests still pass, plus a test that `get_selection` is rejected pre-auth.
7. The `get_selection` tool description teaches the agent *when* to reach for it (user says "this/these/selected") — verified by transcript: the §3.1 prompt triggers the tool without the user naming it.

If any of these fail, the feature is not launchable.

---

## 4. User stories

- "When I select a cluster of stickies and say *'summarize these'*, I want the agent to know exactly which ones, so I never have to describe my own board back to it."
- "When the agent drafts ten options and I select the two I like and say *'delete the rest'*, I want it to act on the complement of my selection correctly."
- "When I select a shape and say *'expand this into a full flow'*, I want new objects to appear around *that* shape, not wherever the agent guesses."
- "When I've selected nothing and say *'move these'*, I want the agent to tell me to select something — not act on a stale or imagined selection."

---

## 5. Functional requirements

### 5.1 New tool: `get_selection`

| | |
|---|---|
| **Input** | *(none)* — selection is a property of the open tab, not of a `boardId`. Taking no input also solves "which board?": the response says. |
| **Output** | `{ boardId, boardName, selection: [ …full objects, same shape as read_board… ] }` |
| **Empty selection** | `{ boardId, boardName, selection: [], hint: "Nothing is selected — ask the user to select the objects they mean." }` |
| **Semantics** | A **snapshot at call time** of the live selection (`controller.selection`). No history, no subscription, no staleness window managed by the bridge — if the user changes selection after the call, the agent's next call sees the new state. |

**Tool description requirements** (the description *is* the UX for an agent): it must say — use this when the user's instruction contains "this", "these", "that", "selected", "what I picked", or otherwise points at something without naming it; call it at instruction time, not preemptively, because selection changes; returned objects are full objects, so a follow-up `read_board` is usually unnecessary before `update_objects`/`delete_objects`.

**Object fidelity rules:**

- Returned objects use the exact serialization `read_board` uses — one shape, one code path, zero drift.
- Group selection returns every member object (the selection set already stores member ids).
- Locked objects in the selection are returned with their existing `locked` flag; the agent learns it can't edit them from `update_objects`' normal error, not from omission.
- Ink strokes: summarized as in `read_board` (bounding box + `"ink"` type), never dropped (§3.5).

### 5.2 `read_board` gains `selected: true` (additive)

- On the **currently open** board only, objects in the live selection carry `"selected": true`.
- On any other board, and on all unselected objects, the field is **absent** (not `false`) — additive evolution, no consumer sees a new mandatory field (forever-contract rule: additions easy, removals impossible).
- `read_board`'s description gains one sentence noting the field, so agents discover it.

### 5.3 What v1.2 deliberately does **not** change

- `render_board` continues to render **without** selection chrome (handles, highlight boxes). The image shows the board, not the UI state; selection is structured data, not pixels.
- No tool may **modify** the selection (see §9). `focus_on` remains the only attention-directing tool, and it moves the camera, not the selection.

---

## 6. Technical architecture notes

Smallest possible diff, riding entirely on existing rails:

- **Source of truth (exactly one):** `SlateController.selection` (`src/engine/controller.ts:103`, a `Set<string>`), already mirrored to `useUI` for chrome. The bridge method reads the controller directly — the `useUI` mirror stays a projection, not a second source.
- **Tab side (`src/bridge/methods.ts`):** one new exported method. It uses the *current* controller only (the `cur` accessor) — **no `ensureBoardOpen`, no board switching**: selection exists only on the open board, and a read tool must never move the user's tab. Serialization delegates to the same object-serializer `read_board` uses.
- **Registry (`src/bridge/methods.ts` `METHODS` map + `slate-mcp/src/index.js` `TOOLS`):** one entry each. The stdio server needs no new logic — `get_selection` is a plain forwarded call like `list_boards`, standard 30 s timeout.
- **`read_board` change:** where objects are serialized, if the board being read is the open board, stamp `selected: true` from the live set.
- **Protocol:** no version bump. `slateBridge: 1` already tolerates unknown methods on old tabs — an old tab answers `Unknown method "get_selection"`, which the stdio server surfaces verbatim; the agent gets an intelligible failure and the README notes the version pairing. (This skew case gets a test.)

Estimated blast radius: ~40 lines app-side, ~15 lines bridge-side, plus tests. No schema change, no persistence change, no new dependency.

---

## 7. Security & safety

- **No new data class.** Selection contents are a subset of what `read_board` already exposes on the same paired connection. The new information is only *which* objects the user indicated. Threat delta: approximately zero; still worth stating so nobody "hardens" this later with a redundant permission prompt.
- **Same gate as everything else:** 127.0.0.1 bind, origin allowlist, pairing token, capability-ceiling dispatcher. `get_selection` is rejected pre-auth like any method (§3.6 test).
- **Read-only by construction:** the method touches no command, no history, no store write. It cannot appear in the undo stack because it does nothing.
- **No ambient monitoring:** the bridge never *pushes* selection changes to the agent (§9). The agent knows the selection only at the moment it asks — the user's pointer is not a surveillance feed.

---

## 8. Milestones

Deliberately small — this is a one-sitting feature with a real test bill.

### M0 — The tool
Tab-side `get_selection` method (shared serializer, `cur`-only, ink-safe), `METHODS` + `TOOLS` registration with the deictic-trigger description, empty-selection hint, no-tab fail-fast. *Exit: end-condition items 1, 2, 3, 5.*

### M1 — Read-board flag + hardening
`selected: true` stamping in `read_board`, pre-auth rejection test, version-skew (old tab) test, README + tool-count updates (12 → 13). *Exit: end-condition items 4, 6, 7; full suite green.*

---

## 9. Non-goals (v1.2)

Deliberately **not** in this release, each with its revisit trigger:

- **`set_selection` / agent-modifiable selection.** The selection is the *user's* hand; an agent that grabs it mid-gesture is the canvas equivalent of moving someone's mouse. `focus_on` already covers "look here." *Revisit if:* transcripts show agents repeatedly telling users "please select X so I can…" as a workaround.
- **Selection-change push events / subscriptions.** Pull-only keeps the bridge stateless and the privacy story trivial. *Revisit with:* a broader eventing design (board-change events would come first anyway).
- **Selection history** ("what was selected when I sent that message"). Snapshot-at-call is honest and simple; history is a staleness minefield. *Revisit if:* real transcripts show race complaints.
- **Selection rendered into `render_board` pixels.** Structured beats pixels for this; keeps the renderer selection-agnostic.
- **Cross-board or background-board selection.** Selection is a live-tab concept; there is nothing to expose elsewhere.

---

## 10. Success metrics

- **The demo test:** select three stickies, say *"merge these into one summary sticky"* — works first try, unrehearsed, on camera. (Same internal bar as v1's GIF rule.)
- Transcript check across dogfooding sessions: instructions containing "this/these/selected" resolve via `get_selection` rather than prose-matching against `read_board` in the clear majority of cases.
- Zero regressions in the existing bridge security and tool test suites.

---

## 11. Open questions

1. **Should `get_selection` also return the selection's combined bounding box?** Nearly free to compute (the controller already does it for chrome at `controller.ts:267`) and useful for "add a note next to my selection." Leaning yes if it's < 5 lines; decide in M0.
2. **Should the empty-selection `hint` field live in the result or in the tool description only?** Result-embedded hints reach the agent at exactly the right moment; description-only keeps the payload pure. Leaning result-embedded (matches how `PairingRequiredError` already instructs through content).
3. **`selected` on `read_board`: is the open-board-only asymmetry confusing?** It's the truthful semantics (other boards *have* no selection), but the field's absence is ambiguous between "not selected" and "not the open board." If transcripts show confusion, add `openBoard: true/false` to `read_board`'s board metadata instead of complicating the per-object field.

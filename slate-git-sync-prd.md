# Product Requirements Document — "Slate Git Sync v1"

**Your boards, in your repo. Every machine, forever.**

| | |
|---|---|
| **Document status** | Draft v0.1 |
| **Feature codename** | Git Sync v1 (`gitsync`) |
| **Parent documents** | `slate-prd.md` (Slate), `slate-mcp-prd.md` (Bridge v1) |
| **Owner** | Dc |
| **Last updated** | July 17, 2026 |
| **Baseline** | Durability v1 shipped: Dexie/IndexedDB persistence, full-workspace export/import, auto-backup to a local directory handle |

---

## 1. Summary

Git Sync lets a user connect a GitHub repository they own — on **github.com or a GitHub Enterprise Server instance** — and have Slate mirror their boards into it automatically.

- **One new settings section, "Git Sync"** — connect a repo with a fine-grained personal access token (optional custom host for Enterprise), disconnect, see status.
- **One background sync engine** — pushes changed boards to the repo ~10 s after the user stops editing, pulls on board-open, catches up on app-open. No manual bookkeeping.
- **One visible status indicator** — `Synced ✓ / Syncing… / N pending / Error` plus a **Sync now** action.

What the user gets: boards survive browser wipes, follow them to any machine, carry full commit history, and are viewable by anyone they grant repo access — with **no Slate server, no database, no account**. Their GitHub identity is the auth; their repo is the storage.

What this is *not*: real-time collaboration, a replacement for the local MCP bridge, or a multi-provider abstraction. GitHub only, async only, v1.

---

## 2. Problem & motivation

Durability v1 made a single browser trustworthy: IndexedDB persistence, export/import, auto-backup to a local folder. But every copy of the data still lives on **one machine**, and two real scenarios break it:

1. **"I want to open my Slate on my other laptop."** Today the answer is export-a-file-and-carry-it — manual, forgettable, and stale the moment either side edits.
2. **"My laptop died / my browser profile got wiped and my backup folder was on the same disk."** Auto-backup protects against browser-storage loss, not machine loss.

The workaround evidence (playbook §18): the export/import feature *is* the workaround — users who care are already hand-carrying JSON between machines. Git Sync automates exactly that motion.

Choosing Git-as-backend over building a Slate database is deliberate (playbook: build-vs-buy, and the best code is no code):

- **Zero infrastructure to run or pay for.** No server, no DB, no auth system, no GDPR surface. Slate stays a static site.
- **The user owns their data**, in an open format, in a system they already trust — consistent with Slate's local-first ethos and the MIT-only stack rule.
- **Version history for free.** Every sync is a commit; "restore yesterday's board" is `git log`, not a feature we build.
- **It unlocks the future cloud bridge** (§10): once boards live in a repo, a cloud-deployed MCP can operate on them without any new storage design.

**Core insight:** Slate already saves every edit to IndexedDB instantly, so sync does not need to be a safety net — local save is the safety net. Sync only needs to move already-safe data to the repo *reasonably soon*. That single fact makes every design choice below simpler (no heroic tab-close flushing, no per-stroke commits, no sync-blocking UI).

---

## 3. Goal & end condition

### Goal

A user connects a repo once per machine, and from then on never thinks about sync: boards appear on every machine they use, nothing is ever lost with a dead laptop, and the status indicator is the only evidence the system exists.

### End condition (definition of done)

The feature is **done** when all of the following are true:

1. **Round trip:** connect repo on machine A, draw a board, wait for `Synced ✓`; connect the same repo on machine B → the board opens there, pixel-identical (objects, ink, uploads, wiring, runnable-node state).
2. **Debounce:** a 5-minute continuous drawing session produces a handful of commits (one per pause), never one per stroke and never one per fixed clock tick.
3. **Catch-up:** kill the tab mid-edit before sync fires → nothing lost; reopening Slate on the same machine pushes the pending changes within seconds, unprompted.
4. **Conflict:** edit the same board on two machines while both are offline-from-each-other, then sync both → the later push wins the canonical file, and the losing version appears as a clearly named **conflict copy board** — both versions fully intact, zero objects lost (data-integrity rule: no silent truncation, ever — a conflict must never merge, sample, or drop objects).
5. **Assets:** a board with pasted images and uploads syncs completely; the repo never stores the same blob twice (content-addressed), and a pulled board never references an asset that failed to upload.
6. **Status honesty:** the indicator never shows `Synced ✓` unless the last known local change is confirmed in the repo. Errors (bad token, revoked access, rate limit, offline) surface as a visible non-blocking error state with a human-readable cause — never a silent stall.
7. **Failed pull ≠ empty workspace:** if the repo is unreachable on app-open, Slate opens the local data and shows a sync error — it never renders an empty or partial board list (regression guard on the durability v1 rule).
8. **Security posture:** the token is stored locally only (never in the repo, never in exports, never in board JSON), and disconnecting deletes it.
9. **MCP untouched:** all existing bridge tests pass unmodified; agent edits over the local bridge sync to Git exactly like human edits, with the bridge unaware Git exists.
10. **Enterprise parity:** every criterion above also passes against a GitHub Enterprise Server host configured via the host field (verified against a GHES instance or its API contract in tests); a policy-blocked org token produces the named remedy from §5.1, never a generic error.

If any of these fail, the feature is not launchable.

---

## 4. User stories

- "When I close my work laptop and open my personal one, I want my boards already there, so I never export/import again."
- "When my laptop dies, I want to sign into GitHub on a new machine and have everything back in five minutes."
- "When I've been drawing for an hour, I want to glance at one indicator and know it's all in the repo — without ever clicking save."
- "When I'm about to walk to another machine, I want a **Sync now** button so I don't have to wonder whether the debounce fired."
- "When I edited the same board in two places, I want both versions kept and labeled — never silently merged, never one thrown away."
- "When I give a teammate read access to my repo, I want them to be able to pull my boards into their Slate and look at them."

---

## 5. Functional requirements

### 5.1 Connect / disconnect (Settings → Git Sync)

| | |
|---|---|
| **Connect input** | Repo (`owner/name`) + fine-grained PAT with Contents read/write scoped to that one repo + **optional host** (defaults to `github.com`; set it for GitHub Enterprise Server, e.g. `github.acme-corp.com`). Inline help walks through creating the token (screenshots, correct scopes, "only select this repo"). |
| **Validation** | On connect: verify the token can read and write the repo (write a `.slate/ping` file or dry-run). Fail with a specific message (bad token / no such repo / read-only scope / org requires token approval or SSO authorization / Enterprise host unreachable from this browser) — never a generic "connection failed". |
| **First connect, empty repo** | Push the full local workspace. |
| **First connect, repo has boards** | Pull-merge by board id: repo boards appear locally; local boards push up; same-id boards resolve per §5.4. Never overwrite either side wholesale. |
| **Disconnect** | Deletes the token and sync state locally. Touches nothing in the repo. Local boards remain untouched. |

**Org repos & SSO.** Repos owned by a github.com organization may sit behind org token policy: fine-grained PATs can require per-token admin approval, classic PATs require per-org SSO authorization, and some orgs disable PATs outright. Slate can't work around org policy — but it must *name* it: the validation error for a policy-blocked token says what to do ("authorize this token for the <org> organization" / "your organization has disabled personal access tokens"), never a generic failure. Personal-account repos are unaffected.

**Enterprise hosts.** GitHub Enterprise Server exposes the same REST API at `https://<host>/api/v3`. One constraint we can't control: the browser calls that API directly, so the instance's network posture (VPN-only, CORS restrictions on the API — rare but possible on locked-down installs) decides reachability. Connect-validation is where this surfaces; the error distinguishes "host unreachable" (VPN?) from "host reachable, token rejected".

### 5.2 Sync engine

| Trigger | Behavior |
|---|---|
| **Edit settles** (~10 s after last change to a board) | Push that board's file (+ any new assets). One commit per settle, message like `slate: update "Growth board"`. |
| **Board open** | Pull that board's file if the repo version differs from the last-seen SHA; apply if the local copy has no unpushed changes, else §5.4. |
| **App open** | Catch-up: push every board with unpushed local changes; refresh the board list from the repo. |
| **Sync now** (button) | Skip the debounce; push everything pending immediately. |
| **Tab close** | Best-effort flush via `visibilitychange` — explicitly *not* relied upon; the app-open catch-up is the guarantee. |
| **Offline / error** | Queue pending boards, back off, retry; indicator shows pending count + cause. Editing is never blocked by sync state. |

### 5.3 Status indicator

Always visible when a repo is connected: `Synced ✓` · `Syncing…` · `N pending` · `Error: <cause>`. Clicking it opens sync detail (last sync time, pending boards, last error, Sync now, link to the repo). The indicator is load-bearing trust UI, not decoration — §3.6 defines its honesty contract.

### 5.4 Conflicts

- Detection is mechanical: every push sends the last-seen file SHA; GitHub rejects the write (409) if the remote moved. No timestamps, no clock trust.
- Policy: **the active editor wins the canonical file** (they're the one present); the superseded remote version is preserved locally *and* in the repo as a **conflict copy** — a full board named `"<name> (conflict from <machine>, <date>)"`.
- Both versions are complete boards. No merging of object arrays, ever — a textual merge of board JSON produces corrupt boards, and a "smart" merge that drops objects violates the no-silent-truncation rule. Conflict copies are boards like any other: the user deletes one when done comparing.

### 5.5 Repo layout

```
slate/
  boards/<boardId>.json     # one board per file: meta + full object list
  assets/<sha256>           # content-addressed blobs (images, uploads); no duplicates
  workspace.json            # board list, projects, components, prompts, brand kit
  .slate/                   # sync metadata (format version)
```

One file per board keeps diffs reviewable, commits scoped, and pulls cheap (only changed boards move). Push order is assets-first, board-JSON-last, so a pulled board never references a missing asset (§3.5).

---

## 6. Non-goals (v1)

- **Real-time / simultaneous editing.** Git sync is asynchronous. Two live cursors on one board is a CRDT/WebSocket problem; Git is the wrong tool, and this feature must not drift toward it. Sequential multi-machine use is the product.
- **Providers other than GitHub.** GitLab/Bitbucket/Gitea wait for demand. GitHub Enterprise Server is *not* a second provider — same API, different base URL — and is in scope for v1. The sync engine still talks to a narrow client interface so a true second provider is a swap, not a rewrite.
- **OAuth.** PAT only. GitHub's device flow needs a token-exchange proxy; that's a v1.1 polish item on the existing `/api/*` functions, not a v1 blocker.
- **In-repo git operating on the working tree.** No isomorphic-git, no clones in the browser. The GitHub REST API is the entire transport.
- **Cloud MCP.** Unlocked by this design, not built by it (§10).
- **Branch/PR workflows, partial-board sync, selective board exclusion.** Whole workspace, default branch, all boards.

---

## 7. Technical design

### 7.1 Placement

Git Sync plugs in at the **storage layer** (`src/store/`), beside Dexie (`db.ts`) and durability (`durability.ts`) — not scattered through the app. The app writes boards exactly as today; a sync adapter observes committed writes and mirrors them. The module is deletable: removing it must leave Slate exactly as it is today (playbook: write code that's easy to delete).

### 7.2 Source of truth

IndexedDB remains the live source of truth on each machine; the repo is the durable, shared mirror. Sync state per board: last-pushed content hash + last-seen remote file SHA. "Unpushed changes" = local hash ≠ pushed hash; "remote moved" = repo SHA ≠ last-seen SHA. Both checks are cheap and clock-free.

### 7.3 Transport

GitHub REST v3 from the browser (CORS-supported): `GET/PUT /repos/{owner}/{repo}/contents/{path}` for files, `GET /contents/boards` for listing. The API base URL is derived from the configured host — `https://api.github.com` for github.com, `https://<host>/api/v3` for Enterprise Server — and is the *only* place host-awareness lives; everything above the client is host-agnostic. PUT-with-SHA gives atomic per-file compare-and-swap (§5.4). Budget: an edit-settle push is 1–2 requests + one per *new* asset; the 5,000 req/hr authenticated limit is two orders of magnitude above real usage, but the engine still backs off on 403-rate-limit and surfaces it (§3.6).

### 7.4 Token storage

The PAT lives in IndexedDB (kv table) on that machine only. Excluded from workspace export, board JSON, and the repo itself. Disconnect deletes it. The settings UI recommends fine-grained tokens scoped to the single sync repo with Contents-only permission, so worst-case token leakage exposes one repo of boards — not the user's GitHub account.

### 7.5 Assets

Blobs (Dexie `blobs` table) are pushed as `assets/<sha256-of-content>`, base64 via the contents API. Content addressing = free dedup and immutability (assets are never edited, only added; garbage collection of unreferenced assets is a non-goal for v1 — repos are cheap, correctness first).

---

## 8. Edge cases & failure modes

| Case | Behavior |
|---|---|
| Token revoked / expired mid-session | Error state with cause + reconnect CTA; editing unaffected; pending queue holds until fixed. |
| Org token policy blocks the PAT (approval pending, SSO not authorized, PATs disabled) | Named error at connect-validation or first failing push, with the org-specific remedy (§5.1). |
| Enterprise host unreachable (off VPN, network change) | Treated as offline: queue + retry + indicator shows "host unreachable"; recovers automatically when the VPN is back. |
| Repo deleted or renamed | Same error path; reconnect flow accepts the new `owner/name`. |
| Offline for a week | Everything queues; catch-up on next successful contact. No cap on pending changes. |
| Board deleted locally | Delete propagates as removal from `workspace.json` + file delete (its history survives in git — that's a feature). |
| Asset push succeeds, board push fails | Harmless orphan asset; board retries. The reverse order is forbidden (§5.5). |
| Two machines, same catch-up moment | SHA compare-and-swap serializes them; the loser re-pulls and re-pushes or conflicts per §5.4. |
| Repo edited by hand (user pushes board JSON edits) | Legitimate — it's their data. Slate pulls it like any remote change; malformed JSON is rejected on pull with a visible error, never a crash and never a blank board. |
| Board too large for the contents API (~100 MB blob ceiling) | Push fails visibly, named cause, local data untouched. Chunking is a v-next problem, not silent failure. |

---

## 9. Success metrics

- **Adoption:** % of returning users with a repo connected.
- **Trust:** conflict copies created per hundred syncs (should be rare; a spike means the debounce/pull windows are wrong).
- **Reliability:** syncs ending in error state; time-to-`Synced ✓` after edit settle (should be ≲ 15 s p90).
- **The metric that matters:** support-type reports of "lost my board" from Git Sync users — target zero, forever.

---

## 10. Future phases (explicitly out of scope)

- **v1.1 — OAuth device flow** via a small `/api/github-token` proxy; kills the PAT-paste friction.
- **v1.2 — Provider abstraction** (GitLab, Gitea) behind the existing client interface, when someone asks.
- **v2 — Cloud MCP over the repo:** a cloud-deployed bridge that reads/writes the same repo, so agents can work on boards while the user's laptop is closed. Complements — never replaces — the instant local bridge: repo transport costs seconds per operation and has rate limits; the live draw-and-watch loop stays on `127.0.0.1`.

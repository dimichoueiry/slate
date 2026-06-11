# Product Requirements Document — "Slate"

**An infinite-canvas sketchbook for thinking, drawing, diagramming, and planning.**

| | |
|---|---|
| **Document status** | Draft v0.1 |
| **Product codename** | Slate |
| **Owner** | Dc |
| **Last updated** | June 10, 2026 |
| **Target platforms** | Web (primary), iPad/tablet (stylus-first), desktop PWA |

---

## 1. Summary

Slate is a single-user, local-first infinite canvas. One unbounded surface where you can sketch freehand, drop stickers, draw diagrams with snapping connectors, write notes, paste images, and lay out plans — without the friction of picking the "right tool" up front. It is your sketchbook: zero setup, instant ink, never runs out of page.

It draws from Miro and FigJam for the canvas model (pan/zoom, sticky notes, shapes, connectors), but inverts their priorities. Those tools are collaboration-first and treat drawing as a second-class citizen. Slate is **personal-first and ink-first**: the pen feels real, the canvas is yours, and collaboration is a later layer rather than the foundation.

---

## 2. Problem & motivation

Existing tools force a split:

- **Whiteboard tools (Miro, FigJam, Mural)** are built for teams and meetings. Freehand ink is laggy, pressure support is weak, and the surface is cluttered with collaboration chrome. They are heavy, online-only, and slow to open.
- **Drawing apps (Procreate, Concepts)** have beautiful ink but no diagramming primitives — no smart shapes, no connectors that stay attached, no structured layout.
- **Note apps (Notion, Apple Notes, GoodNotes)** are page-bound. The page ends. You can't zoom out and see the whole shape of your thinking.

There is no single surface where **freehand sketching, structured diagramming, and spatial planning** coexist with first-class ink and no page boundary. Slate is that surface.

**Core insight:** the value is in the *unbounded canvas + great ink + structure-on-demand*, used by one person who wants to think. Everything else (real-time collaboration, comments, templates marketplace) is optional sediment that gets added later if at all.

---

## 3. Goals & non-goals

### Goals
- A genuinely infinite canvas with smooth 60fps pan/zoom holding thousands of objects.
- Ink that feels real: pressure, tilt, low latency, multiple pen/brush styles.
- Structure on demand: shapes, connectors that stay attached, snapping, alignment.
- Stickers, stamps, sticky notes, text, and images as first-class objects.
- Local-first: opens instantly, works fully offline, data lives on the device.
- Export anything (PNG/SVG/PDF) at any zoom level or region.

### Non-goals (for v1)
- Real-time multiplayer collaboration (designed for, not built in v1).
- Comments / @-mentions / presence cursors.
- A template marketplace or community gallery.
- Native mobile apps (web/PWA covers tablet; native is a later bet).
- Video/embed/live-data widgets (Miro-style apps).
- AI features (generation, auto-diagram, handwriting-to-text) — see §13 as a deliberate later phase, not a v1 distraction.

---

## 4. Target user & personas

Slate is built for **one primary user: the thinker-maker** — someone who reaches for a sketchbook to externalize ideas.

| Persona | What they do on Slate | What they need |
|---|---|---|
| **The systems thinker** | Architecture diagrams, flows, system maps | Snapping shapes, attached connectors, frames |
| **The visual planner** | Mood boards, roadmaps, project layouts | Images, sticky notes, freeform grouping |
| **The sketcher** | Freehand drawing, UI wireframes, doodles | Pressure pen, brushes, eraser, low latency |
| **The note-taker** | Lecture/meeting notes, mixed ink + text | Stylus input, infinite room, search |

The same person is usually several of these at once. Slate's job is to not make them choose a mode up front.

---

## 5. Jobs to be done

- "When an idea is half-formed, I want to dump it onto a surface without deciding its final form, so I don't lose it."
- "When I'm explaining a system, I want boxes and arrows that stay connected when I move things, so the diagram stays coherent."
- "When I'm planning, I want to spread everything out spatially and zoom out to see the whole, so I can find the structure."
- "When I sketch, I want the pen to feel like a pen, so the medium doesn't fight me."
- "When I come back tomorrow, I want it to be exactly where I left it, instantly, offline, so the tool never blocks the thought."

---

## 6. Functional requirements

### 6.1 Canvas & navigation
- **Infinite surface.** Logical coordinate space backed by 64-bit floats; practically unbounded (≫ any realistic board size).
- **Pan:** space-drag, two-finger drag, trackpad scroll, middle-mouse, edge-of-board auto-pan while dragging.
- **Zoom:** pinch, scroll+modifier, `+`/`-`, zoom-to-fit (`Shift+1`), zoom-to-selection (`Shift+2`), zoom range ~1% to ~6400%.
- **Minimap** in a corner, toggleable, showing object density and current viewport.
- **Coordinate readout / grid** (dot grid default, line grid, blank) — togglable, snap-to-grid optional.
- Smooth momentum/inertia on pan; zoom anchored to cursor/pinch centroid.

### 6.2 Drawing & ink
This is the headline feature and must be best-in-class.
- **Pen styles (v1 set):**
  - Fineliner (uniform, crisp)
  - Pressure pen (width responds to pressure)
  - Pencil (textured, grain, tilt-shading)
  - Marker/highlighter (multiply blend, semi-transparent)
  - Brush (tapered, expressive)
- **Per-style controls:** color, size, opacity, smoothing/stabilization amount.
- **Input fidelity:** Pointer Events API for pressure + tilt; Apple Pencil and Wacom support; palm rejection on touch; predicted/coalesced points for low latency.
- **Stroke model:** strokes stored as vector point-lists (pressure-per-point), rendered to smooth variable-width paths — not rasterized — so they stay crisp at any zoom and stay editable.
- **Eraser:** stroke eraser (removes whole strokes) and pixel/segment eraser (splits strokes). Eraser is a tool, not a destructive bake.
- **Stabilization/smoothing** slider to tame shaky lines.
- **Shape recognition (optional toggle):** draw a rough circle/rectangle/arrow/line and snap it to a clean primitive (hold to keep raw).
- **Lasso select** on ink to move/scale/recolor groups of strokes.

### 6.3 Shapes & diagramming
- **Primitives:** rectangle, rounded rect, ellipse, triangle, diamond, parallelogram, line, arrow, freeform polygon.
- **Smart connectors:** arrows that *attach* to objects by anchor point. Move a box → connectors follow and re-route. Connector styles: straight, elbow/orthogonal, curved. Arrowhead options on both ends.
- **Snapping & alignment:** snap to other objects' edges/centers, equal-spacing guides, snap to grid, snap connector endpoints to anchors. Smart guides appear on drag.
- **Text in shapes:** double-click any shape to add centered, auto-fitting text.
- **Styling:** fill, stroke color, stroke width, stroke style (solid/dashed/dotted), corner radius, opacity, shadow.

### 6.4 Stickers, stamps & sticky notes
- **Sticky notes:** colored notes with auto-resizing text, quick color cycle, stack/grid auto-layout when dropped together.
- **Sticker library:** built-in pack (arrows, checkmarks, emoji-style reactions, tags, callouts, banners). Drag from a tray onto the canvas.
- **Custom stickers/stamps:** import any image/SVG as a reusable stamp; pin favorites to the tray.
- **Stamp tool:** click-to-place repeated stickers (e.g. dotting a path).

### 6.5 Text
- Free text objects (not bound to shapes): click anywhere to type.
- Font family, size, weight, color, alignment, line height; basic rich text (bold/italic/underline, lists, links).
- Text auto-grows; optional fixed-width text boxes with wrapping.

### 6.6 Images & media
- Drag-drop, paste, or upload PNG/JPG/WebP/SVG/GIF.
- Crop, resize (aspect-locked by default), rotate, opacity, corner radius, basic filters (later).
- Images stored as blobs in local storage, referenced by id; large images downscaled for canvas display, full-res kept for export.

### 6.7 Selection, transform & organization
- Click, shift-click, marquee (drag), lasso select.
- Move, scale (corner/edge handles), rotate (rotation handle + angle snap to 15°), flip.
- **Group / ungroup**; nested groups.
- **Lock / unlock** (prevents accidental edits).
- **Z-order:** bring forward/back, to front/back.
- Multi-object alignment & distribution (align left/center/right, distribute spacing).
- Copy/paste/duplicate (with offset); paste-in-place; cross-board paste.

### 6.8 Frames & sections
- **Frames:** named rectangular regions that act as containers. Children move with the frame. Used for slides, sections, or export boundaries.
- A frame can be exported as a single image/PDF page.
- Frame outline navigator (list of frames for quick jump).

### 6.9 Layers (lightweight)
- Optional layer panel: show/hide, lock, reorder. Kept simple — not Photoshop. Every object lives on a layer; default single layer is fine for most users.

### 6.10 History & state
- Unlimited undo/redo within a session; bounded persisted history.
- **Version snapshots:** manual "save snapshot" + automatic periodic snapshots; restore to any snapshot.
- Auto-save continuously (no save button).

### 6.11 Boards & organization
- Multiple boards; a board picker / home grid with thumbnails.
- Rename, duplicate, delete, pin/favorite boards.
- Tags or folders for boards (v1.x).
- **Search:** find text, sticky-note content, and (later) recognized handwriting across a board and across boards.

### 6.12 Export & sharing
- Export selection / frame / whole board / current view as **PNG, SVG, PDF**.
- Choose scale (1×–4×), transparent vs solid background, padding.
- Export board as a `.slate` file (full fidelity, importable) for backup/portability.
- Read-only share link (later, requires sync backend).

### 6.13 Input & shortcuts
- Full keyboard-shortcut set (tool switching by single key: `V` select, `P` pen, `E` eraser, `T` text, `R` rect, `O` ellipse, `L` line/arrow, `S` sticky, `H` hand/pan, `F` frame).
- Radial/quick tool menu on long-press (tablet).
- Customizable shortcuts (v1.x).

---

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| **Performance** | 60fps pan/zoom with 5,000+ objects on the board; <16ms input-to-ink latency target on stylus; first interactive < 1.5s on warm load. |
| **Scale** | Boards up to ~50k objects degrade gracefully (LOD culling), not crash. |
| **Offline** | Fully functional offline. No network dependency for any core feature. |
| **Durability** | No data loss on crash/refresh; writes are transactional to local store. |
| **Accessibility** | Keyboard navigable; respects reduced-motion; sufficient contrast in UI chrome; resizable UI. |
| **Privacy** | Data is local by default. No content leaves the device unless the user exports or (later) opts into sync. |
| **Cross-device** | Same board renders identically on desktop and tablet; touch and pointer parity. |

---

## 8. Technical architecture

### 8.1 High-level
A local-first web app. The canvas is a **scene graph** of objects, persisted to **IndexedDB**, rendered through a **layered canvas/WebGL pipeline**, with all mutations flowing through a single command/event model so that undo, persistence, and (future) sync share one path.

```
[ Input layer ]  pointer/keyboard → tool state machine
        │
        ▼
[ Command model ]  immutable ops → applied to store → emitted to (history | persistence | future sync)
        │
        ▼
[ Document store ]  scene graph + spatial index (in-memory, mirrors IndexedDB)
        │
        ▼
[ Render scheduler ]  dirty-region diff → draw visible tiles only
        │
        ▼
[ Renderer ]  Canvas2D (default) / WebGL (scale path) → screen
```

### 8.2 Rendering strategy
- **Layered canvases:** a static layer (committed objects, redrawn only on viewport/dirty change) + a live layer (the stroke currently being drawn, the selection, drag previews). The active stroke never forces a full-scene repaint — critical for ink latency.
- **Viewport culling:** only objects whose bounds intersect the visible viewport are drawn, found via the spatial index.
- **Level of detail (LOD):** at far zoom, render simplified/quantized representations; skip sub-pixel detail; batch tiny objects.
- **Tiling for large boards:** cache rendered regions as bitmap tiles, redraw a tile only when an object inside it changes.
- **WebGL escalation:** Canvas2D is the default for fidelity and simplicity; a WebGL renderer is the planned path for very large/dense boards (instanced quads, signed-distance ink). Renderer is behind an interface so this is swappable.
- **DPR-aware:** render at device pixel ratio for crisp ink on retina/tablet.

### 8.3 Data model (scene graph)
Every object is a node with a stable id, a type, a transform, a z-index, a parent (for groups/frames), and type-specific props.

```jsonc
// Conceptual shape — not final schema
{
  "board": {
    "id": "b_01H...",
    "name": "System sketches",
    "createdAt": 0, "updatedAt": 0,
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
  },
  "objects": [
    {
      "id": "o_stroke_01",
      "type": "stroke",
      "parent": null,
      "z": 12,
      "transform": { "x": 0, "y": 0, "rotation": 0, "scaleX": 1, "scaleY": 1 },
      "style": { "tool": "pressurePen", "color": "#1a1a1a", "size": 4, "opacity": 1 },
      "points": [ { "x": 0, "y": 0, "p": 0.4 }, { "x": 3, "y": -2, "p": 0.7 } ]
    },
    {
      "id": "o_rect_02",
      "type": "shape",
      "shape": "roundedRect",
      "transform": { "x": 200, "y": 80, "rotation": 0, "scaleX": 1, "scaleY": 1 },
      "size": { "w": 160, "h": 90 },
      "style": { "fill": "#FFE08A", "stroke": "#333", "strokeWidth": 2, "radius": 12 },
      "text": "Auth service"
    },
    {
      "id": "o_conn_03",
      "type": "connector",
      "from": { "objectId": "o_rect_02", "anchor": "right" },
      "to":   { "objectId": "o_rect_05", "anchor": "left" },
      "routing": "elbow",
      "style": { "stroke": "#333", "strokeWidth": 2, "endArrow": "triangle" }
    },
    {
      "id": "o_frame_04",
      "type": "frame",
      "name": "Diagram A",
      "size": { "w": 1200, "h": 800 },
      "transform": { "x": -100, "y": -100 },
      "children": ["o_rect_02", "o_conn_03"]
    }
  ]
}
```

Design notes:
- **Connectors store endpoints as references + anchors**, never absolute points, so they re-route automatically when targets move. Free-floating endpoints are allowed (a connector can attach to a point in space).
- **Strokes store raw points with pressure**, rendered to variable-width paths at draw time — keeps them crisp and editable.
- **Transforms are local to parent**; world transform is composed up the tree (groups/frames).

### 8.4 Spatial index
An **R-tree** (or quadtree) over object bounding boxes, kept in memory, used for: viewport culling, hit-testing (click/lasso), snapping candidate lookup, and tile invalidation. Updated incrementally on every object mutation.

### 8.5 Persistence (local-first)
- **IndexedDB** as the store of record. Objects written as discrete records keyed by id, plus a board metadata record and a blob store for images.
- Writes are **batched and debounced** but durable: the in-memory store is the source of truth during a session and continuously flushed.
- **Snapshots** are serialized board states stored separately for versioning.
- Export/import via a self-contained `.slate` file (zip of JSON + image blobs).

### 8.6 Command & history model
- All mutations are expressed as **commands** (add/remove/update/transform/reorder/group…). Commands are reversible (carry enough info to undo).
- Undo/redo = stacks of commands. The same command stream feeds persistence and the future sync layer.
- This single-write-path design is what makes collaboration addable later without rewriting the core.

### 8.7 Collaboration readiness (designed-for, not-built)
- The command model maps cleanly onto a **CRDT** (Yjs-style) when multiplayer is added: per-object maps, last-writer-wins on scalar props, list CRDT for z-order, fractional indexing for ordering.
- v1 ships single-user with this seam intact, so multiplayer is a layer (presence + a sync server relaying CRDT updates) rather than a rewrite.

### 8.8 Tech stack (proposed)
- **Frontend:** TypeScript, React for chrome/panels, hand-rolled canvas engine (React does *not* manage canvas objects — the engine does, for performance).
- **Rendering:** Canvas2D first, WebGL renderer behind an interface for the scale path.
- **State:** in-memory document store + command bus; a lightweight reactive layer for UI (e.g. Zustand/signals) for tool/UI state only.
- **Persistence:** IndexedDB (via a thin wrapper, e.g. Dexie) + blob store.
- **Packaging:** PWA (installable, offline via service worker).
- **Future sync:** Yjs + a WebSocket/WebRTC relay; storage backend TBD.

---

## 9. UX & interaction principles

- **Mode-light.** The user shouldn't have to declare "I'm diagramming now." Tools are quick to switch, and the canvas accepts ink, shapes, and text interchangeably.
- **Direct manipulation everywhere.** Drag, don't dialog. Inline editing over property panels where possible; a contextual toolbar appears near the selection.
- **The pen is sacred.** Nothing in the UI should add latency to ink. Tool palette is one tap/keypress away and otherwise out of the way.
- **Zoom is navigation, not a feature.** Zooming out to see structure and back in to detail is the core loop; it must be effortless and never lose place.
- **Forgiving.** Generous undo, non-destructive erase, locked-object protection, autosave. The user should never fear losing work.
- **Quiet chrome.** Minimal persistent UI; surfaces reveal on hover/selection. The canvas, not the toolbar, is the product.

---

## 10. Milestones & phasing

### M0 — Engine spike (proof it's fast)
Infinite pan/zoom + drawing one pen style at 60fps with 1k+ objects; scene graph + spatial index + dirty-rect rendering. *No persistence, no polish.* Validates the hard part.

### M1 — MVP "It's a sketchbook"
- Canvas nav (pan/zoom/minimap/grid)
- Pen styles (fineliner, pressure, marker, pencil) + eraser
- Sticky notes + free text
- Basic shapes + manual arrows (no smart routing yet)
- Selection/move/scale/rotate, undo/redo
- Single board, IndexedDB persistence, autosave
- PNG export

### M2 — "It's a diagramming tool too"
- Smart connectors (attached, auto-routing, elbow/curved)
- Snapping, alignment guides, distribute
- Shape recognition toggle
- Groups, frames, z-order, lock
- Multiple boards + home grid
- SVG/PDF export, `.slate` import/export

### M3 — "It's powerful"
- Sticker/stamp library + custom stamps
- Images (crop/filters), lasso ink editing
- Layers panel, version snapshots
- Search (text + sticky content)
- WebGL renderer for dense boards
- PWA offline polish, performance hardening

### M4+ — Optional bets
- Real-time collaboration (CRDT + presence)
- AI features (§13)
- Native tablet app

---

## 11. Success metrics

Since this is personal-first, vanity metrics matter less than *whether it earns the daily reach*.

- **Activation:** % of new boards that get >20 objects (the user actually used it, not just opened it).
- **Retention:** D7 / D30 return rate; boards reopened across multiple days.
- **Ink health:** measured input-to-ink latency p95 on stylus < 25ms; dropped-frame rate during draw.
- **Performance:** p95 frame time during pan/zoom on a 5k-object board.
- **Reliability:** zero-data-loss rate (sessions with no detected loss / total).
- **Engagement depth:** sessions that mix ≥2 object types (ink + shapes, ink + text) — proxy for the "no mode" thesis working.

---

## 12. Risks & open questions

### Risks
| Risk | Mitigation |
|---|---|
| Canvas performance at scale is genuinely hard | M0 spike de-risks it first; tiling + culling + WebGL escalation path planned from day one. |
| Ink latency on web is worse than native | Pointer prediction/coalescing, dedicated live layer, DPR-aware draw; benchmark early on real tablets. |
| Scope creep toward "another Miro" | Non-goals are explicit; collaboration & AI are firewalled into later phases. |
| IndexedDB limits / quota on big image-heavy boards | Downscale for display, evict/lazy-load full-res, surface storage usage, support export-as-backup. |
| Building a canvas engine from scratch is expensive | Consider whether to lean on an existing OSS canvas core vs. full custom — see open questions. |

### Open questions
- **Build vs. adopt:** hand-roll the canvas engine, or build on an existing infinite-canvas OSS core (e.g. tldraw's editor) and focus effort on ink + stickers + UX? (Strong candidate for a fast MVP.)
- **Where does data live long-term?** Pure local with manual backup, or optional encrypted cloud sync from M2?
- **Handwriting recognition** — first-party model, on-device, or skip until AI phase?
- **Pricing/model** if this ever ships beyond personal use — free + local, paid sync/AI?
- **Tablet:** PWA-only, or is native (Pencil hover, ProMotion) worth it sooner?

---

## 13. Future: AI layer (deliberately deferred)

Kept out of v1 on purpose so the core surface is solid first. Candidates, roughly in order of value:
- **Sketch-to-shape / sketch-to-diagram:** clean up rough ink into structured diagrams.
- **Handwriting → text** search and conversion.
- **"Tidy this":** auto-align, auto-route, auto-layout a messy region.
- **Generate from prompt:** drop a described diagram or sticker set onto the canvas.
- **Summarize a board** into text/outline.

Each is additive on top of the scene graph and command model; none should compromise ink latency or the local-first guarantee.

---

## 14. Appendix — competitive positioning

| | Miro / FigJam | Procreate / Concepts | Notion / GoodNotes | **Slate** |
|---|---|---|---|---|
| Infinite canvas | ✅ | partial | ❌ (pages) | ✅ |
| First-class ink | ❌ weak | ✅ | ✅ (GoodNotes) | ✅ |
| Smart connectors | ✅ | ❌ | ❌ | ✅ |
| Stickers/stamps | ✅ | partial | ❌ | ✅ |
| Local-first / offline | ❌ | ✅ | partial | ✅ |
| Collaboration | ✅ (core) | ❌ | partial | later |
| Single-user focus | ❌ | ✅ | ✅ | ✅ |

**One-line positioning:** *Slate is the infinite canvas for one mind — Miro's structure and Procreate's ink, with no page and no meeting attached.*

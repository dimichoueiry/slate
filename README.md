# Slate

An infinite-canvas sketchbook for thinking, drawing, diagramming, and planning. Local-first, offline, single-user. See `slate-prd.md` for the full product spec.

Built entirely on MIT-licensed open source — no tldraw, no Excalidraw:

| Concern | Library |
|---|---|
| Ink (variable-width pressure strokes) | [perfect-freehand](https://github.com/steveruizok/perfect-freehand) |
| Hand-drawn "sketchy" shape rendering | [roughjs](https://roughjs.com) |
| Spatial index (culling, hit-testing, snapping) | [rbush](https://github.com/mourner/rbush) (R-tree) |
| Persistence | [Dexie](https://dexie.org) over IndexedDB |
| Markdown notes | [marked](https://marked.js.org) |
| UI state | [Zustand](https://github.com/pmndrs/zustand) |
| Chrome / panels | React 18 + Vite + TypeScript |
| Offline / installable | vite-plugin-pwa |

The canvas engine itself is hand-rolled (`src/engine/`): a scene-graph document store with a reversible command model (one write path feeding undo, autosave, and a future CRDT sync layer), a two-layer Canvas2D renderer (static scene + live overlay so ink never repaints the world), viewport culling via the R-tree, `Path2D` caching per stroke, and far-zoom LOD.

## Run

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production PWA in dist/
```

Headless browser test scenarios live in `scripts/*.mjs` (Playwright); they expect the dev server on port 5180: `npm run dev -- --port 5180`, then e.g. `node scripts/smoke.mjs`.

## Use

### Draw & navigate
- **Draw**: `P`, then pick Fine / Pen / Pencil / Marker / Brush in the style bar, with size, smoothing and opacity sliders. Trackpad and mouse get velocity-based width; a stylus gets real pressure. `E` is a stroke eraser.
- **Navigate**: two-finger scroll pans, pinch (or `⌘`+scroll) zooms at the cursor, `Space`-drag or `H` pans, `⇧1` zoom-to-fit, `⇧2` zoom-to-selection, `⌘0` reset. The minimap (bottom-left) is clickable.
- **Tools**: `V` select · `E` eraser · `R` rect · `O` ellipse · `D` diamond · `L` line · `C` connector/arrow · `S` sticky · `T` text · `F` frame · `I` icon library. The toolbar is movable — drag the `⋮⋮` grip (double-click it to reset).

### Shapes, lines & connectors
- Shapes have fill/stroke/dash controls, square or **rounded corners**, and a **Sketchy** mode (hand-drawn roughjs borders, Excalidraw-style).
- **Connectors** (`C`) magnetically attach to any object and land exactly on its edge; they re-route live when things move (straight / elbow / curved, arrowheads togglable). **Lines** (`L`) are the same minus arrowheads.
- Drag a selected line's **endpoint handles** to re-angle or re-attach it; hold `⇧` while dragging for 15° angle snapping.
- The **Attach / Free** toggle in the line/connector style bar stops endpoints from sticking to shapes (for grids and interior lines); holding `⌥` while drawing does the same as a one-off.

### Text
- `T` places text; double-click empty canvas does too; double-click any shape or sticky to label it. `Enter` edits the selected object.
- Font picker (Sans / Serif / Elegant / Futura / Hand / Mono — native macOS stacks, fully offline) and a 12–96px size dropdown for visual hierarchy.

### Icons & components
- `I` opens **Iconland**: ~290 stroke-style vector icons in 20 searchable categories (arrows, UI, design, engineering, AI/ML, data, product, geometric shapes, symbols, science…). Icons are recolorable and have an adjustable stroke width.
- Select anything and hit **⊕ Save** to store it as a reusable **component**; place copies from the "My components" section of the tray on any board (right-click a component to delete it).

### Organize
- `⌘G` group / `⌘⇧G` ungroup, `⌘L` lock, `⌘[`/`⌘]` z-order, align/distribute buttons on multi-selection, `⌘D` duplicate, arrow keys nudge.
- **Frames** (`F`) are named regions: everything inside moves with the frame, the `⧈` button in the top bar jumps to any frame, frames rename from the style bar, and each frame exports as its own PNG from the Export menu.
- Smart alignment guides appear while dragging; toggle snapping with the `⌖` button.

### Boards, notes & files
- The home screen lists boards with thumbnails; boards rename, duplicate, pin and delete. Everything autosaves to IndexedDB continuously — no save button.
- **🗒 Notes** opens a collapsible per-board markdown side panel (write/preview).
- Export PNG (1×/2×) / SVG of the board, selection or a frame, plus full-fidelity `.slate` backup files that re-import from the home screen. Paste or drag-drop images straight onto the canvas; pasted text becomes a text object.
- Custom colors: the dashed **＋** swatch in any palette opens the system color wheel; picked colors are saved across sessions (right-click a swatch to remove).

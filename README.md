# Slate

An infinite-canvas sketchbook for thinking, drawing, diagramming, and planning. Local-first, offline, single-user. See `slate-prd.md` for the full product spec.

Built entirely on MIT-licensed open source — no tldraw, no Excalidraw:

| Concern | Library |
|---|---|
| Ink (variable-width pressure strokes) | [perfect-freehand](https://github.com/steveruizok/perfect-freehand) |
| Spatial index (culling, hit-testing, snapping) | [rbush](https://github.com/mourner/rbush) (R-tree) |
| Persistence | [Dexie](https://dexie.org) over IndexedDB |
| UI state | [Zustand](https://github.com/pmndrs/zustand) |
| Chrome / panels | React 18 + Vite + TypeScript |
| Offline / installable | vite-plugin-pwa |

The canvas engine itself is hand-rolled (`src/engine/`): a scene-graph document store with a reversible command model (one write path feeding undo, autosave, and a future CRDT sync layer), a two-layer Canvas2D renderer (static scene + live overlay so ink never repaints the world), viewport culling via the R-tree, `Path2D` caching per stroke, and far-zoom LOD.

## Run

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production PWA in dist/
node scripts/smoke.mjs   # headless browser smoke test (needs `npm run dev -- --port 5180`)
```

## Use

- **Draw**: `P`, then pick Fine / Pen / Pencil / Marker / Brush in the top bar. Trackpad and mouse get velocity-based width; a stylus gets real pressure.
- **Navigate**: two-finger scroll pans, pinch (or `⌘`+scroll) zooms at the cursor, `Space`-drag or `H` pans, `⇧1` zoom-to-fit, `⇧2` zoom-to-selection, `⌘0` reset.
- **Tools**: `V` select · `E` eraser · `R` rect · `O` ellipse · `D` diamond · `L` arrow · `C` connector · `S` sticky · `T` text · `F` frame.
- **Connectors** attach to shape anchors and re-route when you move the shapes (straight / elbow / curved).
- **Edit**: double-click any shape/sticky/text to type; double-click empty canvas for a text note; `Enter` edits the selected object.
- **Organize**: `⌘G` group, `⌘L` lock, `⌘[`/`⌘]` z-order, align/distribute in the selection toolbar, drag objects fully inside a frame to contain them.
- **Everything autosaves** to IndexedDB continuously. Export PNG / SVG / `.slate` backup from the Export menu; paste or drag-drop images straight onto the canvas.

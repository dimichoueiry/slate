import { nanoid } from 'nanoid';
import type {
  AnchorSide,
  Box,
  ConnectorObj,
  FrameObj,
  IconObj,
  ShapeObj,
  SlateObj,
  StickyObj,
  StrokeObj,
  TextObj,
  ToolId,
  Vec,
} from '../types';
import { STICKY_COLORS } from '../types';
import {
  cameraToFit,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToWorld,
  visibleWorldRect,
  zoomAt,
  type Camera,
} from './camera';
import { Doc } from './doc';
import {
  aabbOf,
  anchorPoint,
  boundsOf,
  boxContains,
  boxesIntersect,
  boxUnion,
  nearestAnchor,
  rotatePoint,
  routeConnector,
  snapAngle,
} from './geometry';
import { hitTest, strokesHitBySegment } from './hit';
import { strokeOutline, outlineToPath, type InputPoint } from './ink';
import { drawScene, type GridSettings } from './renderer';
import { snapBox, snapToGrid, type SnapResult } from './snap';
import { textBlockSize } from './text';
import { useUI } from '../store/ui';
import { saveComponent, type ComponentDef } from '../store/db';
import { exportPng } from '../export/export';

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

interface PointerInfo {
  id: number;
  type: string;
  screen: Vec;
}

type Interaction =
  | { kind: 'idle' }
  | { kind: 'panning'; last: Vec; restoreTool?: ToolId }
  | { kind: 'pinch'; lastDist: number; lastCenter: Vec }
  | { kind: 'drawing'; points: InputPoint[]; lastWorld: Vec }
  | { kind: 'erasing'; lastWorld: Vec; erased: Set<string> }
  | { kind: 'marquee'; start: Vec; current: Vec; additive: boolean }
  | {
      kind: 'translating';
      startWorld: Vec;
      origins: Map<string, SlateObj>;
      moved: boolean;
      freeEnds: Map<string, ConnectorObj>;
      /** object (incl. its group) under the cursor at pointerdown — click without drag refines selection to it */
      clickIds: string[] | null;
    }
  | {
      kind: 'resizing';
      handle: HandleId;
      startWorld: Vec;
      origins: Map<string, SlateObj>;
      startBox: Box;
    }
  | { kind: 'rotating'; id: string; origin: SlateObj; center: Vec }
  | { kind: 'shaping'; start: Vec; id: string }
  | { kind: 'framing'; start: Vec; id: string }
  | {
      kind: 'connecting';
      id: string;
      from: { objectId?: string | null; anchor?: AnchorSide; point?: Vec };
      hover: { objectId: string; anchor: AnchorSide } | null;
    }
  | { kind: 'endpointing'; id: string; end: 'from' | 'to' };

const HANDLE_SIZE = 9;

export class Controller {
  doc = new Doc();
  camera: Camera = { x: -200, y: -200, zoom: 1 };
  selection = new Set<string>();

  private scene: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private sceneCtx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;
  viewW = 1;
  viewH = 1;
  dpr = Math.min(window.devicePixelRatio || 1, 3);

  private sceneDirty = true;
  private overlayDirty = true;
  private rafId = 0;
  private disposed = false;

  private pointers = new Map<number, PointerInfo>();
  private interaction: Interaction = { kind: 'idle' };
  private spaceDown = false;
  private lastPenSeen = 0;
  private hoverAnchors: { objectId: string; box: Box } | null = null;
  private snapGuides: SnapResult['guides'] = [];
  private clipboard: SlateObj[] = [];
  private frameCount = 1;

  private cameraListeners = new Set<() => void>();
  onViewportChanged: (() => void) | null = null;

  constructor(scene: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.scene = scene;
    this.overlay = overlay;
    this.sceneCtx = scene.getContext('2d')!;
    this.overlayCtx = overlay.getContext('2d')!;

    this.doc.subscribe(() => {
      this.sceneDirty = true;
      this.overlayDirty = true;
      this.syncHistoryFlags();
      const ui = useUI.getState();
      ui.set({ docVersion: ui.docVersion + 1 });
    });

    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);
  }

  // ---------- lifecycle ----------

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
  }

  resize(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
    for (const c of [this.scene, this.overlay]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.sceneDirty = true;
    this.overlayDirty = true;
  }

  markSceneDirty = () => {
    this.sceneDirty = true;
  };

  onCamera(fn: () => void): () => void {
    this.cameraListeners.add(fn);
    return () => this.cameraListeners.delete(fn);
  }

  private cameraChanged() {
    this.sceneDirty = true;
    this.overlayDirty = true;
    useUI.getState().set({ zoomPct: Math.round(this.camera.zoom * 100) });
    for (const fn of this.cameraListeners) fn();
    this.onViewportChanged?.();
  }

  private syncHistoryFlags() {
    const ui = useUI.getState();
    const canUndo = this.doc.canUndo();
    const canRedo = this.doc.canRedo();
    if (ui.canUndo !== canUndo || ui.canRedo !== canRedo) ui.set({ canUndo, canRedo });
  }

  private syncSelection() {
    useUI.getState().set({ selection: [...this.selection] });
    this.overlayDirty = true;
  }

  // ---------- render loop ----------

  private loop() {
    if (this.disposed) return;
    if (this.sceneDirty) {
      this.sceneDirty = false;
      const ui = useUI.getState();
      const grid: GridSettings = { mode: ui.gridMode };
      drawScene(this.sceneCtx, this.doc, this.camera, this.viewW, this.viewH, this.dpr, grid, ui.editingTextId);
    }
    if (this.overlayDirty) {
      this.overlayDirty = false;
      this.drawOverlay();
    }
    this.rafId = requestAnimationFrame(this.loop);
  }

  // ---------- coordinate helpers ----------

  private toScreen(e: { clientX: number; clientY: number }): Vec {
    const r = this.overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  toWorld(e: { clientX: number; clientY: number }): Vec {
    return screenToWorld(this.camera, this.toScreen(e));
  }

  worldToScreenPt(p: Vec): Vec {
    return { x: (p.x - this.camera.x) * this.camera.zoom, y: (p.y - this.camera.y) * this.camera.zoom };
  }

  // ---------- camera API ----------

  panBy(dxScreen: number, dyScreen: number) {
    this.camera = {
      ...this.camera,
      x: this.camera.x - dxScreen / this.camera.zoom,
      y: this.camera.y - dyScreen / this.camera.zoom,
    };
    this.cameraChanged();
  }

  zoomTo(zoom: number, screenAnchor?: Vec) {
    const anchor = screenAnchor ?? { x: this.viewW / 2, y: this.viewH / 2 };
    this.camera = zoomAt(this.camera, anchor, zoom);
    this.cameraChanged();
  }

  zoomToFit() {
    const objs = this.doc.all();
    if (objs.length === 0) return;
    const box = boxUnion(objs.map((o) => aabbOf(o, this.doc.resolve)));
    this.camera = cameraToFit(box, this.viewW, this.viewH);
    this.cameraChanged();
  }

  zoomToSelection() {
    if (this.selection.size === 0) return;
    const boxes = [...this.selection]
      .map((id) => this.doc.get(id))
      .filter((o): o is SlateObj => !!o)
      .map((o) => aabbOf(o, this.doc.resolve));
    this.camera = cameraToFit(boxUnion(boxes), this.viewW, this.viewH, 96);
    this.cameraChanged();
  }

  frames(): FrameObj[] {
    return this.doc
      .allSorted()
      .filter((o): o is FrameObj => o.type === 'frame');
  }

  zoomToFrame(id: string) {
    const f = this.doc.get(id);
    if (!f) return;
    this.camera = cameraToFit(boundsOf(f, this.doc.resolve), this.viewW, this.viewH, 48);
    this.cameraChanged();
  }

  setCamera(c: Camera) {
    this.camera = { ...c, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom)) };
    this.cameraChanged();
  }

  // ---------- selection / edit API (used by UI chrome + shortcuts) ----------

  selectIds(ids: string[]) {
    this.selection = new Set(ids);
    this.syncSelection();
  }

  selectAll() {
    this.selection = new Set(this.doc.all().filter((o) => !o.locked).map((o) => o.id));
    this.syncSelection();
  }

  clearSelection() {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.syncSelection();
  }

  selectedObjects(): SlateObj[] {
    return [...this.selection].map((id) => this.doc.get(id)).filter((o): o is SlateObj => !!o);
  }

  deleteSelection() {
    if (this.selection.size === 0) return;
    this.doc.begin();
    // also delete connectors that reference deleted objects at both ends? keep ones with one end — detach instead
    const ids = new Set(this.selection);
    const attached = this.doc.connectorsAttachedTo(ids) as ConnectorObj[];
    for (const c of attached) {
      if (ids.has(c.id)) continue;
      const patch: Partial<ConnectorObj> = {};
      const pts = routeConnector(c, this.doc.resolve);
      if (c.from.objectId && ids.has(c.from.objectId)) {
        patch.from = { point: pts[0] };
      }
      if (c.to.objectId && ids.has(c.to.objectId)) {
        patch.to = { point: pts[pts.length - 1] };
      }
      this.doc.update(c.id, patch);
    }
    this.doc.deleteMany([...ids]);
    this.doc.commit();
    this.selection.clear();
    this.syncSelection();
  }

  undo() {
    this.doc.undo();
    this.pruneSelection();
  }

  redo() {
    this.doc.redo();
    this.pruneSelection();
  }

  private pruneSelection() {
    let changed = false;
    for (const id of [...this.selection]) {
      if (!this.doc.get(id)) {
        this.selection.delete(id);
        changed = true;
      }
    }
    if (changed) this.syncSelection();
    else this.overlayDirty = true;
  }

  copySelection() {
    this.clipboard = this.selectedObjects().map((o) => ({ ...o }));
  }

  cutSelection() {
    this.copySelection();
    this.deleteSelection();
  }

  paste(atWorld?: Vec) {
    if (this.clipboard.length === 0) return;
    const idMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    for (const o of this.clipboard) idMap.set(o.id, nanoid(8));

    const srcBox = boxUnion(this.clipboard.map((o) => aabbOf(o, (id) => this.clipboard.find((c) => c.id === id))));
    let dx = 24;
    let dy = 24;
    if (atWorld) {
      dx = atWorld.x - (srcBox.x + srcBox.w / 2);
      dy = atWorld.y - (srcBox.y + srcBox.h / 2);
    }

    const clones: SlateObj[] = this.clipboard.map((o) => {
      const clone: SlateObj = {
        ...structuredClone(o),
        id: idMap.get(o.id)!,
        x: o.x + dx,
        y: o.y + dy,
        z: this.doc.nextZ(),
      };
      if (clone.groupId) {
        if (!groupMap.has(clone.groupId)) groupMap.set(clone.groupId, nanoid(8));
        clone.groupId = groupMap.get(clone.groupId)!;
      }
      if (clone.parentId) clone.parentId = idMap.get(clone.parentId) ?? null;
      if (clone.type === 'connector') {
        const c = clone as ConnectorObj;
        c.from = remapEnd(c.from, idMap, dx, dy);
        c.to = remapEnd(c.to, idMap, dx, dy);
      }
      return clone;
    });

    this.doc.begin();
    this.doc.setMany(clones);
    this.doc.commit();
    this.selection = new Set(clones.map((c) => c.id));
    this.syncSelection();
  }

  duplicateSelection() {
    this.copySelection();
    this.paste();
  }

  hasClipboard(): boolean {
    return this.clipboard.length > 0;
  }

  addIcon(iconId: string) {
    const center = screenToWorld(this.camera, { x: this.viewW / 2, y: this.viewH / 2 });
    const size = 56;
    const obj: IconObj = {
      id: nanoid(8),
      type: 'icon',
      icon: iconId,
      x: center.x - size / 2,
      y: center.y - size / 2,
      w: size,
      h: size,
      rotation: 0,
      z: this.doc.nextZ(),
      color: useUI.getState().penColor,
      opacity: 1,
      strokeWidth: 2,
    };
    this.doc.set(obj);
    this.selection = new Set([obj.id]);
    this.syncSelection();
    useUI.getState().set({ tool: 'select' });
  }

  addTextAtCenter(text: string) {
    const center = screenToWorld(this.camera, { x: this.viewW / 2, y: this.viewH / 2 });
    const fontSize = 20;
    const fontFamily = useUI.getState().fontFamily;
    const m = textBlockSize(text, fontSize, undefined, 400, fontFamily);
    const obj: TextObj = {
      id: nanoid(8),
      type: 'text',
      x: center.x - m.w / 2,
      y: center.y - m.h / 2,
      w: m.w,
      h: m.h,
      rotation: 0,
      z: this.doc.nextZ(),
      text,
      color: useUI.getState().penColor,
      fontSize,
      fontFamily,
      fixedWidth: false,
    };
    this.doc.set(obj);
    this.selection = new Set([obj.id]);
    this.syncSelection();
  }

  groupSelection() {
    if (this.selection.size < 2) return;
    const gid = nanoid(8);
    this.doc.begin();
    for (const o of this.selectedObjects()) this.doc.update(o.id, { groupId: gid });
    this.doc.commit();
  }

  ungroupSelection() {
    this.doc.begin();
    for (const o of this.selectedObjects()) {
      if (o.groupId) this.doc.update(o.id, { groupId: null });
    }
    this.doc.commit();
  }

  toggleLockSelection() {
    const objs = this.selectedObjects();
    if (objs.length === 0) return;
    const anyUnlocked = objs.some((o) => !o.locked);
    this.doc.begin();
    for (const o of objs) this.doc.update(o.id, { locked: anyUnlocked });
    this.doc.commit();
    this.overlayDirty = true;
  }

  reorderSelection(mode: 'front' | 'back' | 'forward' | 'backward') {
    const objs = this.selectedObjects();
    if (objs.length === 0) return;
    const all = this.doc.allSorted();
    this.doc.begin();
    if (mode === 'front') {
      for (const o of objs) this.doc.update(o.id, { z: this.doc.nextZ() });
    } else if (mode === 'back') {
      const minZ = all.length ? all[0].z : 0;
      let z = minZ - objs.length - 1;
      for (const o of objs) this.doc.update(o.id, { z: z++ });
    } else {
      const dir = mode === 'forward' ? 1 : -1;
      for (const o of objs) {
        const idx = all.findIndex((a) => a.id === o.id);
        const swap = all[idx + dir];
        if (swap && !this.selection.has(swap.id)) {
          const oz = o.z;
          this.doc.update(o.id, { z: swap.z });
          this.doc.update(swap.id, { z: oz });
        }
      }
    }
    this.doc.commit();
  }

  align(mode: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') {
    const objs = this.selectedObjects().filter((o) => o.type !== 'connector');
    if (objs.length < 2) return;
    const boxes = objs.map((o) => ({ o, b: aabbOf(o, this.doc.resolve) }));
    const union = boxUnion(boxes.map((x) => x.b));
    this.doc.begin();
    for (const { o, b } of boxes) {
      let dx = 0;
      let dy = 0;
      if (mode === 'left') dx = union.x - b.x;
      if (mode === 'right') dx = union.x + union.w - (b.x + b.w);
      if (mode === 'centerX') dx = union.x + union.w / 2 - (b.x + b.w / 2);
      if (mode === 'top') dy = union.y - b.y;
      if (mode === 'bottom') dy = union.y + union.h - (b.y + b.h);
      if (mode === 'centerY') dy = union.y + union.h / 2 - (b.y + b.h / 2);
      if (dx || dy) this.doc.update(o.id, { x: o.x + dx, y: o.y + dy });
    }
    this.doc.commit();
  }

  distribute(axis: 'x' | 'y') {
    const objs = this.selectedObjects().filter((o) => o.type !== 'connector');
    if (objs.length < 3) return;
    const boxes = objs
      .map((o) => ({ o, b: aabbOf(o, this.doc.resolve) }))
      .sort((p, q) => (axis === 'x' ? p.b.x - q.b.x : p.b.y - q.b.y));
    const first = boxes[0].b;
    const last = boxes[boxes.length - 1].b;
    const totalSize = boxes.reduce((s, x) => s + (axis === 'x' ? x.b.w : x.b.h), 0);
    const span =
      axis === 'x' ? last.x + last.w - first.x : last.y + last.h - first.y;
    const gap = (span - totalSize) / (boxes.length - 1);
    this.doc.begin();
    let cursor = axis === 'x' ? first.x : first.y;
    for (const { o, b } of boxes) {
      const target = cursor;
      const cur = axis === 'x' ? b.x : b.y;
      const d = target - cur;
      if (Math.abs(d) > 0.01) {
        this.doc.update(o.id, axis === 'x' ? { x: o.x + d } : { y: o.y + d });
      }
      cursor += (axis === 'x' ? b.w : b.h) + gap;
    }
    this.doc.commit();
  }

  updateSelected(patch: Record<string, unknown>) {
    // optional props may be absent on older objects, so `in` checks would miss them
    const OPTIONAL: Record<string, Set<string>> = {
      fontFamily: new Set(['text', 'shape', 'sticky']),
      sketchy: new Set(['shape']),
      seed: new Set(['shape']),
      strokeWidth: new Set(['icon']),
    };
    this.doc.begin();
    for (const o of this.selectedObjects()) {
      const valid: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        // corner toggle only applies to rectangles, not other shape kinds
        if (k === 'shape' && (o.type !== 'shape' || !['rect', 'roundedRect'].includes((o as ShapeObj).shape)))
          continue;
        if (k in o || OPTIONAL[k]?.has(o.type)) valid[k] = v;
      }
      if (Object.keys(valid).length) {
        if (valid.sketchy && (o as ShapeObj).seed === undefined) {
          valid.seed = Math.floor(Math.random() * 2 ** 31);
        }
        this.doc.update(o.id, valid as Partial<SlateObj>);
      }
    }
    this.doc.commit();
  }

  /** Set font size on selected text-bearing objects, re-measuring text bounds. */
  setSelectedFontSize(size: number) {
    this.doc.begin();
    for (const o of this.selectedObjects()) {
      if (o.type === 'text') {
        const m = textBlockSize(o.text || ' ', size, o.fixedWidth ? o.w : undefined, 400, o.fontFamily);
        this.doc.update<TextObj>(o.id, { fontSize: size, w: o.fixedWidth ? o.w : m.w, h: m.h });
      } else if (o.type === 'sticky') {
        const m = textBlockSize(o.text || ' ', size, o.w - 24, 500, o.fontFamily);
        this.doc.update<StickyObj>(o.id, { fontSize: size, h: Math.max(o.h, m.h + 24) });
      } else if (o.type === 'shape') {
        this.doc.update<ShapeObj>(o.id, { fontSize: size });
      }
    }
    this.doc.commit();
  }

  /** Save the current selection as a reusable component (normalized to origin, with thumbnail). */
  async saveSelectionAsComponent(name: string): Promise<boolean> {
    const objs = this.selectedObjects();
    if (objs.length === 0) return false;
    const ids = new Set(objs.map((o) => o.id));
    const box = boxUnion(objs.map((o) => aabbOf(o, this.doc.resolve)));

    const clones: SlateObj[] = objs.map((o) => {
      const c = structuredClone(o);
      c.x -= box.x;
      c.y -= box.y;
      if (c.parentId && !ids.has(c.parentId)) c.parentId = null;
      if (c.type === 'connector') {
        const src = o as ConnectorObj;
        const pts = routeConnector(src, this.doc.resolve);
        if (src.from.objectId && !ids.has(src.from.objectId)) {
          c.from = { point: { x: pts[0].x - box.x, y: pts[0].y - box.y } };
        } else if (c.from.point) {
          c.from.point = { x: c.from.point.x - box.x, y: c.from.point.y - box.y };
        }
        if (src.to.objectId && !ids.has(src.to.objectId)) {
          c.to = { point: { x: pts[pts.length - 1].x - box.x, y: pts[pts.length - 1].y - box.y } };
        } else if (c.to.point) {
          c.to.point = { x: c.to.point.x - box.x, y: c.to.point.y - box.y };
        }
      }
      return c;
    });

    let thumb: string | undefined;
    try {
      const pad = 12;
      const tBox = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
      const blob = await exportPng(this.doc, tBox, Math.min(1, 256 / Math.max(tBox.w, tBox.h)), false);
      thumb = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
    } catch {
      // thumbnail is best-effort
    }

    await saveComponent({
      id: nanoid(10),
      name,
      objects: clones,
      thumb,
      w: box.w,
      h: box.h,
      createdAt: Date.now(),
    });
    const ui = useUI.getState();
    ui.set({ componentsVersion: ui.componentsVersion + 1, iconTrayOpen: true });
    return true;
  }

  /** Instantiate a saved component at the viewport center. */
  placeComponent(comp: ComponentDef) {
    const idMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    for (const o of comp.objects) idMap.set(o.id, nanoid(8));
    const center = screenToWorld(this.camera, { x: this.viewW / 2, y: this.viewH / 2 });
    const dx = center.x - comp.w / 2;
    const dy = center.y - comp.h / 2;

    const clones: SlateObj[] = comp.objects.map((o) => {
      const c = structuredClone(o);
      c.id = idMap.get(o.id)!;
      c.x += dx;
      c.y += dy;
      c.z = this.doc.nextZ();
      if (c.groupId) {
        if (!groupMap.has(c.groupId)) groupMap.set(c.groupId, nanoid(8));
        c.groupId = groupMap.get(c.groupId)!;
      }
      if (c.parentId) c.parentId = idMap.get(c.parentId) ?? null;
      if (c.type === 'connector') {
        c.from = remapEnd(c.from, idMap, dx, dy);
        c.to = remapEnd(c.to, idMap, dx, dy);
      }
      return c;
    });

    this.doc.begin();
    this.doc.setMany(clones);
    this.doc.commit();
    this.selection = new Set(clones.map((c) => c.id));
    this.syncSelection();
    useUI.getState().set({ tool: 'select' });
  }

  startEditingText(id: string) {
    const o = this.doc.get(id);
    if (!o || (o.type !== 'shape' && o.type !== 'sticky' && o.type !== 'text')) return;
    useUI.getState().set({ editingTextId: id });
    this.overlayDirty = true;
  }

  // ---------- creation API ----------

  addImage(blobId: string, natural: { w: number; h: number }, atWorld?: Vec) {
    const maxDim = 480 / Math.min(this.camera.zoom, 1);
    const scale = Math.min(1, maxDim / Math.max(natural.w, natural.h));
    const w = natural.w * scale;
    const h = natural.h * scale;
    const center =
      atWorld ?? screenToWorld(this.camera, { x: this.viewW / 2, y: this.viewH / 2 });
    const obj: SlateObj = {
      id: nanoid(8),
      type: 'image',
      x: center.x - w / 2,
      y: center.y - h / 2,
      w,
      h,
      rotation: 0,
      z: this.doc.nextZ(),
      blobId,
      opacity: 1,
      radius: 0,
    };
    this.doc.set(obj);
    this.selection = new Set([obj.id]);
    this.syncSelection();
    useUI.getState().set({ tool: 'select' });
  }

  // ---------- pointer input ----------

  handlePointerDown(e: PointerEvent) {
    this.overlay.setPointerCapture(e.pointerId);
    const screen = this.toScreen(e);
    this.pointers.set(e.pointerId, { id: e.pointerId, type: e.pointerType, screen });
    if (e.pointerType === 'pen') this.lastPenSeen = Date.now();

    // second touch finger → switch to pinch (cancelling any in-progress touch draw)
    if (e.pointerType === 'touch' && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      if (this.interaction.kind === 'drawing') this.interaction = { kind: 'idle' };
      this.interaction = {
        kind: 'pinch',
        lastDist: Math.hypot(a.screen.x - b.screen.x, a.screen.y - b.screen.y),
        lastCenter: { x: (a.screen.x + b.screen.x) / 2, y: (a.screen.y + b.screen.y) / 2 },
      };
      return;
    }
    if (this.pointers.size > 1) return;

    const ui = useUI.getState();
    if (ui.editingTextId) {
      // clicking the canvas closes the editor (TextEditor commits on unmount)
      ui.set({ editingTextId: null });
      return;
    }

    const world = screenToWorld(this.camera, screen);
    const middlePan = e.button === 1;
    const tool: ToolId = middlePan || this.spaceDown ? 'hand' : ui.tool;

    // palm rejection: ignore touch for ink if a pen was used recently
    const isPalm =
      e.pointerType === 'touch' && Date.now() - this.lastPenSeen < 60_000 && tool === 'pen';

    switch (tool) {
      case 'hand':
        this.interaction = { kind: 'panning', last: screen };
        break;
      case 'pen': {
        if (isPalm) {
          this.interaction = { kind: 'panning', last: screen };
          break;
        }
        const pressure = e.pressure > 0 && e.pointerType !== 'mouse' ? e.pressure : 0.5;
        this.interaction = {
          kind: 'drawing',
          points: [{ x: world.x, y: world.y, p: pressure }],
          lastWorld: world,
        };
        break;
      }
      case 'eraser':
        this.interaction = { kind: 'erasing', lastWorld: world, erased: new Set() };
        this.doc.begin();
        this.eraseAt(world, world);
        break;
      case 'select':
        this.beginSelectInteraction(e, screen, world);
        break;
      case 'sticky':
        this.placeSticky(world);
        break;
      case 'text':
        this.placeText(world);
        break;
      case 'frame': {
        const id = nanoid(8);
        const frame: FrameObj = {
          id,
          type: 'frame',
          name: `Frame ${this.frameCount++}`,
          x: world.x,
          y: world.y,
          w: 1,
          h: 1,
          rotation: 0,
          z: -this.doc.nextZ(), // frames render under content
        };
        this.doc.begin();
        this.doc.set(frame);
        this.interaction = { kind: 'framing', start: world, id };
        break;
      }
      case 'line':
      case 'connector':
        this.beginConnector(world, tool, this.attachAllowed(e));
        break;
      default: {
        // shape tools
        const id = nanoid(8);
        const shape: ShapeObj = {
          id,
          type: 'shape',
          shape:
            tool === 'rect'
              ? ui.rounded
                ? 'roundedRect'
                : 'rect'
              : tool === 'roundedRect'
                ? 'roundedRect'
                : tool === 'ellipse'
                  ? 'ellipse'
                  : tool === 'triangle'
                    ? 'triangle'
                    : 'diamond',
          x: world.x,
          y: world.y,
          w: 1,
          h: 1,
          rotation: 0,
          z: this.doc.nextZ(),
          fill: ui.fill,
          stroke: ui.stroke,
          strokeWidth: ui.strokeWidth,
          dash: ui.dash,
          radius: 12,
          opacity: 1,
          text: '',
          textColor: '#1a1a1a',
          fontSize: 16,
          fontFamily: ui.fontFamily,
          sketchy: ui.sketchy,
          seed: Math.floor(Math.random() * 2 ** 31),
        };
        this.doc.begin();
        this.doc.set(shape);
        this.interaction = { kind: 'shaping', start: world, id };
      }
    }
    this.overlayDirty = true;
  }

  private beginSelectInteraction(e: PointerEvent, screen: Vec, world: Vec) {
    const tol = 6 / this.camera.zoom;

    // 1. handles on current selection?
    const handle = this.handleAt(screen);
    if (handle) {
      const objs = this.selectedObjects().filter((o) => o.type !== 'connector');
      const startBox = boxUnion(objs.map((o) => aabbOf(o, this.doc.resolve)));
      if (handle === 'rotate' && objs.length === 1) {
        const b = boundsOf(objs[0], this.doc.resolve);
        this.doc.begin();
        this.interaction = {
          kind: 'rotating',
          id: objs[0].id,
          origin: { ...objs[0] },
          center: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
        };
        return;
      }
      if (handle !== 'rotate') {
        this.doc.begin();
        this.interaction = {
          kind: 'resizing',
          handle,
          startWorld: world,
          origins: new Map(objs.map((o) => [o.id, structuredClone(o)])),
          startBox,
        };
        return;
      }
    }

    // 1b. endpoint handles on a single selected connector → drag to re-angle / re-attach
    if (this.selection.size === 1) {
      const only = this.selectedObjects()[0];
      if (only?.type === 'connector' && !only.locked) {
        const pts = routeConnector(only, this.doc.resolve);
        const a = this.worldToScreenPt(pts[0]);
        const b = this.worldToScreenPt(pts[pts.length - 1]);
        const R = 10;
        if (Math.hypot(screen.x - a.x, screen.y - a.y) < R) {
          this.doc.begin();
          this.interaction = { kind: 'endpointing', id: only.id, end: 'from' };
          return;
        }
        if (Math.hypot(screen.x - b.x, screen.y - b.y) < R) {
          this.doc.begin();
          this.interaction = { kind: 'endpointing', id: only.id, end: 'to' };
          return;
        }
      }
    }

    // 2. object under cursor?
    const hit = hitTest(this.doc, world, tol);
    if (hit) {
      const targetIds = this.expandGroup(hit);
      if (e.shiftKey) {
        const allIn = targetIds.every((id) => this.selection.has(id));
        for (const id of targetIds) {
          if (allIn) this.selection.delete(id);
          else this.selection.add(id);
        }
        this.syncSelection();
        return;
      }
      const wasSubsetOfSelection = targetIds.every((id) => this.selection.has(id));
      if (!wasSubsetOfSelection) {
        this.selection = new Set(targetIds);
        this.syncSelection();
      }
      // remember the hit so a click without drag can narrow a multi-selection to it
      this.beginTranslate(world, this.selection.size > targetIds.length ? targetIds : null);
      return;
    }

    // 3. empty space → marquee
    if (!e.shiftKey) {
      this.selection.clear();
      this.syncSelection();
    }
    this.interaction = { kind: 'marquee', start: world, current: world, additive: e.shiftKey };
  }

  /** Objects currently inside a frame — live containment, so newly added objects count too. */
  frameChildren(frameId: string): SlateObj[] {
    const f = this.doc.get(frameId);
    if (!f || f.type !== 'frame') return [];
    const fb = boundsOf(f, this.doc.resolve);
    return this.doc
      .search(fb)
      .filter(
        (o) =>
          o.id !== frameId &&
          o.type !== 'frame' &&
          !o.locked &&
          boxContains(fb, aabbOf(o, this.doc.resolve))
      );
  }

  private expandGroup(o: SlateObj): string[] {
    const ids = [o.id];
    if (o.groupId) {
      for (const other of this.doc.all()) {
        if (other.groupId === o.groupId && other.id !== o.id) ids.push(other.id);
      }
    }
    if (o.type === 'frame') {
      for (const child of this.frameChildren(o.id)) ids.push(child.id);
    }
    return ids;
  }

  private beginTranslate(world: Vec, clickIds: string[] | null = null) {
    const ids = new Set(this.selection);
    // frames carry everything currently inside them
    for (const id of [...ids]) {
      const o = this.doc.get(id);
      if (o?.type === 'frame') {
        for (const child of this.frameChildren(id)) ids.add(child.id);
      }
    }
    const origins = new Map<string, SlateObj>();
    for (const id of ids) {
      const o = this.doc.get(id);
      if (o && !o.locked) origins.set(id, structuredClone(o));
    }
    // connectors with free endpoints fully inside the moving set should translate too
    const freeEnds = new Map<string, ConnectorObj>();
    for (const o of this.doc.connectorsAttachedTo(new Set(origins.keys()))) {
      const c = o as ConnectorObj;
      if (origins.has(c.id)) continue;
      freeEnds.set(c.id, structuredClone(c));
    }
    this.doc.begin();
    this.interaction = { kind: 'translating', startWorld: world, origins, moved: false, freeEnds, clickIds };
  }

  handlePointerMove(e: PointerEvent) {
    const screen = this.toScreen(e);
    const info = this.pointers.get(e.pointerId);
    if (info) info.screen = screen;
    const world = screenToWorld(this.camera, screen);
    const ui = useUI.getState();
    const it = this.interaction;

    switch (it.kind) {
      case 'idle': {
        // anchor hints when hovering with connector tool
        if (ui.tool === 'connector' || ui.tool === 'line') {
          const hit = this.attachAllowed(e) ? this.findAttachTarget(world) : null;
          const next = hit ? { objectId: hit.id, box: boundsOf(hit, this.doc.resolve) } : null;
          if (next?.objectId !== this.hoverAnchors?.objectId) {
            this.hoverAnchors = next;
            this.overlayDirty = true;
          }
        } else if (this.hoverAnchors) {
          this.hoverAnchors = null;
          this.overlayDirty = true;
        }
        if (ui.tool === 'eraser') this.overlayDirty = true; // eraser cursor follows
        break;
      }
      case 'panning': {
        this.panBy(screen.x - it.last.x, screen.y - it.last.y);
        it.last = screen;
        break;
      }
      case 'pinch': {
        if (this.pointers.size < 2) break;
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.screen.x - b.screen.x, a.screen.y - b.screen.y);
        const center = { x: (a.screen.x + b.screen.x) / 2, y: (a.screen.y + b.screen.y) / 2 };
        if (it.lastDist > 0) {
          this.camera = zoomAt(this.camera, center, this.camera.zoom * (dist / it.lastDist));
        }
        this.camera = {
          ...this.camera,
          x: this.camera.x - (center.x - it.lastCenter.x) / this.camera.zoom,
          y: this.camera.y - (center.y - it.lastCenter.y) / this.camera.zoom,
        };
        it.lastDist = dist;
        it.lastCenter = center;
        this.cameraChanged();
        break;
      }
      case 'drawing': {
        const events = 'getCoalescedEvents' in e ? e.getCoalescedEvents() : [e];
        for (const ce of events) {
          const w = this.toWorld(ce);
          const pressure = ce.pressure > 0 && ce.pointerType !== 'mouse' ? ce.pressure : 0.5;
          const last = it.points[it.points.length - 1];
          if (Math.hypot(w.x - last.x, w.y - last.y) * this.camera.zoom < 0.75) continue;
          it.points.push({ x: w.x, y: w.y, p: pressure });
        }
        it.lastWorld = world;
        this.overlayDirty = true;
        break;
      }
      case 'erasing': {
        this.eraseAt(it.lastWorld, world);
        it.lastWorld = world;
        this.overlayDirty = true;
        break;
      }
      case 'marquee': {
        it.current = world;
        this.overlayDirty = true;
        break;
      }
      case 'translating': {
        let dx = world.x - it.startWorld.x;
        let dy = world.y - it.startWorld.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.5) it.moved = true;

        this.snapGuides = [];
        if (ui.snapEnabled && !e.metaKey && it.origins.size > 0) {
          const movingBoxes: Box[] = [];
          for (const orig of it.origins.values()) {
            if (orig.type === 'connector') continue;
            const b = aabbOf(orig, (id) => it.origins.get(id) ?? this.doc.get(id));
            movingBoxes.push({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });
          }
          if (movingBoxes.length) {
            const union = boxUnion(movingBoxes);
            const res = snapBox(this.doc, union, new Set(it.origins.keys()), 8 / this.camera.zoom);
            dx += res.dx;
            dy += res.dy;
            this.snapGuides = res.guides;
          }
        }
        if (ui.gridSnap) {
          const first = [...it.origins.values()][0];
          if (first) {
            dx = snapToGrid(first.x + dx) - first.x;
            dy = snapToGrid(first.y + dy) - first.y;
          }
        }

        const updates: SlateObj[] = [];
        for (const [id, orig] of it.origins) {
          if (orig.type === 'connector') {
            const c = orig as ConnectorObj;
            const next = structuredClone(c);
            if (!next.from.objectId && next.from.point)
              next.from.point = { x: c.from.point!.x + dx, y: c.from.point!.y + dy };
            if (!next.to.objectId && next.to.point)
              next.to.point = { x: c.to.point!.x + dx, y: c.to.point!.y + dy };
            next.x = c.x + dx;
            next.y = c.y + dy;
            updates.push(next);
          } else {
            updates.push({ ...structuredClone(orig), x: orig.x + dx, y: orig.y + dy });
          }
        }
        this.doc.setMany(updates);
        this.overlayDirty = true;
        break;
      }
      case 'resizing': {
        this.applyResize(it, world, e.shiftKey);
        break;
      }
      case 'rotating': {
        const angle = Math.atan2(world.y - it.center.y, world.x - it.center.x) + Math.PI / 2;
        const rot = e.shiftKey ? snapAngle(angle) : Math.abs(angle % (Math.PI / 12)) < 0.04 ? snapAngle(angle) : angle;
        this.doc.setMany([{ ...structuredClone(it.origin), rotation: rot }]);
        this.overlayDirty = true;
        break;
      }
      case 'shaping': {
        const o = this.doc.get(it.id) as ShapeObj | undefined;
        if (!o) break;
        let { box } = dragBox(it.start, world, e.shiftKey);
        if (ui.gridSnap) box = snapBoxToGrid(box);
        this.doc.setMany([{ ...o, x: box.x, y: box.y, w: box.w, h: box.h }]);
        break;
      }
      case 'framing': {
        const o = this.doc.get(it.id) as FrameObj | undefined;
        if (!o) break;
        const { box } = dragBox(it.start, world, e.shiftKey);
        this.doc.setMany([{ ...o, x: box.x, y: box.y, w: box.w, h: box.h }]);
        break;
      }
      case 'endpointing': {
        const c = this.doc.get(it.id) as ConnectorObj | undefined;
        if (!c) break;
        const otherEnd = it.end === 'from' ? c.to : c.from;
        const hit = this.attachAllowed(e)
          ? this.findAttachTarget(world, otherEnd.objectId ?? undefined)
          : null;
        let end: ConnectorObj['from'];
        if (hit) {
          end = { objectId: hit.id, anchor: nearestAnchor(boundsOf(hit, this.doc.resolve), world) };
          this.hoverAnchors = { objectId: hit.id, box: boundsOf(hit, this.doc.resolve) };
        } else {
          let p = world;
          if (e.shiftKey) {
            // snap the line's angle to 15° steps around the other endpoint
            const pts = routeConnector(c, this.doc.resolve);
            const anchor = it.end === 'from' ? pts[pts.length - 1] : pts[0];
            const d = Math.hypot(world.x - anchor.x, world.y - anchor.y);
            const ang = snapAngle(Math.atan2(world.y - anchor.y, world.x - anchor.x));
            p = { x: anchor.x + d * Math.cos(ang), y: anchor.y + d * Math.sin(ang) };
          }
          end = { point: p };
          this.hoverAnchors = null;
        }
        this.doc.setMany([{ ...structuredClone(c), [it.end]: end }]);
        this.overlayDirty = true;
        break;
      }
      case 'connecting': {
        const c = this.doc.get(it.id) as ConnectorObj | undefined;
        if (!c) break;
        const hit = this.attachAllowed(e) ? this.findAttachTarget(world, it.from.objectId) : null;
        let to: ConnectorObj['to'];
        if (hit) {
          const b = boundsOf(hit, this.doc.resolve);
          const anchor = nearestAnchor(b, world);
          to = { objectId: hit.id, anchor };
          it.hover = { objectId: hit.id, anchor };
        } else {
          to = { point: world };
          it.hover = null;
        }
        this.doc.setMany([{ ...structuredClone(c), to }]);
        this.overlayDirty = true;
        break;
      }
    }
  }

  handlePointerUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    const it = this.interaction;
    const ui = useUI.getState();

    switch (it.kind) {
      case 'drawing':
        this.commitStroke(it.points);
        break;
      case 'erasing':
        this.doc.commit();
        break;
      case 'marquee': {
        const box = normBox(it.start, it.current);
        const hits = this.doc
          .search(box)
          .filter((o) => !o.locked)
          .filter((o) => {
            const b = aabbOf(o, this.doc.resolve);
            if (o.type === 'frame') return boxContains(box, b);
            return boxesIntersect(b, box);
          });
        for (const h of hits) {
          for (const id of this.expandGroup(h)) this.selection.add(id);
        }
        this.syncSelection();
        break;
      }
      case 'translating': {
        if (it.moved) {
          this.reassignFrameParents(new Set(it.origins.keys()));
          this.doc.commit();
        } else {
          this.doc.abort();
          // click (no drag) on one object inside a multi-selection → select just it
          if (it.clickIds) {
            this.selection = new Set(it.clickIds);
            this.syncSelection();
          }
        }
        this.snapGuides = [];
        break;
      }
      case 'resizing':
      case 'rotating':
        this.doc.commit();
        break;
      case 'endpointing':
        this.doc.commit();
        this.hoverAnchors = null;
        break;
      case 'shaping': {
        const o = this.doc.get(it.id) as ShapeObj | undefined;
        if (o && (o.w < 4 || o.h < 4)) {
          // click without drag → default-size shape centered on click
          this.doc.setMany([{ ...o, x: o.x - 80, y: o.y - 50, w: 160, h: 100 }]);
        }
        this.doc.commit();
        this.selection = new Set([it.id]);
        this.syncSelection();
        useUI.getState().set({ tool: 'select' });
        break;
      }
      case 'framing': {
        const o = this.doc.get(it.id) as FrameObj | undefined;
        if (o && (o.w < 8 || o.h < 8)) {
          this.doc.setMany([{ ...o, x: o.x - 400, y: o.y - 250, w: 800, h: 500 }]);
        }
        this.doc.commit();
        if (o) this.adoptFrameChildren(o.id);
        this.selection = new Set([it.id]);
        this.syncSelection();
        useUI.getState().set({ tool: 'select' });
        break;
      }
      case 'connecting': {
        const c = this.doc.get(it.id) as ConnectorObj | undefined;
        if (c) {
          const pts = routeConnector(c, this.doc.resolve);
          const len = Math.hypot(
            pts[pts.length - 1].x - pts[0].x,
            pts[pts.length - 1].y - pts[0].y
          );
          if (len < 4 && !c.to.objectId) {
            this.doc.delete(c.id);
          } else {
            this.selection = new Set([c.id]);
            this.syncSelection();
          }
        }
        this.doc.commit();
        if (ui.tool === 'line') useUI.getState().set({ tool: 'select' });
        break;
      }
    }
    if (this.pointers.size === 0 || it.kind === 'pinch') {
      this.interaction = this.pointers.size >= 2 ? this.interaction : { kind: 'idle' };
    }
    this.overlayDirty = true;
  }

  handleDoubleClick(e: MouseEvent) {
    const world = this.toWorld(e);
    const ui = useUI.getState();
    if (ui.tool !== 'select') return;
    const hit = hitTest(this.doc, world, 6 / this.camera.zoom);
    if (hit && (hit.type === 'shape' || hit.type === 'sticky' || hit.type === 'text')) {
      this.selection = new Set([hit.id]);
      this.syncSelection();
      this.startEditingText(hit.id);
      return;
    }
    if (!hit) this.placeText(world);
  }

  handleWheel(e: WheelEvent) {
    e.preventDefault();
    const screen = this.toScreen(e);
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.002));
      this.camera = zoomAt(this.camera, screen, this.camera.zoom * factor);
      this.cameraChanged();
    } else {
      this.panBy(-e.deltaX, -e.deltaY);
    }
  }

  setSpaceDown(down: boolean) {
    this.spaceDown = down;
  }

  // ---------- tool internals ----------

  private commitStroke(points: InputPoint[]) {
    if (points.length < 2) {
      // dot: synthesize a tiny segment so a tap leaves a mark
      const p = points[0];
      if (!p) return;
      points = [p, { x: p.x + 0.1, y: p.y + 0.1, p: p.p }];
    }
    const ui = useUI.getState();
    const pad = ui.penSize * 2 + 4;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const x = minX - pad;
    const y = minY - pad;
    const flat: number[] = [];
    for (const p of points) flat.push(p.x - x, p.y - y, p.p);
    const obj: StrokeObj = {
      id: nanoid(8),
      type: 'stroke',
      tool: ui.penTool,
      color: ui.penColor,
      size: ui.penSize,
      opacity: ui.penOpacity,
      x,
      y,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
      points: flat,
      rotation: 0,
      z: this.doc.nextZ(),
    };
    this.doc.set(obj);
  }

  private eraseAt(from: Vec, to: Vec) {
    const it = this.interaction;
    if (it.kind !== 'erasing') return;
    const radius = 10 / this.camera.zoom;
    for (const s of strokesHitBySegment(this.doc, from, to, radius)) {
      if (!it.erased.has(s.id)) {
        it.erased.add(s.id);
        this.doc.delete(s.id);
      }
    }
  }

  private placeSticky(world: Vec) {
    const ui = useUI.getState();
    const obj: StickyObj = {
      id: nanoid(8),
      type: 'sticky',
      x: world.x - 90,
      y: world.y - 90,
      w: 180,
      h: 180,
      rotation: 0,
      z: this.doc.nextZ(),
      color: ui.stickyColor,
      text: '',
      fontSize: 18,
      fontFamily: ui.fontFamily,
    };
    this.doc.set(obj);
    this.selection = new Set([obj.id]);
    this.syncSelection();
    useUI.getState().set({ tool: 'select', editingTextId: obj.id });
  }

  private placeText(world: Vec) {
    const ui = useUI.getState();
    const obj: TextObj = {
      id: nanoid(8),
      type: 'text',
      x: world.x,
      y: world.y - ui.fontSize * 0.6,
      w: 12,
      h: Math.round(ui.fontSize * 1.35),
      rotation: 0,
      z: this.doc.nextZ(),
      text: '',
      color: ui.penColor,
      fontSize: ui.fontSize,
      fontFamily: ui.fontFamily,
      fixedWidth: false,
    };
    this.doc.set(obj);
    this.selection = new Set([obj.id]);
    this.syncSelection();
    useUI.getState().set({ tool: 'select', editingTextId: obj.id });
  }

  /**
   * Object a connector endpoint should attach to: a direct hit, or — magnetically —
   * the nearest attachable object within ~36 screen px, so snapping doesn't require
   * pixel-perfect aim.
   */
  /** Attachment is suppressed by the UI toggle or by holding Alt/Option while drawing. */
  private attachAllowed(e: { altKey: boolean }): boolean {
    return useUI.getState().attachEnabled && !e.altKey;
  }

  private findAttachTarget(world: Vec, excludeId?: string | null): SlateObj | null {
    const attachable = (o: SlateObj) =>
      !o.locked && o.id !== excludeId && o.type !== 'connector' && o.type !== 'stroke' && o.type !== 'frame';
    const hit = hitTest(this.doc, world, 8 / this.camera.zoom, { ignoreFrames: true, solidShapes: true });
    if (hit && attachable(hit)) return hit;
    const r = 36 / this.camera.zoom;
    let best: SlateObj | null = null;
    let bestD = Infinity;
    for (const o of this.doc.search({ x: world.x - r, y: world.y - r, w: r * 2, h: r * 2 })) {
      if (!attachable(o)) continue;
      const b = boundsOf(o, this.doc.resolve);
      const dx = Math.max(b.x - world.x, 0, world.x - (b.x + b.w));
      const dy = Math.max(b.y - world.y, 0, world.y - (b.y + b.h));
      const d = Math.hypot(dx, dy);
      if (d <= r && d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private beginConnector(world: Vec, tool: 'line' | 'connector', allowAttach = true) {
    const ui = useUI.getState();
    const hit = allowAttach ? this.findAttachTarget(world) : null;
    let from: ConnectorObj['from'];
    if (hit) {
      from = { objectId: hit.id, anchor: nearestAnchor(boundsOf(hit, this.doc.resolve), world) };
    } else {
      from = { point: world };
    }
    const obj: ConnectorObj = {
      id: nanoid(8),
      type: 'connector',
      x: world.x,
      y: world.y,
      rotation: 0,
      z: this.doc.nextZ(),
      from,
      to: { point: world },
      routing: tool === 'line' ? 'straight' : ui.routing,
      stroke: ui.stroke,
      strokeWidth: ui.strokeWidth,
      dash: ui.dash,
      startArrow: 'none',
      endArrow: tool === 'line' ? 'none' : 'triangle',
      opacity: 1,
    };
    this.doc.begin();
    this.doc.set(obj);
    this.interaction = { kind: 'connecting', id: obj.id, from, hover: null };
  }

  private applyResize(
    it: Extract<Interaction, { kind: 'resizing' }>,
    world: Vec,
    uniform: boolean
  ) {
    const { startBox, handle } = it;
    if (startBox.w < 1 || startBox.h < 1) return;

    // fixed point = handle's opposite corner/edge
    const fx = handle.includes('w') ? startBox.x + startBox.w : handle.includes('e') ? startBox.x : startBox.x + startBox.w / 2;
    const fy = handle.includes('n') ? startBox.y + startBox.h : handle.includes('s') ? startBox.y : startBox.y + startBox.h / 2;

    let sx = handle.includes('e') || handle.includes('w') ? (world.x - fx) / (it.startWorld.x - fx || 1) : 1;
    let sy = handle.includes('n') || handle.includes('s') ? (world.y - fy) / (it.startWorld.y - fy || 1) : 1;

    const corner = handle.length === 2;
    if (corner && (uniform || this.multiResize(it))) {
      const s = Math.max(Math.abs(sx), Math.abs(sy));
      sx = Math.sign(sx || 1) * s;
      sy = Math.sign(sy || 1) * s;
    }
    sx = clampScale(sx);
    sy = clampScale(sy);

    const updates: SlateObj[] = [];
    for (const orig of it.origins.values()) {
      const next = structuredClone(orig);
      const b = boundsOf(orig, (id) => it.origins.get(id) ?? this.doc.get(id));
      const nx = fx + (b.x - fx) * sx;
      const ny = fy + (b.y - fy) * sy;
      const nw = b.w * Math.abs(sx);
      const nh = b.h * Math.abs(sy);
      next.x = sx < 0 ? nx - nw : nx;
      next.y = sy < 0 ? ny - nh : ny;
      if (next.type === 'stroke') {
        const s = next as StrokeObj;
        const scaled: number[] = [];
        for (let i = 0; i < s.points.length; i += 3) {
          scaled.push(s.points[i] * Math.abs(sx), s.points[i + 1] * Math.abs(sy), s.points[i + 2]);
        }
        s.points = scaled;
        s.w = nw;
        s.h = nh;
        s.size = Math.max(0.5, s.size * (Math.abs(sx) + Math.abs(sy)) / 2);
      } else if (next.type === 'text') {
        const t = next as TextObj;
        t.fontSize = Math.max(6, t.fontSize * Math.abs(sy));
        const m = textBlockSize(t.text || ' ', t.fontSize, t.fixedWidth ? nw : undefined, 400, t.fontFamily);
        t.w = t.fixedWidth ? nw : m.w;
        t.h = m.h;
      } else if ('w' in next && 'h' in next) {
        (next as ShapeObj).w = Math.max(8, nw);
        (next as ShapeObj).h = Math.max(8, nh);
      }
      updates.push(next);
    }
    this.doc.setMany(updates);
    this.overlayDirty = true;
  }

  private multiResize(it: Extract<Interaction, { kind: 'resizing' }>): boolean {
    return it.origins.size > 1 || [...it.origins.values()].some((o) => o.type === 'stroke' || o.type === 'image');
  }

  private reassignFrameParents(movedIds: Set<string>) {
    const frames = this.doc.all().filter((o): o is FrameObj => o.type === 'frame');
    if (frames.length === 0) return;
    for (const id of movedIds) {
      const o = this.doc.get(id);
      if (!o || o.type === 'frame' || o.type === 'connector') continue;
      const b = aabbOf(o, this.doc.resolve);
      let parent: string | null = null;
      for (const f of frames) {
        if (movedIds.has(f.id)) continue;
        if (boxContains(boundsOf(f, this.doc.resolve), b)) parent = f.id;
      }
      if ((o.parentId ?? null) !== parent) this.doc.update(id, { parentId: parent });
    }
  }

  private adoptFrameChildren(frameId: string) {
    const f = this.doc.get(frameId);
    if (!f || f.type !== 'frame') return;
    const fb = boundsOf(f, this.doc.resolve);
    this.doc.begin();
    for (const o of this.doc.search(fb)) {
      if (o.id === frameId || o.type === 'frame' || o.type === 'connector') continue;
      if (boxContains(fb, aabbOf(o, this.doc.resolve))) this.doc.update(o.id, { parentId: frameId });
    }
    this.doc.commit();
  }

  // ---------- overlay drawing (selection chrome, live ink, guides) ----------

  private drawOverlay() {
    const ctx = this.overlayCtx;
    const cam = this.camera;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    const it = this.interaction;
    const ui = useUI.getState();

    // live ink
    if (it.kind === 'drawing' && it.points.length > 0) {
      ctx.save();
      ctx.setTransform(
        this.dpr * cam.zoom, 0, 0, this.dpr * cam.zoom,
        -cam.x * this.dpr * cam.zoom, -cam.y * this.dpr * cam.zoom
      );
      const cfg = useUI.getState();
      const outline = strokeOutline(it.points, cfg.penTool, cfg.penSize, cfg.smoothing);
      ctx.globalAlpha = cfg.penOpacity * (cfg.penTool === 'marker' ? 0.45 : cfg.penTool === 'pencil' ? 0.85 : 1);
      if (cfg.penTool === 'marker') ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = cfg.penColor;
      ctx.fill(outlineToPath(outline));
      ctx.restore();
    }

    // marquee
    if (it.kind === 'marquee') {
      const a = this.worldToScreenPt(it.start);
      const b = this.worldToScreenPt(it.current);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      ctx.fillStyle = 'rgba(60,120,255,0.08)';
      ctx.strokeStyle = 'rgba(60,120,255,0.6)';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }

    // snap guides
    if (this.snapGuides.length) {
      ctx.strokeStyle = '#ff4dac';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (const g of this.snapGuides) {
        ctx.beginPath();
        if (g.axis === 'x') {
          const s = this.worldToScreenPt({ x: g.pos, y: g.from });
          const t = this.worldToScreenPt({ x: g.pos, y: g.to });
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
        } else {
          const s = this.worldToScreenPt({ x: g.from, y: g.pos });
          const t = this.worldToScreenPt({ x: g.to, y: g.pos });
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // anchor hints for connector tool
    if (this.hoverAnchors || (it.kind === 'connecting' && it.hover)) {
      const targetId = it.kind === 'connecting' && it.hover ? it.hover.objectId : this.hoverAnchors?.objectId;
      const target = targetId ? this.doc.get(targetId) : null;
      if (target) {
        const b = boundsOf(target, this.doc.resolve);
        ctx.fillStyle = '#3c78ff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        for (const side of ['left', 'right', 'top', 'bottom'] as AnchorSide[]) {
          const p = this.worldToScreenPt(anchorPoint(b, side));
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // eraser cursor
    if (ui.tool === 'eraser') {
      const last = [...this.pointers.values()][0];
      if (last || it.kind === 'erasing') {
        const p = last ? last.screen : null;
        if (p) {
          ctx.strokeStyle = 'rgba(40,40,40,0.7)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // selection box + handles
    if (this.selection.size > 0 && ui.editingTextId === null) {
      const objs = this.selectedObjects();
      if (objs.length) {
        ctx.strokeStyle = '#3c78ff';
        ctx.lineWidth = 1.25;
        // per-object outline
        for (const o of objs) {
          const b = boundsOf(o, this.doc.resolve);
          const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
          const corners = [
            { x: b.x, y: b.y },
            { x: b.x + b.w, y: b.y },
            { x: b.x + b.w, y: b.y + b.h },
            { x: b.x, y: b.y + b.h },
          ].map((p) => this.worldToScreenPt(rotatePoint(p, c, o.rotation)));
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
          ctx.closePath();
          ctx.globalAlpha = 0.55;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        // endpoint handles for a single selected connector (drag to angle / re-attach)
        if (objs.length === 1 && objs[0].type === 'connector') {
          const pts = routeConnector(objs[0], this.doc.resolve);
          for (const p of [pts[0], pts[pts.length - 1]]) {
            const s = this.worldToScreenPt(p);
            ctx.beginPath();
            ctx.arc(s.x, s.y, 5.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#3c78ff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
        // group bounds + handles
        const nonConn = objs.filter((o) => o.type !== 'connector');
        if (nonConn.length) {
          const union = boxUnion(nonConn.map((o) => aabbOf(o, this.doc.resolve)));
          const tl = this.worldToScreenPt({ x: union.x, y: union.y });
          const br = this.worldToScreenPt({ x: union.x + union.w, y: union.y + union.h });
          ctx.strokeStyle = '#3c78ff';
          ctx.lineWidth = 1.25;
          ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
          for (const [, hx, hy] of this.handlePositions(tl, br)) {
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#3c78ff';
            ctx.beginPath();
            ctx.rect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
            ctx.fill();
            ctx.stroke();
          }
          // rotate handle for single object
          if (nonConn.length === 1) {
            const rx = (tl.x + br.x) / 2;
            const ry = tl.y - 24;
            ctx.beginPath();
            ctx.moveTo(rx, tl.y);
            ctx.lineTo(rx, ry + 6);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(rx, ry, 5.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.stroke();
          }
        }
      }
    }
  }

  private handlePositions(tl: Vec, br: Vec): [HandleId, number, number][] {
    const mx = (tl.x + br.x) / 2;
    const my = (tl.y + br.y) / 2;
    return [
      ['nw', tl.x, tl.y],
      ['n', mx, tl.y],
      ['ne', br.x, tl.y],
      ['e', br.x, my],
      ['se', br.x, br.y],
      ['s', mx, br.y],
      ['sw', tl.x, br.y],
      ['w', tl.x, my],
    ];
  }

  private handleAt(screen: Vec): HandleId | null {
    const nonConn = this.selectedObjects().filter((o) => o.type !== 'connector');
    if (nonConn.length === 0) return null;
    const union = boxUnion(nonConn.map((o) => aabbOf(o, this.doc.resolve)));
    const tl = this.worldToScreenPt({ x: union.x, y: union.y });
    const br = this.worldToScreenPt({ x: union.x + union.w, y: union.y + union.h });
    const R = HANDLE_SIZE;
    if (nonConn.length === 1) {
      const rx = (tl.x + br.x) / 2;
      const ry = tl.y - 24;
      if (Math.hypot(screen.x - rx, screen.y - ry) < R) return 'rotate';
    }
    for (const [id, hx, hy] of this.handlePositions(tl, br)) {
      if (Math.abs(screen.x - hx) < R && Math.abs(screen.y - hy) < R) return id;
    }
    return null;
  }

  // ---------- minimap data ----------

  minimapData(): { boxes: { b: Box; type: string }[]; world: Box; view: Box } {
    const objs = this.doc.all();
    const boxes = objs.map((o) => ({ b: aabbOf(o, this.doc.resolve), type: o.type }));
    const world = boxes.length
      ? boxUnion(boxes.map((x) => x.b))
      : { x: -500, y: -500, w: 1000, h: 1000 };
    return { boxes, world, view: visibleWorldRect(this.camera, this.viewW, this.viewH) };
  }
}

// ---------- small helpers ----------

function remapEnd(
  end: ConnectorObj['from'],
  idMap: Map<string, string>,
  dx: number,
  dy: number
): ConnectorObj['from'] {
  if (end.objectId && idMap.has(end.objectId)) {
    return { objectId: idMap.get(end.objectId)!, anchor: end.anchor };
  }
  if (end.point) return { point: { x: end.point.x + dx, y: end.point.y + dy } };
  return { ...end, objectId: undefined };
}

function normBox(a: Vec, b: Vec): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function dragBox(start: Vec, current: Vec, square: boolean): { box: Box } {
  let w = current.x - start.x;
  let h = current.y - start.y;
  if (square) {
    const s = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * s;
    h = Math.sign(h || 1) * s;
  }
  return {
    box: {
      x: w < 0 ? start.x + w : start.x,
      y: h < 0 ? start.y + h : start.y,
      w: Math.abs(w),
      h: Math.abs(h),
    },
  };
}

function snapBoxToGrid(b: Box): Box {
  return { x: snapToGrid(b.x), y: snapToGrid(b.y), w: Math.max(8, snapToGrid(b.w)), h: Math.max(8, snapToGrid(b.h)) };
}

function clampScale(s: number): number {
  if (!isFinite(s) || Math.abs(s) < 0.02) return 0.02;
  return s;
}

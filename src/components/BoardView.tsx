import { useEffect, useRef, useState } from 'react';
import { goHome } from '../App';
import { Controller } from '../engine/controller';
import { configureImageLoading } from '../engine/renderer';
import { getBlob, putBlob, db, loadBoardObjects, startAutosave, updateBoardMeta, resolveBoardKit } from '../store/db';
import { useUI } from '../store/ui';
import { setCanvasDark } from '../store/theme';
import type { ToolId } from '../types';
import Toolbar from './Toolbar';
import StyleBar from './StyleBar';
import ZoomBar from './ZoomBar';
import Minimap from './Minimap';
import TextEditor from './TextEditor';
import { StickyReader } from './StickyReader';
import TopBar from './TopBar';
import NotesPanel from './NotesPanel';
import IconTray from './IconTray';
import { stopAllSchedules } from '../ui/ainodes';
import { isUploadable, readUpload, uploadLabel } from '../ui/upload';
import { UPLOAD_ACCEPT } from '../ui/aiNodeButtons';
import CommandPalette from './CommandPalette';
import AIPanel from '../ai/AIPanel';
import RunButtons from '../ui/aiNodeButtons';
import DataNodeEditor from '../ui/DataNodeEditor';
import ImageActions from '../ui/imageActions';
import FrameTitle from '../ui/frameTitle';
import UsageMeter from './UsageMeter';
import { exportBounds, exportPng } from '../export/export';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  h: 'hand',
  p: 'pen',
  e: 'eraser',
  r: 'rect',
  o: 'ellipse',
  d: 'diamond',
  l: 'line',
  c: 'connector',
  s: 'sticky',
  t: 'text',
  f: 'frame',
};

export default function BoardView({ boardId }: { boardId: string }) {
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [ctl, setCtl] = useState<Controller | null>(null);
  const [loaded, setLoaded] = useState(false);
  const editingTextId = useUI((s) => s.editingTextId);
  const readerObjectId = useUI((s) => s.readerObjectId);
  const canvasDark = useUI((s) => s.canvasDark);
  const tool = useUI((s) => s.tool);

  // ---------- controller lifecycle ----------
  useEffect(() => {
    const scene = sceneRef.current!;
    const overlay = overlayRef.current!;
    const controller = new Controller(scene, overlay);
    configureImageLoading(getBlob, controller.markSceneDirty);

    const root = rootRef.current!;
    const ro = new ResizeObserver(() => {
      controller.resize(root.clientWidth, root.clientHeight);
    });
    ro.observe(root);
    controller.resize(root.clientWidth, root.clientHeight);

    let autosave: { flush: () => Promise<void>; dispose: () => Promise<void> } | null = null;
    let cancelled = false;

    (async () => {
      const meta = await db.boards.get(boardId);
      if (!meta) {
        goHome();
        return;
      }
      const objects = await loadBoardObjects(boardId);
      if (cancelled) return;
      controller.doc.load(objects);
      controller.doc.dirty.clear(); // loading isn't an edit
      controller.setCamera(meta.viewport);
      const kit = await resolveBoardKit(meta);
      setCanvasDark(!!meta.canvasDark);
      useUI.getState().set({ boardName: meta.name, selection: [], editingTextId: null, activeBrandKit: kit ?? null, canvasDark: !!meta.canvasDark });
      useUI.getState().syncCanvasInk(!!meta.canvasDark);
      autosave = startAutosave(controller.doc, boardId);
      setLoaded(true);
    })();

    // persist viewport (debounced)
    let vpTimer: ReturnType<typeof setTimeout> | null = null;
    controller.onViewportChanged = () => {
      if (vpTimer) clearTimeout(vpTimer);
      vpTimer = setTimeout(() => {
        void updateBoardMeta(boardId, { viewport: { ...controller.camera } });
      }, 500);
    };

    setCtl(controller);

    return () => {
      cancelled = true;
      stopAllSchedules(); // don't let interval/timer nodes keep ticking after leaving the board
      ro.disconnect();
      // final flush + thumbnail
      (async () => {
        await autosave?.dispose();
        try {
          const box = exportBounds(controller.doc);
          if (box) {
            const scale = Math.min(1, 480 / Math.max(box.w, box.h));
            const blob = await exportPng(controller.doc, box, scale, false);
            const thumb = await new Promise<string>((res) => {
              const r = new FileReader();
              r.onload = () => res(r.result as string);
              r.readAsDataURL(blob);
            });
            await updateBoardMeta(boardId, { thumb });
          }
        } catch {
          // thumbnails are best-effort
        }
      })();
      controller.dispose();
    };
  }, [boardId]);

  // re-render the scene when text editing starts/stops (text is hidden under the editor)
  useEffect(() => {
    ctl?.markSceneDirty();
  }, [ctl, editingTextId]);

  // ---------- pointer + wheel wiring ----------
  useEffect(() => {
    if (!ctl) return;
    const overlay = overlayRef.current!;
    const down = (e: PointerEvent) => {
      if (e.button === 2) return;
      ctl.handlePointerDown(e);
    };
    const move = (e: PointerEvent) => ctl.handlePointerMove(e);
    const up = (e: PointerEvent) => ctl.handlePointerUp(e);
    const dbl = (e: MouseEvent) => ctl.handleDoubleClick(e);
    const wheel = (e: WheelEvent) => ctl.handleWheel(e);
    const ctxMenu = (e: Event) => e.preventDefault();
    // keep focus where it is (e.g. the text editor) — focus changes are managed explicitly
    const mouseDown = (e: MouseEvent) => e.preventDefault();

    overlay.addEventListener('mousedown', mouseDown);
    overlay.addEventListener('pointerdown', down);
    overlay.addEventListener('pointermove', move);
    overlay.addEventListener('pointerup', up);
    overlay.addEventListener('pointercancel', up);
    overlay.addEventListener('dblclick', dbl);
    overlay.addEventListener('wheel', wheel, { passive: false });
    overlay.addEventListener('contextmenu', ctxMenu);
    return () => {
      overlay.removeEventListener('mousedown', mouseDown);
      overlay.removeEventListener('pointerdown', down);
      overlay.removeEventListener('pointermove', move);
      overlay.removeEventListener('pointerup', up);
      overlay.removeEventListener('pointercancel', up);
      overlay.removeEventListener('dblclick', dbl);
      overlay.removeEventListener('wheel', wheel);
      overlay.removeEventListener('contextmenu', ctxMenu);
    };
  }, [ctl]);

  // ---------- keyboard ----------
  useEffect(() => {
    if (!ctl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      const target = e.target as HTMLElement;
      const typing =
        ui.editingTextId !== null ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      if (typing) {
        if (e.key === 'Escape') useUI.getState().set({ editingTextId: null });
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (mod && k === 'k') {
        e.preventDefault();
        useUI.getState().set({ paletteOpen: !useUI.getState().paletteOpen });
        return;
      }
      if (mod && k === 'j') {
        e.preventDefault();
        useUI.getState().set({ notesOpen: true });
        return;
      }

      if (e.code === 'Space') {
        ctl.setSpaceDown(true);
        return;
      }
      if (mod && k === 'z') {
        e.preventDefault();
        e.shiftKey ? ctl.redo() : ctl.undo();
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        ctl.selectAll();
        return;
      }
      if (mod && k === 'c') {
        e.preventDefault();
        ctl.copySelection();
        return;
      }
      if (mod && k === 'x') {
        e.preventDefault();
        ctl.cutSelection();
        return;
      }
      // ⌘V is handled by the native 'paste' event so image/text clipboard content works
      if (mod && k === 'd') {
        e.preventDefault();
        ctl.duplicateSelection();
        return;
      }
      if (mod && k === 'g') {
        e.preventDefault();
        e.shiftKey ? ctl.ungroupSelection() : ctl.groupSelection();
        return;
      }
      if (mod && (k === '=' || k === '+')) {
        e.preventDefault();
        ctl.zoomTo(ctl.camera.zoom * 1.25);
        return;
      }
      if (mod && k === '-') {
        e.preventDefault();
        ctl.zoomTo(ctl.camera.zoom / 1.25);
        return;
      }
      if (mod && k === '0') {
        e.preventDefault();
        ctl.zoomTo(1);
        return;
      }
      if (mod && k === 'l') {
        e.preventDefault();
        ctl.toggleLockSelection();
        return;
      }
      if (mod && k === ']') {
        e.preventDefault();
        ctl.reorderSelection(e.shiftKey ? 'front' : 'forward');
        return;
      }
      if (mod && k === '[') {
        e.preventDefault();
        ctl.reorderSelection(e.shiftKey ? 'back' : 'backward');
        return;
      }
      if (mod) return;

      if (e.key === 'Backspace' || e.key === 'Delete') {
        ctl.deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        ctl.clearSelection();
        useUI.getState().set({ tool: 'select' });
        return;
      }
      if (e.key === 'Enter' && ui.selection.length === 1) {
        e.preventDefault();
        ctl.startEditingText(ui.selection[0]);
        return;
      }
      if (e.shiftKey && e.key === '!') {
        ctl.zoomToFit();
        return;
      }
      if (e.shiftKey && e.key === '@') {
        ctl.zoomToSelection();
        return;
      }
      if (k === '+' || k === '=') {
        ctl.zoomTo(ctl.camera.zoom * 1.25);
        return;
      }
      if (k === '-') {
        ctl.zoomTo(ctl.camera.zoom / 1.25);
        return;
      }
      // arrow-key nudge
      const NUDGE = e.shiftKey ? 10 : 1;
      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-NUDGE, 0],
        ArrowRight: [NUDGE, 0],
        ArrowUp: [0, -NUDGE],
        ArrowDown: [0, NUDGE],
      };
      if (nudges[e.key] && ui.selection.length) {
        e.preventDefault();
        const [dx, dy] = nudges[e.key];
        ctl.doc.begin();
        for (const o of ctl.selectedObjects()) {
          ctl.doc.update(o.id, { x: o.x + dx, y: o.y + dy });
        }
        ctl.doc.commit();
        return;
      }
      if (k === 'i' && !e.shiftKey) {
        useUI.getState().set({ iconTrayOpen: !useUI.getState().iconTrayOpen });
        return;
      }
      if (k === 'u' && !e.shiftKey) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = UPLOAD_ACCEPT;
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const payload = await readUpload(file);
            ctl.addUploadNode(payload, uploadLabel(payload));
          } catch (err) {
            ctl.addTextAtCenter(`⚠ Couldn't read ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        };
        input.click();
        return;
      }
      if (TOOL_KEYS[k] && !e.shiftKey) {
        useUI.getState().set({ tool: TOOL_KEYS[k] });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') ctl.setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [ctl]);

  // ---------- paste / drop images ----------
  useEffect(() => {
    if (!ctl) return;
    const addImageFile = async (file: File, at?: { x: number; y: number }) => {
      const blobId = await putBlob(file);
      const bmp = await createImageBitmap(file);
      ctl.addImage(blobId, { w: bmp.width, h: bmp.height }, at);
    };
    const addUploadFile = async (file: File, at?: { x: number; y: number }) => {
      try {
        const payload = await readUpload(file);
        ctl.addUploadNode(payload, uploadLabel(payload), at);
      } catch (err) {
        ctl.addTextAtCenter(`⚠ Couldn't read ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const ui = useUI.getState();
      if (ui.editingTextId) return; // textarea handles its own paste
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      e.preventDefault();

      // 1. images from the system clipboard (screenshots, copied images)
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              void addImageFile(file);
              return;
            }
          }
        }
      }
      // 2. Slate objects copied with ⌘C
      if (ctl.hasClipboard()) {
        ctl.paste();
        return;
      }
      // 3. plain text → a text object at the viewport center
      const text = e.clipboardData?.getData('text/plain');
      if (text?.trim()) ctl.addTextAtCenter(text);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      const at = ctl.toWorld(e);
      for (const file of files) {
        if (file.type.startsWith('image/')) void addImageFile(file, at);
        else if (isUploadable(file)) void addUploadFile(file, at);
      }
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener('paste', onPaste);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
    };
  }, [ctl]);

  const cursor =
    tool === 'hand'
      ? 'grab'
      : tool === 'pen' || tool === 'eraser'
        ? 'crosshair'
        : tool === 'text'
          ? 'text'
          : tool === 'select'
            ? 'default'
            : 'crosshair';

  return (
    <div className="board-root" ref={rootRef} style={{ background: canvasDark ? '#15151a' : '#f3f2ef' }}>
      <canvas ref={sceneRef} className="layer" />
      <canvas ref={overlayRef} className="layer overlay-canvas" style={{ cursor }} />
      {ctl && loaded && (
        <>
          <TopBar ctl={ctl} boardId={boardId} />
          <Toolbar />
          <StyleBar ctl={ctl} />
          <ZoomBar ctl={ctl} />
          <Minimap ctl={ctl} />
          {editingTextId && <TextEditor key={editingTextId} ctl={ctl} objectId={editingTextId} />}
          {readerObjectId && <StickyReader key={readerObjectId} ctl={ctl} objectId={readerObjectId} />}
          <NotesPanel boardId={boardId} ctl={ctl} />
          <IconTray ctl={ctl} />
          <CommandPalette ctl={ctl} boardId={boardId} />
          <AIPanel ctl={ctl} />
          <RunButtons ctl={ctl} />
          <DataNodeEditor ctl={ctl} />
          <ImageActions ctl={ctl} />
          <FrameTitle ctl={ctl} />
          <UsageMeter />
          {ctl.doc.objects.size === 0 && (
            <div className="hint">Press P and just draw — or double-click anywhere to type. Scroll to pan, pinch to zoom.</div>
          )}
        </>
      )}
    </div>
  );
}

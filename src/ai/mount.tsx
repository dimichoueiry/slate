// Self-mounting AI edit bar (injected by vite-slate-persist).
// Also bridges the live Controller to window.__slateCtl and adjusts frame
// behavior: grabbing a resize handle on a frame selection resizes ONLY the
// frame, never the objects inside it.
import { createRoot } from 'react-dom/client';
import { Controller } from '../engine/controller';
import { useUI } from '../store/ui';
import AIPanel from './AIPanel';
import { tryToggleCheckbox, isOnCheckbox, attachChecklistNormalizer } from '../ui/checkboxes';
import { tryRunAINode, isOnRunGlyph, attachAINodeNormalizer, hiddenNodeAt } from '../ui/ainodes';

const proto = Controller.prototype as any;
if (!proto.__slateBridged) {
  proto.__slateBridged = true;

  // Allow connectors to attach to FRAMES (the engine excludes them by default).
  // Wrap findAttachTarget: if nothing else is hit, grab a nearby frame by its border.
  const origFind = proto.findAttachTarget;
  if (origFind) {
    proto.findAttachTarget = function (world: any, excludeId?: any) {
      const hit = origFind.call(this, world, excludeId);
      if (hit) return hit;
      try {
        const r = 30 / this.camera.zoom;
        let best: any = null;
        let bestD = Infinity;
        for (const o of this.doc.all()) {
          if (o.type !== 'frame' || o.locked || o.id === excludeId) continue;
          const dx = Math.max(o.x - world.x, 0, world.x - (o.x + o.w));
          const dy = Math.max(o.y - world.y, 0, world.y - (o.y + o.h));
          const inside = dx === 0 && dy === 0;
          const d = inside
            ? Math.min(world.x - o.x, o.x + o.w - world.x, world.y - o.y, o.y + o.h - world.y)
            : Math.hypot(dx, dy);
          if (d <= r && d < bestD) {
            bestD = d;
            best = o;
          }
        }
        return best;
      } catch {
        return null;
      }
    };
  }

  const origResize = proto.resize;
  proto.resize = function (...args: unknown[]) {
    (window as any).__slateCtl = this;
    (window as any).__slateUIState = () => useUI.getState();
    if (!(this as any).__cbNormalizer) {
      (this as any).__cbNormalizer = true;
      attachChecklistNormalizer(this);
      attachAINodeNormalizer(this);
      // the retired html-widget type leaves invisible objects behind — sweep them (undoable)
      setTimeout(() => {
        try {
          const stale = this.doc.all().filter((o: any) => o.type === 'html');
          if (stale.length) {
            this.doc.begin();
            for (const o of stale) this.doc.delete(o.id);
            this.doc.commit();
          }
        } catch {
          /* ignore */
        }
      }, 2000);
    }
    return origResize.apply(this, args);
  };

  const origDown = proto.handlePointerDown;
  proto.handlePointerDown = function (e: PointerEvent) {
    try {
      const ui = useUI.getState();
      if (ui.tool === 'select' && !ui.editingTextId && tryToggleCheckbox(this, e)) {
        return; // checkbox click consumed — no select/drag
      }
      if (ui.tool === 'select' && !ui.editingTextId && tryRunAINode(this, e)) {
        return; // run-glyph click consumed
      }
      if (ui.tool === 'select' && !ui.editingTextId && this.selection?.size > 1) {
        const objs = [...this.selection]
          .map((id: string) => this.doc.get(id))
          .filter(Boolean);
        const frames = objs.filter((o: any) => o.type === 'frame');
        if (frames.length === 1) {
          const frame = frames[0];
          const childIds = new Set(this.frameChildren(frame.id).map((o: any) => o.id));
          const onlyFrameContents = objs.every((o: any) => o.id === frame.id || childIds.has(o.id));
          if (onlyFrameContents) {
            const screen = this.toScreen(e);
            const handle = this.handleAt(screen);
            if (handle) {
              // resize/rotate the frame itself — contents stay as they are
              this.selection = new Set([frame.id]);
              this.syncSelection();
            }
          }
        }
      }
    } catch {
      // bridge must never break input handling
    }
    return origDown.call(this, e);
  };
}

if (!(Controller.prototype as any).__slateDblBridged) {
  (Controller.prototype as any).__slateDblBridged = true;
  const origDbl = (Controller.prototype as any).handleDoubleClick;
  (Controller.prototype as any).handleDoubleClick = function (e: MouseEvent) {
    try {
      if (useUI.getState().tool === 'select' && (isOnCheckbox(this, e) || isOnRunGlyph(this, e) || hiddenNodeAt(this, e))) return; // interactive glyphs + locked prompts don't open the editor
    } catch {
      /* never break input */
    }
    return origDbl.call(this, e);
  };
}

const id = 'slate-ai-root';
if (!document.getElementById(id)) {
  const el = document.createElement('div');
  el.id = id;
  document.body.appendChild(el);
  createRoot(el).render(<AIPanel />);
}

export {};

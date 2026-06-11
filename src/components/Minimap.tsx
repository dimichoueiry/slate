import { useEffect, useRef } from 'react';
import type { Controller } from '../engine/controller';
import { useUI } from '../store/ui';

const W = 192;
const H = 128;

const TYPE_COLORS: Record<string, string> = {
  stroke: 'rgba(40,40,50,0.75)',
  shape: 'rgba(25,113,194,0.7)',
  sticky: 'rgba(255,200,60,0.9)',
  text: 'rgba(80,80,90,0.7)',
  image: 'rgba(103,65,217,0.7)',
  connector: 'rgba(120,120,130,0.5)',
  icon: 'rgba(47,158,68,0.7)',
  frame: 'rgba(150,150,160,0.35)',
};

export default function Minimap({ ctl }: { ctl: Controller }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const visible = useUI((s) => s.minimapVisible);

  useEffect(() => {
    if (!visible) return;
    const canvas = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;

    let raf = 0;
    let dirty = true;
    const markDirty = () => (dirty = true);
    const unsubDoc = ctl.doc.subscribe(markDirty);
    const unsubCam = ctl.onCamera(markDirty);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!dirty) return;
      dirty = false;
      const { boxes, world, view } = ctl.minimapData();
      // include the viewport in the fitted area so the view rect is always visible
      const minX = Math.min(world.x, view.x);
      const minY = Math.min(world.y, view.y);
      const maxX = Math.max(world.x + world.w, view.x + view.w);
      const maxY = Math.max(world.y + world.h, view.y + view.h);
      const pad = 0.06 * Math.max(maxX - minX, maxY - minY);
      const scale = Math.min(W / (maxX - minX + pad * 2), H / (maxY - minY + pad * 2));
      const ox = (W - (maxX - minX) * scale) / 2 - (minX) * scale;
      const oy = (H - (maxY - minY) * scale) / 2 - (minY) * scale;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(243,242,239,0.96)';
      ctx.fillRect(0, 0, W, H);
      for (const { b, type } of boxes) {
        ctx.fillStyle = TYPE_COLORS[type] ?? 'rgba(60,60,70,0.6)';
        ctx.fillRect(ox + b.x * scale, oy + b.y * scale, Math.max(1.5, b.w * scale), Math.max(1.5, b.h * scale));
      }
      ctx.strokeStyle = '#3c78ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ox + view.x * scale, oy + view.y * scale, view.w * scale, view.h * scale);

      // stash mapping for click navigation
      (canvas as any)._map = { scale, ox, oy };
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      unsubDoc();
      unsubCam();
    };
  }, [ctl, visible]);

  if (!visible) return null;

  const navigate = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current!;
    const map = (canvas as any)._map;
    if (!map) return;
    const r = canvas.getBoundingClientRect();
    const wx = (e.clientX - r.left - map.ox) / map.scale;
    const wy = (e.clientY - r.top - map.oy) / map.scale;
    ctl.setCamera({
      x: wx - ctl.viewW / 2 / ctl.camera.zoom,
      y: wy - ctl.viewH / 2 / ctl.camera.zoom,
      zoom: ctl.camera.zoom,
    });
  };

  return (
    <canvas
      ref={ref}
      className="panel minimap"
      style={{ width: W, height: H }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        navigate(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && navigate(e)}
    />
  );
}

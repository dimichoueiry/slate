import type { Controller } from '../engine/controller';
import { useUI } from '../store/ui';

export default function ZoomBar({ ctl }: { ctl: Controller }) {
  const zoomPct = useUI((s) => s.zoomPct);
  return (
    <div className="panel zoombar">
      <button title="Zoom out (-)" onClick={() => ctl.zoomTo(ctl.camera.zoom / 1.25)}>
        −
      </button>
      <span className="pct" title="Reset to 100% (⌘0)" onClick={() => ctl.zoomTo(1)}>
        {zoomPct}%
      </span>
      <button title="Zoom in (+)" onClick={() => ctl.zoomTo(ctl.camera.zoom * 1.25)}>
        ＋
      </button>
      <button title="Zoom to fit (⇧1)" onClick={() => ctl.zoomToFit()}>
        ⛶
      </button>
    </div>
  );
}

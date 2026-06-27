import { useEffect, useRef, useState } from 'react';
import type { Controller } from '../engine/controller';
import { useUI } from '../store/ui';
import { FONTS, PALETTE, STICKY_COLORS, type PenTool, type Routing } from '../types';
import FloatingPanel from './FloatingPanel';

const FONT_SIZES = [12, 14, 16, 20, 24, 32, 40, 56, 72, 96];

// Crisp corner-style icons (the old ⃞/▢ glyphs rendered inverted in some fonts).
const SharpCornerIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden focusable="false">
    <rect x="2.5" y="2.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
const RoundCornerIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden focusable="false">
    <rect x="2.5" y="2.5" width="9" height="9" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

function FontSizeSelect({ value, onPick }: { value: number; onPick: (n: number) => void }) {
  const options = FONT_SIZES.includes(value) ? FONT_SIZES : [...FONT_SIZES, value].sort((a, b) => a - b);
  return (
    <select className="font-select" value={value} onChange={(e) => onPick(Number(e.target.value))} title="Text size">
      {options.map((n) => (
        <option key={n} value={n}>
          {n}px
        </option>
      ))}
    </select>
  );
}

const FONT_CATS = ['Sans', 'Serif', 'Display', 'Handwriting', 'Mono', 'Retro'] as const;

function FontSelect({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  return (
    <select className="font-select" value={value} onChange={(e) => onPick(e.target.value)}>
      {FONT_CATS.map((cat) => (
        <optgroup key={cat} label={cat}>
          {FONTS.filter((f) => f.cat === cat).map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
              {f.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

const PEN_TOOLS: { id: PenTool; label: string }[] = [
  { id: 'fineliner', label: 'Fine' },
  { id: 'pen', label: 'Pen' },
  { id: 'pencil', label: 'Pencil' },
  { id: 'marker', label: 'Marker' },
  { id: 'brush', label: 'Brush' },
];

function Swatches({
  value,
  onPick,
  colors = PALETTE,
  allowTransparent,
}: {
  value: string;
  onPick: (c: string) => void;
  colors?: string[];
  allowTransparent?: boolean;
}) {
  const customColors = useUI((s) => s.customColors);
  const addCustomColor = useUI((s) => s.addCustomColor);
  const removeCustomColor = useUI((s) => s.removeCustomColor);

  return (
    <>
      {allowTransparent && (
        <button
          className={`swatch transparent ${value === 'transparent' ? 'selected' : ''}`}
          title="No fill"
          onClick={() => onPick('transparent')}
        />
      )}
      {colors.map((c) => (
        <button
          key={c}
          className={`swatch ${value === c ? 'selected' : ''}`}
          style={{ background: c, border: c === '#ffffff' ? '2px solid #555' : undefined }}
          onClick={() => onPick(c)}
        />
      ))}
      {customColors.map((c) => (
        <button
          key={c}
          className={`swatch ${value === c ? 'selected' : ''}`}
          style={{ background: c }}
          title={`${c} — right-click to remove`}
          onClick={() => onPick(c)}
          onContextMenu={(e) => {
            e.preventDefault();
            removeCustomColor(c);
          }}
        />
      ))}
      <label className="swatch-picker" title="Custom color">
        ＋
        <input
          type="color"
          value={value.startsWith('#') && value.length === 7 ? value : '#1a1a1a'}
          onInput={(e) => onPick((e.target as HTMLInputElement).value)}
          onChange={(e) => addCustomColor(e.target.value)}
        />
      </label>
    </>
  );
}

/** Compact color control: a chip showing the current color that opens a swatch popover. */
function ColorControl({
  label,
  value,
  onPick,
  colors,
  allowTransparent,
}: {
  label?: string;
  value: string;
  onPick: (c: string) => void;
  colors?: string[];
  allowTransparent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const empty = value === 'transparent' || !value;
  return (
    <div className="color-ctl" ref={ref}>
      <button
        className="color-chip-btn"
        title={label ? `${label} color` : 'Color'}
        onClick={() => setOpen((o) => !o)}
      >
        {label && <span className="color-chip-label">{label}</span>}
        <span
          className={`color-chip${empty ? ' empty' : ''}`}
          style={empty ? undefined : { background: value }}
        />
      </button>
      {open && (
        <div className="color-pop" onPointerDown={(e) => e.stopPropagation()}>
          <div className="color-pop-grid">
            <Swatches value={value} onPick={onPick} colors={colors} allowTransparent={allowTransparent} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function StyleBar({ ctl }: { ctl: Controller }) {
  const ui = useUI();
  useUI((s) => s.docVersion); // re-render when object props change so controls track the document
  const sel = ui.selection;
  const selObjs = ctl.selectedObjects();
  const hasSel = ui.tool === 'select' && selObjs.length > 0;

  // ---------- selection context ----------
  if (hasSel) {
    const types = new Set(selObjs.map((o) => o.type));
    const single = selObjs.length === 1 ? selObjs[0] : null;
    const anyLocked = selObjs.some((o) => o.locked);
    const allOneGroup =
      selObjs.length >= 2 && !!selObjs[0].groupId && selObjs.every((o) => o.groupId === selObjs[0].groupId);
    return (
      <FloatingPanel id="stylebar" className="stylebar">
        {(types.has('stroke') || types.has('text') || types.has('icon')) && (
          <ColorControl
            label="Color"
            value={(single as any)?.color ?? ''}
            onPick={(c) => ctl.updateSelected({ color: c })}
          />
        )}
        {(types.has('shape') || types.has('connector')) && (
          <>
            <ColorControl
              label="Stroke"
              value={(single as any)?.stroke ?? ''}
              onPick={(c) => ctl.updateSelected({ stroke: c })}
            />
            {types.has('shape') && (
              <>
                <ColorControl
                  label="Fill"
                  allowTransparent
                  value={(single as any)?.fill ?? ''}
                  onPick={(c) => ctl.updateSelected({ fill: c })}
                />
                {ui.editingTextId !== null &&
                  selObjs.some((o) => o.id === ui.editingTextId && o.type === 'shape') && (
                    <ColorControl
                      label="Text"
                      value={single?.type === 'shape' ? single.textColor : ''}
                      onPick={(c) => ctl.updateSelected({ textColor: c })}
                    />
                  )}
              </>
            )}
            <label>
              W
              <input
                type="range"
                min={1}
                max={12}
                step={0.5}
                value={(single as any)?.strokeWidth ?? 2}
                onChange={(e) => ctl.updateSelected({ strokeWidth: Number(e.target.value) })}
              />
            </label>
            <div className="seg">
              {(['solid', 'dashed', 'dotted'] as const).map((d) => (
                <button
                  key={d}
                  className={(single as any)?.dash === d ? 'active' : ''}
                  onClick={() => ctl.updateSelected({ dash: d })}
                >
                  {d === 'solid' ? '—' : d === 'dashed' ? '┄' : '⋯'}
                </button>
              ))}
            </div>
            {types.has('shape') && (
              <div className="seg">
                <button
                  className={!(single as any)?.sketchy ? 'active' : ''}
                  title="Clean borders"
                  onClick={() => ctl.updateSelected({ sketchy: false })}
                >
                  Clean
                </button>
                <button
                  className={(single as any)?.sketchy ? 'active' : ''}
                  title="Hand-drawn borders"
                  onClick={() => ctl.updateSelected({ sketchy: true })}
                >
                  Sketchy
                </button>
              </div>
            )}
            {selObjs.some((o) => o.type === 'shape' && (o.shape === 'rect' || o.shape === 'roundedRect')) && (
              <div className="seg">
                <button
                  className={single?.type === 'shape' && single.shape === 'rect' ? 'active' : ''}
                  title="Square corners"
                  onClick={() => ctl.updateSelected({ shape: 'rect' })}
                >
                  <SharpCornerIcon />
                </button>
                <button
                  className={single?.type === 'shape' && single.shape === 'roundedRect' ? 'active' : ''}
                  title="Rounded corners"
                  onClick={() => ctl.updateSelected({ shape: 'roundedRect' })}
                >
                  <RoundCornerIcon />
                </button>
              </div>
            )}
          </>
        )}
        {(types.has('text') || types.has('shape') || types.has('sticky')) && (
          <>
            <FontSelect
              value={(single as any)?.fontFamily ?? 'sans'}
              onPick={(id) => ctl.updateSelected({ fontFamily: id })}
            />
            <FontSizeSelect
              value={(single as any)?.fontSize ?? 20}
              onPick={(n) => ctl.setSelectedFontSize(n)}
            />
          </>
        )}
        {types.has('icon') && (
          <label>
            Width
            <input
              type="range"
              min={0.75}
              max={4.5}
              step={0.25}
              value={(single as any)?.strokeWidth ?? 2}
              onChange={(e) => ctl.updateSelected({ strokeWidth: Number(e.target.value) })}
            />
          </label>
        )}
        {types.has('connector') && single?.type === 'connector' && (
          <div className="seg">
            {(['straight', 'elbow', 'curved'] as Routing[]).map((r) => (
              <button
                key={r}
                className={single.routing === r ? 'active' : ''}
                onClick={() => ctl.updateSelected({ routing: r })}
              >
                {r === 'straight' ? '╱' : r === 'elbow' ? '└' : '∿'}
              </button>
            ))}
            <button
              title="Toggle start arrow"
              onClick={() =>
                ctl.updateSelected({ startArrow: single.startArrow === 'none' ? 'triangle' : 'none' })
              }
            >
              ◀
            </button>
            <button
              title="Toggle end arrow"
              onClick={() =>
                ctl.updateSelected({ endArrow: single.endArrow === 'none' ? 'triangle' : 'none' })
              }
            >
              ▶
            </button>
          </div>
        )}
        {types.has('sticky') && (
          <ColorControl
            label="Note"
            colors={STICKY_COLORS}
            value={(single as any)?.color ?? ''}
            onPick={(c) => ctl.updateSelected({ color: c })}
          />
        )}
        {sel.length >= 2 && (
          <>
            <div className="seg">
              <button title="Align left" onClick={() => ctl.align('left')}>⫷</button>
              <button title="Align center" onClick={() => ctl.align('centerX')}>⫶</button>
              <button title="Align right" onClick={() => ctl.align('right')}>⫸</button>
              <button title="Align top" onClick={() => ctl.align('top')}>⊤</button>
              <button title="Align middle" onClick={() => ctl.align('centerY')}>⊣</button>
              <button title="Align bottom" onClick={() => ctl.align('bottom')}>⊥</button>
            </div>
            {sel.length >= 3 && (
              <div className="seg">
                <button title="Distribute horizontally" onClick={() => ctl.distribute('x')}>↔</button>
                <button title="Distribute vertically" onClick={() => ctl.distribute('y')}>↕</button>
              </div>
            )}
            {allOneGroup ? (
              <button className="chrome-btn" title="Ungroup (⌘⇧G)" onClick={() => ctl.ungroupSelection()}>
                Ungroup
              </button>
            ) : (
              <button className="chrome-btn" title="Group (⌘G)" onClick={() => ctl.groupSelection()}>
                Group
              </button>
            )}
          </>
        )}
        {single?.type === 'frame' && (
          <label>
            Frame
            <input
              className="frame-name-input"
              value={single.name}
              spellCheck={false}
              onChange={(e) => ctl.updateSelected({ name: e.target.value })}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLElement).blur();
              }}
            />
          </label>
        )}
        <div className="seg">
          <button title="Bring to front (⌘⇧])" onClick={() => ctl.reorderSelection('front')}>⏫</button>
          <button title="Send to back (⌘⇧[)" onClick={() => ctl.reorderSelection('back')}>⏬</button>
        </div>
        <button className="chrome-btn" onClick={() => ctl.toggleLockSelection()}>
          {anyLocked ? 'Unlock' : 'Lock'}
        </button>
        <button
          className="chrome-btn"
          title="Save selection as a reusable component"
          onClick={() => {
            const name = prompt('Component name', 'My component');
            if (name) void ctl.saveSelectionAsComponent(name);
          }}
        >
          ⊕ Save
        </button>
      </FloatingPanel>
    );
  }

  // ---------- tool contexts ----------
  if (ui.tool === 'pen') {
    return (
      <FloatingPanel id="stylebar" className="stylebar">
        <div className="seg">
          {PEN_TOOLS.map((p) => (
            <button
              key={p.id}
              className={ui.penTool === p.id ? 'active' : ''}
              onClick={() => ui.set({ penTool: p.id })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <ColorControl label="Ink" value={ui.penColor} onPick={(c) => ui.set({ penColor: c })} />
        <label>
          Size
          <input
            type="range"
            min={1}
            max={32}
            value={ui.penSize}
            onChange={(e) => ui.set({ penSize: Number(e.target.value) })}
          />
        </label>
        <label>
          Smooth
          <input
            type="range"
            min={0}
            max={0.4}
            step={0.05}
            value={ui.smoothing}
            onChange={(e) => ui.set({ smoothing: Number(e.target.value) })}
          />
        </label>
        <label>
          Opacity
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={ui.penOpacity}
            onChange={(e) => ui.set({ penOpacity: Number(e.target.value) })}
          />
        </label>
        <div className="seg" title="Recognize rough strokes as clean shapes and lines">
          <button className={!ui.autoShape ? 'active' : ''} onClick={() => ui.set({ autoShape: false })}>
            Raw ink
          </button>
          <button className={ui.autoShape ? 'active' : ''} onClick={() => ui.set({ autoShape: true })}>
            Auto-shape
          </button>
        </div>
      </FloatingPanel>
    );
  }

  if (['rect', 'roundedRect', 'ellipse', 'triangle', 'diamond'].includes(ui.tool)) {
    return (
      <FloatingPanel id="stylebar" className="stylebar">
        <ColorControl label="Stroke" value={ui.stroke} onPick={(c) => ui.set({ stroke: c })} />
        <ColorControl label="Fill" allowTransparent value={ui.fill} onPick={(c) => ui.set({ fill: c })} />
        <label>
          W
          <input
            type="range"
            min={1}
            max={12}
            step={0.5}
            value={ui.strokeWidth}
            onChange={(e) => ui.set({ strokeWidth: Number(e.target.value) })}
          />
        </label>
        <div className="seg">
          {(['solid', 'dashed', 'dotted'] as const).map((d) => (
            <button key={d} className={ui.dash === d ? 'active' : ''} onClick={() => ui.set({ dash: d })}>
              {d === 'solid' ? '—' : d === 'dashed' ? '┄' : '⋯'}
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={!ui.sketchy ? 'active' : ''} onClick={() => ui.set({ sketchy: false })}>
            Clean
          </button>
          <button className={ui.sketchy ? 'active' : ''} onClick={() => ui.set({ sketchy: true })}>
            Sketchy
          </button>
        </div>
        {ui.tool === 'rect' && (
          <div className="seg">
            <button className={!ui.rounded ? 'active' : ''} title="Square corners" onClick={() => ui.set({ rounded: false })}>
              <SharpCornerIcon />
            </button>
            <button className={ui.rounded ? 'active' : ''} title="Rounded corners" onClick={() => ui.set({ rounded: true })}>
              <RoundCornerIcon />
            </button>
          </div>
        )}
      </FloatingPanel>
    );
  }

  if (ui.tool === 'text') {
    return (
      <FloatingPanel id="stylebar" className="stylebar">
        <label>
          Font
          <FontSelect value={ui.fontFamily} onPick={(id) => ui.set({ fontFamily: id })} />
        </label>
        <FontSizeSelect value={ui.fontSize} onPick={(n) => ui.set({ fontSize: n })} />
        <ColorControl label="Color" value={ui.penColor} onPick={(c) => ui.set({ penColor: c })} />
      </FloatingPanel>
    );
  }

  if (ui.tool === 'connector' || ui.tool === 'line') {
    return (
      <FloatingPanel id="stylebar" className="stylebar">
        <ColorControl label="Stroke" value={ui.stroke} onPick={(c) => ui.set({ stroke: c })} />
        {ui.tool === 'connector' && (
          <div className="seg">
            {(['straight', 'elbow', 'curved'] as Routing[]).map((r) => (
              <button key={r} className={ui.routing === r ? 'active' : ''} onClick={() => ui.set({ routing: r })}>
                {r === 'straight' ? '╱' : r === 'elbow' ? '└' : '∿'}
              </button>
            ))}
          </div>
        )}
        <div className="seg" title="When off, endpoints never stick to nearby shapes (hold ⌥ for a one-off)">
          <button className={ui.attachEnabled ? 'active' : ''} onClick={() => ui.set({ attachEnabled: true })}>
            Attach
          </button>
          <button className={!ui.attachEnabled ? 'active' : ''} onClick={() => ui.set({ attachEnabled: false })}>
            Free
          </button>
        </div>
        <span style={{ fontSize: 11, color: 'var(--chrome-dim)' }}>
          {ui.attachEnabled ? 'Endpoints stick to shapes — hold ⌥ to draw free' : 'Endpoints stay exactly where you put them'}
        </span>
      </FloatingPanel>
    );
  }

  if (ui.tool === 'sticky') {
    return (
      <FloatingPanel id="stylebar" className="stylebar">
        <ColorControl label="Color" colors={STICKY_COLORS} value={ui.stickyColor} onPick={(c) => ui.set({ stickyColor: c })} />
      </FloatingPanel>
    );
  }

  return null;
}

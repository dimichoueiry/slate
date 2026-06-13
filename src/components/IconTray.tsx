import { useEffect, useState } from 'react';
import type { Controller } from '../engine/controller';
import { ICON_CATEGORIES, type IconDef } from '../engine/icons';
import { deleteComponent, listComponents, type ComponentDef } from '../store/db';
import { useUI } from '../store/ui';
import FloatingPanel from './FloatingPanel';

function IconButton({ icon, onPlace }: { icon: IconDef; onPlace: (id: string) => void }) {
  return (
    <button className="icon-cell" title={icon.label} onClick={() => onPlace(icon.id)}>
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icon.d.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
    </button>
  );
}

/** Iconland: categorized, searchable icon library — click an icon to drop it on the canvas. */
export default function IconTray({ ctl }: { ctl: Controller }) {
  const open = useUI((s) => s.iconTrayOpen);
  const compsVersion = useUI((s) => s.componentsVersion);
  const set = useUI((s) => s.set);
  const [query, setQuery] = useState('');
  const [comps, setComps] = useState<ComponentDef[]>([]);

  useEffect(() => {
    if (open) void listComponents().then(setComps);
  }, [open, compsVersion]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const place = (id: string) => ctl.addIcon(id);
  const visibleComps = q ? comps.filter((c) => c.name.toLowerCase().includes(q)) : comps;

  const componentsSection = visibleComps.length > 0 && (
    <div>
      <div className="icon-cat-label">My components</div>
      <div className="comp-grid">
        {visibleComps.map((c) => (
          <button
            key={c.id}
            className="comp-cell"
            title={`${c.name} — right-click to delete`}
            onClick={() => ctl.placeComponent(c)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (confirm(`Delete component “${c.name}”?`)) {
                void deleteComponent(c.id).then(() =>
                  set({ componentsVersion: useUI.getState().componentsVersion + 1 })
                );
              }
            }}
          >
            {c.thumb ? <img src={c.thumb} alt={c.name} /> : <span>{c.name}</span>}
            <span className="comp-name">{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const matches = (i: IconDef) =>
    i.label.toLowerCase().includes(q) || i.tags.includes(q) || i.id.includes(q);

  const total = ICON_CATEGORIES.reduce((n, c) => n + c.icons.length, 0);

  return (
    <FloatingPanel id="icontray" className="icon-tray">
      <div className="icon-tray-header">
        <input
          placeholder={`Search ${total} icons…`}
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') set({ iconTrayOpen: false });
          }}
        />
        <button className="chrome-btn" title="Close" onClick={() => set({ iconTrayOpen: false })}>
          ✕
        </button>
      </div>
      <div className="icon-scroll">
        {componentsSection}
        {q ? (
          <div className="icon-grid">
            {ICON_CATEGORIES.flatMap((c) => c.icons.filter(matches)).map((icon) => (
              <IconButton key={icon.id} icon={icon} onPlace={place} />
            ))}
            {visibleComps.length === 0 && ICON_CATEGORIES.every((c) => !c.icons.some(matches)) && (
              <div className="icon-empty">No icons match “{query}”</div>
            )}
          </div>
        ) : (
          ICON_CATEGORIES.map((cat) => (
            <div key={cat.id}>
              <div className="icon-cat-label">{cat.label}</div>
              <div className="icon-grid">
                {cat.icons.map((icon) => (
                  <IconButton key={icon.id} icon={icon} onPlace={place} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </FloatingPanel>
  );
}

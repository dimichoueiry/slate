import { useEffect, useState } from 'react';
import type { Controller } from '../engine/controller';
import { ICON_CATEGORIES, type IconDef } from '../engine/icons';
import { isAINode } from '../ui/ainodes';
import { TEMPLATES } from '../engine/templates';
import { deleteComponent, deletePrompt, listComponents, listPrompts, savePrompt, type ComponentDef, type PromptDef } from '../store/db';
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
  const [prompts, setPrompts] = useState<PromptDef[]>([]);

  useEffect(() => {
    if (open) {
      void listComponents().then(setComps);
      void listPrompts().then(setPrompts);
    }
  }, [open, compsVersion]);

  const reloadPrompts = () => void listPrompts().then(setPrompts);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const place = (id: string) => ctl.addIcon(id);
  const visibleComps = q ? comps.filter((c) => c.name.toLowerCase().includes(q)) : comps;

  const isFlow = (c: ComponentDef) => c.objects.some((o) => isAINode(o));
  const compCell = (c: ComponentDef) => (
    <button
      key={c.id}
      className="comp-cell"
      title={`${c.name} — right-click to delete`}
      onClick={() => ctl.placeComponent(c)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (confirm(`Delete “${c.name}”?`)) {
          void deleteComponent(c.id).then(() => set({ componentsVersion: useUI.getState().componentsVersion + 1 }));
        }
      }}
    >
      {c.thumb ? <img src={c.thumb} alt={c.name} /> : <span>{c.name}</span>}
      <span className="comp-name">{c.name}</span>
    </button>
  );
  const myFlows = visibleComps.filter(isFlow);
  const myComponents = visibleComps.filter((c) => !isFlow(c));

  const componentsSection = (
    <>
      {myFlows.length > 0 && (
        <div>
          <div className="icon-cat-label">My flows</div>
          <div className="comp-grid">{myFlows.map(compCell)}</div>
        </div>
      )}
      {myComponents.length > 0 && (
        <div>
          <div className="icon-cat-label">My components</div>
          <div className="comp-grid">{myComponents.map(compCell)}</div>
        </div>
      )}
    </>
  );

  const visiblePrompts = q ? prompts.filter((p) => p.name.toLowerCase().includes(q) || p.text.toLowerCase().includes(q)) : prompts;
  const visibleTemplates = q ? TEMPLATES.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)) : TEMPLATES;

  const saveCurrentPrompt = () => {
    const text = ctl.selectedPromptText();
    if (!text) {
      alert('Select a single sticky/text/node first, then Save prompt.');
      return;
    }
    const name = prompt('Name this prompt', text.split('\n')[0].slice(0, 40));
    if (name) void savePrompt(name, text).then(reloadPrompts);
  };

  const templatesSection = !q || visibleTemplates.length > 0 ? (
    <div>
      <div className="icon-cat-label">Flow templates</div>
      <div className="prompt-list">
        {visibleTemplates.map((t) => (
          <button key={t.id} className="prompt-cell" title={t.description} onClick={() => ctl.placeObjects(t.build())}>
            <span className="prompt-name">⚡ {t.name}</span>
            <span className="prompt-text">{t.description}</span>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  const promptsSection = (
    <div>
      <div className="icon-cat-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Prompt templates</span>
        <button className="chrome-btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={saveCurrentPrompt}>
          ＋ Save
        </button>
      </div>
      <div className="prompt-list">
        {visiblePrompts.map((p) => (
          <button
            key={p.id}
            className="prompt-cell"
            title={`${p.text}\n\n(right-click to delete)`}
            onClick={() => ctl.addPromptSticky(p.text)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (confirm(`Delete prompt “${p.name}”?`)) void deletePrompt(p.id).then(reloadPrompts);
            }}
          >
            <span className="prompt-name">{p.name}</span>
            <span className="prompt-text">{p.text}</span>
          </button>
        ))}
        {visiblePrompts.length === 0 && (
          <div className="icon-empty">No saved prompts yet — select a node and hit ＋ Save.</div>
        )}
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
        {templatesSection}
        {promptsSection}
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

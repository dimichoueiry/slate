// Self-mounting settings UI (injected by vite-slate-persist) — no app files touched.
import { createRoot } from 'react-dom/client';
import SettingsPanel from './SettingsPanel';

const id = 'slate-settings-root';
if (!document.getElementById(id)) {
  const el = document.createElement('div');
  el.id = id;
  document.body.appendChild(el);
  createRoot(el).render(<SettingsPanel />);
}

export {};

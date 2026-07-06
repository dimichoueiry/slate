import { useEffect, lazy, Suspense } from 'react';
import { useUI } from './store/ui';
import type { Route } from './store/ui';
import Home from './components/Home';
import BoardView from './components/BoardView';
import SettingsPanel from './settings/SettingsPanel';
import BridgeUI from './bridge/BridgeUI';
import { startBridge } from './bridge/bridge';

// marketing landing — lazy so it never weighs down the canvas bundle
const Landing = lazy(() => import('./landing/Landing'));

// path-based routing: / = landing, /app = board list, /board/:id = a board
function parsePath(path: string): Route {
  const board = path.match(/^\/board\/(.+?)\/?$/);
  if (board) return { view: 'board', boardId: decodeURIComponent(board[1]) };
  if (/^\/app\/?$/.test(path)) return { view: 'home' };
  return { view: 'welcome' };
}

export default function App() {
  const route = useUI((s) => s.route);

  useEffect(() => {
    const apply = () => useUI.getState().set({ route: parsePath(location.pathname) });
    apply();
    window.addEventListener('popstate', apply);
    return () => window.removeEventListener('popstate', apply);
  }, []);

  // connect to a local slate-mcp bridge if one is running (no-op otherwise)
  useEffect(() => {
    if (route.view !== 'welcome') startBridge();
  }, [route.view]);

  if (route.view === 'welcome') {
    return (
      <Suspense fallback={null}>
        <Landing />
      </Suspense>
    );
  }

  return (
    <>
      {route.view === 'board' ? <BoardView key={route.boardId} boardId={route.boardId} /> : <Home />}
      {/* global settings (AI providers) — available on every screen */}
      <SettingsPanel />
      {/* MCP agent bridge indicator + pairing dialog */}
      <BridgeUI />
    </>
  );
}

function navigate(path: string) {
  if (location.pathname === path) return;
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function openBoard(id: string) {
  navigate(`/board/${encodeURIComponent(id)}`);
}

export function goHome() {
  navigate('/app');
}

export function goWelcome() {
  navigate('/');
}

import { useEffect, lazy, Suspense } from 'react';
import { useUI } from './store/ui';
import Home from './components/Home';
import BoardView from './components/BoardView';
import SettingsPanel from './settings/SettingsPanel';

// marketing landing — lazy so it never weighs down the canvas bundle
const Landing = lazy(() => import('./landing/Landing'));

export default function App() {
  const route = useUI((s) => s.route);

  // simple hash routing so boards are linkable / survive refresh
  useEffect(() => {
    const apply = () => {
      const board = location.hash.match(/^#\/board\/(.+)$/);
      if (board) {
        useUI.getState().set({ route: { view: 'board', boardId: board[1] } });
      } else if (location.hash.match(/^#\/welcome\/?$/)) {
        useUI.getState().set({ route: { view: 'welcome' } });
      } else {
        useUI.getState().set({ route: { view: 'home' } });
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

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
    </>
  );
}

export function openBoard(id: string) {
  location.hash = `#/board/${id}`;
}

export function goHome() {
  location.hash = '#/';
}

export function goWelcome() {
  location.hash = '#/welcome';
}

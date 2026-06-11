import { useEffect } from 'react';
import { useUI } from './store/ui';
import Home from './components/Home';
import BoardView from './components/BoardView';

export default function App() {
  const route = useUI((s) => s.route);

  // simple hash routing so boards are linkable / survive refresh
  useEffect(() => {
    const apply = () => {
      const m = location.hash.match(/^#\/board\/(.+)$/);
      useUI.getState().set({ route: m ? { view: 'board', boardId: m[1] } : { view: 'home' } });
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  if (route.view === 'board') {
    return <BoardView key={route.boardId} boardId={route.boardId} />;
  }
  return <Home />;
}

export function openBoard(id: string) {
  location.hash = `#/board/${id}`;
}

export function goHome() {
  location.hash = '#/';
}

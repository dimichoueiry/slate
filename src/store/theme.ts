// Theme layer: drives the [data-theme] attribute that flips the CSS token set, and
// mirrors the resolved canvas tokens into the renderer (the canvas is painted
// imperatively, so it can't read CSS variables directly).

import { setSceneColors } from '../engine/renderer';

export type Theme = 'light' | 'dark';
const KEY = 'slate-theme';

export function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* storage unavailable */
  }
  // default 'dark' = today's dark glassy chrome (zero regression). The canvas stays
  // light paper in both themes for now; 'light' reskins the chrome to a light UI.
  return 'dark';
}

function readVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Apply a theme: set data-theme, sync the canvas colors from the resolved tokens, repaint. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  // data-theme is set first so getComputedStyle reflects the active token values
  setSceneColors({
    bg: readVar('--canvas-bg', '#15151a'),
    gridDot: readVar('--grid-dot', 'rgba(255,255,255,0.10)'),
    gridLine: readVar('--grid-line', 'rgba(255,255,255,0.05)'),
  });
  (window as { __slateCtl?: { markSceneDirty?: () => void } }).__slateCtl?.markSceneDirty?.();
}

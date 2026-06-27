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

/** Apply the global chrome theme (panels/dashboard). The canvas surface is per-board. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}

// Canvas surface is a per-board choice, independent of the chrome theme.
const CANVAS_LIGHT = { bg: '#f3f2ef', gridDot: 'rgba(60,60,70,0.18)', gridLine: 'rgba(60,60,70,0.08)' };
const CANVAS_DARK = { bg: '#15151a', gridDot: 'rgba(255,255,255,0.09)', gridLine: 'rgba(255,255,255,0.05)' };

// Default ink that reads well on each canvas surface (new strokes/shapes/text only).
export const INK_ON_LIGHT = '#1a1a1a';
export const INK_ON_DARK = '#e8e6f0';
export function inkForCanvas(dark: boolean): string {
  return dark ? INK_ON_DARK : INK_ON_LIGHT;
}

/** Set the drawing canvas surface light/dark for the open board, and repaint. */
export function setCanvasDark(dark: boolean) {
  setSceneColors(dark ? CANVAS_DARK : CANVAS_LIGHT);
  (window as { __slateCtl?: { markSceneDirty?: () => void } }).__slateCtl?.markSceneDirty?.();
}

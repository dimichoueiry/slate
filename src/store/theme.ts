// Theme layer: drives the [data-theme] attribute that flips the CSS token set, and
// mirrors the resolved canvas tokens into the renderer (the canvas is painted
// imperatively, so it can't read CSS variables directly).

import { setSceneColors } from '../engine/renderer';
import { setStyleInk } from '../engine/style';

export type Theme = 'light' | 'dark';
const KEY = 'slate-theme';

/** The theme the user picked with the toggle, or null = follow the OS. */
export function savedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* storage unavailable */
  }
  return null;
}

function osTheme(): Theme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** A manual pick wins; otherwise follow prefers-color-scheme. */
export function loadTheme(): Theme {
  return savedTheme() ?? osTheme();
}

/** Apply the global chrome theme (panels/dashboard). The canvas surface is per-board.
 *  `persist` = a manual pick from the toggle; startup/OS changes don't persist. */
export function applyTheme(theme: Theme, persist = false) {
  document.documentElement.dataset.theme = theme;
  if (!persist) return;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}

/** Follow OS theme changes until the user picks one manually. */
export function watchOsTheme(onChange: (t: Theme) => void) {
  if (typeof matchMedia !== 'function') return;
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (savedTheme()) return;
    const t = osTheme();
    applyTheme(t);
    onChange(t);
  });
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
  setStyleInk(inkForCanvas(dark));
  (window as { __slateCtl?: { markSceneDirty?: () => void } }).__slateCtl?.markSceneDirty?.();
}

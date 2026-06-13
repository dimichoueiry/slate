import { create } from 'zustand';
import type { BrandKit, DashStyle, PenTool, Routing, ToolId } from '../types';

export type Route = { view: 'home' } | { view: 'board'; boardId: string };

interface UIState {
  route: Route;
  boardName: string;

  tool: ToolId;
  // pen
  penTool: PenTool;
  penColor: string;
  penSize: number;
  penOpacity: number;
  smoothing: number; // 0..0.4 extra stabilization
  autoShape: boolean; // recognize rough strokes as clean shapes
  glideDraw: boolean; // ⌘Y: cursor inks without holding the button (trackpad drawing)
  // shapes
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash: DashStyle;
  sketchy: boolean; // hand-drawn (roughjs) borders for new shapes
  rounded: boolean; // rect tool draws rounded rectangles
  // connector
  routing: Routing;
  /** when false, lines/connectors never attach to nearby objects */
  attachEnabled: boolean;
  // sticky
  stickyColor: string;
  // text
  fontFamily: string; // FONTS id, default for new text-bearing objects
  fontSize: number; // default for new text objects
  // canvas
  gridMode: 'dots' | 'lines' | 'none';
  snapEnabled: boolean;
  gridSnap: boolean;
  minimapVisible: boolean;
  notesOpen: boolean;
  iconTrayOpen: boolean;
  paletteOpen: boolean;
  localAiModel: string;
  localAiSystemPrompt: string;

  selection: string[];
  editingTextId: string | null;
  zoomPct: number;
  canUndo: boolean;
  canRedo: boolean;
  /** bumped on every document mutation so chrome panels showing object props re-render */
  docVersion: number;
  /** bumped when saved components change so the tray reloads */
  componentsVersion: number;

  /** user-saved colors, shown in every palette */
  customColors: string[];
  addCustomColor: (c: string) => void;
  removeCustomColor: (c: string) => void;

  /** running usage/cost across the session (persisted) */
  usage: Usage;
  addUsage: (delta: Partial<Usage>) => void;
  resetUsage: () => void;

  /** brand kit active for the current board (auto-applied to AI nodes) */
  activeBrandKit: BrandKit | null;
  /** bumped when the brand-kit library changes so pickers reload */
  brandKitsVersion: number;

  set: (patch: Partial<UIState>) => void;
}

export interface Usage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  tavilyCredits: number;
}

const CUSTOM_COLORS_KEY = 'slate-custom-colors';
const USAGE_KEY = 'slate-usage';
const ZERO_USAGE: Usage = { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, tavilyCredits: 0 };

function loadUsage(): Usage {
  try {
    return { ...ZERO_USAGE, ...JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}') };
  } catch {
    return { ...ZERO_USAGE };
  }
}

function saveUsage(u: Usage) {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(u));
  } catch {
    // ignore
  }
}

function loadCustomColors(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((c) => typeof c === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

function saveCustomColors(colors: string[]) {
  try {
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors));
  } catch {
    // storage full/unavailable — colors just won't persist
  }
}

export const useUI = create<UIState>((setState) => ({
  route: { view: 'home' },
  boardName: '',

  tool: 'select',
  penTool: 'pen',
  penColor: '#1a1a1a',
  penSize: 4,
  penOpacity: 1,
  smoothing: 0.1,
  autoShape: false,
  glideDraw: false,

  fill: 'transparent',
  stroke: '#1a1a1a',
  strokeWidth: 2,
  dash: 'solid',
  sketchy: false,
  rounded: false,

  routing: 'curved',
  attachEnabled: true,
  stickyColor: '#FFE066',
  fontFamily: 'sans',
  fontSize: 20,

  gridMode: 'dots',
  snapEnabled: true,
  gridSnap: false,
  minimapVisible: true,
  notesOpen: false,
  iconTrayOpen: false,
  paletteOpen: false,
  localAiModel: 'qwen2.5:3b',
  localAiSystemPrompt:
    'You are a concise writing assistant for a visual canvas. Keep answers practical and structured.',

  selection: [],
  editingTextId: null,
  zoomPct: 100,
  canUndo: false,
  canRedo: false,
  docVersion: 0,
  componentsVersion: 0,

  customColors: loadCustomColors(),
  addCustomColor: (c) =>
    setState((s) => {
      const colors = [c, ...s.customColors.filter((x) => x !== c)].slice(0, 12);
      saveCustomColors(colors);
      return { customColors: colors };
    }),
  removeCustomColor: (c) =>
    setState((s) => {
      const colors = s.customColors.filter((x) => x !== c);
      saveCustomColors(colors);
      return { customColors: colors };
    }),

  activeBrandKit: null,
  brandKitsVersion: 0,

  usage: loadUsage(),
  addUsage: (delta) =>
    setState((s) => {
      const u: Usage = {
        calls: s.usage.calls + (delta.calls ?? 0),
        promptTokens: s.usage.promptTokens + (delta.promptTokens ?? 0),
        completionTokens: s.usage.completionTokens + (delta.completionTokens ?? 0),
        costUsd: s.usage.costUsd + (delta.costUsd ?? 0),
        tavilyCredits: s.usage.tavilyCredits + (delta.tavilyCredits ?? 0),
      };
      saveUsage(u);
      return { usage: u };
    }),
  resetUsage: () => {
    saveUsage({ ...ZERO_USAGE });
    setState({ usage: { ...ZERO_USAGE } });
  },

  set: (patch) => setState(patch),
}));

import type { ConnectorObj, RevealEffect, RevealSpec, SlateObj } from '../types';

export const DEFAULT_REVEAL_EFFECT: RevealEffect = 'pop';
export const DEFAULT_REVEAL_DURATION = 360;

export const REVEAL_EFFECTS: { id: RevealEffect; label: string }[] = [
  { id: 'pop', label: 'Pop' },
  { id: 'fade', label: 'Fade' },
  { id: 'slide-up', label: 'Rise' },
  { id: 'slide-left', label: 'Slide' },
  { id: 'none', label: 'None' },
];

export const REVEAL_DURATIONS = [
  { ms: 220, label: 'Quick' },
  { ms: DEFAULT_REVEAL_DURATION, label: 'Smooth' },
  { ms: 560, label: 'Slow' },
];

export function normalizeRevealStep(step: unknown): number | null {
  if (typeof step !== 'number' || !Number.isFinite(step)) return null;
  const n = Math.round(step);
  return n >= 1 ? n : null;
}

export function explicitRevealStep(o: SlateObj): number | null {
  return normalizeRevealStep(o.reveal?.step);
}

/**
 * Effective playback step. Connectors without their own reveal inherit the
 * later endpoint reveal so arrows do not appear before the things they connect.
 */
export function revealStepOf(
  o: SlateObj,
  resolve?: (id: string) => SlateObj | undefined
): number | null {
  const own = explicitRevealStep(o);
  if (own !== null) return own;
  if (o.type !== 'connector' || !resolve) return null;

  const c = o as ConnectorObj;
  const endpointSteps = [c.from.objectId, c.to.objectId]
    .map((id) => (id ? resolve(id) : undefined))
    .map((obj) => (obj ? explicitRevealStep(obj) : null))
    .filter((step): step is number => step !== null);

  return endpointSteps.length ? Math.max(...endpointSteps) : null;
}

export function revealEffectOf(spec?: RevealSpec | null): RevealEffect {
  return spec?.effect ?? DEFAULT_REVEAL_EFFECT;
}

export function revealDurationOf(spec?: RevealSpec | null): number {
  const ms = spec?.durationMs;
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_REVEAL_DURATION;
}

export function revealDelayOf(spec?: RevealSpec | null): number {
  const ms = spec?.delayMs;
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : 0;
}

export function collectRevealSteps(
  objects: SlateObj[],
  resolve?: (id: string) => SlateObj | undefined
): number[] {
  return [...new Set(objects.map((o) => revealStepOf(o, resolve)).filter((step): step is number => step !== null))]
    .sort((a, b) => a - b);
}

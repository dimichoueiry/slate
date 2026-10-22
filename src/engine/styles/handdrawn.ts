// 'handdrawn': STUB — renders exactly like 'sketch' until implemented.
// TODO(handdrawn): implement every StyleRenderer primitive (see ./types.ts) with
// the hand-drawn look; derive all randomness from `s.seed`, bump `version` when
// output changes, and set this style's own palette / stickyPalette / font.

import { sketchStyle } from './sketch';
import type { StyleRenderer } from './types';

export const handdrawnStyle: StyleRenderer = {
  ...sketchStyle,
  id: 'handdrawn',
  label: 'Hand-drawn',
  version: 0,
  // TODO(handdrawn): palette, stickyPalette, defaultFontId, fontStack, fontId()
  // TODO(handdrawn): rect, roundedRect, ellipse, polygon, polyline, curve, arrowhead, arrowHeadLen, stickyPaper
};

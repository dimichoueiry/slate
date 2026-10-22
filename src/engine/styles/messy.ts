// 'messy': STUB — renders exactly like 'sketch' until implemented.
// TODO(messy): implement every StyleRenderer primitive (see ./types.ts) with
// the messy look; derive all randomness from `s.seed`, bump `version` when
// output changes, and set this style's own palette / stickyPalette / font.

import { sketchStyle } from './sketch';
import type { StyleRenderer } from './types';

export const messyStyle: StyleRenderer = {
  ...sketchStyle,
  id: 'messy',
  label: 'Messy',
  version: 0,
  // TODO(messy): palette, stickyPalette, defaultFontId, fontStack, fontId()
  // TODO(messy): rect, roundedRect, ellipse, polygon, polyline, curve, arrowhead, arrowHeadLen, stickyPaper
};

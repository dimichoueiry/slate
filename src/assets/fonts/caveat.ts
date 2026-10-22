// Caveat (SIL OFL 1.1) from @fontsource/caveat, Regular + Bold. The faces are
// registered by the @fontsource CSS imported in main.tsx; these URLs let SVG export
// embed the subsets a board uses so the file renders handwritten anywhere.

import c0 from '@fontsource/caveat/files/caveat-cyrillic-400-normal.woff2?url';
import c1 from '@fontsource/caveat/files/caveat-cyrillic-ext-400-normal.woff2?url';
import c2 from '@fontsource/caveat/files/caveat-latin-400-normal.woff2?url';
import c3 from '@fontsource/caveat/files/caveat-latin-ext-400-normal.woff2?url';
import c4 from '@fontsource/caveat/files/caveat-cyrillic-700-normal.woff2?url';
import c5 from '@fontsource/caveat/files/caveat-cyrillic-ext-700-normal.woff2?url';
import c6 from '@fontsource/caveat/files/caveat-latin-700-normal.woff2?url';
import c7 from '@fontsource/caveat/files/caveat-latin-ext-700-normal.woff2?url';

export const CAVEAT_FACES: { url: string; weight: number; unicodeRange: string }[] = [
  { url: c0, weight: 400, unicodeRange: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
  { url: c1, weight: 400, unicodeRange: 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F' },
  { url: c2, weight: 400, unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
  { url: c3, weight: 400, unicodeRange: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' },
  { url: c4, weight: 700, unicodeRange: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
  { url: c5, weight: 700, unicodeRange: 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F' },
  { url: c6, weight: 700, unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
  { url: c7, weight: 700, unicodeRange: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' },
];

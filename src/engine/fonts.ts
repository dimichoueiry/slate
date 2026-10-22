// Webfont loading for canvas text. Canvas measureText/fillText silently use a
// fallback family while a webfont is still downloading, so anything that
// measures or paints text awaits these first.

import { CAVEAT_FACES } from '../assets/fonts/caveat';
import kalamLatin400 from '@fontsource/kalam/files/kalam-latin-400-normal.woff2?url';
import kalamLatinExt400 from '@fontsource/kalam/files/kalam-latin-ext-400-normal.woff2?url';
import kalamLatin700 from '@fontsource/kalam/files/kalam-latin-700-normal.woff2?url';
import kalamLatinExt700 from '@fontsource/kalam/files/kalam-latin-ext-700-normal.woff2?url';
import { EXCALIFONT_FACES } from '../assets/fonts/excalifont';
import { fontStack, type SlateObj } from '../types';
import { fontString } from './text';

let registered = false;

/** Register the bundled Excalifont faces (lazy: a subset downloads on first use). */
export function registerBundledFonts() {
  if (registered || typeof document === 'undefined' || !document.fonts) return;
  registered = true;
  for (const f of EXCALIFONT_FACES) {
    document.fonts.add(new FontFace('Excalifont', `url(${f.url}) format('woff2')`, { unicodeRange: f.unicodeRange }));
  }
}

/** Load the default font's Latin subset. Never rejects: on failure text just uses the fallback stack. */
export async function loadDefaultFonts(): Promise<void> {
  registerBundledFonts();
  try {
    await document.fonts.load(fontString(16, 400, "'Excalifont'"));
  } catch {
    // font failed to load; canvas falls back to the rest of the stack
  }
}

/** Load every face (incl. unicode-range subsets) needed to draw these objects' text. */
export async function ensureObjectFonts(
  objs: Iterable<SlateObj>,
  /** FONTS id the object actually draws with (its style may override fontFamily) */
  fontIdOf: (o: SlateObj & { fontFamily?: string }) => string | undefined = (o) => o.fontFamily,
  /** weight the object's text draws with (a style may bold big text) */
  weightOf: (o: SlateObj & { fontSize?: number }) => number = () => 400
): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  registerBundledFonts();
  const byFace = new Map<string, { weight: number; stack: string; chars: Set<string> }>();
  for (const o of objs) {
    // connector labels draw in their style's font too
    const text = (o as { text?: unknown }).text || (o as { label?: unknown }).label;
    if (typeof text !== 'string' || !text) continue;
    const stack = fontStack(fontIdOf(o));
    const weight = weightOf(o);
    const key = `${weight} ${stack}`;
    let face = byFace.get(key);
    if (!face) byFace.set(key, (face = { weight, stack, chars: new Set() }));
    for (const ch of text) face.chars.add(ch);
  }
  await Promise.all(
    [...byFace.values()].map(({ weight, stack, chars }) =>
      document.fonts.load(fontString(16, weight, stack), [...chars].join('')).catch(() => [])
    )
  );
}

/** Codepoint ranges parsed from a CSS unicode-range ("U+20-7e,U+a0"). */
function parseRange(range: string): [number, number][] {
  return range.split(',').map((part) => {
    const [a, b] = part.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
}

async function dataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** @font-face rules (as data URLs) for the faces of `family` whose unicode-range covers `text`. */
async function embeddedFaceCss(family: string, faces: { url: string; unicodeRange: string; weight?: number }[], text: string): Promise<string> {
  const cps = new Set<number>();
  for (const ch of text) cps.add(ch.codePointAt(0)!);
  const rules: string[] = [];
  for (const f of faces) {
    const ranges = parseRange(f.unicodeRange);
    if (![...cps].some((c) => ranges.some(([lo, hi]) => c >= lo && c <= hi))) continue;
    rules.push(
      `@font-face{font-family:'${family}';font-weight:${f.weight ?? 400};src:url(${await dataUrl(f.url)}) format('woff2');unicode-range:${f.unicodeRange};}`
    );
  }
  return rules.join('\n');
}

/**
 * `@font-face` rules embedding the Excalifont subsets that cover `text`, as
 * data URLs, so an exported SVG renders handwritten anywhere (even as <img>).
 */
export function excalifontFaceCss(text: string): Promise<string> {
  return embeddedFaceCss('Excalifont', EXCALIFONT_FACES, text);
}

// Kalam (SIL OFL 1.1, @fontsource/kalam): the pen font stack's guaranteed fallback.
const KALAM_LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const KALAM_LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const KALAM_FACES = [
  { url: kalamLatin400, unicodeRange: KALAM_LATIN, weight: 400 },
  { url: kalamLatinExt400, unicodeRange: KALAM_LATIN_EXT, weight: 400 },
  { url: kalamLatin700, unicodeRange: KALAM_LATIN, weight: 700 },
  { url: kalamLatinExt700, unicodeRange: KALAM_LATIN_EXT, weight: 700 },
];

/** `@font-face` rules embedding Kalam for `text`, so the hand-drawn style's SVG export renders handwritten anywhere. */
export function kalamFaceCss(text: string): Promise<string> {
  return embeddedFaceCss('Kalam', KALAM_FACES, text);
}

/** `@font-face` rules embedding Caveat (the 'messy' style's font) at each weight in `textByWeight` (weight → text drawn at it). */
export async function caveatFaceCss(textByWeight: Map<number, string>): Promise<string> {
  const rules: string[] = [];
  for (const [weight, text] of textByWeight) {
    const css = await embeddedFaceCss('Caveat', CAVEAT_FACES.filter((f) => f.weight === weight), text);
    if (css) rules.push(css);
  }
  return rules.join('\n');
}

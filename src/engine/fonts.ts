// Webfont loading for canvas text. Canvas measureText/fillText silently use a
// fallback family while a webfont is still downloading, so anything that
// measures or paints text awaits these first.

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
  fontIdOf: (o: SlateObj & { fontFamily?: string }) => string | undefined = (o) => o.fontFamily
): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  registerBundledFonts();
  const byStack = new Map<string, Set<string>>();
  for (const o of objs) {
    const text = (o as { text?: unknown }).text;
    if (typeof text !== 'string' || !text) continue;
    const stack = fontStack(fontIdOf(o));
    let chars = byStack.get(stack);
    if (!chars) byStack.set(stack, (chars = new Set()));
    for (const ch of text) chars.add(ch);
  }
  await Promise.all(
    [...byStack].map(([stack, chars]) =>
      document.fonts.load(fontString(16, 400, stack), [...chars].join('')).catch(() => [])
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

/**
 * `@font-face` rules embedding the Excalifont subsets that cover `text`, as
 * data URLs, so an exported SVG renders handwritten anywhere (even as <img>).
 */
export async function excalifontFaceCss(text: string): Promise<string> {
  const cps = new Set<number>();
  for (const ch of text) cps.add(ch.codePointAt(0)!);
  const rules: string[] = [];
  for (const f of EXCALIFONT_FACES) {
    const ranges = parseRange(f.unicodeRange);
    if (![...cps].some((c) => ranges.some(([lo, hi]) => c >= lo && c <= hi))) continue;
    rules.push(
      `@font-face{font-family:'Excalifont';font-weight:400;src:url(${await dataUrl(f.url)}) format('woff2');unicode-range:${f.unicodeRange};}`
    );
  }
  return rules.join('\n');
}

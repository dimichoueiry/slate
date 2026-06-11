// Canvas text measurement + wrapping shared by renderer, editor overlay and export.

import { FONTS, fontStack } from '../types';

let measureCtx: CanvasRenderingContext2D | null = null;

function ctx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')!;
  }
  return measureCtx;
}

export const FONT_FAMILY = FONTS[0].stack;

export function fontString(size: number, weight = 400, family: string = FONT_FAMILY): string {
  return `${weight} ${size}px ${family}`;
}

export function lineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.35);
}

/** Wrap text into lines fitting maxWidth. Honors explicit newlines. */
export function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number,
  weight = 400,
  fontId?: string
): string[] {
  const c = ctx();
  c.font = fontString(fontSize, weight, fontStack(fontId));
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine === '') {
      out.push('');
      continue;
    }
    const words = rawLine.split(' ');
    let line = '';
    for (const word of words) {
      const probe = line ? line + ' ' + word : word;
      if (c.measureText(probe).width <= maxWidth || !line) {
        line = probe;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export function textBlockSize(
  text: string,
  fontSize: number,
  maxWidth?: number,
  weight = 400,
  fontId?: string
): { w: number; h: number; lines: string[] } {
  const lines = maxWidth ? wrapText(text, fontSize, maxWidth, weight, fontId) : text.split('\n');
  const c = ctx();
  c.font = fontString(fontSize, weight, fontStack(fontId));
  let w = 0;
  for (const line of lines) w = Math.max(w, c.measureText(line).width);
  return { w, h: lines.length * lineHeight(fontSize), lines };
}

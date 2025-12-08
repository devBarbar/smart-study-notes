import { CanvasStrokeData } from '@/types';

type Point = { x: number; y: number };
type Glyph = Point[][];

export type HandwritingOptions = {
  color?: string;
  strokeWidth?: number;
  charWidth?: number;
  charSpacing?: number;
  wordSpacing?: number;
  lineHeight?: number;
  jitter?: number;
  maxWidth?: number;
};

type TextToStrokesResult = {
  strokes: CanvasStrokeData[];
  width: number;
  height: number;
};

const DEFAULTS: Required<HandwritingOptions> = {
  color: '#0f172a',
  strokeWidth: 3,
  charWidth: 18,
  charSpacing: 3,
  wordSpacing: 8,
  lineHeight: 32,
  jitter: 0.8,
  maxWidth: 0,
};

const narrowChars = new Set(['i', 'l', 'I', '1', '.', ',', ':', ';', '!']);
const wideChars = new Set(['m', 'w', 'M', 'W']);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const jitterPoint = (point: Point, jitter: number): Point => ({
  x: point.x + (Math.random() - 0.5) * jitter,
  y: point.y + (Math.random() - 0.5) * jitter,
});

const scaleStroke = (stroke: Point[], offsetX: number, offsetY: number, width: number, height: number, jitter: number): Point[] =>
  stroke.map((p) => jitterPoint({ x: offsetX + p.x * width, y: offsetY + p.y * height }, jitter));

const asGlyph = (strokes: number[][][]): Glyph =>
  strokes.map((stroke) => stroke.map(([x, y]) => ({ x, y })));

// Minimal hand-drawn style glyphs on a 1x1 grid
const GLYPHS: Record<string, Glyph> = {
  A: asGlyph([
    [
      [0.1, 1],
      [0.5, 0],
      [0.9, 1],
    ],
    [
      [0.25, 0.6],
      [0.75, 0.6],
    ],
  ]),
  B: asGlyph([
    [
      [0.1, 0],
      [0.1, 1],
    ],
    [
      [0.1, 0],
      [0.75, 0.2],
      [0.1, 0.5],
    ],
    [
      [0.1, 0.5],
      [0.75, 0.7],
      [0.1, 1],
    ],
  ]),
  C: asGlyph([
    [
      [0.85, 0.1],
      [0.35, 0],
      [0.1, 0.35],
      [0.1, 0.65],
      [0.35, 1],
      [0.85, 0.9],
    ],
  ]),
  D: asGlyph([
    [
      [0.1, 0],
      [0.1, 1],
    ],
    [
      [0.1, 0],
      [0.8, 0.3],
      [0.8, 0.7],
      [0.1, 1],
    ],
  ]),
  E: asGlyph([
    [
      [0.85, 0],
      [0.1, 0],
      [0.1, 1],
      [0.85, 1],
    ],
    [
      [0.1, 0.52],
      [0.65, 0.52],
    ],
  ]),
  F: asGlyph([
    [
      [0.1, 1],
      [0.1, 0],
      [0.85, 0],
    ],
    [
      [0.1, 0.52],
      [0.65, 0.52],
    ],
  ]),
  G: asGlyph([
    [
      [0.85, 0.15],
      [0.35, 0],
      [0.1, 0.35],
      [0.1, 0.7],
      [0.35, 1],
      [0.85, 0.85],
      [0.85, 0.55],
      [0.55, 0.55],
    ],
  ]),
  H: asGlyph([
    [
      [0.1, 0],
      [0.1, 1],
    ],
    [
      [0.9, 0],
      [0.9, 1],
    ],
    [
      [0.1, 0.55],
      [0.9, 0.55],
    ],
  ]),
  I: asGlyph([
    [
      [0.5, 0],
      [0.5, 1],
    ],
  ]),
  J: asGlyph([
    [
      [0.85, 0],
      [0.6, 0],
      [0.6, 0.75],
      [0.35, 1],
      [0.1, 0.85],
    ],
  ]),
  K: asGlyph([
    [
      [0.1, 0],
      [0.1, 1],
    ],
    [
      [0.85, 0],
      [0.1, 0.55],
      [0.85, 1],
    ],
  ]),
  L: asGlyph([
    [
      [0.1, 0],
      [0.1, 1],
      [0.85, 1],
    ],
  ]),
  M: asGlyph([
    [
      [0.1, 1],
      [0.1, 0],
      [0.5, 0.4],
      [0.9, 0],
      [0.9, 1],
    ],
  ]),
  N: asGlyph([
    [
      [0.1, 1],
      [0.1, 0],
      [0.9, 1],
      [0.9, 0],
    ],
  ]),
  O: asGlyph([
    [
      [0.5, 0],
      [0.15, 0.2],
      [0.1, 0.5],
      [0.15, 0.8],
      [0.5, 1],
      [0.85, 0.8],
      [0.9, 0.5],
      [0.85, 0.2],
      [0.5, 0],
    ],
  ]),
  P: asGlyph([
    [
      [0.1, 1],
      [0.1, 0],
      [0.75, 0],
      [0.85, 0.25],
      [0.75, 0.5],
      [0.1, 0.5],
    ],
  ]),
  Q: asGlyph([
    [
      [0.5, 0],
      [0.15, 0.2],
      [0.1, 0.5],
      [0.15, 0.8],
      [0.5, 1],
      [0.85, 0.8],
      [0.9, 0.5],
      [0.85, 0.2],
      [0.5, 0],
    ],
    [
      [0.65, 0.65],
      [0.95, 0.95],
    ],
  ]),
  R: asGlyph([
    [
      [0.1, 1],
      [0.1, 0],
      [0.75, 0],
      [0.85, 0.25],
      [0.75, 0.5],
      [0.1, 0.5],
    ],
    [
      [0.1, 0.5],
      [0.85, 1],
    ],
  ]),
  S: asGlyph([
    [
      [0.85, 0.15],
      [0.35, 0],
      [0.1, 0.35],
      [0.65, 0.5],
      [0.9, 0.75],
      [0.35, 1],
      [0.1, 0.85],
    ],
  ]),
  T: asGlyph([
    [
      [0.05, 0],
      [0.95, 0],
    ],
    [
      [0.5, 0],
      [0.5, 1],
    ],
  ]),
  U: asGlyph([
    [
      [0.1, 0],
      [0.1, 0.7],
      [0.35, 1],
      [0.65, 1],
      [0.9, 0.7],
      [0.9, 0],
    ],
  ]),
  V: asGlyph([
    [
      [0.1, 0],
      [0.5, 1],
      [0.9, 0],
    ],
  ]),
  W: asGlyph([
    [
      [0.1, 0],
      [0.3, 1],
      [0.5, 0.2],
      [0.7, 1],
      [0.9, 0],
    ],
  ]),
  X: asGlyph([
    [
      [0.1, 0],
      [0.9, 1],
    ],
    [
      [0.9, 0],
      [0.1, 1],
    ],
  ]),
  Y: asGlyph([
    [
      [0.1, 0],
      [0.5, 0.5],
      [0.9, 0],
    ],
    [
      [0.5, 0.5],
      [0.5, 1],
    ],
  ]),
  Z: asGlyph([
    [
      [0.1, 0],
      [0.9, 0],
      [0.1, 1],
      [0.9, 1],
    ],
  ]),
  '0': asGlyph([
    [
      [0.5, 0],
      [0.15, 0.2],
      [0.1, 0.5],
      [0.15, 0.8],
      [0.5, 1],
      [0.85, 0.8],
      [0.9, 0.5],
      [0.85, 0.2],
      [0.5, 0],
    ],
    [
      [0.35, 0.35],
      [0.65, 0.65],
    ],
  ]),
  '1': asGlyph([
    [
      [0.3, 0.2],
      [0.5, 0],
      [0.5, 1],
    ],
  ]),
  '2': asGlyph([
    [
      [0.1, 0.25],
      [0.4, 0],
      [0.8, 0.25],
      [0.1, 1],
      [0.85, 1],
    ],
  ]),
  '3': asGlyph([
    [
      [0.1, 0.15],
      [0.45, 0],
      [0.8, 0.25],
      [0.45, 0.5],
      [0.8, 0.75],
      [0.45, 1],
      [0.1, 0.85],
    ],
  ]),
  '4': asGlyph([
    [
      [0.75, 0],
      [0.75, 1],
    ],
    [
      [0.05, 0.65],
      [0.9, 0.65],
    ],
    [
      [0.05, 0.65],
      [0.7, 0],
    ],
  ]),
  '5': asGlyph([
    [
      [0.85, 0.1],
      [0.2, 0.1],
      [0.2, 0.45],
      [0.7, 0.45],
      [0.85, 0.7],
      [0.5, 1],
      [0.15, 0.85],
    ],
  ]),
  '6': asGlyph([
    [
      [0.8, 0.15],
      [0.4, 0],
      [0.15, 0.35],
      [0.15, 0.65],
      [0.45, 1],
      [0.8, 0.7],
      [0.45, 0.5],
      [0.15, 0.65],
    ],
  ]),
  '7': asGlyph([
    [
      [0.1, 0],
      [0.9, 0],
      [0.35, 1],
    ],
  ]),
  '8': asGlyph([
    [
      [0.5, 0],
      [0.1, 0.25],
      [0.5, 0.5],
      [0.9, 0.25],
      [0.5, 0],
    ],
    [
      [0.5, 0.5],
      [0.1, 0.75],
      [0.5, 1],
      [0.9, 0.75],
      [0.5, 0.5],
    ],
  ]),
  '9': asGlyph([
    [
      [0.15, 0.85],
      [0.5, 1],
      [0.85, 0.65],
      [0.85, 0.35],
      [0.5, 0],
      [0.15, 0.35],
      [0.5, 0.5],
      [0.85, 0.35],
    ],
  ]),
  '?': asGlyph([
    [
      [0.2, 0.25],
      [0.5, 0],
      [0.8, 0.25],
      [0.5, 0.45],
      [0.5, 0.65],
    ],
    [
      [0.5, 0.92],
      [0.5, 0.98],
    ],
  ]),
  '!': asGlyph([
    [
      [0.5, 0],
      [0.5, 0.75],
    ],
    [
      [0.5, 0.92],
      [0.5, 0.98],
    ],
  ]),
  ':': asGlyph([
    [
      [0.5, 0.25],
      [0.5, 0.3],
    ],
    [
      [0.5, 0.7],
      [0.5, 0.75],
    ],
  ]),
  ';': asGlyph([
    [
      [0.5, 0.25],
      [0.5, 0.3],
    ],
    [
      [0.5, 0.7],
      [0.45, 0.9],
    ],
  ]),
  ',': asGlyph([
    [
      [0.55, 0.75],
      [0.45, 0.95],
    ],
  ]),
  '.': asGlyph([
    [
      [0.5, 0.75],
      [0.5, 0.8],
    ],
  ]),
  '-': asGlyph([
    [
      [0.2, 0.5],
      [0.8, 0.5],
    ],
  ]),
  '(': asGlyph([
    [
      [0.7, 0.05],
      [0.3, 0.5],
      [0.7, 0.95],
    ],
  ]),
  ')': asGlyph([
    [
      [0.3, 0.05],
      [0.7, 0.5],
      [0.3, 0.95],
    ],
  ]),
  '/': asGlyph([
    [
      [0.9, 0],
      [0.1, 1],
    ],
  ]),
  "'": asGlyph([
    [
      [0.5, 0],
      [0.45, 0.15],
    ],
  ]),
  '"': asGlyph([
    [
      [0.4, 0],
      [0.35, 0.15],
    ],
    [
      [0.6, 0],
      [0.55, 0.15],
    ],
  ]),
  ' ': [],
};

const getGlyph = (char: string): Glyph => {
  if (GLYPHS[char]) return GLYPHS[char];
  const upper = char.toUpperCase();
  if (GLYPHS[upper]) return GLYPHS[upper];
  // Fallback: simple zig-zag to keep it legible
  return asGlyph([
    [
      [0.1, 0.2],
      [0.9, 0.8],
    ],
    [
      [0.9, 0.2],
      [0.1, 0.8],
    ],
  ]);
};

const charWidthFor = (char: string, baseWidth: number) => {
  if (narrowChars.has(char)) return baseWidth * 0.6;
  if (wideChars.has(char)) return baseWidth * 1.2;
  return baseWidth;
};

export const textToStrokes = (
  text: string,
  startX: number,
  startY: number,
  options?: HandwritingOptions
): TextToStrokesResult => {
  const opts = { ...DEFAULTS, ...options };
  let cursorX = startX;
  let cursorY = startY;
  let maxWidthUsed = 0;
  const maxAllowedX = opts.maxWidth ? startX + opts.maxWidth : undefined;
  const strokes: CanvasStrokeData[] = [];

  for (const char of text) {
    if (char === '\n') {
      cursorX = startX;
      cursorY += opts.lineHeight;
      continue;
    }

    const baseWidth = charWidthFor(char, opts.charWidth);
    const advance = baseWidth + opts.charSpacing;

    if (char === ' ') {
      cursorX += baseWidth + opts.wordSpacing;
      maxWidthUsed = Math.max(maxWidthUsed, cursorX - startX);
      continue;
    }

    if (maxAllowedX && cursorX + advance > maxAllowedX) {
      cursorX = startX;
      cursorY += opts.lineHeight;
    }

    const glyph = getGlyph(char);
    glyph.forEach((stroke) => {
      const scaled = scaleStroke(stroke, cursorX, cursorY, baseWidth, opts.lineHeight * 0.9, opts.jitter);
      strokes.push({
        points: scaled,
        color: opts.color,
        width: clamp(opts.strokeWidth + (Math.random() - 0.5) * 0.4, 2.4, 4.2),
      });
    });

    cursorX += advance;
    maxWidthUsed = Math.max(maxWidthUsed, cursorX - startX);
  }

  const totalHeight = (cursorY - startY) + opts.lineHeight;

  return { strokes, width: maxWidthUsed, height: totalHeight };
};


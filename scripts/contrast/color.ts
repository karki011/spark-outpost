export type Rgba = { r: number; g: number; b: number; a: number };

const NAMED: Record<string, Rgba> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 1, g: 1, b: 1, a: 1 },
  currentcolor: { r: 0, g: 0, b: 0, a: 0 },
};

export function parseHex(hex: string): Rgba {
  const body = hex.slice(1);
  const expanded = body.length <= 4 ? [...body].map((c) => c + c).join('') : body;
  const channel = (i: number) => parseInt(expanded.slice(i, i + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4), a: expanded.length === 8 ? channel(6) : 1 };
}

export function toHex({ r, g, b }: Rgba): string {
  const channel = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function splitArgs(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts;
}

function part<T>(list: readonly T[], index: number, source: string): T {
  const value = list[index];
  if (value === undefined) throw new Error(`Malformed colour: ${source}`);
  return value;
}

function numberOrPercent(token: string, scale: number): number {
  return token.endsWith('%') ? (parseFloat(token) / 100) * scale : parseFloat(token);
}

function parseRgbFunction(inner: string): Rgba {
  const tokens = inner.replace(/[,/]/g, ' ').split(/\s+/).filter(Boolean);
  const channel = (index: number) => numberOrPercent(part(tokens, index, inner), 255) / 255;
  const alpha = tokens[3] === undefined ? 1 : numberOrPercent(tokens[3], 1);
  return { r: channel(0), g: channel(1), b: channel(2), a: alpha };
}

const srgbEncode = (v: number) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

export function oklchToRgba(l: number, c: number, h: number, a = 1): Rgba {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, srgbEncode(v)));
  return {
    r: clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    g: clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    b: clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
    a,
  };
}

export function rgbaToOklch({ r, g, b }: Rgba): { l: number; c: number; h: number } {
  const lr = srgbDecode(r);
  const lg = srgbDecode(g);
  const lb = srgbDecode(b);
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function parseOklch(inner: string): Rgba {
  const tokens = inner.replace('/', ' ').split(/\s+/).filter(Boolean);
  const l = numberOrPercent(part(tokens, 0, inner), 1);
  const c = parseFloat(part(tokens, 1, inner));
  const h = parseFloat(part(tokens, 2, inner));
  const alpha = tokens[3] === undefined ? 1 : numberOrPercent(tokens[3], 1);
  return oklchToRgba(l, c, h, alpha);
}

export function mixSrgb(first: Rgba, p1: number, second: Rgba, p2: number): Rgba {
  const total = p1 + p2;
  const w1 = p1 / total;
  const w2 = p2 / total;
  const alpha = first.a * w1 + second.a * w2;
  const channel = (k: 'r' | 'g' | 'b') =>
    alpha === 0 ? 0 : (first[k] * first.a * w1 + second[k] * second.a * w2) / alpha;
  const scale = Math.min(1, total / 100);
  return { r: channel('r'), g: channel('g'), b: channel('b'), a: alpha * scale };
}

function parseColorMix(inner: string, resolve: (expr: string) => Rgba): Rgba {
  const args = splitArgs(inner);
  const space = part(args, 0, inner);
  if (space !== 'in srgb') throw new Error(`Unsupported color-mix space: ${space}`);
  const stop = (index: number) => {
    const text = part(args, index, inner);
    const match = text.match(/^(.*?)\s+(\d+(?:\.\d+)?)%$/);
    if (!match?.[1] || !match[2]) return { color: resolve(text), pct: undefined };
    return { color: resolve(match[1]), pct: parseFloat(match[2]) };
  };
  const a = stop(1);
  const b = stop(2);
  const pa = a.pct ?? (b.pct === undefined ? 50 : 100 - b.pct);
  const pb = b.pct ?? 100 - pa;
  return mixSrgb(a.color, pa, b.color, pb);
}

export function parseColor(expr: string, resolve: (expr: string) => Rgba): Rgba {
  const value = expr.trim();
  const lower = value.toLowerCase();
  const named = NAMED[lower];
  if (named) return named;
  if (value.startsWith('#')) return parseHex(value);
  const fn = value.match(/^([a-z-]+)\((.*)\)$/s);
  if (!fn) throw new Error(`Unsupported colour: ${value}`);
  const name = fn[1];
  const inner = fn[2] ?? '';
  if (name === 'rgb' || name === 'rgba') return parseRgbFunction(inner);
  if (name === 'oklch') return parseOklch(inner);
  if (name === 'color-mix') return parseColorMix(inner, resolve);
  if (name === 'var') return resolve(value);
  throw new Error(`Unsupported colour function: ${name}`);
}

export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const channel = (k: 'r' | 'g' | 'b') => (top[k] * top.a + bottom[k] * bottom.a * (1 - top.a)) / a;
  return { r: channel('r'), g: channel('g'), b: channel('b'), a };
}

export function withAlpha(color: Rgba, alpha: number): Rgba {
  return { ...color, a: color.a * alpha };
}

export function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * srgbDecode(r) + 0.7152 * srgbDecode(g) + 0.0722 * srgbDecode(b);
}

export function contrast(first: Rgba, second: Rgba): number {
  const hi = Math.max(luminance(first), luminance(second));
  const lo = Math.min(luminance(first), luminance(second));
  return (hi + 0.05) / (lo + 0.05);
}

import type { FileKind } from './file-kind.ts';

export interface Palette {
  sky0: string;
  sky1: string;
  grid: string;
  dust: string;
  star: string;
  line: string;
  gold: string;
  warm: string;
  cross: string;
  skel: string;
  text: string;
  muted: string;
  bridge: string;
  event: string;
  types: string;
  pill: string;
  kind: Record<FileKind, string>;
  tints: string[];
  dark: boolean;
  glow: HTMLCanvasElement;
  warmGlow: HTMLCanvasElement;
}

const TOKENS = {
  sky0: '--map-sky-0',
  sky1: '--map-sky-1',
  grid: '--map-grid',
  dust: '--map-dust',
  star: '--map-star',
  line: '--map-star-line',
  gold: '--map-gold',
  warm: '--map-warm',
  cross: '--map-cross',
  skel: '--map-skel',
  text: '--text',
  muted: '--muted',
  bridge: '--map-bridge',
  event: '--map-event',
  types: '--map-types',
  pill: '--map-pill',
} as const;

function resolveColor(probe: HTMLElement, token: string): string {
  probe.style.color = `var(${token})`;
  return getComputedStyle(probe).color;
}

function luminance(color: string): number {
  const scale = color.startsWith('color(') ? 1 : 255;
  const [r = 0, g = 0, b = 0] = (color.replace(/^color\(\w+/, '').match(/[\d.]+/g) ?? []).map(
    Number,
  );
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / scale;
}

function glowSprite(color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, color);
  gradient.addColorStop(
    0.25,
    color.replace(/rgba?\(([^)]+)\)/, (_, inner: string) => fade(inner, 0.3)),
  );
  gradient.addColorStop(
    1,
    color.replace(/rgba?\(([^)]+)\)/, (_, inner: string) => fade(inner, 0)),
  );
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return canvas;
}

function fade(inner: string, alpha: number): string {
  const [r, g, b] = inner.split(',').map((part) => part.trim());
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function readPalette(host: HTMLElement): Palette {
  const probe = document.createElement('span');
  probe.hidden = true;
  host.append(probe);
  const read = (token: string) => resolveColor(probe, token);
  const colors = Object.fromEntries(
    Object.entries(TOKENS).map(([name, token]) => [name, read(token)]),
  ) as Record<keyof typeof TOKENS, string>;
  const palette: Palette = {
    ...colors,
    kind: {
      ui: read('--map-k-ui'),
      api: read('--map-k-api'),
      data: read('--map-k-data'),
      test: read('--map-k-test'),
      config: read('--map-k-config'),
    },
    tints: [1, 2, 3, 4].map((n) => read(`--map-tint-${n}`)),
    dark: luminance(colors.sky1) < 0.4,
    glow: glowSprite(read('--map-glow')),
    warmGlow: glowSprite(colors.warm),
  };
  probe.remove();
  return palette;
}

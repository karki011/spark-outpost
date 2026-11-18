import type { ArtifactShareTheme } from '@spark-outpost/contracts';

const TOKENS = {
  bg: '--bg',
  card: '--panel',
  text: '--text',
  muted: '--muted',
  line: '--line-strong',
  accent: '--accent',
  accentInk: '--accent-ink',
  ok: '--success',
  bad: '--danger',
  strip: '--raise',
} as const;

type Channels = [number, number, number];

const hex = (channel: number) => Math.round(channel).toString(16).padStart(2, '0');

function channels(color: string): Channels | null {
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(
    color,
  );
  if (rgb) {
    if (rgb[4] !== undefined && rgb[4] !== '1' && rgb[4] !== '100%') return null;
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(color);
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  return null;
}

export function hexColor(computed: string): string | null {
  const parsed = channels(computed.trim());
  if (!parsed || parsed.some((channel) => !(channel >= 0 && channel <= 255))) return null;
  return `#${parsed.map(hex).join('')}`;
}

function isDark(color: string): boolean {
  const [red, green, blue] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue! < 128;
}

export function shareTheme(computedColor: (token: string) => string): ArtifactShareTheme | null {
  const colors: Record<string, string> = {};
  for (const [name, token] of Object.entries(TOKENS)) {
    const color = hexColor(computedColor(token));
    if (!color) return null;
    colors[name] = color;
  }
  return {
    ...(colors as Omit<ArtifactShareTheme, 'scheme'>),
    scheme: isDark(colors.bg!) ? 'dark' : 'light',
  };
}

export function currentShareTheme(): ArtifactShareTheme | null {
  const probe = document.createElement('span');
  probe.hidden = true;
  document.body.append(probe);
  try {
    return shareTheme((token) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    });
  } finally {
    probe.remove();
  }
}

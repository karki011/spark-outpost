export const THEME_COLORS = [
  'bg',
  'card',
  'text',
  'muted',
  'line',
  'accent',
  'accentInk',
  'ok',
  'bad',
  'strip',
] as const;
export const THEME_SCHEMES = ['light', 'dark'] as const;
export const THEME_COLOR = /^#[0-9a-f]{6}$/;

type ThemeColor = (typeof THEME_COLORS)[number];

export type ShareTheme = { scheme: (typeof THEME_SCHEMES)[number] } & Record<ThemeColor, string>;

const CSS_NAMES: Record<ThemeColor, string> = {
  bg: '--bg',
  card: '--card',
  text: '--text',
  muted: '--muted',
  line: '--line',
  accent: '--accent',
  accentInk: '--accent-ink',
  ok: '--ok',
  bad: '--bad',
  strip: '--strip',
};

export function parseTheme(value: unknown): ShareTheme | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== THEME_COLORS.length + 1) return null;
  const { scheme } = record;
  if (scheme !== 'light' && scheme !== 'dark') return null;
  const theme: Partial<ShareTheme> = { scheme };
  for (const name of THEME_COLORS) {
    const color = record[name];
    if (typeof color !== 'string' || !THEME_COLOR.test(color)) return null;
    theme[name] = color;
  }
  return theme as ShareTheme;
}

export function storedTheme(text: string | undefined): ShareTheme | null {
  if (!text) return null;
  try {
    return parseTheme(JSON.parse(text));
  } catch {
    return null;
  }
}

export function themeCss(theme: ShareTheme | null | undefined): string {
  if (!theme) return '';
  const colors = THEME_COLORS.map((name) => `${CSS_NAMES[name]}: ${theme[name]};`).join(' ');
  return `
:root {
  color-scheme: ${theme.scheme};
  ${colors}
  --accent-glow: color-mix(in srgb, ${theme.accent} 32%, transparent);
  --ok-glow: color-mix(in srgb, ${theme.ok} 35%, transparent);
}
`;
}

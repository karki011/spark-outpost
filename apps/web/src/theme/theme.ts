export const themes = [
  {
    id: 'system',
    label: 'Match system',
    description: 'Follows your light or dark setting',
    swatch: { accent: '#8b95a3', background: '#12161a' },
  },
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Dark, teal accent',
    swatch: { accent: '#34c3a3', background: '#12161a' },
  },
  {
    id: 'apricot',
    label: 'Apricot',
    description: 'Warm light, orange accent',
    swatch: { accent: '#e2742f', background: '#fffdfb' },
  },
  {
    id: 'void',
    label: 'Void',
    description: 'Pure black, violet accent',
    swatch: { accent: '#9d8aff', background: '#000000' },
  },
  {
    id: 'fjord',
    label: 'Fjord',
    description: 'Cool light, blue accent',
    swatch: { accent: '#2f6fe4', background: '#ffffff' },
  },
  {
    id: 'moss',
    label: 'Moss',
    description: 'Deep green, lime accent',
    swatch: { accent: '#c7d96b', background: '#171b13' },
  },
  {
    id: 'lagoon',
    label: 'Lagoon',
    description: 'Sea-glass light, teal accent',
    swatch: { accent: '#0a7389', background: '#fbfefe' },
  },
  {
    id: 'plum',
    label: 'Plum',
    description: 'Dusky plum, rose-gold accent',
    swatch: { accent: '#e9ab8c', background: '#1c1520' },
  },
  {
    id: 'sage',
    label: 'Sage',
    description: 'Soft sage, clay accent',
    swatch: { accent: '#a85a2a', background: '#fbfcf8' },
  },
  {
    id: 'aurora',
    label: 'Aurora',
    description: 'Night violet, lime glow',
    swatch: { accent: '#c1f354', background: '#18152f' },
  },
  {
    id: 'iris',
    label: 'Iris',
    description: 'Lilac light, indigo accent',
    swatch: { accent: '#5b3df5', background: '#fdfcff' },
  },
  {
    id: 'contrast',
    label: 'High contrast',
    description: 'Maximum legibility',
    swatch: { accent: '#0000e0', background: '#ffffff' },
  },
] as const;

export type ThemeId = (typeof themes)[number]['id'];

const STORAGE_KEY = 'spark-outpost.theme';
const DEFAULT_THEME: ThemeId = 'graphite';

function isThemeId(value: string | null): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}

export function readTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(id: ThemeId): void {
  if (id === 'system') delete document.documentElement.dataset.skin;
  else document.documentElement.dataset.skin = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    return;
  }
}

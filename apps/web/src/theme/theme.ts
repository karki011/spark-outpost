export const modes = [
  { id: 'auto', label: 'Automatic' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
] as const;

export const contrastChoices = [
  { id: 'system', label: 'Follow system' },
  { id: 'always', label: 'Always' },
] as const;

export const tints = [
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Neutral grey, teal accent',
    light: 'light',
    dark: 'graphite',
    swatch: { accent: '#34c3a3', background: '#12161a' },
  },
  {
    id: 'apricot',
    label: 'Apricot · Plum',
    description: 'Warm cream and dusky plum',
    light: 'apricot',
    dark: 'plum',
    swatch: { accent: '#e2742f', background: '#1c1520' },
  },
  {
    id: 'lagoon',
    label: 'Lagoon · Moss',
    description: 'Sea-glass and deep green',
    light: 'lagoon',
    dark: 'moss',
    swatch: { accent: '#0a7389', background: '#171b13' },
  },
  {
    id: 'iris',
    label: 'Iris · Aurora',
    description: 'Lilac and night violet',
    light: 'iris',
    dark: 'aurora',
    swatch: { accent: '#5b3df5', background: '#18152f' },
  },
  {
    id: 'fjord',
    label: 'Fjord · Void',
    description: 'Cool blue and pure black',
    light: 'fjord',
    dark: 'void',
    swatch: { accent: '#2866d4', background: '#07070a' },
  },
  {
    id: 'sage',
    label: 'Sage · Loam',
    description: 'Soft sage and dark loam, clay accent',
    light: 'sage',
    dark: 'loam',
    swatch: { accent: '#a85a2a', background: '#1a1913' },
  },
] as const;

export type Mode = (typeof modes)[number]['id'];
export type ContrastChoice = (typeof contrastChoices)[number]['id'];
export type Tint = (typeof tints)[number];
export type TintId = Tint['id'];
export type SkinId = Tint['light'] | Tint['dark'] | 'contrast' | 'contrast-dark';

export interface Appearance {
  mode: Mode;
  tint: TintId;
  contrast: ContrastChoice;
}

export interface SystemLook {
  dark: boolean;
  moreContrast: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  mode: 'auto',
  tint: 'graphite',
  contrast: 'system',
};

function isMode(value: string | undefined): value is Mode {
  return modes.some((mode) => mode.id === value);
}

function isContrast(value: string | undefined): value is ContrastChoice {
  return contrastChoices.some((choice) => choice.id === value);
}

export function tintOf(id: TintId): Tint {
  return tints.find((tint) => tint.id === id) ?? tints[0];
}

function fromLegacyTheme(theme: string): Appearance {
  if (theme === 'light') return { ...DEFAULT_APPEARANCE, mode: 'light' };
  if (theme === 'dark') return { ...DEFAULT_APPEARANCE, mode: 'dark' };
  if (theme === 'contrast') return { ...DEFAULT_APPEARANCE, mode: 'light', contrast: 'always' };
  const lightOf = tints.find((tint) => tint.light === theme);
  if (lightOf) return { ...DEFAULT_APPEARANCE, mode: 'light', tint: lightOf.id };
  const darkOf = tints.find((tint) => tint.dark === theme);
  if (darkOf) return { ...DEFAULT_APPEARANCE, mode: 'dark', tint: darkOf.id };
  return DEFAULT_APPEARANCE;
}

export function parseAppearance(stored: string | null): Appearance {
  if (!stored) return DEFAULT_APPEARANCE;
  const parts = stored.split('.');
  if (parts.length === 1) return fromLegacyTheme(stored);
  const [mode, tintId, contrast] = parts;
  const tint = tints.find((option) => option.id === tintId);
  if (parts.length !== 3 || !isMode(mode) || !tint || !isContrast(contrast)) {
    return DEFAULT_APPEARANCE;
  }
  return { mode, tint: tint.id, contrast };
}

export function formatAppearance(appearance: Appearance): string {
  return `${appearance.mode}.${appearance.tint}.${appearance.contrast}`;
}

export function contrastOn(appearance: Appearance, system: SystemLook): boolean {
  return appearance.contrast === 'always' || system.moreContrast;
}

export function resolveSkin(appearance: Appearance, system: SystemLook): SkinId {
  const dark = appearance.mode === 'auto' ? system.dark : appearance.mode === 'dark';
  if (contrastOn(appearance, system)) return dark ? 'contrast-dark' : 'contrast';
  const tint = tintOf(appearance.tint);
  return dark ? tint.dark : tint.light;
}

export function resolveIslandSkin(appearance: Appearance, system: SystemLook): SkinId {
  return contrastOn(appearance, system) ? 'contrast-dark' : tintOf(appearance.tint).dark;
}

export function appearanceSummary(appearance: Appearance): string {
  const mode = modes.find((option) => option.id === appearance.mode)?.label ?? 'Automatic';
  const contrast = appearance.contrast === 'always' ? ' · High contrast' : '';
  return `${mode} · ${tintOf(appearance.tint).label}${contrast}`;
}

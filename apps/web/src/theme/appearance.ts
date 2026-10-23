import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import {
  DEFAULT_APPEARANCE,
  formatAppearance,
  parseAppearance,
  resolveIslandSkin,
  resolveSkin,
  type Appearance,
  type SystemLook,
} from './theme.ts';

export const APPEARANCE_KEY = 'spark-outpost.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const MORE_CONTRAST_QUERY = '(prefers-contrast: more)';
const SYSTEM_BAR_COLORS = ['#eaecf0', '#07090b'];
const CHANGED_EVENT = 'spark-outpost:appearance';
let unsaved: Appearance = DEFAULT_APPEARANCE;

export function readAppearance(): Appearance {
  try {
    return parseAppearance(localStorage.getItem(APPEARANCE_KEY));
  } catch {
    return unsaved;
  }
}

export function systemLook(): SystemLook {
  return {
    dark: window.matchMedia(DARK_QUERY).matches,
    moreContrast: window.matchMedia(MORE_CONTRAST_QUERY).matches,
  };
}

export function syncThemeColor(): void {
  const skinned = document.documentElement.dataset.skin !== undefined;
  const rail = getComputedStyle(document.documentElement).getPropertyValue('--rail').trim();
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta, index) => {
    const fallback = SYSTEM_BAR_COLORS[index];
    const color = skinned && rail ? rail : fallback;
    if (color) meta.content = color;
  });
}

export function showAppearance(appearance: Appearance = readAppearance()): void {
  const root = document.documentElement;
  const resolve = root.dataset.island === undefined ? resolveSkin : resolveIslandSkin;
  const skin = resolve(appearance, systemLook());
  if (root.dataset.skin === skin) return;
  root.dataset.skin = skin;
  syncThemeColor();
}

export function saveAppearance(appearance: Appearance): void {
  showAppearance(appearance);
  const stored = formatAppearance(appearance);
  sparkDesktop()?.theme?.save(stored);
  try {
    localStorage.setItem(APPEARANCE_KEY, stored);
  } catch {
    unsaved = appearance;
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function onAppearanceChange(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === APPEARANCE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGED_EVENT, listener);
  };
}

export function followAppearance(): () => void {
  const refresh = () => showAppearance();
  const queries = [DARK_QUERY, MORE_CONTRAST_QUERY].map((query) => window.matchMedia(query));
  refresh();
  syncThemeColor();
  const stopStorage = onAppearanceChange(refresh);
  queries.forEach((query) => query.addEventListener('change', refresh));
  return () => {
    stopStorage();
    queries.forEach((query) => query.removeEventListener('change', refresh));
  };
}

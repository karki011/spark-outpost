import { useLayoutEffect } from 'react';
import { readTheme, type ThemeId } from '../theme/theme.ts';

const THEME_KEY = 'spark-outpost.theme';

const NIGHT_SKIN: Partial<Record<ThemeId, ThemeId>> = {
  system: 'graphite',
  apricot: 'plum',
  fjord: 'void',
  lagoon: 'graphite',
  sage: 'moss',
  iris: 'void',
  contrast: 'void',
};

export function islandSkin(theme: ThemeId): ThemeId {
  return NIGHT_SKIN[theme] ?? theme;
}

function applySkin(): void {
  document.documentElement.dataset.skin = islandSkin(readTheme());
}

export function useThemeSync(): void {
  useLayoutEffect(() => {
    applySkin();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_KEY) applySkin();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}

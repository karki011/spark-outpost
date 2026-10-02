import { useEffect } from 'react';
import { readTheme } from '../theme/theme.ts';

const THEME_KEY = 'spark-outpost.theme';

function applySkin(): void {
  const theme = readTheme();
  if (theme === 'system') delete document.documentElement.dataset.skin;
  else document.documentElement.dataset.skin = theme;
}

export function useThemeSync(): void {
  useEffect(() => {
    applySkin();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_KEY) applySkin();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}

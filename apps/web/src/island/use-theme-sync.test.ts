import { describe, expect, it } from 'vitest';
import { themes } from '../theme/theme.ts';
import { islandSkin } from './use-theme-sync.ts';

const NIGHT = ['graphite', 'void', 'moss', 'plum', 'aurora'];

describe('the island skin', () => {
  it('stays a night glass panel in every app theme', () => {
    for (const theme of themes) expect(NIGHT).toContain(islandSkin(theme.id));
  });

  it('keeps a dark theme the user picked', () => {
    expect(islandSkin('aurora')).toBe('aurora');
    expect(islandSkin('void')).toBe('void');
  });
});

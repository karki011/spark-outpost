import { describe, expect, it } from 'vitest';
import { picked } from './MapFilters.tsx';

const ALL = ['ui', 'api', 'data'] as const;

describe('picked', () => {
  it('toggles one chip on a plain click', () => {
    expect([...picked(new Set(ALL), 'api', ALL, false)]).toEqual(['ui', 'data']);
    expect([...picked(new Set(['ui']), 'api', ALL, false)]).toEqual(['ui', 'api']);
  });

  it('shows only the chip on a shift-click', () => {
    expect([...picked(new Set(ALL), 'api', ALL, true)]).toEqual(['api']);
    expect([...picked(new Set(['ui']), 'api', ALL, true)]).toEqual(['api']);
  });

  it('brings every chip back on a shift-click of the only one shown', () => {
    expect([...picked(new Set(['api']), 'api', ALL, true)]).toEqual(ALL);
  });
});

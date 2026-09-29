import { describe, expect, it } from 'vitest';
import { branchRows } from './place-picker-model.ts';

const branches = {
  current: 'main',
  local: ['feature/login', 'main', 'fix/typo'],
  remote: ['release/2.0'],
  hasRemote: true,
  fetchFailed: false,
};

describe('branchRows', () => {
  it('puts the checked-out branch first and tags it and remote branches', () => {
    const rows = branchRows(branches, '', 'main');
    expect(rows.map((row) => row.name)).toEqual([
      'main',
      'feature/login',
      'fix/typo',
      'release/2.0',
    ]);
    expect(rows[0]?.tags).toEqual(['in your folder']);
    expect(rows.at(-1)).toEqual({ name: 'release/2.0', remote: true, tags: ['remote'] });
  });

  it('filters by a case-insensitive search', () => {
    expect(branchRows(branches, ' LOG ', 'main').map((row) => row.name)).toEqual(['feature/login']);
  });
});

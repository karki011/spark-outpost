import { describe, expect, it } from 'vitest';
import { branchRows, branchTip, showsPlaceMenu } from './place-picker-model.ts';

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
    expect(rows[0]?.tags).toEqual(['in my files']);
    expect(rows.at(-1)).toEqual({ name: 'release/2.0', remote: true, tags: ['remote'] });
  });

  it('filters by a case-insensitive search', () => {
    expect(branchRows(branches, ' LOG ', 'main').map((row) => row.name)).toEqual(['feature/login']);
  });
});

describe('branchTip', () => {
  const chat = {
    projectId: '00000000-0000-4000-8000-000000000000',
    branch: 'spark/fix-divider',
    path: '/repo/.spark/worktrees/1',
    worktree: true,
    owned: true,
    baseBranch: 'main',
    baseRef: null,
    createdAt: null,
    adopted: null,
  };

  it('names the base the chat branched from and when', () => {
    const now = Date.parse('2026-10-02T12:02:00Z');
    const fresh = { ...chat, baseRef: 'origin/main', createdAt: '2026-10-02T12:00:00Z' };
    expect(branchTip(fresh, now)).toBe('spark/fix-divider · from origin/main · 2 min ago');
    expect(branchTip(chat, now)).toBe('spark/fix-divider');
  });
});

describe('showsPlaceMenu', () => {
  const fresh = { place: 'worktree' as const, requestedBranch: null, current: null };

  it('hides the picker until the workspace loads and once the chat has a branch', () => {
    expect(showsPlaceMenu(undefined, 'main')).toBe(false);
    const current = {
      projectId: '00000000-0000-4000-8000-000000000000',
      branch: 'spark/x',
      path: '/tmp/x',
      worktree: true,
      owned: true,
      baseBranch: null,
      baseRef: null,
      createdAt: null,
    };
    expect(showsPlaceMenu({ ...fresh, current }, 'main')).toBe(false);
  });

  it('hides a fresh worktree picker in a folder with no checked-out branch', () => {
    expect(showsPlaceMenu(fresh, null)).toBe(false);
    expect(showsPlaceMenu(fresh, 'main')).toBe(true);
    expect(showsPlaceMenu({ ...fresh, place: 'checkout' }, null)).toBe(true);
    expect(showsPlaceMenu({ ...fresh, requestedBranch: 'feature' }, null)).toBe(true);
  });
});

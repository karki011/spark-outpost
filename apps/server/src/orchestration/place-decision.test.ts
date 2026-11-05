import { describe, expect, it } from 'vitest';
import { decidePlace, namedBranch, type PlaceFacts } from './place-decision.ts';

const facts = (overrides: Partial<PlaceFacts> = {}): PlaceFacts => ({
  preference: 'worktree',
  requested: null,
  current: 'main',
  clean: true,
  local: ['main', 'feature/login'],
  remote: new Map([['release', 'origin/release']]),
  checkedOutElsewhere: false,
  ...overrides,
});

describe('where a Do chat works', () => {
  it('starts a new branch in a worktree by default', () => {
    expect(decidePlace(facts())).toEqual({ kind: 'new', from: null, note: null });
  });

  it('works in the checkout when the user chose that', () => {
    expect(decidePlace(facts({ preference: 'checkout' }))).toEqual({
      kind: 'checkout',
      note: null,
    });
  });

  it('works in place on the checked-out branch when the tree is clean', () => {
    expect(decidePlace(facts({ requested: 'main' }))).toEqual({ kind: 'in_place', branch: 'main' });
  });

  it('starts from the checked-out branch in a worktree when that tree is dirty', () => {
    const decision = decidePlace(facts({ requested: 'main', clean: false }));
    expect(decision).toMatchObject({ kind: 'new', from: 'main' });
    expect(decision.kind === 'new' && decision.note).toContain('uncommitted changes');
  });

  it('checks out another local branch in a worktree, even when the user prefers the checkout', () => {
    const decision = decidePlace(facts({ requested: 'feature/login', preference: 'checkout' }));
    expect(decision).toEqual({ kind: 'existing', branch: 'feature/login' });
  });

  it('starts from a branch that another worktree already has open', () => {
    const decision = decidePlace(facts({ requested: 'feature/login', checkedOutElsewhere: true }));
    expect(decision).toMatchObject({ kind: 'new', from: 'feature/login' });
  });

  it('tracks a branch that exists only on the remote', () => {
    expect(decidePlace(facts({ requested: 'release' }))).toEqual({
      kind: 'remote',
      branch: 'release',
      ref: 'origin/release',
    });
  });

  it('says so when the chosen branch is gone', () => {
    const decision = decidePlace(facts({ requested: 'gone' }));
    expect(decision).toMatchObject({ kind: 'new', from: null });
    expect(decision.kind === 'new' && decision.note).toContain('no branch named gone');
  });
});

describe('where a stacked sub-chat works', () => {
  const stackOn = { branch: 'spark/api-1a2b3c4d', owner: '@api' };
  const local = ['main', 'spark/api-1a2b3c4d'];

  it('starts its own branch from the branch it is stacked on', () => {
    const decision = decidePlace(facts({ stackOn, local }));
    expect(decision).toMatchObject({ kind: 'new', from: 'spark/api-1a2b3c4d' });
    expect(decision.kind === 'new' && decision.note).toBe(
      "This chat's branch starts from @api's branch spark/api-1a2b3c4d, and its pull request targets that branch.",
    );
  });

  it('never works on that branch itself when the first message names it', () => {
    for (const preference of ['worktree', 'checkout'] as const) {
      const decision = decidePlace(
        facts({ stackOn, local, requested: 'spark/api-1a2b3c4d', preference }),
      );
      expect(decision).toMatchObject({ kind: 'new', from: 'spark/api-1a2b3c4d' });
    }
  });

  it('keeps a different branch the user chose, and the checkout when that was chosen', () => {
    expect(
      decidePlace(
        facts({ stackOn, local: [...local, 'feature/login'], requested: 'feature/login' }),
      ),
    ).toEqual({
      kind: 'existing',
      branch: 'feature/login',
    });
    expect(decidePlace(facts({ stackOn, local, preference: 'checkout' }))).toEqual({
      kind: 'checkout',
      note: null,
    });
  });

  it('starts from the default branch when the branch it would stack on is not in the repository', () => {
    expect(decidePlace(facts({ stackOn }))).toEqual({ kind: 'new', from: null, note: null });
  });
});

describe('a branch named in the request', () => {
  const known = new Set(['main', 'feature/login', 'release-2']);

  it('finds branches the repo has', () => {
    expect(namedBranch('Fix the header on branch feature/login.', known)).toBe('feature/login');
    expect(namedBranch('Work on the `release-2` branch please', known)).toBe('release-2');
    expect(namedBranch('Use the main branch', known)).toBe('main');
  });

  it('ignores words that are not branches', () => {
    expect(namedBranch('Create a new branch for the main function', known)).toBeNull();
    expect(namedBranch('Fix the main function', known)).toBeNull();
  });
});

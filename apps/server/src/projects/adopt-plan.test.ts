import { describe, expect, it } from 'vitest';
import type { OpenPull } from '@spark-outpost/contracts';
import { adoptPlan, forkRemoteName, type AdoptFacts } from './adopt-plan.ts';

const PULL: OpenPull = {
  number: 12,
  title: 'Fix dates',
  url: 'https://github.com/acme/app/pull/12',
  author: 'alice',
  head: 'alice/fix-dates',
  base: 'main',
  fork: false,
  maintainerCanModify: false,
};
const FACTS: AdoptFacts = {
  guarded: ['main', 'master', 'develop'],
  protectedOnHost: false,
  localBranch: false,
  checkedOut: false,
};

describe('adoptPlan()', () => {
  it('adopts a same-repo head branch', () => {
    expect(adoptPlan(PULL, FACTS)).toEqual({
      kind: 'head',
      branch: 'alice/fix-dates',
      fork: false,
      local: false,
    });
  });

  it('reuses a local branch of the same repo', () => {
    expect(adoptPlan(PULL, { ...FACTS, localBranch: true })).toMatchObject({
      kind: 'head',
      local: true,
    });
  });

  it('adopts a fork branch only when maintainers can modify it', () => {
    const fork = { ...PULL, fork: true };
    expect(adoptPlan({ ...fork, maintainerCanModify: true }, FACTS)).toMatchObject({
      kind: 'head',
      fork: true,
    });
    const plan = adoptPlan(fork, FACTS);
    expect(plan.kind).toBe('based');
    expect(plan.kind === 'based' && plan.why).toContain("doesn't allow edits by maintainers");
  });

  it.each(['main', 'develop'])('never adopts the protected branch %s as the head', (head) => {
    expect(adoptPlan({ ...PULL, head }, FACTS)).toMatchObject({ kind: 'based' });
  });

  it('works on its own branch when GitHub protects the head', () => {
    expect(adoptPlan(PULL, { ...FACTS, protectedOnHost: true })).toMatchObject({ kind: 'based' });
  });

  it('does not take over a different local branch with the fork branch name', () => {
    const fork = { ...PULL, fork: true, maintainerCanModify: true };
    expect(adoptPlan(fork, { ...FACTS, localBranch: true })).toMatchObject({ kind: 'based' });
  });

  it('asks to switch away when the head is checked out elsewhere', () => {
    expect(adoptPlan(PULL, { ...FACTS, checkedOut: true })).toMatchObject({ kind: 'busy' });
  });

  it.each(['-x', '../etc', 'a b'])('refuses the odd head name %s', (head) => {
    expect(adoptPlan({ ...PULL, head }, FACTS)).toMatchObject({ kind: 'based' });
  });
});

describe('forkRemoteName()', () => {
  it('names the remote after the fork owner', () => {
    expect(forkRemoteName('Alice_Dev')).toBe('pr-alice-dev');
  });
});

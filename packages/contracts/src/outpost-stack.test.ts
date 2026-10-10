import { describe, expect, it } from 'vitest';
import { prBase, stackWarnings } from './outpost-stack.ts';
import type { StackFacts } from './outpost-story.ts';
import { stackWarningSchema } from './outposts.ts';

const PARENT = 'spark/orders-endpoint-0a1b2c3d';
const OWN = 'spark/orders-page-1a2b3c4d';

function facts(extra: Partial<StackFacts> = {}): StackFacts {
  return {
    handle: 'web',
    parentHandle: 'api',
    defaultBranch: 'main',
    branch: OWN,
    pull: { state: 'open', base: PARENT },
    parentBranch: PARENT,
    parentOnRemote: true,
    parentInBranch: true,
    parentState: 'answered',
    parentPull: { state: 'open' },
    ...extra,
  };
}

function kinds(extra: Partial<StackFacts> = {}): string[] {
  return stackWarnings(facts(extra)).map((warning) => warning.kind);
}

describe('prBase', () => {
  it('targets the parent branch while the parent is open or has no pull request yet', () => {
    expect(prBase(facts())).toBe(PARENT);
    expect(prBase(facts({ parentPull: null, pull: null }))).toBe(PARENT);
    expect(prBase(facts({ parentOnRemote: false, parentPull: null }))).toBe(PARENT);
  });

  it('falls back to the default branch when the parent merged or was closed', () => {
    expect(prBase(facts({ parentPull: { state: 'merged' } }))).toBe('main');
    expect(prBase(facts({ parentPull: { state: 'closed' } }))).toBe('main');
  });

  it('falls back to the default branch when the parent has no branch', () => {
    expect(prBase(facts({ parentBranch: null, parentPull: null, defaultBranch: 'trunk' }))).toBe(
      'trunk',
    );
  });
});

describe('stackWarnings', () => {
  it('says nothing about a healthy stack, before or after its pull request opens', () => {
    expect(stackWarnings(facts())).toEqual([]);
    expect(stackWarnings(facts({ pull: null, parentPull: null }))).toEqual([]);
    expect(stackWarnings(facts({ branch: null, pull: null, parentInBranch: null }))).toEqual([]);
    expect(stackWarnings(facts({ parentState: 'working', parentInBranch: null }))).toEqual([]);
  });

  it('warns when the parent has commits the stacked branch lacks', () => {
    expect(stackWarnings(facts({ parentInBranch: false }))).toEqual([
      { kind: 'behind_parent', text: '@api has commits that @web does not have' },
    ]);
    expect(kinds({ parentInBranch: false, branch: null, pull: null })).toEqual([]);
    expect(kinds({ parentInBranch: null })).toEqual([]);
  });

  it('warns when the parent branch is not on the remote', () => {
    expect(stackWarnings(facts({ parentOnRemote: false, parentPull: null, pull: null }))).toEqual([
      { kind: 'parent_not_pushed', text: "@api's branch is not pushed, so @web cannot push" },
    ]);
    expect(kinds({ parentOnRemote: false, parentBranch: null, parentPull: null })).toEqual([
      'base_mismatch',
    ]);
  });

  it('warns that a pull request still based on a merged parent would not reach the default branch', () => {
    expect(stackWarnings(facts({ parentPull: { state: 'merged' } }))).toEqual([
      { kind: 'base_merged', text: 'Merging this now would not reach main' },
    ]);
  });

  it('warns the same way, naming the closed pull request, when the parent was closed', () => {
    expect(stackWarnings(facts({ parentPull: { state: 'closed' } }))).toEqual([
      {
        kind: 'base_merged',
        text: "@api's pull request was closed. Merging this now would not reach main",
      },
    ]);
  });

  it('clears the warning once the pull request targets the default branch', () => {
    const retargeted = { parentPull: { state: 'merged' }, pull: { state: 'open', base: 'main' } };
    expect(stackWarnings(facts(retargeted as Partial<StackFacts>))).toEqual([]);
  });

  it('does not ask a stack whose parent merged to catch up with it or to wait for its push', () => {
    expect(
      kinds({
        parentPull: { state: 'merged' },
        parentOnRemote: false,
        parentInBranch: false,
        pull: null,
      }),
    ).toEqual([]);
    expect(
      kinds({ parentPull: { state: 'merged' }, parentOnRemote: false, parentInBranch: false }),
    ).toEqual(['base_merged']);
  });

  it('warns when the pull request targets a branch other than the expected base', () => {
    expect(stackWarnings(facts({ pull: { state: 'open', base: 'main' } }))).toEqual([
      { kind: 'base_mismatch', text: `The pull request targets main, not ${PARENT}` },
    ]);
    expect(
      stackWarnings(
        facts({ parentPull: { state: 'merged' }, pull: { state: 'open', base: 'release' } }),
      ),
    ).toEqual([{ kind: 'base_mismatch', text: 'The pull request targets release, not main' }]);
    expect(kinds({ pull: { state: 'open', base: null } })).toEqual([]);
  });

  it('warns when the parent failed or was cancelled', () => {
    expect(stackWarnings(facts({ parentState: 'failed', pull: null }))).toEqual([
      { kind: 'parent_failed', text: '@api failed' },
    ]);
    expect(stackWarnings(facts({ parentState: 'cancelled', pull: null }))).toEqual([
      { kind: 'parent_failed', text: '@api was cancelled' },
    ]);
    expect(kinds({ parentState: 'needs_you' })).toEqual([]);
    expect(kinds({ parentState: null })).toEqual([]);
  });

  it('lists several warnings in a fixed order', () => {
    expect(
      kinds({
        parentState: 'failed',
        parentOnRemote: false,
        parentInBranch: false,
        parentPull: null,
        pull: { state: 'open', base: 'main' },
      }),
    ).toEqual(['parent_failed', 'parent_not_pushed', 'behind_parent', 'base_mismatch']);
  });

  it('says nothing once the stacked pull request itself is merged or closed', () => {
    const broken = { parentState: 'failed', parentInBranch: false } as const;
    expect(kinds({ ...broken, pull: { state: 'merged', base: 'main' } })).toEqual([]);
    expect(kinds({ ...broken, pull: { state: 'closed', base: PARENT } })).toEqual([]);
  });

  it('writes warnings that fit the contract and never say harness', () => {
    const all = stackWarnings(
      facts({ parentState: 'failed', parentOnRemote: false, parentInBranch: false }),
    ).concat(stackWarnings(facts({ parentPull: { state: 'closed' } })));
    expect(all.length).toBeGreaterThan(3);
    for (const warning of all) {
      expect(stackWarningSchema.parse(warning)).toEqual(warning);
      expect(warning.text.toLowerCase()).not.toContain('harness');
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  isStacked,
  prBase,
  stackWarnings,
  stackedCount,
  storyOrder,
  type StackFacts,
  type StoryOrderItem,
} from './sub-chat-stack.ts';
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

const PROJECT = '4f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const OTHER_PROJECT = '5f0e0d0c-1a2b-4c3d-8e9f-001122334455';

function task(conversationId: string, position: number, dependsOn: string | null = null) {
  return { conversationId, position, dependsOn } satisfies StoryOrderItem;
}

function ids(tasks: readonly StoryOrderItem[]): string[] {
  return storyOrder(tasks).map((item) => item.conversationId);
}

describe('storyOrder', () => {
  it('keeps parallel tasks in position order', () => {
    expect(ids([task('c', 2), task('a', 0), task('b', 1)])).toEqual(['a', 'b', 'c']);
    expect(ids([])).toEqual([]);
  });

  it('puts a task after the one it depends on, whatever its position', () => {
    expect(ids([task('web', 0, 'api'), task('api', 1)])).toEqual(['api', 'web']);
    expect(ids([task('ios', 0, 'web'), task('web', 1, 'api'), task('api', 2)])).toEqual([
      'api',
      'web',
      'ios',
    ]);
  });

  it('keeps a stack together ahead of the next independent task', () => {
    expect(
      ids([task('api', 0), task('docs', 1), task('web', 2, 'api'), task('ios', 3, 'api')]),
    ).toEqual(['api', 'web', 'ios', 'docs']);
  });

  it('treats a dependency outside the story, or on itself, as none', () => {
    expect(ids([task('web', 1, 'deleted'), task('api', 0)])).toEqual(['api', 'web']);
    expect(ids([task('web', 1, 'web'), task('api', 0)])).toEqual(['api', 'web']);
  });

  it('keeps every task of a cycle, once each, and does not loop', () => {
    expect(ids([task('a', 1, 'b'), task('b', 2, 'a'), task('api', 0)])).toEqual(['api', 'a', 'b']);
  });

  it('keeps input order for equal positions and returns the same items without changing the input', () => {
    const first = { ...task('a', 0), title: 'first' };
    const second = { ...task('b', 0), title: 'second' };
    const given = [first, second];
    const ordered = storyOrder(given);
    expect(ordered).toEqual([first, second]);
    expect(ordered[0]).toBe(first);
    expect(given).toEqual([first, second]);
  });
});

describe('isStacked', () => {
  it('is stacked on a parent in the same project', () => {
    expect(isStacked({ projectId: PROJECT }, { projectId: PROJECT })).toBe(true);
  });

  it('never stacks an existing chat, which keeps its own branch, but stacks a new chat on one', () => {
    const existing = { projectId: PROJECT, chatId: 'chat-1' };
    expect(isStacked(existing, { projectId: PROJECT })).toBe(false);
    expect(isStacked({ projectId: PROJECT }, existing)).toBe(true);
  });

  it('is order only across projects, with no parent, or with no project', () => {
    expect(isStacked({ projectId: PROJECT }, { projectId: OTHER_PROJECT })).toBe(false);
    expect(isStacked({ projectId: PROJECT }, null)).toBe(false);
    expect(isStacked({ projectId: null }, { projectId: null })).toBe(false);
    expect(isStacked({ projectId: PROJECT }, { projectId: null })).toBe(false);
  });
});

describe('stackedCount', () => {
  const chat = (handle: string, projectId: string, dependsOn?: string) => ({
    handle,
    projectId,
    ...(dependsOn ? { dependsOn } : {}),
  });

  it('counts the chats that start from another chat in the same project', () => {
    expect(
      stackedCount([
        chat('api', PROJECT),
        chat('web', PROJECT, 'api'),
        chat('docs', OTHER_PROJECT, 'api'),
        chat('qa', PROJECT, 'web'),
      ]),
    ).toBe(2);
  });

  it('counts none for parallel chats or a parent that is not in the draft', () => {
    expect(stackedCount([chat('api', PROJECT), chat('web', PROJECT)])).toBe(0);
    expect(stackedCount([chat('web', PROJECT, 'api')])).toBe(0);
  });
});

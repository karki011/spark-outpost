import { describe, expect, it } from 'vitest';
import { prBase, stackOrder, type PrBaseFacts, type StackOrderItem } from './sub-chat-stack.ts';

const PARENT = 'spark/orders-endpoint-0a1b2c3d';

function facts(extra: Partial<PrBaseFacts> = {}): PrBaseFacts {
  return { defaultBranch: 'main', parentBranch: PARENT, parentPull: { state: 'open' }, ...extra };
}

describe('prBase', () => {
  it('targets the parent branch while the parent is open or has no pull request yet', () => {
    expect(prBase(facts())).toBe(PARENT);
    expect(prBase(facts({ parentPull: null }))).toBe(PARENT);
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

function task(conversationId: string, position: number, dependsOn: string | null = null) {
  return { conversationId, position, dependsOn } satisfies StackOrderItem;
}

function ids(tasks: readonly StackOrderItem[]): string[] {
  return stackOrder(tasks).map((item) => item.conversationId);
}

describe('stackOrder', () => {
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

  it('treats a dependency outside the plan, or on itself, as none', () => {
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
    const ordered = stackOrder(given);
    expect(ordered).toEqual([first, second]);
    expect(ordered[0]).toBe(first);
    expect(given).toEqual([first, second]);
  });
});

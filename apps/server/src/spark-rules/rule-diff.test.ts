import { describe, expect, it } from 'vitest';
import { diffLine, effectiveDiff, listsDiff, unrecognisedRules } from './rule-diff.ts';

const lists = { allow: [], ask: ['Push(force)'], deny: ['Push', 'Gh(*)'] };

describe('what a rules edit really changes', () => {
  it('drops lines already in place and removals of lines that are not there', () => {
    const diff = effectiveDiff(
      lists,
      [
        { effect: 'deny', rule: 'Push' },
        { effect: 'allow', rule: 'Gh(release create)' },
        { effect: 'allow', rule: 'Gh(release create)' },
      ],
      [
        { effect: 'ask', rule: 'Push(force)' },
        { effect: 'allow', rule: 'PullRequest' },
      ],
    );
    expect(diff).toEqual({
      add: [{ effect: 'allow', rule: 'Gh(release create)' }],
      remove: [{ effect: 'ask', rule: 'Push(force)' }],
    });
    expect(diffLine(diff)).toBe('+ allow Gh(release create); − ask Push(force)');
  });

  it('cancels a line that is both added and removed', () => {
    const line = { effect: 'deny' as const, rule: 'Push' };
    expect(effectiveDiff(lists, [line], [line])).toEqual({ add: [], remove: [] });
  });

  it('names rules Spark does not know', () => {
    expect(
      unrecognisedRules([
        { effect: 'allow', rule: 'Bash(npm test)' },
        { effect: 'deny', rule: 'Push' },
      ]),
    ).toEqual(['Bash(npm test)']);
  });

  it('lists what a file gained and lost', () => {
    const after = { allow: ['Gh(release create)'], ask: [], deny: ['Push', 'Gh(*)'] };
    expect(listsDiff(lists, after)).toEqual({
      add: [{ effect: 'allow', rule: 'Gh(release create)' }],
      remove: [{ effect: 'ask', rule: 'Push(force)' }],
    });
  });
});

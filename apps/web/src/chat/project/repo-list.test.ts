import { describe, expect, it } from 'vitest';
import { CONVERSATION_PROJECTS_MAX } from '@spark-outpost/contracts';
import { applyRepoChange, interleave, repoSummary } from './repo-list.ts';

describe('repo list changes', () => {
  const ids = ['a', 'b', 'c'];

  it('adds to the end once, removes, and clears', () => {
    expect(applyRepoChange(ids, { type: 'add', projectId: 'd' })).toEqual(['a', 'b', 'c', 'd']);
    expect(applyRepoChange(ids, { type: 'add', projectId: 'b' })).toEqual(ids);
    expect(applyRepoChange(ids, { type: 'remove', projectId: 'a' })).toEqual(['b', 'c']);
    expect(applyRepoChange(ids, { type: 'clear' })).toEqual([]);
  });

  it('moves a linked repo to the front to make it primary', () => {
    expect(applyRepoChange(ids, { type: 'primary', projectId: 'c' })).toEqual(['c', 'a', 'b']);
    expect(applyRepoChange(ids, { type: 'primary', projectId: 'z' })).toEqual(ids);
  });

  it('never grows past the limit', () => {
    const full = Array.from({ length: CONVERSATION_PROJECTS_MAX }, (_, index) => `p${index}`);
    expect(applyRepoChange(full, { type: 'add', projectId: 'extra' })).toEqual(full);
  });
});

describe('repo helpers', () => {
  it('summarises the primary repo and counts the rest', () => {
    expect(repoSummary([])).toBe('');
    expect(repoSummary(['spark-outpost'])).toBe('spark-outpost');
    expect(repoSummary(['spark-outpost', 'lib', 'docs'])).toBe('spark-outpost +2');
  });

  it('interleaves ranked lists so every repo shows its best matches first', () => {
    expect(interleave([['a1', 'a2', 'a3'], ['b1'], []])).toEqual(['a1', 'b1', 'a2', 'a3']);
  });
});

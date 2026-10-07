import { describe, expect, it } from 'vitest';
import { KEPT_BY_AUTO_EDIT } from './checkpoint-policy.ts';
import { KEPT_BY_FULL_AUTO, keptNote, shipFailureLine } from './full-auto-ship.ts';

describe('shipFailureLine', () => {
  it('names the failure whatever was thrown', () => {
    expect(shipFailureLine(new Error('push rejected'))).toBe(
      'Full auto → PR kept the change but could not ship it: push rejected',
    );
    expect(shipFailureLine('gh missing')).toBe(
      'Full auto → PR kept the change but could not ship it: gh missing',
    );
    expect(shipFailureLine(null)).toBe(
      'Full auto → PR kept the change but could not ship it: null',
    );
  });
});

describe('keptNote', () => {
  it('is empty when the change was kept and published as usual', () => {
    const published =
      "Opened pull request #7: https://github.com/o/r/pull/7\n\nThe change is on spark/x in this chat's worktree.";
    expect(keptNote([KEPT_BY_FULL_AUTO, null, published])).toBeNull();
    expect(keptNote([KEPT_BY_AUTO_EDIT, null])).toBeNull();
  });

  it('carries what is out of the ordinary', () => {
    const failing = 'Opened draft PR #7, marked "Checks failing": https://github.com/o/r/pull/7';
    expect(keptNote([KEPT_BY_FULL_AUTO, null, failing])).toBe(failing);
    expect(
      keptNote([
        'Kept automatically; worth a look: the Critic still has concerns.',
        'The AI review found 1 correctness finding.',
        'No pull request: this chat has no project.',
      ]),
    ).toBe(
      'Kept automatically; worth a look: the Critic still has concerns. The AI review found 1 correctness finding. No pull request: this chat has no project.',
    );
  });
});

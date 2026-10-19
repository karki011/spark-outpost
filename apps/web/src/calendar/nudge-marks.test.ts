import { describe, expect, it } from 'vitest';
import { nextBoundary } from './event-clock.ts';
import {
  dismissNudge,
  NO_NUDGE_MARKS,
  nudgeHidden,
  purgeMarks,
  snoozeEnds,
  snoozeNudge,
} from './nudge-marks.ts';

describe('nudge marks', () => {
  it('snoozes for two minutes and dismisses until the meeting ends', () => {
    const snoozed = snoozeNudge(NO_NUDGE_MARKS, 'standup', 9_000_000, 1_000_000);
    expect(nudgeHidden(snoozed, 'standup', 1_119_999)).toBe(true);
    expect(nudgeHidden(snoozed, 'standup', 1_120_000)).toBe(false);
    expect(snoozeEnds(snoozed)).toEqual([1_120_000]);
    const dismissed = dismissNudge(snoozed, 'standup', 9_000_000);
    expect(nudgeHidden(dismissed, 'standup', 5_000_000)).toBe(true);
    expect(nudgeHidden(dismissed, 'other', 5_000_000)).toBe(false);
  });

  it('forgets a mark once its meeting has ended', () => {
    const marks = dismissNudge(NO_NUDGE_MARKS, 'standup', 9_000_000);
    expect(purgeMarks(marks, 8_999_999)).toBe(marks);
    expect(purgeMarks(marks, 9_000_000).size).toBe(0);
  });
});

describe('the next clock boundary', () => {
  it('is the earliest end still ahead, or none', () => {
    expect(nextBoundary([300, 100, 200], 150)).toBe(200);
    expect(nextBoundary([100], 100)).toBeNull();
    expect(nextBoundary([], 0)).toBeNull();
  });
});

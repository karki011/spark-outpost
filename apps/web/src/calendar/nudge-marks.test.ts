import { describe, expect, it } from 'vitest';
import { nextBoundary } from './event-clock.ts';
import {
  dismissNudge,
  NO_NUDGE_MARKS,
  nudgeHidden,
  purgeMarks,
  snoozeEnds,
  snoozeNudge,
  withServerDismissed,
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

describe('dismissals Spark saved', () => {
  it('hide the meeting even in a fresh island, and leave other occurrences alone', () => {
    const end = '2026-10-16T10:45:00.000Z';
    const events = [
      { key: 'daily@2026-10-16T10:30:00.000Z', end, dismissed: true },
      { key: 'daily@2026-10-17T10:30:00.000Z', end, dismissed: false },
    ];
    const marks = withServerDismissed(NO_NUDGE_MARKS, events);
    expect(nudgeHidden(marks, 'daily@2026-10-16T10:30:00.000Z', 0)).toBe(true);
    expect(nudgeHidden(marks, 'daily@2026-10-17T10:30:00.000Z', 0)).toBe(false);
    expect(withServerDismissed(marks, events)).toBe(marks);
    expect(withServerDismissed(NO_NUDGE_MARKS, [events[1]!])).toBe(NO_NUDGE_MARKS);
  });
});

describe('the next clock boundary', () => {
  it('is the earliest end still ahead, or none', () => {
    expect(nextBoundary([300, 100, 200], 150)).toBe(200);
    expect(nextBoundary([100], 100)).toBeNull();
    expect(nextBoundary([], 0)).toBeNull();
  });
});

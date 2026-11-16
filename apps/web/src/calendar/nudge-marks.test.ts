import { remindUntil } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { nextBoundary, nextMinuteMark } from './event-clock.ts';
import {
  closeNudge,
  dismissNudge,
  NO_NUDGE_MARKS,
  nudgeHidden,
  purgeMarks,
  snoozeEnds,
  snoozeNudge,
  withServerDismissed,
} from './nudge-marks.ts';

describe('nudge marks', () => {
  it('snoozes for a minute and dismisses until the meeting ends', () => {
    const snoozed = snoozeNudge(NO_NUDGE_MARKS, 'standup', 9_000_000, 1_000_000);
    expect(nudgeHidden(snoozed, 'standup', 1_059_999)).toBe(true);
    expect(nudgeHidden(snoozed, 'standup', 1_060_000)).toBe(false);
    expect(snoozeEnds(snoozed)).toEqual([1_060_000]);
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

describe('the next countdown minute', () => {
  const MINUTE = 60_000;
  const span = { start: 100 * MINUTE + 7_000, end: 130 * MINUTE + 7_000 };

  it('wakes on the whole minutes counted from the start, from an hour before to the end', () => {
    expect(nextMinuteMark([span], 0)).toBe(40 * MINUTE + 7_000);
    expect(nextMinuteMark([span], 98 * MINUTE + 30_000)).toBe(99 * MINUTE + 7_000);
    expect(nextMinuteMark([span], 99 * MINUTE + 7_000)).toBe(100 * MINUTE + 7_000);
    expect(nextMinuteMark([span], 129 * MINUTE + 7_000)).toBeNull();
  });

  it('stays one mark per meeting, however long the meeting runs', () => {
    const year = { start: span.start, end: span.start + 365 * 24 * 60 * MINUTE };
    expect(nextMinuteMark([year, span], 200 * MINUTE)).toBe(200 * MINUTE + 7_000);
  });

  it('closes a card until the start, or for the rest of its reminders once started', () => {
    const span = { start: 2_000_000, end: 5_000_000 };
    const before = closeNudge(NO_NUDGE_MARKS, 'standup', span, 1_000_000);
    expect(nudgeHidden(before, 'standup', 1_999_999)).toBe(true);
    expect(nudgeHidden(before, 'standup', 2_000_000)).toBe(false);
    expect(before.get('standup')?.dismissed).toBe(false);
    const after = closeNudge(NO_NUDGE_MARKS, 'standup', span, 2_060_000);
    expect(nudgeHidden(after, 'standup', remindUntil(span) - 1)).toBe(true);
    expect(after.get('standup')?.dismissed).toBe(false);
  });

  it('keeps a dismissed meeting dismissed when its card is closed', () => {
    const span = { start: 2_000_000, end: 5_000_000 };
    const dismissed = dismissNudge(NO_NUDGE_MARKS, 'standup', span.end);
    expect(closeNudge(dismissed, 'standup', span, 1_000_000)).toBe(dismissed);
  });
});

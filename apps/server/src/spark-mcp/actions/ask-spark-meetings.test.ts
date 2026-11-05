import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@spark-outpost/contracts';
import { MEETING_REFUSALS, pickMeeting } from './ask-spark-meetings.ts';

const NOW = Date.parse('2026-10-20T10:00:00.000Z');
const MINUTE = 60_000;
const ZOOM = { url: 'https://acme.zoom.us/j/1', host: 'zoom' } as CalendarEvent['link'];

function meeting(title: string, startIn: number, extra: Partial<CalendarEvent> = {}) {
  const start = new Date(NOW + startIn * MINUTE).toISOString();
  return {
    key: `${title}@${start}`,
    title,
    start,
    end: new Date(NOW + (startIn + 30) * MINUTE).toISOString(),
    link: ZOOM,
    dismissed: false,
    ...extra,
  } as CalendarEvent;
}

const times = { now: NOW, alertLeadMs: MINUTE };

describe('pickMeeting', () => {
  it('snoozes only a meeting whose alert is due', () => {
    expect(pickMeeting('snooze_meeting', [meeting('Standup', 5)], times, null)).toBe(
      MEETING_REFUSALS.snooze_meeting,
    );
    const due = meeting('Standup', 1);
    expect(pickMeeting('snooze_meeting', [due], times, null)).toBe(due);
  });

  it('joins only from 10 minutes before, with an allowed link', () => {
    const later = meeting('Later', 20);
    const linkless = meeting('Call', 2, { link: null });
    expect(pickMeeting('join_meeting', [later, linkless], times, null)).toBe(
      MEETING_REFUSALS.join_meeting,
    );
    const soon = meeting('Review', 8);
    expect(pickMeeting('join_meeting', [soon, later], times, null)).toBe(soon);
  });

  it('asks which one when meetings overlap, unless the name picks one', () => {
    const design = meeting('Design review', 2);
    const sales = meeting('Sales sync', 4);
    expect(pickMeeting('join_meeting', [design, sales], times, null)).toBe(MEETING_REFUSALS.clash);
    expect(pickMeeting('join_meeting', [design, sales], times, 'sales')).toBe(sales);
    expect(pickMeeting('join_meeting', [design, sales], times, 'review')).toBe(design);
    const qa = meeting('QA sync', 3);
    expect(pickMeeting('join_meeting', [design, qa], times, 'qa')).toBe(qa);
  });

  it('skips dismissed meetings and matches names on word boundaries', () => {
    const gone = meeting('Standup', 2, { dismissed: true });
    expect(pickMeeting('dismiss_meeting', [gone], times, null)).toBe(
      MEETING_REFUSALS.dismiss_meeting,
    );
    const design = meeting('Design', 2);
    expect(pickMeeting('dismiss_meeting', [design], times, 'sign')).toBe(
      MEETING_REFUSALS.dismiss_meeting,
    );
  });
});

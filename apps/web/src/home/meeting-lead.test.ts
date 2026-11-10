import { describe, expect, it } from 'vitest';
import { at, event } from '../calendar/test-fixtures.ts';
import { leadMeeting } from './meeting-lead.ts';

const LEAD = 10 * 60_000;
const none = () => false;
const sync = event('Design sync', at(14, 50), at(15, 20));

describe('leadMeeting', () => {
  it('opens when Join opens and stays until five minutes after the start', () => {
    expect(leadMeeting([sync], at(14, 39), LEAD, none)).toBeNull();
    expect(leadMeeting([sync], at(14, 40), LEAD, none)).toBe(sync);
    expect(leadMeeting([sync], at(14, 54, 59), LEAD, none)).toBe(sync);
    expect(leadMeeting([sync], at(14, 55), LEAD, none)).toBeNull();
  });

  it('follows the Join opens setting', () => {
    expect(leadMeeting([sync], at(14, 44), 5 * 60_000, none)).toBeNull();
    expect(leadMeeting([sync], at(14, 45), 5 * 60_000, none)).toBe(sync);
    expect(leadMeeting([sync], at(14, 50), 0, none)).toBe(sync);
  });

  it('ends with a meeting shorter than the grace', () => {
    const short = event('Quick one', at(10, 0), at(10, 3));
    expect(leadMeeting([short], at(10, 2), LEAD, none)).toBe(short);
    expect(leadMeeting([short], at(10, 3), LEAD, none)).toBeNull();
  });

  it('skips dismissed, hidden, silent and all-day events', () => {
    const dismissed = event('Dismissed', at(14, 50), at(15, 0), { dismissed: true });
    const silent = event('Silent', at(14, 50), at(15, 0), { nudges: false });
    const allDay = event('Offsite', at(0, 0), at(23, 59), { allDay: true });
    const now = at(14, 45);
    expect(leadMeeting([dismissed, silent, allDay], now, LEAD, none)).toBeNull();
    expect(leadMeeting([sync], now, LEAD, (key) => key === sync.key)).toBeNull();
  });

  it('takes the earliest meeting when two are inside the window', () => {
    const later = event('Later', at(14, 55), at(15, 25));
    expect(leadMeeting([later, sync], at(14, 48), LEAD, none)).toBe(sync);
  });
});

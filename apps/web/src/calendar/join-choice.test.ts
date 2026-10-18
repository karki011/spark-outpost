import { describe, expect, it } from 'vitest';
import type { CalendarNow } from '@spark-outpost/contracts';
import { joinChoice } from './join-choice.ts';
import { at, event, link } from './test-fixtures.ts';

function now(overrides: Partial<CalendarNow>): CalendarNow {
  return {
    active: true,
    upcoming: [],
    nudge: null,
    hold: null,
    capture: null,
    clashes: [],
    calendars: [],
    ...overrides,
  };
}

const standup = event('Standup', at(10), at(10, 15), { link: link('zoom') });
const design = event('Design sync', at(10), at(10, 30), { link: link('meet') });
const room = event('Room booking', at(10), at(10, 30));

describe('joinChoice', () => {
  it('joins the one open meeting directly', () => {
    expect(joinChoice(now({ upcoming: [standup, room] }), at(9, 55))).toEqual({ join: standup });
  });

  it('offers a choice when two or more meetings are open, with the group’s other meetings', () => {
    const nudge = {
      kind: 'before' as const,
      eventKey: standup.key,
      title: standup.title,
      startsAt: standup.start,
      minutes: 5,
      group: [standup, design, room],
    };
    const choice = joinChoice(now({ upcoming: [standup, design], nudge }), at(9, 55));
    expect(choice && 'choose' in choice ? choice.choose.map((item) => item.title) : []).toEqual([
      'Standup',
      'Design sync',
      'Room booking',
    ]);
  });

  it('asks at the hand-over between back-to-back calls, when both are open', () => {
    const next = event('Planning', at(10, 15), at(10, 45), { link: link('zoom') });
    const choice = joinChoice(now({ upcoming: [standup, next] }), at(10, 8));
    expect(choice && 'choose' in choice ? choice.choose.length : 0).toBe(2);
    expect(joinChoice(now({ upcoming: [standup, next] }), at(10, 2))).toEqual({ join: standup });
  });

  it('does nothing when no meeting is open to join', () => {
    expect(joinChoice(now({ upcoming: [room] }), at(9, 55))).toBeNull();
    expect(joinChoice(null, at(9, 55))).toBeNull();
  });
});

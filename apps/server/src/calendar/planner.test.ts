import { describe, expect, it } from 'vitest';
import {
  CALENDAR_DEFAULT_SETTINGS,
  type CalendarEvent,
  type CalendarSettings,
} from '@spark-outpost/contracts';
import {
  activeHold,
  meetingPushDue,
  planNudges,
  tomorrowMeetings,
  type PlannerChat,
} from './planner.ts';

const MINUTE = 60_000;
const NOW = new Date(2026, 9, 16, 9, 20).getTime();
const at = (minutes: number) => new Date(NOW + minutes * MINUTE).toISOString();
const KEY = '00000000-0000-4000-8000-000000000001';

function event(title: string, from: number, to: number, extra: Partial<CalendarEvent> = {}) {
  return {
    key: `${title}@${at(from)}`,
    id: title,
    uid: title,
    start: at(from),
    end: at(to),
    allDay: false,
    title,
    calendarKey: KEY,
    also: [],
    link: null,
    attendeeCount: 3,
    othersInvited: true,
    myStatus: 'accepted',
    availability: 'busy',
    recurring: false,
    hasNotes: false,
    hasLocation: false,
    busy: true,
    nudges: true,
    focus: false,
    remind: false,
    hold: false,
    dismissed: false,
    joinAtStart: false,
    ...extra,
  } satisfies CalendarEvent;
}

const settings = (patch: Partial<CalendarSettings> = {}) => ({
  ...CALENDAR_DEFAULT_SETTINGS,
  ...patch,
});
const NO_CHATS: PlannerChat[] = [];
const RUNNING: PlannerChat[] = [
  {
    id: '00000000-0000-4000-8000-0000000000aa',
    title: 'Dashboards',
    running: true,
    needsYou: false,
  },
];

describe('planNudges', () => {
  it('gives a meeting no nudge of its own: Join opens and the alert cover it', () => {
    const standup = event('Standup', 5, 25);
    expect(planNudges([standup], NO_CHATS, settings(), NOW).nudge).toBeNull();
    expect(planNudges([event('Now', -2, 25)], NO_CHATS, settings(), NOW).nudge).toBeNull();
  });

  it('reminds 5 min before a marked event, on any calendar, before other lines', () => {
    const marked = event('Design review', 4, 30, { remind: true, nudges: false });
    const standup = event('Standup', 3, 18);
    const plan = planNudges([standup, marked], NO_CHATS, settings(), NOW);
    expect(plan.nudge).toMatchObject({ kind: 'remind', title: 'Design review', minutes: 4 });
  });

  it('groups Remind me marks that overlap the first one, and keeps others apart', () => {
    const marked = event('Design review', 4, 30, { remind: true });
    const overlapping = event('Office hours', 3, 20, { remind: true });
    const after = event('Retro', 30, 40, { remind: true });
    const plan = planNudges([after, overlapping, marked], NO_CHATS, settings(), NOW);
    const group = plan.nudge?.kind === 'remind' ? plan.nudge.group : [];
    expect(group.map((item) => item.title)).toEqual(['Office hours', 'Design review']);
  });

  it('stops reminding at the start', () => {
    const started = event('Started', -1, 30, { remind: true });
    expect(planNudges([started], NO_CHATS, settings(), NOW).nudge).toBeNull();
  });

  it('names the meetings each upcoming meeting clashes with, among all of today', () => {
    const events = [
      event('Customer call', 30, 60),
      event('Vendor sync', 45, 75),
      event('Lunch', 75, 120),
      event('Skipped', 50, 70, { myStatus: 'declined' }),
      event('Holiday', 0, 24 * 60, { allDay: true }),
    ];
    const plan = planNudges(events, NO_CHATS, settings(), NOW);
    expect(plan.clashes).toEqual([
      { eventKey: events[0]!.key, titles: ['Vendor sync'] },
      { eventKey: events[1]!.key, titles: ['Customer call'] },
    ]);
  });

  it('wraps up 15 min before when a chat is running, and stays quiet otherwise', () => {
    const meeting = event('Planning', 14, 60);
    expect(planNudges([meeting], NO_CHATS, settings(), NOW).nudge).toBeNull();
    expect(planNudges([meeting], RUNNING, settings(), NOW).nudge).toMatchObject({
      kind: 'wrap_up',
      minutes: 14,
      chats: [{ title: 'Dashboards', reason: 'running' }],
    });
    expect(planNudges([meeting], RUNNING, settings({ wrapUpMinutes: 0 }), NOW).nudge).toBeNull();
  });

  it('ends the wrap-up when Join opens', () => {
    const soon = event('Planning', 8, 60);
    expect(planNudges([soon], RUNNING, settings(), NOW).nudge).toBeNull();
    expect(planNudges([soon], RUNNING, settings({ joinLead: 5 }), NOW).nudge).toMatchObject({
      kind: 'wrap_up',
      minutes: 8,
    });
  });

  it('lists the next three meetings that have not ended', () => {
    const events = [
      event('Done', -60, -30),
      event('Now', -10, 10),
      event('A', 30, 60),
      event('B', 90, 120),
      event('C', 150, 180),
    ];
    const plan = planNudges(events, NO_CHATS, settings(), NOW);
    expect(plan.upcoming.map((item) => item.title)).toEqual(['Now', 'A', 'B']);
  });

  it('lists meetings in Upcoming whether or not their calendar nudges', () => {
    const events = [
      event('Quiet', 30, 60, { nudges: false }),
      event('Focus: deep', 60, 90, { focus: true }),
    ];
    const plan = planNudges(events, NO_CHATS, settings(), NOW);
    expect(plan.upcoming.map((item) => item.title)).toEqual(['Quiet']);
    expect(plan.nudge).toBeNull();
  });

  it('offers a capture line only for a meeting Spark took notes in, for 15 min after', () => {
    const MEETING = '00000000-0000-4000-8000-0000000000bb';
    const ended = event('Design review', -40, -5, { hasNotes: true });
    const recorded = new Map([[ended.key, { meetingId: MEETING, endedAt: NOW - 6 * MINUTE }]]);
    expect(planNudges([ended], NO_CHATS, settings(), NOW, recorded).capture).toEqual({
      eventKey: ended.key,
      meetingId: MEETING,
      title: 'Design review',
    });
    expect(planNudges([ended], NO_CHATS, settings(), NOW).capture).toBeNull();
    expect(
      planNudges([ended], NO_CHATS, settings({ capture: false }), NOW, recorded).capture,
    ).toBeNull();
    const long = event('Old', -60, -16);
    const old = new Map([[long.key, { meetingId: MEETING, endedAt: NOW - 16 * MINUTE }]]);
    expect(planNudges([long], NO_CHATS, settings(), NOW, old).capture).toBeNull();
  });

  it('counts the capture window from when the notes stopped, if that was after the end', () => {
    const MEETING = '00000000-0000-4000-8000-0000000000bb';
    const overran = event('Retro', -60, -20);
    const late = new Map([[overran.key, { meetingId: MEETING, endedAt: NOW - 2 * MINUTE }]]);
    expect(planNudges([overran], NO_CHATS, settings(), NOW, late).capture?.title).toBe('Retro');
  });
});

describe('holds', () => {
  const focus = event('Focus: dashboards', -10, 50, { focus: true });
  const meeting = event('Review', -10, 20);

  it('holds during focus blocks by default', () => {
    expect(activeHold([focus, meeting], settings(), NOW)).toMatchObject({
      title: 'Focus: dashboards',
      focus: true,
      until: focus.end,
    });
    expect(activeHold([meeting], settings(), NOW)).toBeNull();
  });

  it('follows the hold rule and the Hold alerts mark', () => {
    expect(activeHold([focus], settings({ holdRule: 'never' }), NOW)).toBeNull();
    expect(activeHold([meeting], settings({ holdRule: 'meetings' }), NOW)?.title).toBe('Review');
    const marked = { ...meeting, hold: true };
    expect(activeHold([marked], settings({ holdRule: 'never' }), NOW)?.title).toBe('Review');
    expect(activeHold([event('Later', 5, 30, { focus: true })], settings(), NOW)).toBeNull();
  });
});

describe('meeting pushes', () => {
  it('are in start order so a group is claimed from its first meeting', () => {
    const events = [event('Later', 9, 20), event('Soon', 8, 20)];
    expect(meetingPushDue(events, settings(), NOW).map((item) => item.title)).toEqual([
      'Soon',
      'Later',
    ]);
  });

  it('are due from Join opens until 5 min after the start', () => {
    const events = [
      event('Soon', 8, 20),
      event('Later', 30, 40),
      event('Started', -4, 20),
      event('Gone', -5, 20),
    ];
    expect(meetingPushDue(events, settings(), NOW).map((item) => item.title)).toEqual([
      'Started',
      'Soon',
    ]);
  });

  it('wait for the start when Join opens at the start', () => {
    const events = [event('Soon', 1, 20), event('Now', 0, 20)];
    expect(
      meetingPushDue(events, settings({ joinLead: 0 }), NOW).map((item) => item.title),
    ).toEqual(['Now']);
  });

  it('skip calendars without nudges, focus, declined, tentative, all-day and other days', () => {
    const events = [
      event('Pickup', 5, 20, { nudges: false }),
      event('Focus', 5, 20, { focus: true }),
      event('Skipped', 5, 20, { myStatus: 'declined' }),
      event('Maybe', 5, 20, { myStatus: 'tentative' }),
      event('Holiday', 5, 20, { allDay: true }),
      event('Tomorrow', 24 * 60 + 5, 24 * 60 + 20),
      event('Invite', 5, 20, { myStatus: 'pending' }),
    ];
    expect(meetingPushDue(events, settings(), NOW).map((item) => item.title)).toEqual(['Invite']);
  });
});

describe('tomorrowMeetings', () => {
  const TOMORROW = new Date(2026, 9, 17, 0, 0).getTime();
  const atTomorrow = (hours: number, minutes = 0) =>
    (TOMORROW + hours * 60 * MINUTE + minutes * MINUTE - NOW) / MINUTE;
  const titles = (events: CalendarEvent[]) => events.map((entry) => entry.title);

  it('lists meetings that start tomorrow in the local day, in order', () => {
    const later = event('Review', atTomorrow(15), atTomorrow(16));
    const first = event('Standup', atTomorrow(9), atTomorrow(9, 15));
    expect(titles(tomorrowMeetings([later, first], NOW))).toEqual(['Standup', 'Review']);
  });

  it('starts at local midnight and ends before the midnight after', () => {
    const midnight = event('Midnight', atTomorrow(0), atTomorrow(1));
    const lastMinute = event('Late', atTomorrow(23, 59), atTomorrow(24, 30));
    const before = event('Tonight', atTomorrow(-0.016), atTomorrow(1));
    const after = event('Next day', atTomorrow(24), atTomorrow(25));
    expect(titles(tomorrowMeetings([before, midnight, lastMinute, after], NOW))).toEqual([
      'Midnight',
      'Late',
    ]);
  });

  it('leaves out today, all-day events, focus blocks and declined meetings', () => {
    const today = event('Today', 30, 60);
    const allDay = event('Offsite', atTomorrow(0), atTomorrow(24), { allDay: true });
    const focus = event('Focus', atTomorrow(10), atTomorrow(11), { focus: true });
    const declined = event('Declined', atTomorrow(12), atTomorrow(13), { myStatus: 'declined' });
    const kept = event('Kept', atTomorrow(14), atTomorrow(15));
    expect(titles(tomorrowMeetings([today, allDay, focus, declined, kept], NOW))).toEqual(['Kept']);
  });

  it('keeps a meeting that began today and runs into tomorrow out of tomorrow', () => {
    const overnight = event('Overnight', 600, atTomorrow(2));
    expect(tomorrowMeetings([overnight], NOW)).toEqual([]);
  });

  it('shows at most three', () => {
    const many = [9, 10, 11, 12].map((hour) =>
      event(`M${hour}`, atTomorrow(hour), atTomorrow(hour, 30)),
    );
    expect(titles(tomorrowMeetings(many, NOW))).toEqual(['M9', 'M10', 'M11']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CALENDAR_DEFAULT_SETTINGS,
  type CalendarEvent,
  type CalendarSettings,
} from '@spark-outpost/contracts';
import { activeHold, meetingPushDue, planNudges, type PlannerChat } from './planner.ts';

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
    busy: true,
    nudges: true,
    focus: false,
    remind: false,
    hold: false,
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
  it('says a nudge-calendar meeting is coming up from 10 min before until 5 min in', () => {
    const standup = event('Standup', 10, 25);
    expect(planNudges([standup], NO_CHATS, settings(), NOW).nudge).toMatchObject({
      kind: 'before',
      title: 'Standup',
      minutes: 10,
    });
    expect(planNudges([event('Standup', 11, 25)], NO_CHATS, settings(), NOW).nudge).toBeNull();
    expect(planNudges([event('Standup', -4, 25)], NO_CHATS, settings(), NOW).nudge).toMatchObject({
      minutes: 0,
    });
    expect(planNudges([event('Standup', -5, 25)], NO_CHATS, settings(), NOW).nudge).toBeNull();
  });

  it('follows the before-a-meeting setting', () => {
    const later = event('Review', 14, 40);
    expect(planNudges([later], NO_CHATS, settings({ beforeMinutes: 15 }), NOW).nudge).toMatchObject(
      {
        kind: 'before',
        minutes: 14,
      },
    );
    expect(planNudges([later], NO_CHATS, settings({ beforeMinutes: 5 }), NOW).nudge).toBeNull();
  });

  it('gives no nudge for calendars without nudges, focus, declined, all-day or other days', () => {
    const events = [
      event('Pickup', 5, 20, { nudges: false }),
      event('Focus', 5, 20, { focus: true }),
      event('Skipped', 5, 20, { myStatus: 'declined' }),
      event('Holiday', 5, 20, { allDay: true }),
      event('Tomorrow', 24 * 60 + 5, 24 * 60 + 20),
    ];
    expect(planNudges(events, NO_CHATS, settings(), NOW).nudge).toBeNull();
  });

  it('nudges unanswered invitations but not tentative ones', () => {
    const pending = event('Invite', 5, 20, { myStatus: 'pending' });
    const maybe = event('Maybe', 5, 20, { myStatus: 'tentative' });
    expect(planNudges([pending], NO_CHATS, settings(), NOW).nudge?.title).toBe('Invite');
    expect(planNudges([maybe], NO_CHATS, settings(), NOW).nudge).toBeNull();
  });

  it('reminds 5 min before a marked event, on any calendar, before other lines', () => {
    const marked = event('Design review', 4, 30, { remind: true, nudges: false });
    const standup = event('Standup', 3, 18);
    const plan = planNudges([standup, marked], NO_CHATS, settings(), NOW);
    expect(plan.nudge).toMatchObject({ kind: 'remind', title: 'Design review', minutes: 4 });
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

  it('offers a capture line for 15 min after a meeting with notes ends', () => {
    const ended = event('Design review', -40, -5, { hasNotes: true });
    expect(planNudges([ended], NO_CHATS, settings(), NOW).capture).toMatchObject({
      title: 'Design review',
    });
    expect(planNudges([ended], NO_CHATS, settings({ capture: false }), NOW).capture).toBeNull();
    const long = event('Old', -60, -16, { hasNotes: true });
    expect(planNudges([long], NO_CHATS, settings(), NOW).capture).toBeNull();
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
  it('are due inside the before window only', () => {
    const events = [event('Soon', 8, 20), event('Later', 30, 40), event('Started', -1, 20)];
    expect(meetingPushDue(events, settings(), NOW).map((item) => item.title)).toEqual(['Soon']);
  });
});

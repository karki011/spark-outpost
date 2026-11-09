import { describe, expect, it } from 'vitest';
import { CALENDAR_DEFAULT_SETTINGS, type CalendarNow } from '@spark-outpost/contracts';
import { at, event, link } from './test-fixtures.ts';
import {
  autoJoinPlan,
  lineUnderAlert,
  meetingAlert,
  type AutoJoinInput,
  type Presence,
} from './meeting-alert.ts';
import { dismissNudge, NO_NUDGE_MARKS, snoozeNudge } from './nudge-marks.ts';

const standup = event('Standup', at(10), at(10, 15), { link: link('zoom') });
const design = event('Design sync', at(10), at(10, 30), { link: link('meet', 'meet.google.com') });
const later = event('Retro', at(11), at(11, 30), { link: link('zoom') });

function now(upcoming = [standup, later]): CalendarNow {
  return {
    active: true,
    upcoming,
    nudge: null,
    hold: null,
    capture: null,
    clashes: [],
    calendars: [],
  } as unknown as CalendarNow;
}

const centre = { alertStyle: 'center' as const, alertLead: 1 as const };

describe('meetingAlert', () => {
  it('comes down at the chosen time and stays until 5 min past the start', () => {
    const input = { now: now(), settings: centre, held: false, marks: NO_NUDGE_MARKS };
    expect(meetingAlert({ ...input, at: at(9, 58) })).toBeNull();
    expect(meetingAlert({ ...input, at: at(9, 59) })?.events).toEqual([standup]);
    expect(meetingAlert({ ...input, at: at(10, 4, 59) })?.events).toEqual([standup]);
    expect(meetingAlert({ ...input, at: at(10, 5) })).toBeNull();
    expect(meetingAlert({ ...input, at: at(10, 14) })).toBeNull();
  });

  it('stops at the end of a meeting shorter than 5 min', () => {
    const quick = event('Check-in', at(10), at(10, 3), { link: link('zoom') });
    const input = { now: now([quick]), settings: centre, held: false, marks: NO_NUDGE_MARKS };
    expect(meetingAlert({ ...input, at: at(10, 2, 59) })?.events).toEqual([quick]);
    expect(meetingAlert({ ...input, at: at(10, 3) })).toBeNull();
  });

  it('follows the lead: at start or five minutes before', () => {
    const input = { now: now(), held: false, marks: NO_NUDGE_MARKS, at: at(9, 57) };
    expect(meetingAlert({ ...input, settings: { ...centre, alertLead: 0 } })).toBeNull();
    expect(meetingAlert({ ...input, settings: { ...centre, alertLead: 5 } })).not.toBeNull();
  });

  it('comes down exactly at the start by default', () => {
    const input = {
      now: now(),
      settings: CALENDAR_DEFAULT_SETTINGS,
      held: false,
      marks: NO_NUDGE_MARKS,
    };
    expect(meetingAlert({ ...input, at: at(10) - 1 })).toBeNull();
    expect(meetingAlert({ ...input, at: at(10) })?.events).toEqual([standup]);
  });

  it('stays at the island for the bubble style and during a hold', () => {
    const input = { now: now(), marks: NO_NUDGE_MARKS, at: at(10) };
    expect(
      meetingAlert({ ...input, settings: { ...centre, alertStyle: 'bubble' }, held: false }),
    ).toBeNull();
    expect(meetingAlert({ ...input, settings: centre, held: true })).toBeNull();
  });

  it('goes after Dismiss, comes back after a snooze, and skips a declined meeting', () => {
    const base = { now: now(), settings: centre, held: false, at: at(10) };
    const dismissed = dismissNudge(NO_NUDGE_MARKS, standup.key, at(10, 15));
    expect(meetingAlert({ ...base, marks: dismissed })).toBeNull();
    const snoozed = snoozeNudge(NO_NUDGE_MARKS, standup.key, at(10, 15), at(10));
    expect(meetingAlert({ ...base, marks: snoozed })).toBeNull();
    expect(meetingAlert({ ...base, marks: snoozed, at: at(10, 3) })).not.toBeNull();
    const declined = { ...standup, myStatus: 'declined' as const };
    expect(meetingAlert({ ...base, now: now([declined]), marks: NO_NUDGE_MARKS })).toBeNull();
  });

  it('lists meetings that start together in one card', () => {
    const alert = meetingAlert({
      now: now([standup, design, later]),
      settings: centre,
      held: false,
      marks: NO_NUDGE_MARKS,
      at: at(10),
    });
    expect(alert?.events.map((item) => item.title)).toEqual(['Design sync', 'Standup']);
  });
});

const here: Presence = { idleSeconds: 3, locked: false, asleep: false };

function plan(overrides: Partial<AutoJoinInput> = {}) {
  return autoJoinPlan({
    events: [standup, later],
    autoJoin: true,
    at: at(10),
    held: false,
    marks: NO_NUDGE_MARKS,
    presence: here,
    joined: new Set(),
    joinLeadMs: 10 * 60_000,
    ...overrides,
  });
}

describe('autoJoinPlan', () => {
  it('joins the one meeting that just started', () => {
    expect(plan()).toEqual({ join: standup });
    expect(plan({ at: at(10, 2) })).toEqual({ join: standup });
  });

  it('does nothing while the switch is off', () => {
    expect(plan({ autoJoin: false })).toEqual({ skip: 'off' });
  });

  it('waits for the start', () => {
    expect(plan({ at: at(9, 59) })).toEqual({ skip: 'none' });
  });

  it('skips a meeting that started more than two minutes ago', () => {
    expect(plan({ at: at(10, 2, 1) })).toEqual({ skip: 'late' });
  });

  it('skips a meeting with no allowed link', () => {
    expect(plan({ events: [{ ...standup, link: null }] })).toEqual({ skip: 'no-link' });
  });

  it('asks the user to choose when two joinable meetings overlap', () => {
    expect(plan({ events: [standup, design] })).toEqual({ skip: 'clash' });
  });

  it('skips a declined, dismissed or already joined meeting', () => {
    expect(plan({ events: [{ ...standup, myStatus: 'declined' }] })).toEqual({ skip: 'declined' });
    const marks = dismissNudge(NO_NUDGE_MARKS, standup.key, at(10, 15));
    expect(plan({ marks })).toEqual({ skip: 'dismissed' });
    expect(plan({ joined: new Set([standup.key]) })).toEqual({ skip: 'joined' });
  });

  it('still joins when a meeting without a link, or one already joined, is running', () => {
    const workshop = event('Workshop', at(9), at(12));
    expect(plan({ events: [workshop, standup] })).toEqual({ join: standup });
    const call = event('Customer call', at(9), at(11), { link: link('zoom') });
    expect(plan({ events: [call, standup], joined: new Set([call.key]) })).toEqual({
      join: standup,
    });
    expect(plan({ events: [call, standup] })).toEqual({ skip: 'clash' });
  });

  it('skips during a hold', () => {
    expect(plan({ held: true })).toEqual({ skip: 'held' });
  });

  it('never joins into an empty room: locked, asleep or away five minutes', () => {
    expect(plan({ presence: { ...here, locked: true } })).toEqual({ skip: 'away' });
    expect(plan({ presence: { ...here, asleep: true } })).toEqual({ skip: 'away' });
    expect(plan({ presence: { ...here, idleSeconds: 301 } })).toEqual({ skip: 'away' });
    expect(plan({ presence: { ...here, idleSeconds: 299 } })).toEqual({ join: standup });
  });

  it('skips an all-day event', () => {
    const allDay = { ...standup, allDay: true };
    expect(plan({ events: [allDay] })).toEqual({ skip: 'all-day' });
  });
});

describe('autoJoinPlan for Join at start', () => {
  const asked = { ...standup, joinAtStart: true };

  it('joins the asked meeting at its start with the switch off, in a hold or a clash', () => {
    expect(plan({ events: [asked, later], autoJoin: false })).toEqual({ join: asked });
    expect(plan({ events: [asked, later], autoJoin: false, held: true })).toEqual({ join: asked });
    expect(plan({ events: [asked, design], autoJoin: false })).toEqual({ join: asked });
    expect(plan({ events: [asked, design] })).toEqual({ join: asked });
  });

  it('waits for the start', () => {
    expect(plan({ events: [asked], autoJoin: false, at: at(9, 59) })).toEqual({ skip: 'off' });
  });

  it('skips when the Mac is away, locked or asleep', () => {
    const away = { events: [asked], autoJoin: false };
    expect(plan({ ...away, presence: { ...here, locked: true } })).toEqual({ skip: 'away' });
    expect(plan({ ...away, presence: { ...here, asleep: true } })).toEqual({ skip: 'away' });
    expect(plan({ ...away, presence: { ...here, idleSeconds: 301 } })).toEqual({ skip: 'away' });
  });

  it('skips when more than two minutes late, declined, dismissed or without a link', () => {
    const one = { autoJoin: false };
    expect(plan({ ...one, events: [asked], at: at(10, 2, 1) })).toEqual({ skip: 'late' });
    expect(plan({ ...one, events: [{ ...asked, myStatus: 'declined' }] })).toEqual({
      skip: 'declined',
    });
    const marks = dismissNudge(NO_NUDGE_MARKS, asked.key, at(10, 15));
    expect(plan({ ...one, events: [asked], marks })).toEqual({ skip: 'dismissed' });
    expect(plan({ ...one, events: [{ ...asked, link: null }] })).toEqual({ skip: 'no-link' });
  });

  it('does not join a cancelled or already joined request again', () => {
    const done = new Set([asked.key]);
    expect(plan({ events: [asked], autoJoin: false, joined: done })).toEqual({ skip: 'off' });
    expect(plan({ events: [asked], joined: done })).toEqual({ skip: 'joined' });
  });

  it('leaves a skipped request to the switch for other meetings', () => {
    const late = { ...asked, start: new Date(at(9, 50)).toISOString() };
    expect(plan({ events: [late, later], at: at(11) })).toEqual({ join: later });
  });
});

describe('lineUnderAlert', () => {
  const alert = { key: standup.key, events: [standup] };

  it('hides the island line for a meeting the centre card shows', () => {
    expect(lineUnderAlert({ eventKey: standup.key, choose: null }, alert)).toBe(true);
    expect(lineUnderAlert({ eventKey: null, choose: [design, standup] }, alert)).toBe(true);
  });

  it('keeps lines about other meetings and every line when no card is down', () => {
    expect(lineUnderAlert({ eventKey: later.key, choose: null }, alert)).toBe(false);
    expect(lineUnderAlert({ eventKey: standup.key, choose: null }, null)).toBe(false);
  });
});

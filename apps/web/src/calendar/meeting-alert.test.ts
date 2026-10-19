import { describe, expect, it } from 'vitest';
import type { CalendarNow } from '@spark-outpost/contracts';
import { at, event, link } from './test-fixtures.ts';
import {
  autoJoinPlan,
  lineUnderAlert,
  meetingAlert, type AutoJoinInput, type Presence } from './meeting-alert.ts';
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
  it('comes down at the chosen time before the meeting and stays until it ends', () => {
    const input = { now: now(), settings: centre, held: false, marks: NO_NUDGE_MARKS };
    expect(meetingAlert({ ...input, at: at(9, 58) })).toBeNull();
    expect(meetingAlert({ ...input, at: at(9, 59) })?.events).toEqual([standup]);
    expect(meetingAlert({ ...input, at: at(10, 14) })?.events).toEqual([standup]);
    expect(meetingAlert({ ...input, at: at(10, 15) })).toBeNull();
  });

  it('follows the lead: at start or five minutes before', () => {
    const input = { now: now(), held: false, marks: NO_NUDGE_MARKS, at: at(9, 57) };
    expect(meetingAlert({ ...input, settings: { ...centre, alertLead: 0 } })).toBeNull();
    expect(meetingAlert({ ...input, settings: { ...centre, alertLead: 5 } })).not.toBeNull();
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

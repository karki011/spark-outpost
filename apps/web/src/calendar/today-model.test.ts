import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { duration, shapeWords } from './calendar-format.ts';
import { at, choice, event, FAMILY, link, status, WORK } from './test-fixtures.ts';
import {
  connectorLine,
  countdown,
  joinHint,
  joinTarget,
  noGaps,
  overlapChat,
  timelineSpan,
  todayState,
  upcomingMeetings,
  visibleEvents,
} from './today-model.ts';

function chat(running: boolean, archived = false): ConversationSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Fix login redirect',
    updatedAt: '2026-10-16T09:00:00.000Z',
    projectIds: [],
    latestRun: running
      ? ({
          id: '00000000-0000-4000-8000-00000000aaaa',
          status: 'running',
          error: null,
          step: null,
          provider: 'claude',
          progress: null,
        } as ConversationSummary['latestRun'])
      : null,
    archivedAt: archived ? '2026-10-16T09:00:00.000Z' : null,
    pinnedOrder: null,
    pinnedAt: null,
    projectOrder: null,
    unread: false,
    needsInput: false,
    attention: null,
    titleSource: 'message',
    category: null,
  } as ConversationSummary;
}

describe('todayState', () => {
  it('names the plain browser before anything else', () => {
    expect(todayState(status({ supported: false, helper: null }))).toBe('web');
  });

  it('reports a missing or failed helper before access', () => {
    expect(todayState(status({ helper: 'missing', authorization: 'denied' }))).toBe('helper');
    expect(todayState(status({ helper: 'failed' }))).toBe('helper');
  });

  it('treats denied, restricted and write-only access as off', () => {
    for (const authorization of ['denied', 'restricted', 'writeOnly'] as const) {
      expect(todayState(status({ authorization, connected: false }))).toBe('denied');
    }
  });

  it('asks to connect when access was never asked or the user disconnected', () => {
    expect(todayState(status({ authorization: 'notDetermined', connected: false }))).toBe(
      'connect',
    );
    expect(todayState(status({ connected: false }))).toBe('connect');
  });

  it('asks to choose calendars when none is included, and is ready otherwise', () => {
    const none = status();
    none.accounts[0]!.calendars = none.accounts[0]!.calendars.map((calendar) => ({
      ...calendar,
      include: false,
    }));
    expect(todayState(none)).toBe('none');
    expect(todayState(status())).toBe('ready');
  });
});

describe('with a Google account', () => {
  const google = (state: 'ready' | 'sign_in_again') =>
    status({
      helper: 'missing',
      connected: false,
      accounts: [
        {
          id: 'google:a',
          title: 'me@example.com',
          kind: 'google',
          calendars: [choice(WORK, { sourceKind: 'google' })],
        },
      ],
      google: {
        ...status().google,
        accounts: [
          {
            id: '00000000-0000-4000-8000-00000000000a',
            email: 'me@example.com',
            state,
            message: null,
          },
        ],
      },
    });

  it('is ready without macOS Calendar, whatever its helper says', () => {
    expect(todayState(google('ready'))).toBe('ready');
    expect(connectorLine(google('ready')).text).toBe('1 Google account · 1 of 1 calendar');
  });

  it('says to sign in again when Google refused the sign-in', () => {
    expect(connectorLine(google('sign_in_again')).text).toBe(
      '1 Google account · 1 of 1 calendar · Sign in again',
    );
  });
});

describe('connectorLine', () => {
  it('counts accounts and included calendars once connected', () => {
    const two = status();
    two.accounts[0]!.calendars[1]!.include = false;
    expect(connectorLine(two)).toEqual({
      state: 'ready',
      text: 'macOS Calendar · 1 account · 1 of 2 calendars',
    });
  });

  it('names the state before connecting', () => {
    expect(connectorLine(status({ connected: false })).text).toBe('Not connected');
    expect(connectorLine(status({ authorization: 'denied' })).text).toBe(
      'Calendars access is off for Spark Outpost',
    );
  });
});

describe('the next meeting', () => {
  const standup = event('Standup', at(9, 30), at(9, 45));
  const focus = event('Focus: dashboards', at(10), at(11), { focus: true });
  const family = event('School pickup', at(15), at(15, 15), { nudges: false });
  const declined = event('Old sync', at(11), at(12), { myStatus: 'declined' });
  const review = event('Design review', at(14), at(15));

  it('skips focus blocks, declined events, ended meetings and calendars without nudges', () => {
    const events = [standup, focus, declined, review, family];
    expect(upcomingMeetings(events, at(9)).map((item) => item.title)).toEqual([
      'Standup',
      'Design review',
    ]);
    expect(upcomingMeetings(events, at(9, 50)).map((item) => item.title)).toEqual([
      'Design review',
    ]);
  });

  it('counts down in minutes and hours, then says now', () => {
    expect(countdown(review, at(13, 35))).toBe('in 25 min');
    expect(countdown(review, at(12, 30))).toBe('in 1 h 30');
    expect(countdown(review, at(12))).toBe('in 2 h');
    expect(countdown(review, at(14, 5))).toBe('now');
  });

  it('describes the day shape in words', () => {
    expect(
      shapeWords({
        load: 'Balanced',
        meetingMinutes: 180,
        focusMinutes: 90,
        freeMinutes: 255,
        bars: [],
      }),
    ).toBe('Balanced day · meetings 3 h · focus 1 h 30 · free 4 h 15');
    expect(duration(0)).toBe('0 min');
  });
});

describe('overlapChat', () => {
  const review = event('Design review', at(14), at(15));

  it('warns for a meeting starting within the hour while a chat runs', () => {
    expect(overlapChat(review, at(13, 1), [chat(true)])?.title).toBe('Fix login redirect');
    expect(overlapChat(review, at(14, 30), [chat(true)])).not.toBeNull();
  });

  it('stays quiet further out, after the end, for focus blocks or without a running chat', () => {
    expect(overlapChat(review, at(12, 59), [chat(true)])).toBeNull();
    expect(overlapChat(review, at(15), [chat(true)])).toBeNull();
    expect(overlapChat(review, at(13, 30), [chat(false), chat(true, true)])).toBeNull();
    const focus = event('Focus', at(14), at(15), { focus: true });
    expect(overlapChat(focus, at(13, 30), [chat(true)])).toBeNull();
  });
});

describe('noGaps', () => {
  it('marks back-to-back calls on different services', () => {
    const customer = event('Customer call', at(16), at(16, 30), { link: link('teams') });
    const vendor = event('Vendor sync', at(16, 30), at(17), { link: link('meet') });
    expect(noGaps([vendor, customer])).toEqual([
      { at: at(16, 30), text: 'no gap: Microsoft Teams → Google Meet' },
    ]);
  });

  it('ignores a gap, the same service, a call without a link and focus blocks', () => {
    const a = event('A', at(9), at(10), { link: link('zoom') });
    const b = event('B', at(10), at(11), { link: link('zoom') });
    const c = event('C', at(11, 5), at(12), { link: link('meet') });
    const d = event('D', at(12), at(13));
    const e = event('E', at(13), at(14), { link: link('meet'), focus: true });
    expect(noGaps([a, b, c, d, e])).toEqual([]);
  });
});

describe('visibleEvents', () => {
  it('hides a calendar and shows a shared copy under the calendar still shown', () => {
    const work = event('Standup', at(9), at(9, 15));
    const family = event('School pickup', at(15), at(15, 15), { calendarKey: FAMILY });
    const shared = event('Shared invite', at(16), at(16, 30), { also: [FAMILY] });
    const shown = visibleEvents([work, family, shared], new Set([WORK]));
    expect(shown.map((item) => [item.title, item.calendarKey, item.also])).toEqual([
      ['School pickup', FAMILY, []],
      ['Shared invite', FAMILY, []],
    ]);
  });
});

describe('timelineSpan', () => {
  const dayStart = at(0);
  const dayEnd = new Date(2026, 9, 17).getTime();

  it('draws 8:00 to 18:00 for a working day', () => {
    expect(timelineSpan(dayStart, dayEnd, [event('A', at(9), at(10))])).toEqual({
      start: at(8),
      end: at(18),
    });
  });

  it('widens to whole hours around early and late events, inside the day', () => {
    const early = event('Early', at(6, 30), at(7));
    const late = event('Late', at(20, 10), at(21, 40));
    const overnight = event('Overnight', at(23), new Date(2026, 9, 17, 2).getTime());
    expect(timelineSpan(dayStart, dayEnd, [early, late])).toEqual({ start: at(6), end: at(22) });
    expect(timelineSpan(dayStart, dayEnd, [overnight]).end).toBe(dayEnd);
  });
});

describe('Join', () => {
  const standup = event('Standup', at(9, 30), at(9, 45), { link: link('zoom') });
  const review = event('Design review', at(9, 40), at(10), { link: link('meet') });
  const noLink = event('Lunch', at(9, 20), at(10));

  it('picks the earliest meeting whose Join is open for ⌘J', () => {
    expect(joinTarget([review, standup, noLink], at(9, 36))?.title).toBe('Standup');
    expect(joinTarget([review, standup], at(9, 25))?.title).toBe('Standup');
    expect(joinTarget([review, standup], at(9, 46))?.title).toBe('Design review');
  });

  it('finds nothing before five minutes ahead or after the end', () => {
    expect(joinTarget([standup], at(9, 24))).toBeNull();
    expect(joinTarget([standup], at(9, 45))).toBeNull();
    expect(joinTarget([noLink], at(9, 30))).toBeNull();
  });

  it('says when Join opens', () => {
    expect(joinHint(standup, at(9))).toBe('from 9:25');
    expect(joinHint(standup, at(9, 26))).toBeNull();
  });
});

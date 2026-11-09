import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, MeetingAlertPayload } from '@spark-outpost/contracts';
import {
  meetingNotifier,
  noticePlan,
  type NoticeChoice,
  type NoticeHandle,
} from './meeting-notification.ts';

vi.mock('electron', () => ({ Notification: class {} }));

type Listener = (...args: unknown[]) => void;

function fakeNotices(supported = true) {
  const created: { options: unknown; listeners: Map<string, Listener>; closed: boolean }[] = [];
  const deps = {
    supported: () => supported,
    log: vi.fn(),
    create: (options: unknown) => {
      const entry = { options, listeners: new Map<string, Listener>(), closed: false };
      created.push(entry);
      const handle = {
        on: (event: string, listener: Listener) => entry.listeners.set(event, listener),
        show: vi.fn(),
        close: () => {
          entry.closed = true;
        },
      };
      return handle as unknown as NoticeHandle;
    },
  };
  return { deps, created };
}

const event = (key: string, link: boolean) =>
  ({
    key,
    title: key,
    link: link ? { url: 'https://zoom.us/j/1', service: 'zoom' } : null,
  }) as unknown as CalendarEvent;

const alert = (events: CalendarEvent[], key = 'standup'): MeetingAlertPayload => ({
  key,
  events,
  calendars: {},
  countdown: null,
  joinLeadMs: 600_000,
  notice: { title: 'Standup', body: '10:00–10:15 · Zoom' },
});

describe('the meeting notification', () => {
  it('offers Join and Snooze for one meeting with a link', () => {
    const plan = noticePlan(alert([event('standup', true)]));
    expect(plan.actions.map((action) => action.label)).toEqual(['Join', 'Snooze 1 min']);
    expect(plan.actions[0]!.choice).toEqual({ kind: 'join', eventKey: 'standup' });
  });

  it('offers Show instead of Join for a clash or a meeting with no link', () => {
    expect(noticePlan(alert([event('a', true), event('b', true)])).actions[0]!.label).toBe('Show');
    expect(noticePlan(alert([event('a', false)])).actions[0]!.label).toBe('Show');
  });

  it('is silent, so the island chime stays the only sound', () => {
    const { deps, created } = fakeNotices();
    meetingNotifier(deps).post(alert([event('standup', true)]), vi.fn());
    expect(created[0]!.options).toMatchObject({ title: 'Standup', silent: true });
  });

  it('routes its buttons and a click on the banner', () => {
    const { deps, created } = fakeNotices();
    const chosen: NoticeChoice[] = [];
    meetingNotifier(deps).post(alert([event('standup', true)]), (choice) => chosen.push(choice));
    const { listeners } = created[0]!;
    listeners.get('action')!({ actionIndex: 0 });
    listeners.get('action')!({}, 1);
    listeners.get('click')!();
    expect(chosen).toEqual([
      { kind: 'join', eventKey: 'standup' },
      { kind: 'snooze' },
      { kind: 'show' },
    ]);
  });

  it('posts once per alert and replaces it when the alert changes', () => {
    const { deps, created } = fakeNotices();
    const notifier = meetingNotifier(deps);
    notifier.post(alert([event('standup', true)]), vi.fn());
    notifier.post(alert([event('standup', true)]), vi.fn());
    expect(created).toHaveLength(1);
    notifier.post(alert([event('review', true)], 'review'), vi.fn());
    expect(created).toHaveLength(2);
    expect(created[0]!.closed).toBe(true);
    notifier.close();
    expect(created[1]!.closed).toBe(true);
  });

  it('replaces the notification when the meeting changes under the same alert', () => {
    const { deps, created } = fakeNotices();
    const notifier = meetingNotifier(deps);
    notifier.post(alert([event('standup', false)]), vi.fn());
    const linked = alert([event('standup', true)]);
    notifier.post(linked, vi.fn());
    notifier.post({ ...linked, notice: { title: 'Standup moved', body: 'Meet' } }, vi.fn());
    expect(created).toHaveLength(3);
    expect(created[0]!.closed).toBe(true);
    expect(created[1]!.closed).toBe(true);
    expect(created[2]!.options).toMatchObject({ title: 'Standup moved' });
  });

  it('does nothing where notifications are not supported', () => {
    const { deps, created } = fakeNotices(false);
    meetingNotifier(deps).post(alert([event('standup', true)]), vi.fn());
    expect(created).toHaveLength(0);
  });
});

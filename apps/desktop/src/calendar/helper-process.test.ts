import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { CalendarHelperError, startCalendarHelper } from './helper-process.ts';

const EVENT = {
  id: 'EVT-1',
  uid: 'uid-1',
  start: '2026-10-16T09:30:00-04:00',
  end: '2026-10-16T09:45:00-04:00',
  allDay: false,
  title: 'Standup',
  calendarId: 'cal-1',
  url: null,
  location: null,
  noteLinks: ['https://acme.zoom.us/j/1'],
  hasNotes: true,
  attendeeCount: 2,
  othersInvited: true,
  myStatus: 'accepted',
  availability: 'busy',
  recurring: false,
};

interface FakeHelper {
  child: ChildProcessWithoutNullStreams;
  requests: Record<string, unknown>[];
  say(line: unknown): void;
  hold: Set<string>;
}

function fakeHelper(): FakeHelper {
  const events = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests: Record<string, unknown>[] = [];
  const hold = new Set<string>();
  const say = (line: unknown) =>
    stdout.write(`${typeof line === 'string' ? line : JSON.stringify(line)}\n`);
  stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').trim().split('\n')) {
      const request = JSON.parse(line) as { id: string; op: string };
      requests.push(request);
      if (hold.has(request.op)) continue;
      if (request.op === 'status')
        say({ id: request.id, ok: true, result: { authorization: 'fullAccess' } });
      if (request.op === 'events')
        say({ id: request.id, ok: true, result: { events: [EVENT], truncated: false } });
      if (request.op === 'calendars')
        say({ id: request.id, ok: true, result: { calendars: [{ id: 'x' }] } });
      if (request.op === 'event') {
        say({ id: request.id, ok: false, code: 'not_found', message: 'That event is gone.' });
      }
    }
  });
  const child = Object.assign(events, {
    stdin,
    stdout,
    stderr,
    pid: 4242,
    kill: () => {
      events.emit('exit', null);
      return true;
    },
  }) as unknown as ChildProcessWithoutNullStreams;
  return { child, requests, say, hold };
}

function setup(silentMs = 30_000) {
  const helpers: FakeHelper[] = [];
  const changed = vi.fn();
  const logged: string[] = [];
  let next = 0;
  const helper = startCalendarHelper({
    binary: '/spark-calendar',
    log: (line) => logged.push(line),
    changed,
    silentMs,
    newId: () => `r${(next += 1)}`,
    spawn: () => {
      const made = fakeHelper();
      helpers.push(made);
      return made.child;
    },
  });
  return { helper, helpers, changed, logged };
}

describe('the calendar helper process', () => {
  it('starts only when first asked and answers by id', async () => {
    const { helper, helpers } = setup();
    expect(helper.running).toBe(false);
    await expect(helper.call({ op: 'status' })).resolves.toEqual({ authorization: 'fullAccess' });
    const from = '2026-10-15T00:00:00Z';
    const to = '2026-10-24T00:00:00Z';
    const window = await helper.call({ op: 'events', from, to });
    expect(window.events[0]?.title).toBe('Standup');
    expect(helpers).toHaveLength(1);
    expect(helpers[0]!.requests.map((request) => request.op)).toEqual(['status', 'events']);
  });

  it('rejects with the helper code and refuses answers that do not match the op', async () => {
    const { helper } = setup();
    await expect(
      helper.call({ op: 'event', eventId: 'EVT-1', start: EVENT.start }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(helper.call({ op: 'calendars' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('reports changed lines and ignores lines that are not JSON or not for anyone', async () => {
    const { helper, helpers, changed, logged } = setup();
    await helper.call({ op: 'status' });
    helpers[0]!.say({ event: 'changed' });
    helpers[0]!.say('not json');
    helpers[0]!.say({ id: 'nobody', ok: true, result: {} });
    helpers[0]!.say({ id: null, ok: false, code: 'invalid', message: 'bad line' });
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(logged).toContain('The calendar helper wrote a line that is not JSON.');
  });

  it('restarts after a silent helper but lets the permission request wait', async () => {
    vi.useFakeTimers();
    try {
      const { helper, helpers } = setup(1_000);
      await helper.call({ op: 'status' });
      helpers[0]!.hold.add('request');
      helpers[0]!.hold.add('calendars');
      const asking = helper.call({ op: 'request' });
      const askingFails = expect(asking).rejects.toBeInstanceOf(CalendarHelperError);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(helper.running).toBe(true);
      const listing = helper.call({ op: 'calendars' });
      const failed = expect(listing).rejects.toMatchObject({ code: 'failed' });
      await vi.advanceTimersByTimeAsync(1_000);
      await failed;
      await askingFails;
      expect(helper.running).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails waiting calls when stopped or when the helper exits', async () => {
    const { helper, helpers } = setup();
    await helper.call({ op: 'status' });
    helpers[0]!.hold.add('status');
    const waiting = helper.call({ op: 'status' });
    helper.kill();
    await expect(waiting).rejects.toMatchObject({ code: 'stopped' });
    const again = helper.call({ op: 'status' });
    await expect(again).resolves.toEqual({ authorization: 'fullAccess' });
    expect(helpers).toHaveLength(2);
    helpers[1]!.hold.add('status');
    const lost = helper.call({ op: 'status' });
    helpers[1]!.child.emit('exit', 1);
    await expect(lost).rejects.toMatchObject({ code: 'failed' });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CALENDAR_DEFAULT_SETTINGS } from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import { calendarConnection, updateSettings } from '../src/calendar/store.ts';
import { createMeetingService } from '../src/meetings/service.ts';
import { MeetingSourceError, type MeetingSource } from '../src/meetings/source.ts';
import { ROUTE_RULES } from '../src/remote/route-rules.ts';
import { testAppOptions, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

const EVENT = {
  title: 'Design review',
  eventKey: 'work|abc@2026-11-12T10:00:00Z',
  calendarName: 'Work',
};

function setup(available = true) {
  const started: string[] = [];
  const source: MeetingSource = {
    state: () => ({ available, reason: available ? null : 'Voice is off.' }),
    start: async (id) => {
      started.push(id);
    },
    stop: async () => undefined,
  };
  const meetings = createMeetingService({
    db: t.db,
    workspaceId: t.workspaceId,
    source,
    publish: () => undefined,
  });
  return { started, client: localClient(createApp({ ...testAppOptions(t), meetings })) };
}

describe('taking notes when the user joins', () => {
  it('is off by default and records nothing on a join', async () => {
    expect(CALENDAR_DEFAULT_SETTINGS.notesOnJoin).toBe(false);
    expect((await calendarConnection(t.db, t.workspaceId)).settings.notesOnJoin).toBe(false);
    const { client, started } = setup();
    const answer = await client.send('post', '/api/meetings/join-notes', EVENT).expect(200);
    expect(answer.body).toEqual({ detail: null, problem: null });
    expect(started).toEqual([]);
    expect((await client.get('/api/meetings')).body.items).toEqual([]);
  });

  it('starts recording the joined calendar meeting once the setting is on', async () => {
    await updateSettings(t.db, t.workspaceId, { notesOnJoin: true });
    const { client, started } = setup();
    const answer = await client.send('post', '/api/meetings/join-notes', EVENT).expect(200);
    expect(answer.body.detail.meeting).toMatchObject({
      title: 'Design review',
      source: 'calendar',
      eventKey: EVENT.eventKey,
      calendarName: 'Work',
      state: 'recording',
    });
    expect(started).toEqual([answer.body.detail.meeting.id]);
    expect((await client.get('/api/meetings/status')).body.recordingId).toBe(
      answer.body.detail.meeting.id,
    );
  });

  it('answers a second join of the meeting already recording with that recording', async () => {
    await updateSettings(t.db, t.workspaceId, { notesOnJoin: true });
    const { client, started } = setup();
    const first = await client.send('post', '/api/meetings/join-notes', EVENT).expect(200);
    const again = await client.send('post', '/api/meetings/join-notes', EVENT).expect(200);
    expect(again.body.problem).toBeNull();
    expect(again.body.detail.meeting.id).toBe(first.body.detail.meeting.id);
    expect(started).toHaveLength(1);
  });

  it('answers a second join during a startup that then fails with the reason, not a gone recording', async () => {
    await updateSettings(t.db, t.workspaceId, { notesOnJoin: true });
    let fail: (error: Error) => void = () => undefined;
    const source: MeetingSource = {
      state: () => ({ available: true, reason: null }),
      start: () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
      stop: async () => undefined,
    };
    const service = createMeetingService({
      db: t.db,
      workspaceId: t.workspaceId,
      source,
      publish: () => undefined,
    });
    let waiting: () => void = () => undefined;
    const secondWaits = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const meetings = {
      ...service,
      started: () => {
        waiting();
        return service.started();
      },
    };
    const client = localClient(createApp({ ...testAppOptions(t), meetings }));
    const first = client
      .send('post', '/api/meetings/join-notes', EVENT)
      .expect(200)
      .then((r) => r);
    await vi.waitFor(async () =>
      expect((await client.get('/api/meetings/status')).body.recordingId).toEqual(
        expect.any(String),
      ),
    );
    const second = client
      .send('post', '/api/meetings/join-notes', EVENT)
      .expect(200)
      .then((r) => r);
    await secondWaits;
    fail(new MeetingSourceError('The microphone is busy.'));
    const [one, two] = await Promise.all([first, second]);
    expect(two.body.detail).toBeNull();
    expect(two.body.problem).toEqual(expect.any(String));
    expect(one.body).toEqual({ detail: null, problem: 'The microphone is busy.' });
  });

  it('makes a second join wait for a start whose recording row is visible but not yet starting', async () => {
    await updateSettings(t.db, t.workspaceId, { notesOnJoin: true });
    let rowVisible: () => void = () => undefined;
    const visible = new Promise<void>((resolve) => {
      rowVisible = resolve;
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const db = new Proxy(t.db, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (prop !== 'query' || typeof value !== 'function') {
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return async (text: string, params?: unknown[]) => {
          const result: unknown = await value.call(target, text, params);
          if (text.startsWith('INSERT INTO meetings')) {
            rowVisible();
            await held;
          }
          return result;
        };
      },
    });
    const service = createMeetingService({
      db,
      workspaceId: t.workspaceId,
      source: {
        state: () => ({ available: true, reason: null }),
        start: () => Promise.reject(new MeetingSourceError('The microphone is busy.')),
        stop: async () => undefined,
      },
      publish: () => undefined,
    });
    let waiting: () => void = () => undefined;
    const secondWaits = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const meetings = {
      ...service,
      started: () => {
        waiting();
        return service.started();
      },
    };
    const client = localClient(createApp({ ...testAppOptions(t), meetings }));
    const first = client
      .send('post', '/api/meetings/join-notes', EVENT)
      .expect(200)
      .then((r) => r);
    await visible;
    const second = client
      .send('post', '/api/meetings/join-notes', EVENT)
      .expect(200)
      .then((r) => r);
    await secondWaits;
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(one.body).toEqual({ detail: null, problem: 'The microphone is busy.' });
    expect(two.body.detail).toBeNull();
    expect(two.body.problem).toEqual(expect.any(String));
  });

  it('starts nothing for a second join while one meeting records', async () => {
    await updateSettings(t.db, t.workspaceId, { notesOnJoin: true });
    const { client, started } = setup();
    await client.send('post', '/api/meetings/join-notes', EVENT).expect(200);
    const again = await client
      .send('post', '/api/meetings/join-notes', {
        ...EVENT,
        eventKey: 'work|other@2026-11-12T10:00:00Z',
      })
      .expect(200);
    expect(again.body.detail).toBeNull();
    expect(again.body.problem).toMatch(/^Still recording .+\. Stop it to take notes here\.$/);
    expect(started).toHaveLength(1);
  });

  it('says why when recording is unavailable, and starts nothing for a join with no event', async () => {
    await updateSettings(t.db, t.workspaceId, { notesOnJoin: true });
    const off = setup(false);
    expect(
      (await off.client.send('post', '/api/meetings/join-notes', EVENT).expect(200)).body,
    ).toEqual({ detail: null, problem: 'Voice is off.' });
    const on = setup();
    const answer = await on.client
      .send('post', '/api/meetings/join-notes', { title: 'No event' })
      .expect(200);
    expect(answer.body).toEqual({ detail: null, problem: null });
    expect(on.started).toEqual([]);
  });

  it('is never open to a paired device', () => {
    expect(ROUTE_RULES.get('POST /api/meetings/join-notes')).toBe('never');
  });
});

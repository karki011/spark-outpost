import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CALENDAR_DEFAULT_SETTINGS } from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import { calendarConnection, updateSettings } from '../src/calendar/store.ts';
import { createMeetingService } from '../src/meetings/service.ts';
import type { MeetingSource } from '../src/meetings/source.ts';
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
    expect(answer.body).toEqual({ detail: null });
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
    expect(again.body).toEqual({ detail: null });
    expect(started).toHaveLength(1);
  });

  it('starts nothing when recording is unavailable or the join names no calendar event', async () => {
    await updateSettings(t.db, t.workspaceId, { notesOnJoin: true });
    const off = setup(false);
    expect(
      (await off.client.send('post', '/api/meetings/join-notes', EVENT).expect(200)).body,
    ).toEqual({
      detail: null,
    });
    const on = setup();
    const answer = await on.client
      .send('post', '/api/meetings/join-notes', { title: 'No event' })
      .expect(200);
    expect(answer.body).toEqual({ detail: null });
    expect(on.started).toEqual([]);
  });

  it('is never open to a paired device', () => {
    expect(ROUTE_RULES.get('POST /api/meetings/join-notes')).toBe('never');
  });
});

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Meeting, MeetingDetail, NewMeetingLine } from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import {
  MEETINGS_NEED_THE_MAC_APP,
  MeetingSourceError,
  type DeliverLines,
} from '../src/meetings/source.ts';
import { createMeetingService, type MeetingServiceOptions } from '../src/meetings/service.ts';
import { testAppOptions, localClient } from './app-support.ts';
import { createTestDb, eventually, startChat, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

const line = (text: string, speaker: 'you' | 'others' = 'others', at = 0): NewMeetingLine => ({
  speaker,
  text,
  startMs: at,
  endMs: at + 900,
});

function controllableSource() {
  const delivers = new Map<string, DeliverLines>();
  const stopped: string[] = [];
  const lost = new Map<string, () => void>();
  return {
    delivers,
    stopped,
    lost,
    source: {
      state: () => ({ available: true, reason: null }),
      start: async (id: string, deliver: DeliverLines, onLost: () => void) => {
        delivers.set(id, deliver);
        lost.set(id, onLost);
      },
      stop: async (id: string) => {
        stopped.push(id);
      },
    },
  };
}

function setup(
  options: Partial<Pick<MeetingServiceOptions, 'source' | 'onEnded' | 'writeNotes'>> = {},
) {
  const events: Array<{ kind: string; meetingId?: string }> = [];
  const meetings = createMeetingService({
    db: t.db,
    workspaceId: t.workspaceId,
    source: null,
    publish: (event) => events.push(JSON.parse(event)),
    ...options,
  });
  const client = localClient(createApp({ ...testAppOptions(t), meetings }));
  return { meetings, events, client };
}

async function started(client: ReturnType<typeof setup>['client'], body: object = {}) {
  const response = await client.send('post', '/api/meetings', body).expect(201);
  return response.body as MeetingDetail;
}

async function uploadedAttachment(workspaceId = t.workspaceId) {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO attachments (id, workspace_id, name, media_type, kind, size, data)
     VALUES ($1, $2, 'pricing.pdf', 'application/pdf', 'file', 3, 'abc')`,
    [id, workspaceId],
  );
  return id;
}

describe('meetings without a source', () => {
  it('reports the reason and refuses to start', async () => {
    const { client } = setup();
    const status = await client.get('/api/meetings/status').expect(200);
    expect(status.body).toEqual({
      supported: false,
      available: false,
      reason: MEETINGS_NEED_THE_MAC_APP,
      recordingId: null,
    });
    const refused = await client.send('post', '/api/meetings', { title: 'Pricing' }).expect(503);
    expect(refused.body.error).toBe(MEETINGS_NEED_THE_MAC_APP);
    const list = await client.get('/api/meetings').expect(200);
    expect(list.body.items).toEqual([]);
  });
});

describe('recording a meeting', () => {
  it('stores delivered lines, pages them, and ends on stop', async () => {
    const test = controllableSource();
    const onEnded = vi.fn((_meeting: Meeting) => {
      throw new Error('notes job broke');
    });
    const { client, events } = setup({ source: test.source, onEnded });

    const detail = await started(client, { title: 'Pricing review' });
    const id = detail.meeting.id;
    expect(detail.meeting).toMatchObject({ state: 'recording', title: 'Pricing review' });
    expect((await client.get('/api/meetings/status')).body).toMatchObject({
      available: true,
      reason: null,
      recordingId: id,
    });

    await test.delivers.get(id)!([line('one'), line('two', 'you', 1000)]);
    await test.delivers.get(id)!([line('three')]);
    expect(events.some((event) => event.kind === 'meeting' && event.meetingId === id)).toBe(true);

    const all = await client.get(`/api/meetings/${id}/lines`).expect(200);
    expect(all.body.lines.map((entry: { text: string }) => entry.text)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(all.body.more).toBe(false);
    const rest = await client.get(`/api/meetings/${id}/lines?after=1`).expect(200);
    expect(rest.body.lines.map((entry: { seq: number }) => entry.seq)).toEqual([2, 3]);
    const paged = await client.get(`/api/meetings/${id}/lines?after=0&limit=2`).expect(200);
    expect(paged.body).toMatchObject({ more: true });
    expect(paged.body.lines).toHaveLength(2);
    const tail = await client.get(`/api/meetings/${id}/lines?tail=1&limit=2`).expect(200);
    expect(tail.body.lines.map((entry: { text: string }) => entry.text)).toEqual(['two', 'three']);
    expect(tail.body.more).toBe(false);
    await client.get(`/api/meetings/${id}/lines?after=-1`).expect(400);

    const stopped = await client.send('post', `/api/meetings/${id}/stop`).expect(200);
    expect(stopped.body.meeting).toMatchObject({ state: 'ended', lineCount: 3 });
    expect(stopped.body.meeting.endedAt).not.toBeNull();
    expect(test.stopped).toEqual([id]);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(onEnded.mock.calls[0]![0]).toMatchObject({ id, state: 'ended' });

    await test.delivers.get(id)!([line('late')]);
    const after = await client.get(`/api/meetings/${id}`).expect(200);
    expect(after.body.meeting.lineCount).toBe(3);

    const again = await client.send('post', `/api/meetings/${id}/stop`).expect(200);
    expect(again.body.meeting).toEqual(after.body.meeting);
    expect(test.stopped).toEqual([id]);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect((await client.get('/api/meetings/status')).body.recordingId).toBeNull();
  });

  it('refuses a second recording while one runs', async () => {
    const test = controllableSource();
    const { client } = setup({ source: test.source });
    const first = await started(client);
    const second = await client.send('post', '/api/meetings', {}).expect(409);
    expect(second.body.error).toMatch(/recording/);
    await client.send('post', `/api/meetings/${first.meeting.id}/stop`).expect(200);
    await started(client);
  });

  it('leaves no meeting behind when the source cannot start, and says why', async () => {
    const { client } = setup({
      source: {
        state: () => ({ available: true, reason: null }),
        start: async () => {
          throw new MeetingSourceError('Allow the microphone in System Settings.');
        },
        stop: async () => undefined,
      },
    });
    const refused = await client.send('post', '/api/meetings', { title: 'Standup' }).expect(503);
    expect(refused.body.error).toBe('Allow the microphone in System Settings.');
    const list = await client.get('/api/meetings').expect(200);
    expect(list.body.items).toEqual([]);
    expect((await client.get('/api/meetings/status')).body.recordingId).toBeNull();
  });

  it('refuses a start with the reason while the source says it cannot record', async () => {
    const { client } = setup({
      source: {
        state: () => ({ available: false, reason: 'Turn on Voice in Settings first.' }),
        start: async () => undefined,
        stop: async () => undefined,
      },
    });
    expect((await client.get('/api/meetings/status')).body).toEqual({
      supported: true,
      available: false,
      reason: 'Turn on Voice in Settings first.',
      recordingId: null,
    });
    const refused = await client.send('post', '/api/meetings', {}).expect(503);
    expect(refused.body.error).toBe('Turn on Voice in Settings first.');
  });

  it('marks the meeting ended by restart when capture is lost, keeping its lines', async () => {
    const test = controllableSource();
    const { client } = setup({ source: test.source });
    const { meeting } = await started(client);
    await test.delivers.get(meeting.id)!([
      { speaker: 'you', text: 'kept line', startMs: 0, endMs: 900 },
    ]);
    test.lost.get(meeting.id)!();
    const ended = await eventually(async () => {
      const detail = await client.get(`/api/meetings/${meeting.id}`).expect(200);
      return detail.body.meeting.state === 'interrupted' ? detail.body.meeting : null;
    });
    expect(ended).toMatchObject({ state: 'interrupted', lineCount: 1 });
    expect((await client.get('/api/meetings/status')).body.recordingId).toBeNull();
    await client.send('post', '/api/meetings', { title: 'Next' }).expect(201);
  });

  it('stops the source when a recording is deleted', async () => {
    const test = controllableSource();
    const { client } = setup({ source: test.source });
    const { meeting } = await started(client, { title: 'Secret roadmap' });
    await test.delivers.get(meeting.id)!([line('private words')]);

    await client.send('delete', `/api/meetings/${meeting.id}`).expect(204);
    expect(test.stopped).toEqual([meeting.id]);
    await client.get(`/api/meetings/${meeting.id}`).expect(404);
    await test.delivers.get(meeting.id)!([line('after delete')]);
    await client.send('delete', `/api/meetings/${meeting.id}`).expect(404);
  });

  it('answers 404 for unknown and 400 for malformed ids', async () => {
    const { client } = setup();
    const unknown = randomUUID();
    await client.get(`/api/meetings/${unknown}`).expect(404);
    await client.send('post', `/api/meetings/${unknown}/stop`).expect(404);
    await client.get(`/api/meetings/${unknown}/lines`).expect(404);
    await client.send('patch', `/api/meetings/${unknown}`, { title: 'x' }).expect(404);
    await client.send('put', `/api/meetings/${unknown}/notes`, { markdown: 'x' }).expect(404);
    await client.get('/api/meetings/not-an-id').expect(400);
  });
});

describe('recovering after a restart', () => {
  it('marks a recording interrupted and a writing notes state failed', async () => {
    const test = controllableSource();
    const first = setup({ source: test.source });
    const recording = await started(first.client, { title: 'Cut off' });
    await test.delivers.get(recording.meeting.id)!([line('hello')]);

    const other = await t.db.query<{ id: string }>(
      `INSERT INTO meetings (id, workspace_id, title, source, state, ended_at, notes_state)
       VALUES ($1, $2, 'Notes pending', 'adhoc', 'ended', now(), 'writing') RETURNING id`,
      [randomUUID(), t.workspaceId],
    );

    const restarted = setup({ source: test.source });
    await restarted.meetings.recover();
    expect(restarted.events.map((event) => event.meetingId)).toEqual([recording.meeting.id]);

    const interrupted = await restarted.client.get(`/api/meetings/${recording.meeting.id}`);
    expect(interrupted.body.meeting).toMatchObject({ state: 'interrupted', lineCount: 1 });
    const failed = await restarted.client.get(`/api/meetings/${other.rows[0]!.id}`);
    expect(failed.body.meeting).toMatchObject({
      state: 'ended',
      notesState: 'failed',
      notesNote: expect.stringContaining('restart'),
    });
    expect((await restarted.client.get('/api/meetings/status')).body.recordingId).toBeNull();
  });
});

describe('finding meetings', () => {
  it('searches lines through the list and validates the query', async () => {
    const test = controllableSource();
    const { client } = setup({ source: test.source });
    const { meeting } = await started(client, { title: 'Pricing review' });
    await test.delivers.get(meeting.id)!([
      line('Churn doubled last quarter'),
      line('We ship in January', 'you'),
    ]);
    await client.send('post', `/api/meetings/${meeting.id}/stop`).expect(200);
    const { meeting: other } = await started(client, { title: 'Standup' });
    await client.send('post', `/api/meetings/${other.id}/stop`).expect(200);

    const hit = await client.get('/api/meetings?q=churn').expect(200);
    expect(hit.body.items).toHaveLength(1);
    expect(hit.body.items[0].meeting.id).toBe(meeting.id);
    expect(hit.body.items[0].snippets).toEqual(['Churn doubled last quarter']);
    expect((await client.get('/api/meetings?q=nonsenseword')).body.items).toEqual([]);

    const everything = await client.get('/api/meetings').expect(200);
    expect(everything.body.items.map((item: { meeting: Meeting }) => item.meeting.id)).toEqual([
      other.id,
      meeting.id,
    ]);
    const firstPage = await client.get('/api/meetings?limit=1').expect(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.nextBefore).not.toBeNull();
    const nextPage = await client
      .get(`/api/meetings?limit=1&before=${encodeURIComponent(firstPage.body.nextBefore)}`)
      .expect(200);
    expect(nextPage.body.items[0].meeting.id).toBe(meeting.id);

    await client.get('/api/meetings?limit=0').expect(400);
    await client.get('/api/meetings?limit=51').expect(400);
    await client.get('/api/meetings?before=yesterday').expect(400);
  });

  it('a meeting started from a calendar event is a calendar meeting', async () => {
    const test = controllableSource();
    const { client } = setup({ source: test.source });
    const { meeting } = await started(client, { eventKey: 'cal:abc', calendarName: 'Work' });
    expect(meeting.source).toBe('calendar');
    expect(meeting.eventKey).toBe('cal:abc');
    expect(meeting.calendarName).toBe('Work');
  });
});

describe('editing a meeting', () => {
  it('patches fields, rejects bad values, and saves edited notes as ready', async () => {
    const test = controllableSource();
    const { client } = setup({ source: test.source });
    const { meeting } = await started(client);
    expect(meeting.title).toBe('Untitled meeting');

    const patched = await client
      .send('patch', `/api/meetings/${meeting.id}`, { title: '  Roadmap  ', goal: 'Decide' })
      .expect(200);
    expect(patched.body.meeting).toMatchObject({ title: 'Roadmap', goal: 'Decide' });
    await client.send('patch', `/api/meetings/${meeting.id}`, { title: '' }).expect(400);
    const ignored = await client
      .send('patch', `/api/meetings/${meeting.id}`, { state: 'ended' })
      .expect(200);
    expect(ignored.body.meeting.state).toBe('recording');
    await client.send('patch', `/api/meetings/${meeting.id}`, { userNotes: 5 }).expect(400);

    await client.send('post', `/api/meetings/${meeting.id}/stop`).expect(200);
    const saved = await client
      .send('put', `/api/meetings/${meeting.id}/notes`, { markdown: '# Decisions\n- ship' })
      .expect(200);
    expect(saved.body).toMatchObject({ markdown: '# Decisions\n- ship', runId: null });
    expect(saved.body.editedAt).not.toBeNull();
    const detail = await client.get(`/api/meetings/${meeting.id}`).expect(200);
    expect(detail.body.meeting.notesState).toBe('ready');
    expect(detail.body.notes.markdown).toBe('# Decisions\n- ship');
    await client.send('put', `/api/meetings/${meeting.id}/notes`, { markdown: 3 }).expect(400);
  });

  it('refuses an edit based on notes that have since been rewritten', async () => {
    const test = controllableSource();
    const { client } = setup({ source: test.source });
    const { meeting } = await started(client);
    await client.send('post', `/api/meetings/${meeting.id}/stop`).expect(200);
    const first = await client
      .send('put', `/api/meetings/${meeting.id}/notes`, { markdown: 'first' })
      .expect(200);
    const base = first.body.editedAt as string;
    const second = await client
      .send('put', `/api/meetings/${meeting.id}/notes`, { markdown: 'second', base })
      .expect(200);
    const stale = await client
      .send('put', `/api/meetings/${meeting.id}/notes`, { markdown: 'from an old editor', base })
      .expect(409);
    expect(stale.body.error).toContain('changed while you were editing');
    const detail = await client.get(`/api/meetings/${meeting.id}`).expect(200);
    expect(detail.body.notes.markdown).toBe('second');
    expect(second.body.editedAt).not.toBe(base);
  });

  it('refuses a second recording without a database error', async () => {
    const test = controllableSource();
    const { client } = setup({ source: test.source });
    await started(client);
    const refused = await client.send('post', '/api/meetings', { title: 'Another' }).expect(409);
    expect(refused.body.error).toBe('Another meeting is recording. Stop it first.');
  });

  it('refuses an edit while notes are being written, so the writer cannot overwrite it', async () => {
    const test = controllableSource();
    const { client } = setup({ source: test.source });
    const { meeting } = await started(client);
    await client.send('post', `/api/meetings/${meeting.id}/stop`).expect(200);
    await t.db.query(`UPDATE meetings SET notes_state = 'writing' WHERE id = $1`, [meeting.id]);
    const refused = await client
      .send('put', `/api/meetings/${meeting.id}/notes`, { markdown: 'mine' })
      .expect(409);
    expect(refused.body.error).toContain('being written');
    const detail = await client.get(`/api/meetings/${meeting.id}`).expect(200);
    expect(detail.body.meeting.notesState).toBe('writing');
    expect(detail.body.notes).toBeNull();
  });

  it('writes notes only through the injected job and never while recording', async () => {
    const test = controllableSource();
    const withoutJob = setup({ source: test.source });
    const { meeting } = await started(withoutJob.client);
    await withoutJob.client.send('post', `/api/meetings/${meeting.id}/stop`).expect(200);
    const unavailable = await withoutJob.client
      .send('post', `/api/meetings/${meeting.id}/notes/write`)
      .expect(503);
    expect(unavailable.body.error).toBe('Notes are not available yet.');

    const writeNotes = vi.fn(async (_id: string) => undefined);
    const withJob = setup({ source: test.source, writeNotes });
    await withJob.client.send('post', `/api/meetings/${meeting.id}/notes/write`).expect(202);
    expect(writeNotes).toHaveBeenCalledWith(meeting.id);

    const running = await started(withJob.client);
    await withJob.client
      .send('post', `/api/meetings/${running.meeting.id}/notes/write`)
      .expect(409);
    expect(writeNotes).toHaveBeenCalledTimes(1);
  });
});

describe('meeting attachments', () => {
  it('attaches, detaches, and refuses foreign, message-bound and surplus files', async () => {
    const test = controllableSource();
    const { client } = setup({ source: test.source });
    const { meeting } = await started(client);
    const path = `/api/meetings/${meeting.id}/attachments`;

    const first = await uploadedAttachment();
    const attached = await client.send('post', path, { attachmentId: first }).expect(201);
    expect(attached.body.attachments).toEqual([
      { id: first, name: 'pricing.pdf', mediaType: 'application/pdf', size: 3 },
    ]);
    const repeated = await client.send('post', path, { attachmentId: first }).expect(201);
    expect(repeated.body.attachments).toHaveLength(1);

    const otherWorkspace = randomUUID();
    await t.db.query(`INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, 'Other')`, [
      otherWorkspace,
      `other-${otherWorkspace}`,
    ]);
    const foreign = await uploadedAttachment(otherWorkspace);
    await client.send('post', path, { attachmentId: foreign }).expect(404);

    const chat = await startChat(t, 'hello');
    const bound = await uploadedAttachment();
    await t.db.query(
      `UPDATE attachments SET message_id = (SELECT id FROM messages WHERE conversation_id = $2 LIMIT 1)
        WHERE id = $1`,
      [bound, chat.conversationId],
    );
    await client.send('post', path, { attachmentId: bound }).expect(404);
    await client.send('post', path, { attachmentId: randomUUID() }).expect(404);
    await client.send('post', path, { attachmentId: 'nope' }).expect(400);

    for (let count = 1; count < 10; count += 1) {
      await client.send('post', path, { attachmentId: await uploadedAttachment() }).expect(201);
    }
    const surplus = await client
      .send('post', path, { attachmentId: await uploadedAttachment() })
      .expect(409);
    expect(surplus.body.error).toMatch(/10/);

    const detached = await client.send('delete', `${path}/${first}`).expect(200);
    expect(detached.body.attachments).toHaveLength(9);
    expect(detached.body.attachments.some((entry: { id: string }) => entry.id === first)).toBe(
      false,
    );
  });
});

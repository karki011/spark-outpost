import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MeetingAlreadyRecording,
  appendLines,
  attachToMeeting,
  claimNotesWrite,
  createMeeting,
  deleteMeeting,
  endMeeting,
  getMeeting,
  getNotes,
  interruptRecordings,
  lastLines,
  linesAfter,
  listMeetings,
  meetingAttachments,
  patchMeeting,
  saveEditedNotes,
  saveWrittenNotes,
} from '../src/meetings/store.ts';
import { pruneUnlinkedAttachments } from '../src/persistence/attachments.ts';
import { insertHiddenRun } from '../src/persistence/hidden-runs.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

const line = (text: string, speaker: 'you' | 'others' = 'others', at = 0) => ({
  speaker,
  text,
  startMs: at,
  endMs: at + 900,
});

describe('a meeting in the store', () => {
  it('records lines in order while it runs and refuses them once it has ended', async () => {
    const meeting = await createMeeting(t.db, t.workspaceId, { title: 'Pricing review' });
    expect(meeting).toMatchObject({ source: 'adhoc', state: 'recording', lineCount: 0 });

    const first = await appendLines(t.db, t.workspaceId, meeting.id, [
      line('What about annual customers?'),
      line('They keep the old price.', 'you', 1000),
    ]);
    const second = await appendLines(t.db, t.workspaceId, meeting.id, [
      line('Good.', 'others', 2000),
    ]);
    expect(first?.map((stored) => stored.seq)).toEqual([1, 2]);
    expect(second?.map((stored) => stored.seq)).toEqual([3]);

    const page = await linesAfter(t.db, meeting.id, 1, 1);
    expect(page).toEqual({
      lines: [expect.objectContaining({ seq: 2, speaker: 'you' })],
      more: true,
    });
    expect((await lastLines(t.db, meeting.id, 2)).map((stored) => stored.seq)).toEqual([2, 3]);

    const ended = await endMeeting(t.db, t.workspaceId, meeting.id);
    expect(ended).toMatchObject({ state: 'ended', lineCount: 3 });
    expect(ended?.endedAt).not.toBeNull();
    expect(await appendLines(t.db, t.workspaceId, meeting.id, [line('late')])).toBeNull();
    expect(await endMeeting(t.db, t.workspaceId, meeting.id)).toBeNull();
  });

  it('allows one recording at a time and marks it interrupted at a restart', async () => {
    const meeting = await createMeeting(t.db, t.workspaceId, {
      eventKey: 'uid-1@2026-11-11T14:00:00.000Z',
    });
    expect(meeting).toMatchObject({ source: 'calendar', title: 'Untitled meeting' });
    await expect(createMeeting(t.db, t.workspaceId, {})).rejects.toBeInstanceOf(
      MeetingAlreadyRecording,
    );
    expect(await interruptRecordings(t.db, t.workspaceId)).toEqual([meeting.id]);
    expect(await getMeeting(t.db, t.workspaceId, meeting.id)).toMatchObject({
      state: 'interrupted',
    });
    await expect(createMeeting(t.db, t.workspaceId, {})).resolves.toMatchObject({
      state: 'recording',
    });
  });

  it('keeps written notes, then the edit, and writes only when nothing else is writing', async () => {
    const meeting = await createMeeting(t.db, t.workspaceId, { title: 'Standup' });
    expect(await claimNotesWrite(t.db, meeting.id)).toBe(false);
    await endMeeting(t.db, t.workspaceId, meeting.id);
    expect(await claimNotesWrite(t.db, meeting.id)).toBe(true);
    expect(await claimNotesWrite(t.db, meeting.id)).toBe(false);

    await saveWrittenNotes(t.db, meeting.id, '## Summary\nShip Friday.', null);
    const edited = await saveEditedNotes(t.db, meeting.id, '## Summary\nShip Monday.');
    expect(edited.editedAt).not.toBeNull();
    expect((await getNotes(t.db, meeting.id))?.markdown).toContain('Monday');
  });

  it('finds a meeting by its title, its notes or a line, newest first, with matching lines', async () => {
    const old = await createMeeting(t.db, t.workspaceId, { title: 'Vendor demo' });
    await appendLines(t.db, t.workspaceId, old.id, [line('The churn number is three percent.')]);
    await endMeeting(t.db, t.workspaceId, old.id);
    await t.db.query(`UPDATE meetings SET started_at = now() - interval '1 day' WHERE id = $1`, [
      old.id,
    ]);
    const recent = await createMeeting(t.db, t.workspaceId, { title: 'Pricing review' });
    await endMeeting(t.db, t.workspaceId, recent.id);
    await saveWrittenNotes(t.db, recent.id, 'Finance needs churn before signing.', null);

    const all = await listMeetings(t.db, t.workspaceId);
    expect(all.items.map((item) => item.meeting.title)).toEqual(['Pricing review', 'Vendor demo']);
    expect(all.nextBefore).toBeNull();

    const found = await listMeetings(t.db, t.workspaceId, { query: 'churn' });
    expect(found.items.map((item) => item.meeting.title)).toEqual([
      'Pricing review',
      'Vendor demo',
    ]);
    expect(found.items[1]!.snippets).toEqual(['The churn number is three percent.']);
    expect((await listMeetings(t.db, t.workspaceId, { query: 'vendor' })).items).toHaveLength(1);

    const paged = await listMeetings(t.db, t.workspaceId, { limit: 1 });
    expect(paged.items).toHaveLength(1);
    const rest = await listMeetings(t.db, t.workspaceId, { limit: 1, before: paged.nextBefore! });
    expect(rest.items.map((item) => item.meeting.title)).toEqual(['Vendor demo']);
  });

  it("keeps a calendar meeting's event key, attaches a file once and deletes with its lines", async () => {
    const key = 'uid-9@2026-11-11T14:00:00.000Z';
    const meeting = await createMeeting(t.db, t.workspaceId, {
      eventKey: key,
      title: 'Design review',
    });
    await patchMeeting(t.db, t.workspaceId, meeting.id, {
      goal: 'Agree the price',
      userNotes: 'ask about churn',
    });
    expect(meeting.eventKey).toBe(key);
    expect(meeting.source).toBe('calendar');

    const attachmentId = randomUUID();
    await t.db.query(
      `INSERT INTO attachments (id, workspace_id, name, media_type, kind, size, data)
       VALUES ($1, $2, 'pricing.pdf', 'application/pdf', 'file', 3, 'abc')`,
      [attachmentId, t.workspaceId],
    );
    expect(await attachToMeeting(t.db, t.workspaceId, meeting.id, attachmentId)).toBe(true);
    expect(await attachToMeeting(t.db, t.workspaceId, meeting.id, attachmentId)).toBe(false);
    expect(await meetingAttachments(t.db, meeting.id)).toEqual([
      { id: attachmentId, name: 'pricing.pdf', mediaType: 'application/pdf', size: 3 },
    ]);

    await appendLines(t.db, t.workspaceId, meeting.id, [line('hello')]);
    expect(await deleteMeeting(t.db, t.workspaceId, meeting.id)).toBe(true);
    const { rows } = await t.db.query('SELECT 1 FROM meeting_lines WHERE meeting_id = $1', [
      meeting.id,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("keeps a meeting's context file when unlinked attachments are pruned", async () => {
    const meeting = await createMeeting(t.db, t.workspaceId, { title: 'Design review' });
    const kept = randomUUID();
    const loose = randomUUID();
    for (const id of [kept, loose]) {
      await t.db.query(
        `INSERT INTO attachments (id, workspace_id, name, media_type, kind, size, data, created_at)
         VALUES ($1, $2, 'notes.txt', 'text/plain', 'text', 3, 'abc', now() - interval '2 days')`,
        [id, t.workspaceId],
      );
    }
    expect(await attachToMeeting(t.db, t.workspaceId, meeting.id, kept)).toBe(true);
    await pruneUnlinkedAttachments(t.db, t.workspaceId);
    const { rows } = await t.db.query<{ id: string }>('SELECT id FROM attachments');
    expect(rows.map((row) => row.id)).toEqual([kept]);
  });

  it('deleting a meeting removes the hidden chats its notes were written in', async () => {
    const meeting = await createMeeting(t.db, t.workspaceId, { title: 'Design review' });
    const other = await insertHiddenRun(t.db, t.workspaceId, {
      title: 'Daily digest',
      archived: true,
      prompt: 'unrelated',
      provider: 'fake',
      model: null,
      effort: null,
    });
    const run = await insertHiddenRun(t.db, t.workspaceId, {
      title: 'Meeting notes',
      archived: true,
      prompt: 'Others: the price goes up in January',
      provider: 'fake',
      model: null,
      effort: null,
    });
    await t.db.query('INSERT INTO meeting_note_runs (run_id, meeting_id) VALUES ($1, $2)', [
      run.runId,
      meeting.id,
    ]);
    await endMeeting(t.db, t.workspaceId, meeting.id);
    expect(await deleteMeeting(t.db, t.workspaceId, meeting.id)).toBe(true);
    const { rows } = await t.db.query<{ id: string }>(
      'SELECT id FROM conversations WHERE id = ANY($1::uuid[])',
      [[run.conversationId, other.conversationId]],
    );
    expect(rows.map((row) => row.id)).toEqual([other.conversationId]);
    const left = await t.db.query('SELECT 1 FROM messages WHERE conversation_id = $1', [
      run.conversationId,
    ]);
    expect(left.rows).toHaveLength(0);
  });
});

import { randomUUID } from 'node:crypto';
import {
  MEETING_LINES_PAGE,
  MEETING_LIST_PAGE,
  MEETING_SNIPPETS,
  MEETING_UNTITLED,
  type Meeting,
  type MeetingAttachment,
  type MeetingLine,
  type MeetingListItem,
  type MeetingNotes,
  type MeetingNotesState,
  type MeetingPatch,
  type NewMeetingLine,
  type StartMeetingRequest,
} from '@spark-outpost/contracts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';

interface MeetingRow {
  id: string;
  title: string;
  source: Meeting['source'];
  event_key: string | null;
  calendar_name: string | null;
  started_at: Date;
  ended_at: Date | null;
  state: Meeting['state'];
  goal: string;
  user_notes: string;
  line_count: number;
  notes_state: MeetingNotesState;
  notes_note: string | null;
}

const MEETING_COLUMNS =
  'id, title, source, event_key, calendar_name, started_at, ended_at, state, goal, user_notes, line_count, notes_state, notes_note';

function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    eventKey: row.event_key,
    calendarName: row.calendar_name,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    state: row.state,
    goal: row.goal,
    userNotes: row.user_notes,
    lineCount: row.line_count,
    notesState: row.notes_state,
    notesNote: row.notes_note,
  };
}

export class MeetingAlreadyRecording extends Error {
  constructor() {
    super('Another meeting is recording. Stop it first.');
  }
}

export async function createMeeting(
  db: Queryable,
  workspaceId: string,
  request: StartMeetingRequest,
): Promise<Meeting> {
  const { rows } = await db.query<MeetingRow>(
    `INSERT INTO meetings (id, workspace_id, title, source, event_key, calendar_name, goal, title_origin)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (workspace_id) WHERE state = 'recording' DO NOTHING
     RETURNING ${MEETING_COLUMNS}`,
    [
      randomUUID(),
      workspaceId,
      request.title || MEETING_UNTITLED,
      request.eventKey ? 'calendar' : 'adhoc',
      request.eventKey ?? null,
      request.calendarName || null,
      request.goal ?? '',
      request.title ? 'given' : 'default',
    ],
  );
  const row = rows[0];
  if (!row) throw new MeetingAlreadyRecording();
  return toMeeting(row);
}

export async function getMeeting(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<Meeting | null> {
  const { rows } = await db.query<MeetingRow>(
    `SELECT ${MEETING_COLUMNS} FROM meetings WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id],
  );
  return rows[0] ? toMeeting(rows[0]) : null;
}

export async function recordingMeeting(
  db: Queryable,
  workspaceId: string,
): Promise<Meeting | null> {
  const { rows } = await db.query<MeetingRow>(
    `SELECT ${MEETING_COLUMNS} FROM meetings WHERE workspace_id = $1 AND state = 'recording'`,
    [workspaceId],
  );
  return rows[0] ? toMeeting(rows[0]) : null;
}

export async function patchMeeting(
  db: Queryable,
  workspaceId: string,
  id: string,
  patch: MeetingPatch,
): Promise<Meeting | null> {
  const { rows } = await db.query<MeetingRow>(
    `UPDATE meetings
        SET title = COALESCE($3, title), goal = COALESCE($4, goal), user_notes = COALESCE($5, user_notes),
            title_origin = CASE WHEN $3::text IS NULL THEN title_origin ELSE 'given' END
      WHERE workspace_id = $1 AND id = $2
      RETURNING ${MEETING_COLUMNS}`,
    [workspaceId, id, patch.title ?? null, patch.goal ?? null, patch.userNotes ?? null],
  );
  return rows[0] ? toMeeting(rows[0]) : null;
}

export async function needsAutoTitle(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM meetings WHERE id = $1 AND title_origin = 'default'`,
    [id],
  );
  return rows.length > 0;
}

export async function setAutoTitle(db: Queryable, id: string, title: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE meetings SET title = $2, title_origin = 'auto'
      WHERE id = $1 AND title_origin = 'default'`,
    [id, title],
  );
  return (rowCount ?? 0) > 0;
}

export async function endMeeting(
  db: Queryable,
  workspaceId: string,
  id: string,
  state: 'ended' | 'interrupted' = 'ended',
): Promise<Meeting | null> {
  const { rows } = await db.query<MeetingRow>(
    `UPDATE meetings SET state = $3, ended_at = now()
      WHERE workspace_id = $1 AND id = $2 AND state = 'recording'
      RETURNING ${MEETING_COLUMNS}`,
    [workspaceId, id, state],
  );
  return rows[0] ? toMeeting(rows[0]) : null;
}

export async function interruptRecordings(db: Queryable, workspaceId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE meetings SET state = 'interrupted', ended_at = now()
      WHERE workspace_id = $1 AND state = 'recording'
      RETURNING id`,
    [workspaceId],
  );
  return rows.map((row) => row.id);
}

export async function deleteMeeting(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  await db.query(
    `DELETE FROM conversations c USING runs r, meeting_note_runs n, meetings m
      WHERE c.id = r.conversation_id AND r.id = n.run_id AND n.meeting_id = m.id
        AND m.workspace_id = $1 AND m.id = $2 AND c.kind = 'digest'`,
    [workspaceId, id],
  );
  const { rowCount } = await db.query('DELETE FROM meetings WHERE workspace_id = $1 AND id = $2', [
    workspaceId,
    id,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function appendLines(
  db: Db,
  workspaceId: string,
  id: string,
  lines: readonly NewMeetingLine[],
): Promise<MeetingLine[] | null> {
  if (lines.length === 0) return [];
  return withTransaction(db, async (client) => {
    const { rows } = await client.query<{ line_count: number }>(
      `SELECT line_count FROM meetings
        WHERE workspace_id = $1 AND id = $2 AND state = 'recording' FOR UPDATE`,
      [workspaceId, id],
    );
    if (!rows[0]) return null;
    const first = rows[0].line_count + 1;
    const stored = lines.map((line, index) => ({ ...line, seq: first + index }));
    await client.query(
      `INSERT INTO meeting_lines (meeting_id, seq, speaker, body, start_ms, end_ms)
       SELECT $1, line.seq, line.speaker, line.text, line."startMs", line."endMs"
         FROM jsonb_to_recordset($2::jsonb)
           AS line(seq integer, speaker text, text text, "startMs" integer, "endMs" integer)`,
      [id, JSON.stringify(stored)],
    );
    await client.query('UPDATE meetings SET line_count = line_count + $2 WHERE id = $1', [
      id,
      stored.length,
    ]);
    return stored;
  });
}

interface LineRow {
  seq: number;
  speaker: MeetingLine['speaker'];
  body: string;
  start_ms: number;
  end_ms: number;
}

function toLine(row: LineRow): MeetingLine {
  return {
    seq: row.seq,
    speaker: row.speaker,
    text: row.body,
    startMs: row.start_ms,
    endMs: row.end_ms,
  };
}

export async function linesAfter(
  db: Queryable,
  meetingId: string,
  after: number,
  limit = MEETING_LINES_PAGE,
): Promise<{ lines: MeetingLine[]; more: boolean }> {
  const { rows } = await db.query<LineRow>(
    `SELECT seq, speaker, body, start_ms, end_ms FROM meeting_lines
      WHERE meeting_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
    [meetingId, after, limit + 1],
  );
  return { lines: rows.slice(0, limit).map(toLine), more: rows.length > limit };
}

export async function lastLines(
  db: Queryable,
  meetingId: string,
  limit = MEETING_LINES_PAGE,
): Promise<MeetingLine[]> {
  const { rows } = await db.query<LineRow>(
    `SELECT seq, speaker, body, start_ms, end_ms FROM meeting_lines
      WHERE meeting_id = $1 ORDER BY seq DESC LIMIT $2`,
    [meetingId, limit],
  );
  return rows.map(toLine).reverse();
}

interface NotesRow {
  markdown: string;
  written_at: Date;
  edited_at: Date | null;
  run_id: string | null;
}

function toNotes(row: NotesRow): MeetingNotes {
  return {
    markdown: row.markdown,
    writtenAt: row.written_at.toISOString(),
    editedAt: row.edited_at ? row.edited_at.toISOString() : null,
    runId: row.run_id,
  };
}

export async function getNotes(db: Queryable, meetingId: string): Promise<MeetingNotes | null> {
  const { rows } = await db.query<NotesRow>(
    'SELECT markdown, written_at, edited_at, run_id FROM meeting_notes WHERE meeting_id = $1',
    [meetingId],
  );
  return rows[0] ? toNotes(rows[0]) : null;
}

export async function saveWrittenNotes(
  db: Queryable,
  meetingId: string,
  markdown: string,
  runId: string | null,
): Promise<MeetingNotes> {
  const { rows } = await db.query<NotesRow>(
    `INSERT INTO meeting_notes (meeting_id, markdown, run_id) VALUES ($1, $2, $3)
     ON CONFLICT (meeting_id) DO UPDATE
       SET markdown = EXCLUDED.markdown, run_id = EXCLUDED.run_id, written_at = now(), edited_at = NULL
     RETURNING markdown, written_at, edited_at, run_id`,
    [meetingId, markdown, runId],
  );
  return toNotes(rows[0]!);
}

export async function saveEditedNotes(
  db: Queryable,
  meetingId: string,
  markdown: string,
): Promise<MeetingNotes> {
  const { rows } = await db.query<NotesRow>(
    `INSERT INTO meeting_notes (meeting_id, markdown, edited_at) VALUES ($1, $2, now())
     ON CONFLICT (meeting_id) DO UPDATE SET markdown = EXCLUDED.markdown, edited_at = now()
     RETURNING markdown, written_at, edited_at, run_id`,
    [meetingId, markdown],
  );
  return toNotes(rows[0]!);
}

export async function setNotesState(
  db: Queryable,
  meetingId: string,
  state: MeetingNotesState,
  note: string | null = null,
): Promise<void> {
  await db.query('UPDATE meetings SET notes_state = $2, notes_note = $3 WHERE id = $1', [
    meetingId,
    state,
    note,
  ]);
}

export async function claimNotesWrite(db: Queryable, meetingId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE meetings SET notes_state = 'writing', notes_note = NULL
      WHERE id = $1 AND notes_state <> 'writing' AND state <> 'recording'`,
    [meetingId],
  );
  return (rowCount ?? 0) > 0;
}

export async function failInterruptedNotes(db: Queryable, workspaceId: string): Promise<void> {
  await db.query(
    `UPDATE meetings SET notes_state = 'failed', notes_note = 'Stopped by a restart. Write again.'
      WHERE workspace_id = $1 AND notes_state = 'writing'`,
    [workspaceId],
  );
}

export async function meetingAttachments(
  db: Queryable,
  meetingId: string,
): Promise<MeetingAttachment[]> {
  const { rows } = await db.query<{ id: string; name: string; media_type: string; size: number }>(
    `SELECT a.id, a.name, a.media_type, a.size
       FROM meeting_attachments m JOIN attachments a ON a.id = m.attachment_id
      WHERE m.meeting_id = $1 ORDER BY m.position, a.name`,
    [meetingId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    mediaType: row.media_type,
    size: Number(row.size),
  }));
}

export async function attachToMeeting(
  db: Queryable,
  workspaceId: string,
  meetingId: string,
  attachmentId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO meeting_attachments (meeting_id, attachment_id, position)
     SELECT $2, a.id, (SELECT count(*) FROM meeting_attachments WHERE meeting_id = $2)
       FROM attachments a WHERE a.id = $3 AND a.workspace_id = $1 AND a.message_id IS NULL
     ON CONFLICT DO NOTHING`,
    [workspaceId, meetingId, attachmentId],
  );
  return (rowCount ?? 0) > 0;
}

export async function detachFromMeeting(
  db: Queryable,
  meetingId: string,
  attachmentId: string,
): Promise<void> {
  await db.query('DELETE FROM meeting_attachments WHERE meeting_id = $1 AND attachment_id = $2', [
    meetingId,
    attachmentId,
  ]);
}

export interface MeetingListQuery {
  before?: string;
  query?: string;
  limit?: number;
}

export async function listMeetings(
  db: Queryable,
  workspaceId: string,
  options: MeetingListQuery = {},
): Promise<{ items: MeetingListItem[]; nextBefore: string | null }> {
  const limit = options.limit ?? MEETING_LIST_PAGE;
  const query = options.query?.trim() ?? '';
  const { rows } = await db.query<MeetingRow & { snippets: string[] | null }>(
    `WITH q AS (SELECT CASE WHEN $3 = '' THEN NULL ELSE plainto_tsquery('simple', $3) END AS ts)
     SELECT ${MEETING_COLUMNS.split(', ')
       .map((column) => `m.${column}`)
       .join(', ')},
       CASE WHEN q.ts IS NULL THEN NULL ELSE ARRAY(
         SELECT l.body FROM meeting_lines l
          WHERE l.meeting_id = m.id AND l.search @@ q.ts ORDER BY l.seq LIMIT $5
       ) END AS snippets
       FROM meetings m CROSS JOIN q
      WHERE m.workspace_id = $1
        AND ($2::timestamptz IS NULL OR m.started_at < $2)
        AND (q.ts IS NULL
          OR m.search @@ q.ts
          OR EXISTS (SELECT 1 FROM meeting_notes n WHERE n.meeting_id = m.id AND n.search @@ q.ts)
          OR EXISTS (SELECT 1 FROM meeting_lines l WHERE l.meeting_id = m.id AND l.search @@ q.ts))
      ORDER BY m.started_at DESC
      LIMIT $4`,
    [workspaceId, options.before ?? null, query, limit + 1, MEETING_SNIPPETS],
  );
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => ({ meeting: toMeeting(row), snippets: row.snippets ?? [] })),
    nextBefore: rows.length > limit ? page[page.length - 1]!.started_at.toISOString() : null,
  };
}

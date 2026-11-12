import { MEETING_NOTES_MAX, type AppEvent } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { NotesModelError, childRunNotesModel, type NotesModel } from './notes-model.ts';
import { buildNotesPrompt, type ContextItem } from './notes-prompt.ts';
import { readSections } from './notes-sections.ts';
import {
  claimNotesWrite,
  getMeeting,
  getNotes,
  meetingAttachments,
  saveWrittenNotes,
  setNotesState,
} from './store.ts';

export interface NotesDeps {
  db: Db;
  workspaceId: string;
  model: NotesModel;
  publish(event: AppEvent): Promise<void>;
}

const NO_PROVIDER = 'Connect a provider to write notes.';
const NOTHING = 'Nothing to write notes from.';
const EMPTY_REPLY = 'The model sent back no notes. Write again.';
const GENERIC = 'The notes could not be written. Write again.';
const FOREIGN_KEY_VIOLATION = '23503';

class NotesFailure extends Error {}

async function attachmentContext(db: Db, meetingId: string): Promise<ContextItem[]> {
  const attachments = await meetingAttachments(db, meetingId);
  if (attachments.length === 0) return [];
  const { rows } = await db.query<{ id: string; kind: string; data: Buffer }>(
    `SELECT id, kind, data FROM attachments WHERE id = ANY($1::uuid[])`,
    [attachments.map((attachment) => attachment.id)],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return attachments.map((attachment) => {
    const row = byId.get(attachment.id);
    const text = row?.kind === 'text' ? row.data.toString('utf8') : null;
    return { name: attachment.name, text };
  });
}

async function runSections(deps: NotesDeps, meetingId: string) {
  const meeting = await getMeeting(deps.db, deps.workspaceId, meetingId);
  if (!meeting) return null;
  const sections = await readSections(deps.db, meetingId);
  if (sections.length === 0 && !meeting.userNotes.trim()) throw new NotesFailure(NOTHING);
  const existing = (await getNotes(deps.db, meetingId))?.markdown ?? '';
  const context = await attachmentContext(deps.db, meetingId);
  const pieces = sections.length > 0 ? sections : [''];
  let notes = existing;
  let runId: string | null = null;
  for (const [index, section] of pieces.entries()) {
    const prompt = buildNotesPrompt({
      title: meeting.title,
      goal: meeting.goal,
      userNotes: meeting.userNotes,
      notesSoFar: notes,
      section,
      index,
      total: pieces.length,
      context,
    });
    const reply = await deps.model.complete(prompt);
    if (!reply.text.trim()) throw new NotesFailure(EMPTY_REPLY);
    notes = reply.text.trim();
    runId = reply.runId;
  }
  return { markdown: notes.slice(0, MEETING_NOTES_MAX), runId };
}

function reasonFor(error: unknown): string {
  if (error instanceof NotesFailure || error instanceof NotesModelError) return error.message;
  return GENERIC;
}

async function saveIfPresent(
  deps: NotesDeps,
  meetingId: string,
  written: { markdown: string; runId: string | null },
): Promise<void> {
  try {
    await saveWrittenNotes(deps.db, meetingId, written.markdown, written.runId);
    await setNotesState(deps.db, meetingId, 'ready');
  } catch (error) {
    if ((error as { code?: string }).code !== FOREIGN_KEY_VIOLATION) throw error;
  }
}

export async function writeMeetingNotes(deps: NotesDeps, meetingId: string): Promise<void> {
  if (!(await claimNotesWrite(deps.db, meetingId))) return;
  await deps.publish({ kind: 'meeting', conversationId: null, runId: null, meetingId });
  try {
    if (!(await deps.model.available())) throw new NotesFailure(NO_PROVIDER);
    const written = await runSections(deps, meetingId);
    if (written) await saveIfPresent(deps, meetingId, written);
  } catch (error) {
    await setNotesState(deps.db, meetingId, 'failed', reasonFor(error)).catch(() => undefined);
  }
  await deps
    .publish({ kind: 'meeting', conversationId: null, runId: null, meetingId })
    .catch(() => undefined);
}

export function meetingNotesWriter(
  db: Db,
  workspaceId: string,
  publish: NotesDeps['publish'],
): (meetingId: string) => Promise<void> {
  const model = childRunNotesModel(db, workspaceId);
  return (meetingId) => writeMeetingNotes({ db, workspaceId, model, publish }, meetingId);
}

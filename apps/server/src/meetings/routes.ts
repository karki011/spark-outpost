import { Router } from 'express';
import { z } from 'zod';
import {
  MEETING_ATTACHMENTS_MAX,
  MEETING_LINES_PAGE,
  MEETING_LIST_PAGE,
  meetingAttachRequestSchema,
  type MeetingJoinNotes,
  meetingNotesEditSchema,
  meetingNotesVersion,
  meetingPatchSchema,
  startMeetingRequestSchema,
  type Meeting,
  type MeetingDetail,
  type StartMeetingRequest,
  type MeetingLinesPage,
} from '@spark-outpost/contracts';
import { paramId, parseBody, parseQuery } from '../api/validation.ts';
import { calendarConnection } from '../calendar/store.ts';
import type { Db } from '../persistence/db.ts';
import { MeetingError, type MeetingService } from './service.ts';
import {
  attachToMeeting,
  detachFromMeeting,
  getMeeting,
  getNotes,
  lastLines,
  linesAfter,
  listMeetings,
  meetingAttachments,
  patchMeeting,
  recordingMeeting,
  saveEditedNotes,
  setNotesState,
} from './store.ts';

export interface MeetingRouteDeps {
  db: Db;
  workspaceId: string;
  meetings: MeetingService;
}

const listQuerySchema = z.object({
  before: z.iso.datetime().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MEETING_LIST_PAGE).optional(),
});

const linesQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MEETING_LINES_PAGE).optional(),
  tail: z.enum(['1']).optional(),
});

const RECORDING_TITLE_SHOWN = 80;
const LIVE_WORDS_CLIENT_LIMIT = 8;
const LIVE_WORDS_RETRY_MS = 2_000;
const LIVE_WORDS_HEARTBEAT_MS = 15_000;

function stillRecording(title: string): string {
  return `Still recording ${title.slice(0, RECORDING_TITLE_SHOWN)}. Stop it to take notes here.`;
}

export function meetingRoutes({ db, workspaceId, meetings }: MeetingRouteDeps) {
  const router = Router();

  async function detail(id: string): Promise<MeetingDetail> {
    const meeting = await getMeeting(db, workspaceId, id);
    if (!meeting) throw new MeetingError(404, 'Meeting not found.');
    const [notes, attachments] = await Promise.all([getNotes(db, id), meetingAttachments(db, id)]);
    return { meeting, notes, attachments };
  }

  router.get('/meetings/status', async (_req, res) => {
    res.json(await meetings.status());
  });

  router.get('/meetings', async (req, res) => {
    const query = parseQuery(listQuerySchema, req);
    res.json(
      await listMeetings(db, workspaceId, {
        ...(query.before ? { before: query.before } : {}),
        ...(query.q ? { query: query.q } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      }),
    );
  });

  router.post('/meetings', async (req, res) => {
    const request = parseBody(startMeetingRequestSchema, req);
    const meeting = await meetings.start(request);
    res.status(201).json(await detail(meeting.id));
  });

  async function joinRecording(recording: Meeting, eventKey: string): Promise<MeetingJoinNotes> {
    if (recording.eventKey !== eventKey) {
      return { detail: null, problem: stillRecording(recording.title) };
    }
    await meetings.started();
    const still = await getMeeting(db, workspaceId, recording.id);
    if (still?.state === 'recording') return { detail: await detail(recording.id), problem: null };
    return { detail: null, problem: 'Recording didn’t start. Try Take notes.' };
  }

  async function startForJoin(request: StartMeetingRequest, eventKey: string) {
    try {
      return { detail: await detail((await meetings.start(request)).id), problem: null };
    } catch (error) {
      if (!(error instanceof MeetingError)) throw error;
      const winner = error.status === 409 ? await recordingMeeting(db, workspaceId) : null;
      if (winner) return joinRecording(winner, eventKey);
      return { detail: null, problem: error.message.slice(0, 500) };
    }
  }

  router.post('/meetings/join-notes', async (req, res) => {
    const request = parseBody(startMeetingRequestSchema, req);
    const { settings } = await calendarConnection(db, workspaceId);
    const eventKey = request.eventKey;
    if (!settings.notesOnJoin || !eventKey) {
      res.json({ detail: null, problem: null } satisfies MeetingJoinNotes);
      return;
    }
    const recording = await recordingMeeting(db, workspaceId);
    res.json(
      recording ? await joinRecording(recording, eventKey) : await startForJoin(request, eventKey),
    );
  });

  router.get('/meetings/:id', async (req, res) => {
    res.json(await detail(paramId(req)));
  });

  router.patch('/meetings/:id', async (req, res) => {
    const id = paramId(req);
    const patch = parseBody(meetingPatchSchema, req);
    if (!(await patchMeeting(db, workspaceId, id, patch))) {
      throw new MeetingError(404, 'Meeting not found.');
    }
    meetings.announce(id);
    res.json(await detail(id));
  });

  router.delete('/meetings/:id', async (req, res) => {
    if (!(await meetings.remove(paramId(req)))) throw new MeetingError(404, 'Meeting not found.');
    res.status(204).end();
  });

  router.post('/meetings/:id/stop', async (req, res) => {
    const id = paramId(req);
    if (!(await meetings.stop(id))) throw new MeetingError(404, 'Meeting not found.');
    res.json(await detail(id));
  });

  router.get('/meetings/:id/lines', async (req, res) => {
    const id = paramId(req);
    const query = parseQuery(linesQuerySchema, req);
    if (!(await getMeeting(db, workspaceId, id))) throw new MeetingError(404, 'Meeting not found.');
    const page: MeetingLinesPage = query.tail
      ? { lines: await lastLines(db, id, query.limit), more: false }
      : await linesAfter(db, id, query.after, query.limit);
    res.json(page);
  });

  router.get('/meetings/:id/live', async (req, res) => {
    const id = paramId(req);
    const stops: (() => void)[] = [];
    res.on('close', () => {
      for (const stop of stops) stop();
    });
    const meeting = await getMeeting(db, workspaceId, id);
    if (res.destroyed) return;
    if (!meeting) throw new MeetingError(404, 'Meeting not found.');
    if (meeting.state !== 'recording') {
      res.status(204).end();
      return;
    }
    if (meetings.wordsWatchers(id) >= LIVE_WORDS_CLIENT_LIMIT) {
      throw new MeetingError(503, 'Too many windows are following this meeting.');
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write(`retry: ${LIVE_WORDS_RETRY_MS}\n\n`);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), LIVE_WORDS_HEARTBEAT_MS);
    stops.push(() => clearInterval(heartbeat));
    stops.push(
      meetings.watchWords(
        id,
        (words) => res.write(`data: ${JSON.stringify(words)}\n\n`),
        () => res.end(),
      ),
    );
  });

  router.put('/meetings/:id/notes', async (req, res) => {
    const id = paramId(req);
    const { markdown, base } = parseBody(meetingNotesEditSchema, req);
    const meeting = await getMeeting(db, workspaceId, id);
    if (!meeting) throw new MeetingError(404, 'Meeting not found.');
    if (meeting.notesState === 'writing') {
      throw new MeetingError(409, 'Notes are being written. Save again when they are done.');
    }
    const current = await getNotes(db, id);
    if (base && current && Date.parse(meetingNotesVersion(current)) !== Date.parse(base)) {
      throw new MeetingError(
        409,
        'The notes changed while you were editing. Copy your text, cancel, and edit the new notes.',
      );
    }
    const notes = await saveEditedNotes(db, id, markdown);
    await setNotesState(db, id, 'ready');
    meetings.announce(id);
    res.json(notes);
  });

  router.post('/meetings/:id/notes/write', async (req, res) => {
    const id = paramId(req);
    const meeting = await getMeeting(db, workspaceId, id);
    if (!meeting) throw new MeetingError(404, 'Meeting not found.');
    const writeNotes = meetings.writeNotes;
    if (!writeNotes) throw new MeetingError(503, 'Notes are not available yet.');
    if (meeting.state === 'recording') throw new MeetingError(409, 'Stop the meeting first.');
    void writeNotes(id).catch(() => undefined);
    res.status(202).end();
  });

  router.post('/meetings/:id/attachments', async (req, res) => {
    const id = paramId(req);
    const { attachmentId } = parseBody(meetingAttachRequestSchema, req);
    if (!(await getMeeting(db, workspaceId, id))) throw new MeetingError(404, 'Meeting not found.');
    const current = await meetingAttachments(db, id);
    if (!current.some((attachment) => attachment.id === attachmentId)) {
      if (current.length >= MEETING_ATTACHMENTS_MAX) {
        throw new MeetingError(409, `A meeting holds at most ${MEETING_ATTACHMENTS_MAX} files.`);
      }
      if (!(await attachToMeeting(db, workspaceId, id, attachmentId))) {
        throw new MeetingError(404, 'Attachment not found.');
      }
      meetings.announce(id);
    }
    res.status(201).json(await detail(id));
  });

  router.delete('/meetings/:id/attachments/:attachmentId', async (req, res) => {
    const id = paramId(req);
    const attachmentId = paramId(req, 'attachmentId');
    if (!(await getMeeting(db, workspaceId, id))) throw new MeetingError(404, 'Meeting not found.');
    await detachFromMeeting(db, id, attachmentId);
    meetings.announce(id);
    res.json(await detail(id));
  });

  return router;
}

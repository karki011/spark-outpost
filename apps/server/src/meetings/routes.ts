import { Router } from 'express';
import { z } from 'zod';
import {
  MEETING_ATTACHMENTS_MAX,
  MEETING_LINES_PAGE,
  MEETING_LIST_PAGE,
  meetingAttachRequestSchema,
  meetingNotesEditSchema,
  meetingPatchSchema,
  meetingsForEventsRequestSchema,
  startMeetingRequestSchema,
  type MeetingDetail,
  type MeetingLinesPage,
} from '@spark-outpost/contracts';
import { paramId, parseBody, parseQuery } from '../api/validation.ts';
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
  meetingsForEvents,
  patchMeeting,
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

  router.post('/meetings/for-events', async (req, res) => {
    const { eventKeys } = parseBody(meetingsForEventsRequestSchema, req);
    res.json({ meetings: await meetingsForEvents(db, workspaceId, eventKeys) });
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

  router.put('/meetings/:id/notes', async (req, res) => {
    const id = paramId(req);
    const { markdown } = parseBody(meetingNotesEditSchema, req);
    if (!(await getMeeting(db, workspaceId, id))) throw new MeetingError(404, 'Meeting not found.');
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

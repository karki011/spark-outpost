import { z } from 'zod';
import {
  meetingDetailSchema,
  meetingLinesPageSchema,
  meetingListSchema,
  meetingNotesSchema,
  meetingStatusSchema,
  MEETING_LIST_PAGE,
  type MeetingDetail,
  type MeetingLinesPage,
  type MeetingList,
  type MeetingNotes,
  type MeetingPatch,
  type MeetingStatus,
  type StartMeetingRequest,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

const empty = z.null();

function send<T>(schema: z.ZodType<T>, method: string, path: string, body?: unknown): Promise<T> {
  return request(schema, path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function path(id: string, rest = ''): string {
  return `/meetings/${encodeURIComponent(id)}${rest}`;
}

export function listPath(query: string, before: string | undefined): string {
  const params = new URLSearchParams({ limit: String(MEETING_LIST_PAGE) });
  if (query) params.set('q', query);
  if (before) params.set('before', before);
  return `/meetings?${params}`;
}

export const meetingsApi = {
  status: (): Promise<MeetingStatus> => request(meetingStatusSchema, '/meetings/status'),
  list: (query: string, before?: string): Promise<MeetingList> =>
    request(meetingListSchema, listPath(query, before)),
  detail: (id: string): Promise<MeetingDetail> => request(meetingDetailSchema, path(id)),
  start: (body: StartMeetingRequest): Promise<MeetingDetail> =>
    send(meetingDetailSchema, 'POST', '/meetings', body),
  patch: (id: string, patch: MeetingPatch): Promise<MeetingDetail> =>
    send(meetingDetailSchema, 'PATCH', path(id), patch),
  remove: (id: string): Promise<null> => send(empty, 'DELETE', path(id)),
  stop: (id: string): Promise<MeetingDetail> =>
    send(meetingDetailSchema, 'POST', path(id, '/stop')),
  linesAfter: (id: string, after: number, limit?: number): Promise<MeetingLinesPage> => {
    const params = new URLSearchParams({ after: String(after) });
    if (limit) params.set('limit', String(limit));
    return request(meetingLinesPageSchema, path(id, `/lines?${params}`));
  },
  linesTail: (id: string): Promise<MeetingLinesPage> =>
    request(meetingLinesPageSchema, path(id, '/lines?tail=1')),
  saveNotes: (id: string, markdown: string, base: string): Promise<MeetingNotes> =>
    send(meetingNotesSchema, 'PUT', path(id, '/notes'), { markdown, base }),
  writeNotes: (id: string): Promise<null> => send(empty, 'POST', path(id, '/notes/write')),
  attach: (id: string, attachmentId: string): Promise<MeetingDetail> =>
    send(meetingDetailSchema, 'POST', path(id, '/attachments'), { attachmentId }),
  detach: (id: string, attachmentId: string): Promise<MeetingDetail> =>
    send(
      meetingDetailSchema,
      'DELETE',
      path(id, `/attachments/${encodeURIComponent(attachmentId)}`),
    ),
};

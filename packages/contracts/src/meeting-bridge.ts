import { z } from 'zod';
import { MEETING_LINES_APPEND_MAX, newMeetingLineSchema } from './meetings.ts';

export const MEETING_START_TIMEOUT_MS = 15_000;
export const MEETING_STOP_TIMEOUT_MS = 30_000;

export const meetingBridgeToHostSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('meeting:status') }),
  z.object({ kind: z.literal('meeting:start'), meetingId: z.uuid() }),
  z.object({ kind: z.literal('meeting:stop'), meetingId: z.uuid() }),
]);
export type MeetingBridgeToHost = z.infer<typeof meetingBridgeToHostSchema>;

export const meetingBridgeFromHostSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('meeting:state'),
    available: z.boolean(),
    reason: z.string().max(300).nullable(),
  }),
  z.object({ kind: z.literal('meeting:started'), meetingId: z.uuid() }),
  z.object({
    kind: z.literal('meeting:lines'),
    meetingId: z.uuid(),
    lines: z.array(newMeetingLineSchema).max(MEETING_LINES_APPEND_MAX),
  }),
  z.object({
    kind: z.literal('meeting:ended'),
    meetingId: z.uuid(),
    reason: z.enum(['stopped', 'failed']),
    detail: z.string().max(300).nullable(),
  }),
]);
export type MeetingBridgeFromHost = z.infer<typeof meetingBridgeFromHostSchema>;

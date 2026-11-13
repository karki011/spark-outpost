import { z } from 'zod';

export const MEETING_TITLE_MAX = 200;
export const MEETING_GOAL_MAX = 500;
export const MEETING_USER_NOTES_MAX = 16_000;
export const MEETING_NOTES_MAX = 64_000;
export const MEETING_LINE_MAX = 4_000;
export const MEETING_LINES_PAGE = 200;
export const MEETING_LINES_APPEND_MAX = 100;
export const MEETING_LIST_PAGE = 50;
export const MEETING_SNIPPETS = 3;
export const MEETING_ATTACHMENTS_MAX = 10;
export const MEETING_UNTITLED = 'Untitled meeting';

export const meetingSourceSchema = z.enum(['calendar', 'adhoc']);
export type MeetingSource = z.infer<typeof meetingSourceSchema>;

export const meetingStateSchema = z.enum(['recording', 'ended', 'interrupted']);
export type MeetingState = z.infer<typeof meetingStateSchema>;

export const meetingNotesStateSchema = z.enum(['none', 'writing', 'ready', 'failed']);
export type MeetingNotesState = z.infer<typeof meetingNotesStateSchema>;

export const meetingSpeakerSchema = z.enum(['you', 'others']);
export type MeetingSpeaker = z.infer<typeof meetingSpeakerSchema>;

export const MEETING_SPEAKER_LABELS: Record<MeetingSpeaker, string> = {
  you: 'You',
  others: 'Others',
};

export const meetingSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  source: meetingSourceSchema,
  eventKey: z.string().nullable(),
  calendarName: z.string().nullable(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  state: meetingStateSchema,
  goal: z.string(),
  userNotes: z.string(),
  lineCount: z.number().int().min(0),
  notesState: meetingNotesStateSchema,
  notesNote: z.string().nullable(),
});
export type Meeting = z.infer<typeof meetingSchema>;

export const meetingLineSchema = z.object({
  seq: z.number().int().min(1),
  speaker: meetingSpeakerSchema,
  text: z.string(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
});
export type MeetingLine = z.infer<typeof meetingLineSchema>;

export const newMeetingLineSchema = z.object({
  speaker: meetingSpeakerSchema,
  text: z.string().trim().min(1).max(MEETING_LINE_MAX),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
});
export type NewMeetingLine = z.infer<typeof newMeetingLineSchema>;

export const meetingNotesSchema = z.object({
  markdown: z.string(),
  writtenAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable(),
  runId: z.uuid().nullable(),
});
export type MeetingNotes = z.infer<typeof meetingNotesSchema>;

export const meetingAttachmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mediaType: z.string(),
  size: z.number().int().min(0),
});
export type MeetingAttachment = z.infer<typeof meetingAttachmentSchema>;

export const meetingDetailSchema = z.object({
  meeting: meetingSchema,
  notes: meetingNotesSchema.nullable(),
  attachments: z.array(meetingAttachmentSchema),
});
export type MeetingDetail = z.infer<typeof meetingDetailSchema>;

export const meetingJoinNotesSchema = z.object({ detail: meetingDetailSchema.nullable() });
export type MeetingJoinNotes = z.infer<typeof meetingJoinNotesSchema>;

export const meetingStatusSchema = z.object({
  supported: z.boolean(),
  available: z.boolean(),
  reason: z.string().nullable(),
  recordingId: z.uuid().nullable(),
});
export type MeetingStatus = z.infer<typeof meetingStatusSchema>;

export const startMeetingRequestSchema = z.object({
  title: z.string().trim().max(MEETING_TITLE_MAX).optional(),
  eventKey: z.string().min(1).max(600).optional(),
  calendarName: z.string().trim().max(200).optional(),
  goal: z.string().trim().max(MEETING_GOAL_MAX).optional(),
});
export type StartMeetingRequest = z.infer<typeof startMeetingRequestSchema>;

export const meetingPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(MEETING_TITLE_MAX),
    goal: z.string().trim().max(MEETING_GOAL_MAX),
    userNotes: z.string().max(MEETING_USER_NOTES_MAX),
  })
  .partial();
export type MeetingPatch = z.infer<typeof meetingPatchSchema>;

export const meetingNotesEditSchema = z.object({
  markdown: z.string().max(MEETING_NOTES_MAX),
  base: z.iso.datetime().optional(),
});

export function meetingNotesVersion(notes: Pick<MeetingNotes, 'writtenAt' | 'editedAt'>): string {
  return notes.editedAt ?? notes.writtenAt;
}
export type MeetingNotesEdit = z.infer<typeof meetingNotesEditSchema>;

export const meetingAttachRequestSchema = z.object({ attachmentId: z.uuid() });

export const meetingLinesPageSchema = z.object({
  lines: z.array(meetingLineSchema),
  more: z.boolean(),
});
export type MeetingLinesPage = z.infer<typeof meetingLinesPageSchema>;

export const meetingListItemSchema = z.object({
  meeting: meetingSchema,
  snippets: z.array(z.string()),
});
export type MeetingListItem = z.infer<typeof meetingListItemSchema>;

export const meetingListSchema = z.object({
  items: z.array(meetingListItemSchema),
  nextBefore: z.iso.datetime().nullable(),
});
export type MeetingList = z.infer<typeof meetingListSchema>;

export function meetingDurationMs(meeting: Pick<Meeting, 'startedAt' | 'endedAt'>, now: number) {
  const end = meeting.endedAt ? Date.parse(meeting.endedAt) : now;
  return Math.max(0, end - Date.parse(meeting.startedAt));
}

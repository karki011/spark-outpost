import { z } from 'zod';
import { CALENDAR_GROUP_MAX } from './calendar-api.ts';
import { calendarEventSchema } from './calendar.ts';

const KEY_MAX = 600;

export const meetingCountdownSchema = z.object({
  eventKey: z.string().max(KEY_MAX),
  deadline: z.number().finite(),
});
export type MeetingCountdown = z.infer<typeof meetingCountdownSchema>;

export const meetingAlertPayloadSchema = z.object({
  key: z.string().max(KEY_MAX * CALENDAR_GROUP_MAX),
  events: z.array(calendarEventSchema).min(1).max(CALENDAR_GROUP_MAX),
  calendars: z.record(z.string().max(KEY_MAX), z.string().max(300)),
  countdown: meetingCountdownSchema.nullable(),
  joinLeadMs: z.number().finite().min(0),
  notice: z.object({ title: z.string().max(400), body: z.string().max(400) }),
});
export type MeetingAlertPayload = z.infer<typeof meetingAlertPayloadSchema>;

export const MEETING_ALERT_ACTIONS = [
  'joined',
  'snooze',
  'dismiss',
  'cancel-join',
  'join-now',
  'join',
  'join-at-start',
  'cancel-join-at-start',
] as const;
export const meetingAlertActionSchema = z.object({
  kind: z.enum(MEETING_ALERT_ACTIONS),
  key: z.string().max(KEY_MAX * CALENDAR_GROUP_MAX),
  eventKey: z.string().max(KEY_MAX).nullable(),
});
export type MeetingAlertAction = z.infer<typeof meetingAlertActionSchema>;

export const meetingAlertPlaceSchema = z.object({
  anchorX: z.number().finite(),
  top: z.number().finite().min(0),
  width: z.number().finite(),
  height: z.number().finite(),
});
export type MeetingAlertPlace = z.infer<typeof meetingAlertPlaceSchema>;

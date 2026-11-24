import { z } from 'zod';
import { CALENDAR_GUESTS_MAX, calendarReplySchema, type CalendarReply } from './calendar-api.ts';
import { calendarEditSpanSchema, calendarEventFieldsSchema } from './calendar-helper.ts';

const instant = z.iso.datetime({ offset: true });

export const CALENDAR_CARD_NOTES_MAX = 2_000;

export const calendarReadActionSchema = z.object({
  action: z.literal('calendar_read'),
  what: z.string().max(300),
});
export type CalendarReadAction = z.infer<typeof calendarReadActionSchema>;

export const calendarEventFactsSchema = z.object({
  title: z.string().max(1_000),
  start: instant,
  end: instant,
  allDay: z.boolean(),
  location: z.string().max(2_000).nullable(),
  notes: z.string().max(CALENDAR_CARD_NOTES_MAX).nullable(),
  alarmMinutes: z.number().int().min(0).nullable(),
  others: z.number().int().min(0),
  recurring: z.boolean(),
});
export type CalendarEventFacts = z.infer<typeof calendarEventFactsSchema>;

export const calendarEditOpSchema = z.enum(['create', 'update', 'delete', 'reply']);
export type CalendarEditOp = z.infer<typeof calendarEditOpSchema>;

export const calendarFloorReasonSchema = z.enum(['delete', 'others', 'shared', 'invites', 'reply']);
export type CalendarFloorReason = z.infer<typeof calendarFloorReasonSchema>;

export const calendarEditActionSchema = z.object({
  action: z.literal('calendar_edit'),
  op: calendarEditOpSchema,
  calendar: z.object({
    key: z.uuid(),
    title: z.string().max(300),
    account: z.string().max(300),
    synced: z.boolean(),
  }),
  eventId: z.string().max(500).nullable(),
  occurrence: instant.nullable(),
  span: calendarEditSpanSchema,
  fields: calendarEventFieldsSchema,
  before: calendarEventFactsSchema.nullable(),
  after: calendarEventFactsSchema.nullable(),
  floor: z.array(calendarFloorReasonSchema).max(5),
  meet: z.boolean().default(false),
  guests: z.array(z.email().max(300)).max(CALENDAR_GUESTS_MAX).default([]),
  reply: calendarReplySchema.nullable().default(null),
});
export type CalendarEditAction = z.infer<typeof calendarEditActionSchema>;

export type CalendarAction = CalendarReadAction | CalendarEditAction;

export function isCalendarAction(action: string): action is CalendarAction['action'] {
  return action === 'calendar_read' || action === 'calendar_edit';
}

const EDIT_QUESTIONS: Record<CalendarEditOp, string> = {
  create: 'Add this event?',
  update: 'Change this event?',
  delete: 'Delete this event?',
  reply: 'Answer this invitation?',
};

const EDIT_CONFIRMS: Record<CalendarEditOp, string> = {
  create: 'Add event',
  update: 'Save change',
  delete: 'Delete event',
  reply: 'Send reply',
};

export const CALENDAR_REPLY_WORDS: Record<CalendarReply, string> = {
  accepted: 'Yes',
  tentative: 'Maybe',
  declined: 'No',
};

export function calendarEditQuestion(action: CalendarEditAction): string {
  return EDIT_QUESTIONS[action.op];
}

export function calendarEditConfirm(action: CalendarEditAction): string {
  if (action.op === 'create' && action.guests.length > 0) return 'Add and invite';
  return EDIT_CONFIRMS[action.op];
}

export function calendarAuditFacts(action: CalendarAction): Record<string, unknown> {
  if (action.action === 'calendar_read') return { action: action.action, what: action.what };
  return {
    action: action.action,
    op: action.op,
    calendarKey: action.calendar.key,
    synced: action.calendar.synced,
    eventId: action.eventId,
    occurrence: action.occurrence,
    span: action.span,
    changed: Object.keys(action.fields).toSorted(),
    floor: action.floor,
    meet: action.meet,
    guests: action.guests.length,
    reply: action.reply,
  };
}

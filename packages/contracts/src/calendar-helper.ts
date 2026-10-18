import { z } from 'zod';

export const CALENDAR_HELPER_NAME = 'spark-calendar';
export const CALENDAR_HELPER_SILENT_MS = 30_000;
export const CALENDAR_EVENTS_MAX = 2_000;
export const CALENDAR_NOTE_LINKS_MAX = 20;
export const CALENDAR_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars';

const id = z.string().min(1).max(100);
const text = (max: number) => z.string().max(max);
const instant = z.iso.datetime({ offset: true });

export const calendarAuthorizationSchema = z.enum([
  'notDetermined',
  'denied',
  'restricted',
  'fullAccess',
  'writeOnly',
]);
export type CalendarAuthorization = z.infer<typeof calendarAuthorizationSchema>;

export const calendarOwnershipSchema = z.enum(['mine', 'shared', 'unknown']);
export type CalendarOwnership = z.infer<typeof calendarOwnershipSchema>;

export const calendarSourceKindSchema = z.enum([
  'local',
  'exchange',
  'caldav',
  'mobileme',
  'subscribed',
  'birthdays',
  'google',
  'other',
]);
export type CalendarSourceKind = z.infer<typeof calendarSourceKindSchema>;

export const helperCalendarSchema = z.object({
  id: text(300).min(1),
  title: text(300),
  sourceId: text(300),
  sourceTitle: text(300),
  sourceKind: calendarSourceKindSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  subscribed: z.boolean(),
  writable: z.boolean(),
  ownership: calendarOwnershipSchema,
});
export type HelperCalendar = z.infer<typeof helperCalendarSchema>;

export const calendarMyStatusSchema = z.enum([
  'accepted',
  'declined',
  'tentative',
  'pending',
  'none',
]);
export type CalendarMyStatus = z.infer<typeof calendarMyStatusSchema>;

export const calendarAvailabilitySchema = z.enum([
  'busy',
  'free',
  'tentative',
  'unavailable',
  'notSupported',
]);
export type CalendarAvailability = z.infer<typeof calendarAvailabilitySchema>;

export const helperEventSchema = z.object({
  id: text(500).min(1),
  uid: text(500).nullable(),
  start: instant,
  end: instant,
  allDay: z.boolean(),
  title: text(1_000),
  calendarId: text(300).min(1),
  url: text(2_000).nullable(),
  location: text(2_000).nullable(),
  noteLinks: z.array(text(2_000)).max(CALENDAR_NOTE_LINKS_MAX),
  hasNotes: z.boolean(),
  attendeeCount: z.number().int().min(0).max(10_000),
  othersInvited: z.boolean(),
  myStatus: calendarMyStatusSchema,
  availability: calendarAvailabilitySchema,
  recurring: z.boolean(),
});
export type HelperEvent = z.infer<typeof helperEventSchema>;

export const helperAttendeeSchema = z.object({
  name: text(300),
  isMe: z.boolean(),
  status: calendarMyStatusSchema,
});

export const helperEventDetailSchema = z.object({
  event: helperEventSchema,
  notes: text(20_000),
  attendees: z.array(helperAttendeeSchema).max(500),
  organizerIsMe: z.boolean(),
  alarms: z.array(z.number().int().min(0)).max(20).optional(),
});
export type HelperEventDetail = z.infer<typeof helperEventDetailSchema>;

const occurrence = { eventId: text(500).min(1), start: instant };

export const CALENDAR_ALARM_MAX_MINUTES = 40_320;

export const calendarEditSpanSchema = z.enum(['this', 'future']);
export type CalendarEditSpan = z.infer<typeof calendarEditSpanSchema>;

export const calendarEventFieldsSchema = z
  .object({
    title: text(1_000).optional(),
    start: instant.optional(),
    end: instant.optional(),
    allDay: z.boolean().optional(),
    notes: text(20_000).optional(),
    location: text(2_000).optional(),
    alarmMinutes: z.number().int().min(0).max(CALENDAR_ALARM_MAX_MINUTES).nullable().optional(),
  })
  .strict();
export type CalendarEventFields = z.infer<typeof calendarEventFieldsSchema>;

export const calendarSaveFields = {
  calendarId: text(300).min(1),
  eventId: text(500).min(1).optional(),
  occurrence: instant.optional(),
  fields: calendarEventFieldsSchema,
  span: calendarEditSpanSchema.optional(),
};

export const calendarRemoveFields = { ...occurrence, span: calendarEditSpanSchema.optional() };

export const calendarSavedSchema = z.object({
  before: helperEventDetailSchema.nullable(),
  after: helperEventDetailSchema,
});
export type CalendarSaved = z.infer<typeof calendarSavedSchema>;

export const calendarHelperRequestSchema = z.discriminatedUnion('op', [
  z.object({ id, op: z.literal('status') }),
  z.object({ id, op: z.literal('request') }),
  z.object({ id, op: z.literal('calendars') }),
  z.object({
    id,
    op: z.literal('events'),
    from: instant,
    to: instant,
    calendarIds: z.array(text(300)).max(500).optional(),
  }),
  z.object({ id, op: z.literal('event'), ...occurrence }),
  z.object({ id, op: z.literal('open'), ...occurrence }),
  z.object({ id, op: z.literal('save'), ...calendarSaveFields }),
  z.object({ id, op: z.literal('remove'), ...calendarRemoveFields }),
]);
export type CalendarHelperRequest = z.infer<typeof calendarHelperRequestSchema>;
export type CalendarHelperOp = CalendarHelperRequest['op'];

const authorized = z.object({ authorization: calendarAuthorizationSchema });

export const calendarHelperResultSchemas = {
  status: authorized,
  request: authorized,
  calendars: z.object({ calendars: z.array(helperCalendarSchema).max(500) }),
  events: z.object({
    events: z.array(helperEventSchema).max(CALENDAR_EVENTS_MAX),
    truncated: z.boolean(),
  }),
  event: helperEventDetailSchema,
  open: z.object({ opened: z.boolean() }),
  save: calendarSavedSchema,
  remove: z.object({ removed: z.literal(true) }),
} satisfies Record<CalendarHelperOp, z.ZodType>;

export const calendarHelperErrorCodeSchema = z.enum([
  'invalid',
  'not_authorized',
  'not_found',
  'failed',
]);
export type CalendarHelperErrorCode = z.infer<typeof calendarHelperErrorCodeSchema>;

export const calendarHelperLineSchema = z.union([
  z.object({ id, ok: z.literal(true), result: z.unknown() }),
  z.object({
    id: id.nullable(),
    ok: z.literal(false),
    code: calendarHelperErrorCodeSchema,
    message: text(500),
  }),
  z.object({ event: z.literal('changed') }),
]);
export type CalendarHelperLine = z.infer<typeof calendarHelperLineSchema>;

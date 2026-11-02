import { z } from 'zod';
import {
  CALENDAR_EVENTS_MAX,
  calendarAuthorizationSchema,
  helperCalendarSchema,
  helperEventDetailSchema,
  calendarRemoveFields,
  calendarSaveFields,
  calendarSavedSchema,
  helperEventSchema,
} from './calendar-helper.ts';

export const CALENDAR_REQUEST_TIMEOUT_MS = 10 * 60_000;

const occurrence = {
  eventId: z.string().min(1).max(500),
  start: z.iso.datetime({ offset: true }),
};

export const calendarHostRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('status') }),
  z.object({ op: z.literal('request') }),
  z.object({ op: z.literal('calendars') }),
  z.object({ op: z.literal('window') }),
  z.object({ op: z.literal('refresh') }),
  z.object({
    op: z.literal('range'),
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  }),
  z.object({ op: z.literal('event'), ...occurrence }),
  z.object({ op: z.literal('open'), ...occurrence }),
  z.object({ op: z.literal('save'), ...calendarSaveFields }),
  z.object({ op: z.literal('remove'), ...calendarRemoveFields }),
  z.object({ op: z.literal('open_settings') }),
  z.object({ op: z.literal('stop') }),
]);
export type CalendarHostRequest = z.infer<typeof calendarHostRequestSchema>;
export type CalendarHostOp = CalendarHostRequest['op'];

export const calendarHelperStateSchema = z.enum(['ready', 'missing', 'failed']);
export type CalendarHelperState = z.infer<typeof calendarHelperStateSchema>;

export const calendarHostResultSchemas = {
  status: z.object({
    helper: calendarHelperStateSchema,
    authorization: calendarAuthorizationSchema.nullable(),
  }),
  request: z.object({ authorization: calendarAuthorizationSchema }),
  calendars: z.object({ calendars: z.array(helperCalendarSchema).max(500) }),
  window: z.object({
    events: z.array(helperEventSchema).max(CALENDAR_EVENTS_MAX),
    truncated: z.boolean(),
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  }),
  range: z.object({
    events: z.array(helperEventSchema).max(CALENDAR_EVENTS_MAX),
    truncated: z.boolean(),
  }),
  event: helperEventDetailSchema,
  open: z.object({ opened: z.boolean() }),
  save: calendarSavedSchema,
  remove: z.object({ removed: z.literal(true) }),
  open_settings: z.object({ opened: z.boolean() }),
  stop: z.object({ stopped: z.boolean() }),
  refresh: z.object({ refreshed: z.boolean() }),
} satisfies Record<CalendarHostOp, z.ZodType>;

export const calendarHostErrorCodeSchema = z.enum([
  'invalid',
  'not_authorized',
  'not_found',
  'missing',
  'cancelled',
  'failed',
]);
export type CalendarHostErrorCode = z.infer<typeof calendarHostErrorCodeSchema>;

export const calendarBridgeToHostSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('calendar:request'),
    id: z.string().min(1).max(64),
    request: calendarHostRequestSchema,
  }),
  z.object({ kind: z.literal('calendar:cancel'), id: z.string().min(1).max(64) }),
]);
export type CalendarBridgeToHost = z.infer<typeof calendarBridgeToHostSchema>;

export const calendarBridgeFromHostSchema = z.union([
  z.object({
    kind: z.literal('calendar:response'),
    id: z.string(),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    kind: z.literal('calendar:response'),
    id: z.string(),
    ok: z.literal(false),
    code: calendarHostErrorCodeSchema,
    message: z.string().max(500),
  }),
  z.object({ kind: z.literal('calendar:changed') }),
]);
export type CalendarBridgeFromHost = z.infer<typeof calendarBridgeFromHostSchema>;

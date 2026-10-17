import { z } from 'zod';
import { calendarChoiceSchema, calendarEventSchema, dayShapeSchema } from './calendar.ts';
import { calendarHelperStateSchema } from './calendar-bridge.ts';
import { calendarAuthorizationSchema, calendarSourceKindSchema } from './calendar-helper.ts';
import { calendarGoogleStatusSchema } from './calendar-google.ts';

export const CALENDAR_BEFORE_MINUTES = [5, 10, 15] as const;
export const CALENDAR_WRAP_UP_MINUTES = [0, 15, 30] as const;
export const CALENDAR_REMIND_MINUTES = 5;
export const CALENDAR_CAPTURE_WINDOW_MS = 15 * 60_000;
export const CALENDAR_UPCOMING_COUNT = 3;

export const calendarHoldRuleSchema = z.enum(['never', 'focus', 'meetings']);
export type CalendarHoldRule = z.infer<typeof calendarHoldRuleSchema>;

const focusName = z.string().trim().min(1).max(60);

export const calendarSettingsSchema = z.object({
  beforeMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  wrapUpMinutes: z.union([z.literal(0), z.literal(15), z.literal(30)]),
  capture: z.boolean(),
  holdRule: calendarHoldRuleSchema,
  focusNames: z.array(focusName).min(1).max(12),
  phoneAlerts: z.boolean(),
  briefBlock: z.boolean(),
  agentsRead: z.boolean(),
});
export type CalendarSettings = z.infer<typeof calendarSettingsSchema>;

export const calendarSettingsPatchSchema = calendarSettingsSchema
  .omit({ agentsRead: true })
  .partial()
  .strict();
export type CalendarSettingsPatch = z.infer<typeof calendarSettingsPatchSchema>;

export const CALENDAR_DEFAULT_SETTINGS: CalendarSettings = {
  beforeMinutes: 10,
  wrapUpMinutes: 15,
  capture: true,
  holdRule: 'focus',
  focusNames: ['Focus', 'Deep work', 'Heads down'],
  phoneAlerts: false,
  briefBlock: true,
  agentsRead: false,
};

export const calendarAccountSchema = z.object({
  id: z.string().max(300),
  title: z.string().max(300),
  kind: calendarSourceKindSchema,
  calendars: z.array(calendarChoiceSchema),
});
export type CalendarAccount = z.infer<typeof calendarAccountSchema>;

export const calendarStatusSchema = z.object({
  supported: z.boolean(),
  helper: calendarHelperStateSchema.nullable(),
  authorization: calendarAuthorizationSchema.nullable(),
  connected: z.boolean(),
  accounts: z.array(calendarAccountSchema),
  notice: z.string().max(500).nullable(),
  settings: calendarSettingsSchema,
  google: calendarGoogleStatusSchema,
});
export type CalendarStatus = z.infer<typeof calendarStatusSchema>;

export const calendarChoicePatchSchema = z
  .object({ include: z.boolean(), nudges: z.boolean(), busy: z.boolean() })
  .partial()
  .strict();
export type CalendarChoicePatch = z.infer<typeof calendarChoicePatchSchema>;

export const calendarSpanSchema = z.object({ start: z.number(), end: z.number() });

export const calendarWeekDaySchema = z.object({
  date: z.iso.date(),
  meetings: z.number().int().min(0),
  focus: z.number().int().min(0),
});
export type CalendarWeekDay = z.infer<typeof calendarWeekDaySchema>;

export const calendarDaySchema = z.object({
  date: z.iso.date(),
  today: z.iso.date(),
  events: z.array(calendarEventSchema),
  free: z.array(calendarSpanSchema),
  shape: dayShapeSchema,
  week: z.array(calendarWeekDaySchema),
  calendars: z.array(calendarChoiceSchema),
  truncated: z.boolean(),
});
export type CalendarDay = z.infer<typeof calendarDaySchema>;

const nudgeBase = {
  eventKey: z.string().max(600),
  title: z.string().max(1_000),
  startsAt: z.iso.datetime({ offset: true }),
};

export const calendarNudgeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('before'), ...nudgeBase, minutes: z.number().int() }),
  z.object({ kind: z.literal('remind'), ...nudgeBase, minutes: z.number().int() }),
  z.object({
    kind: z.literal('wrap_up'),
    ...nudgeBase,
    minutes: z.number().int(),
    chats: z.array(
      z.object({
        id: z.uuid(),
        title: z.string().max(300),
        reason: z.enum(['running', 'needs_you']),
      }),
    ),
  }),
]);
export type CalendarNudge = z.infer<typeof calendarNudgeSchema>;

export const calendarHoldSchema = z.object({
  eventKey: z.string().max(600),
  title: z.string().max(1_000),
  until: z.iso.datetime({ offset: true }),
  focus: z.boolean(),
});
export type CalendarHold = z.infer<typeof calendarHoldSchema>;

export const calendarCaptureSchema = z.object({
  eventKey: z.string().max(600),
  eventId: z.string().max(500),
  start: z.iso.datetime({ offset: true }),
  title: z.string().max(1_000),
});
export type CalendarCapture = z.infer<typeof calendarCaptureSchema>;

export const calendarNowSchema = z.object({
  active: z.boolean(),
  upcoming: z.array(calendarEventSchema),
  nudge: calendarNudgeSchema.nullable(),
  hold: calendarHoldSchema.nullable(),
  capture: calendarCaptureSchema.nullable(),
  calendars: z.array(calendarChoiceSchema),
});
export type CalendarNow = z.infer<typeof calendarNowSchema>;

export const calendarMarkKindSchema = z.enum(['remind_5', 'hold']);
export type CalendarMarkKind = z.infer<typeof calendarMarkKindSchema>;

export const calendarMarkRequestSchema = z
  .object({
    eventKey: z.string().min(1).max(600),
    end: z.iso.datetime({ offset: true }),
    kind: calendarMarkKindSchema,
    on: z.boolean(),
  })
  .strict();
export type CalendarMarkRequest = z.infer<typeof calendarMarkRequestSchema>;

export const calendarOccurrenceSchema = z
  .object({ eventId: z.string().min(1).max(500), start: z.iso.datetime({ offset: true }) })
  .strict();
export type CalendarOccurrence = z.infer<typeof calendarOccurrenceSchema>;

export const calendarEventDetailSchema = z.object({
  title: z.string().max(1_000),
  notes: z.string().max(20_000),
  link: z.url().nullable(),
});
export type CalendarEventDetail = z.infer<typeof calendarEventDetailSchema>;

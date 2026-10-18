import { z } from 'zod';
import {
  calendarDaySchema,
  calendarEventDetailSchema,
  calendarNowSchema,
  calendarRangeSchema,
  calendarSettingsSchema,
  calendarStatusSchema,
  googleSignInFlowSchema,
  type CalendarChoicePatch,
  type CalendarDay,
  type CalendarEventDetail,
  type CalendarMarkRequest,
  type CalendarNow,
  type CalendarOccurrence,
  type CalendarRange,
  type CalendarSettings,
  type CalendarSettingsPatch,
  type CalendarStatus,
  type GoogleSignInFlow,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const calendarKeys = {
  all: ['calendar'] as const,
  status: ['calendar', 'status'] as const,
  now: ['calendar', 'now'] as const,
  day: (date: string) => ['calendar', 'day', date] as const,
  range: (from: string, to: string) => ['calendar', 'range', from, to] as const,
  detail: (occurrence: CalendarOccurrence) =>
    ['calendar', 'detail', occurrence.eventId, occurrence.start] as const,
  googleSignIn: ['calendar', 'google-sign-in'] as const,
};

const disconnected = z.object({ status: calendarStatusSchema, message: z.string().nullable() });

const opened = z.object({ opened: z.boolean() });
const ok = z.object({ ok: z.literal(true) });

function post<T>(schema: z.ZodType<T>, path: string, body: unknown = {}): Promise<T> {
  return request(schema, path, { method: 'POST', body: JSON.stringify(body) });
}

export interface GoogleSignInStart {
  accountId: string | null;
  editCalendar: string | null;
}

export const calendarApi = {
  status: (): Promise<CalendarStatus> => request(calendarStatusSchema, '/calendar/status'),
  connect: (): Promise<CalendarStatus> => post(calendarStatusSchema, '/calendar/connect'),
  disconnect: (): Promise<CalendarStatus> => post(calendarStatusSchema, '/calendar/disconnect'),
  openSettings: (): Promise<{ opened: boolean }> => post(opened, '/calendar/open-settings'),
  choose: (key: string, patch: CalendarChoicePatch): Promise<CalendarStatus> =>
    request(calendarStatusSchema, `/calendar/calendars/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  saveSettings: (patch: CalendarSettingsPatch): Promise<CalendarSettings> =>
    request(calendarSettingsSchema, '/calendar/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  day: (date: string): Promise<CalendarDay> =>
    request(calendarDaySchema, `/calendar/day?${new URLSearchParams({ date }).toString()}`),
  range: (from: string, to: string): Promise<CalendarRange> =>
    request(calendarRangeSchema, `/calendar/range?${new URLSearchParams({ from, to }).toString()}`),
  now: (): Promise<CalendarNow> => request(calendarNowSchema, '/calendar/now'),
  mark: (mark: CalendarMarkRequest): Promise<{ ok: true }> =>
    request(ok, '/calendar/marks', { method: 'PUT', body: JSON.stringify(mark) }),
  open: (occurrence: CalendarOccurrence): Promise<{ opened: boolean }> =>
    post(opened, '/calendar/open', occurrence),
  detail: (occurrence: CalendarOccurrence): Promise<CalendarEventDetail> =>
    post(calendarEventDetailSchema, '/calendar/event', occurrence),
  googleSignIn: (): Promise<GoogleSignInFlow> =>
    request(googleSignInFlowSchema, '/calendar/google/sign-in'),
  startGoogleSignIn: (request: GoogleSignInStart): Promise<GoogleSignInFlow> =>
    post(googleSignInFlowSchema, '/calendar/google/sign-in', {
      ...(request.accountId ? { accountId: request.accountId } : {}),
      ...(request.editCalendar ? { editCalendar: request.editCalendar } : {}),
    }),
  cancelGoogleSignIn: (): Promise<GoogleSignInFlow> =>
    request(googleSignInFlowSchema, '/calendar/google/sign-in', { method: 'DELETE' }),
  disconnectGoogle: (accountId: string): Promise<z.infer<typeof disconnected>> =>
    request(disconnected, `/calendar/google/accounts/${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
    }),
};

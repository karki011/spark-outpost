import { z } from 'zod';
import {
  calendarDaySchema,
  calendarEventDetailSchema,
  calendarNowSchema,
  calendarRangeSchema,
  calendarRefreshSchema,
  calendarSettingsSchema,
  calendarStatusSchema,
  googleSignInFlowSchema,
  type CalendarChoicePatch,
  type CalendarCreateRequest,
  type CalendarDay,
  type CalendarEventDetail,
  type CalendarMarkRequest,
  type CalendarNow,
  type CalendarOccurrence,
  type CalendarRange,
  type CalendarRefresh,
  type CalendarReplyRequest,
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
  signIn: (provider: CloudProvider) => ['calendar', `${provider}-sign-in`] as const,
};

export type CloudProvider = 'google' | 'microsoft';

const disconnected = z.object({ status: calendarStatusSchema, message: z.string().nullable() });

const opened = z.object({ opened: z.boolean() });
const ok = z.object({ ok: z.literal(true) });

function post<T>(schema: z.ZodType<T>, path: string, body: unknown = {}): Promise<T> {
  return request(schema, path, { method: 'POST', body: JSON.stringify(body) });
}

export interface CloudSignInStart {
  accountId: string | null;
  editCalendar: string | null;
  replies?: boolean;
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
  refresh: (): Promise<CalendarRefresh> => post(calendarRefreshSchema, '/calendar/refresh'),
  mark: (mark: CalendarMarkRequest): Promise<{ ok: true }> =>
    request(ok, '/calendar/marks', { method: 'PUT', body: JSON.stringify(mark) }),
  open: (occurrence: CalendarOccurrence): Promise<{ opened: boolean }> =>
    post(opened, '/calendar/open', occurrence),
  createEvent: (event: CalendarCreateRequest): Promise<{ ok: true }> =>
    post(ok, '/calendar/events', event),
  reply: (reply: CalendarReplyRequest): Promise<{ ok: true }> => post(ok, '/calendar/reply', reply),
  detail: (occurrence: CalendarOccurrence): Promise<CalendarEventDetail> =>
    post(calendarEventDetailSchema, '/calendar/event', occurrence),
  signIn: (provider: CloudProvider): Promise<GoogleSignInFlow> =>
    request(googleSignInFlowSchema, `/calendar/${provider}/sign-in`),
  startSignIn: (provider: CloudProvider, request: CloudSignInStart): Promise<GoogleSignInFlow> =>
    post(googleSignInFlowSchema, `/calendar/${provider}/sign-in`, {
      ...(request.accountId ? { accountId: request.accountId } : {}),
      ...(request.editCalendar ? { editCalendar: request.editCalendar } : {}),
      ...(request.replies ? { replies: true } : {}),
    }),
  cancelSignIn: (provider: CloudProvider): Promise<GoogleSignInFlow> =>
    request(googleSignInFlowSchema, `/calendar/${provider}/sign-in`, { method: 'DELETE' }),
  disconnectAccount: (
    provider: CloudProvider,
    accountId: string,
  ): Promise<z.infer<typeof disconnected>> =>
    request(disconnected, `/calendar/${provider}/accounts/${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
    }),
};

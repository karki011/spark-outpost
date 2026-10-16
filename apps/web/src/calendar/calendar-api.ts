import { z } from 'zod';
import {
  calendarDaySchema,
  calendarEventDetailSchema,
  calendarNowSchema,
  calendarSettingsSchema,
  calendarStatusSchema,
  type CalendarChoicePatch,
  type CalendarDay,
  type CalendarEventDetail,
  type CalendarMarkRequest,
  type CalendarNow,
  type CalendarOccurrence,
  type CalendarSettings,
  type CalendarSettingsPatch,
  type CalendarStatus,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const calendarKeys = {
  all: ['calendar'] as const,
  status: ['calendar', 'status'] as const,
  now: ['calendar', 'now'] as const,
  day: (date: string) => ['calendar', 'day', date] as const,
};

const opened = z.object({ opened: z.boolean() });
const ok = z.object({ ok: z.literal(true) });

function post<T>(schema: z.ZodType<T>, path: string, body: unknown = {}): Promise<T> {
  return request(schema, path, { method: 'POST', body: JSON.stringify(body) });
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
  now: (): Promise<CalendarNow> => request(calendarNowSchema, '/calendar/now'),
  mark: (mark: CalendarMarkRequest): Promise<{ ok: true }> =>
    request(ok, '/calendar/marks', { method: 'PUT', body: JSON.stringify(mark) }),
  open: (occurrence: CalendarOccurrence): Promise<{ opened: boolean }> =>
    post(opened, '/calendar/open', occurrence),
  detail: (occurrence: CalendarOccurrence): Promise<CalendarEventDetail> =>
    post(calendarEventDetailSchema, '/calendar/event', occurrence),
};

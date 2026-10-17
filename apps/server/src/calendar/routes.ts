import { Router, type Response } from 'express';
import {
  calendarChoicePatchSchema,
  calendarMarkRequestSchema,
  calendarOccurrenceSchema,
  calendarSettingsPatchSchema,
  isGoogleEventId,
  localDayStart,
} from '@spark-outpost/contracts';
import { BadRequestError, paramId, parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import { googleCalendarRoutes } from './google/routes.ts';
import type { GoogleSource } from './google/source.ts';
import { CalendarHostError, type CalendarHost } from './host-client.ts';
import {
  calendarDay,
  calendarNow,
  calendarState,
  calendarStatus,
  dayFromKey,
  eventDetail,
  plannerChats,
  syncCalendars,
} from './service.ts';
import { forgetMarks, setConnected, setMark, updateChoice, updateSettings } from './store.ts';

export interface CalendarRouteDeps {
  db: Db;
  workspaceId: string;
  calendarHost?: CalendarHost | null;
  googleCalendar?: GoogleSource | null;
  now?: () => number;
}

const HOST_STATUS: Record<CalendarHostError['code'], number> = {
  invalid: 400,
  not_authorized: 403,
  not_found: 404,
  missing: 503,
  cancelled: 503,
  failed: 502,
  timeout: 504,
};

async function guarded(res: Response, work: () => Promise<unknown>): Promise<void> {
  try {
    res.json(await work());
  } catch (error) {
    if (!(error instanceof CalendarHostError)) throw error;
    res.status(HOST_STATUS[error.code]).json({ error: error.message });
  }
}

export async function announceCalendar(db: Db): Promise<void> {
  await db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'calendar', conversationId: null, runId: null }),
  ]);
}

export function calendarRoutes(deps: CalendarRouteDeps): Router {
  const router = Router();
  const host = deps.calendarHost ?? null;
  const now = () => deps.now?.() ?? Date.now();
  const google = deps.googleCalendar ?? null;
  const service = { db: deps.db, workspaceId: deps.workspaceId, host, google, now };
  google?.onChanged(() => void announceCalendar(deps.db).catch(() => undefined));
  const needHost = (): CalendarHost => {
    if (!host) throw new CalendarHostError('missing', 'Calendar is only in the Mac app.');
    return host;
  };

  router.get('/calendar/status', (_req, res) => guarded(res, () => calendarStatus(service)));

  router.post('/calendar/connect', (_req, res) =>
    guarded(res, async () => {
      const { authorization } = await needHost().request({ op: 'request' });
      if (authorization === 'fullAccess') {
        await setConnected(deps.db, deps.workspaceId, true);
        await syncCalendars(service);
        await announceCalendar(deps.db);
      }
      return calendarStatus(service);
    }),
  );

  router.post('/calendar/disconnect', (_req, res) =>
    guarded(res, async () => {
      await setConnected(deps.db, deps.workspaceId, false);
      await forgetMarks(deps.db, deps.workspaceId);
      if (host) await host.request({ op: 'stop' });
      await announceCalendar(deps.db);
      return calendarStatus(service);
    }),
  );

  router.post('/calendar/open-settings', (_req, res) =>
    guarded(res, () => needHost().request({ op: 'open_settings' })),
  );

  router.patch('/calendar/calendars/:key', (req, res) =>
    guarded(res, async () => {
      const patch = parseBody(calendarChoicePatchSchema, req);
      const changed = await updateChoice(deps.db, deps.workspaceId, paramId(req, 'key'), patch);
      if (!changed) throw new BadRequestError('That calendar is not known.');
      if (patch.include !== undefined) google?.refresh();
      await announceCalendar(deps.db);
      return calendarStatus(service);
    }),
  );

  router.patch('/calendar/settings', async (req, res) => {
    const patch = parseBody(calendarSettingsPatchSchema, req);
    const settings = await updateSettings(deps.db, deps.workspaceId, patch);
    await announceCalendar(deps.db);
    res.json(settings);
  });

  router.get('/calendar/day', (req, res) =>
    guarded(res, async () => {
      const raw = typeof req.query.date === 'string' ? req.query.date : null;
      const day = raw === null ? localDayStart(now()) : dayFromKey(raw);
      if (day === null) throw new BadRequestError('The date must be YYYY-MM-DD.');
      return calendarDay(await calendarState(service), day, now());
    }),
  );

  router.get('/calendar/now', (_req, res) =>
    guarded(res, async () => {
      const state = await calendarState(service);
      return calendarNow(state, await plannerChats(deps.db, deps.workspaceId), now());
    }),
  );

  router.put('/calendar/marks', async (req, res) => {
    const mark = parseBody(calendarMarkRequestSchema, req);
    if (!(await setMark(deps.db, deps.workspaceId, mark))) {
      throw new BadRequestError('That event is not known.');
    }
    await announceCalendar(deps.db);
    res.json({ ok: true });
  });

  router.post('/calendar/open', (req, res) =>
    guarded(res, async () => {
      const occurrence = parseBody(calendarOccurrenceSchema, req);
      if (isGoogleEventId(occurrence.eventId)) return { opened: false };
      return needHost().request({ op: 'open', ...occurrence });
    }),
  );

  router.post('/calendar/event', (req, res) =>
    guarded(res, async () => {
      const occurrence = parseBody(calendarOccurrenceSchema, req);
      if (!isGoogleEventId(occurrence.eventId)) return eventDetail(needHost(), occurrence);
      const detail = google?.detail(occurrence);
      if (!detail) throw new CalendarHostError('not_found', 'That event is gone.');
      return detail;
    }),
  );

  router.use(googleCalendarRoutes({ google, status: () => calendarStatus(service) }));

  return router;
}

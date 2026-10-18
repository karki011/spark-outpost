import { Router, type Response } from 'express';
import {
  CALENDAR_RANGE_MAX_DAYS,
  GOOGLE_EDIT_NEEDS_GRANT,
  addLocalDays,
  calendarChoicePatchSchema,
  calendarMarkRequestSchema,
  calendarOccurrenceSchema,
  calendarSettingsPatchSchema,
  type CalendarOccurrence,
  isGoogleEventId,
  localDayStart,
} from '@spark-outpost/contracts';
import { BadRequestError, paramId, parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import { googleCalendarRoutes } from './google/routes.ts';
import { GoogleApiError } from './google/api.ts';
import { GoogleAuthError } from './google/oauth.ts';
import { googleEditBlocked } from './google/store.ts';
import { GoogleSignInNeeded, type GoogleSource } from './google/source.ts';
import { CalendarHostError, type CalendarHost } from './host-client.ts';
import {
  calendarDay,
  calendarNow,
  calendarRange,
  calendarState,
  calendarStatus,
  dayAndWeek,
  dayFromKey,
  eventDetail,
  plannerChats,
  syncCalendars,
} from './service.ts';
import {
  forgetMarks,
  savedChoices,
  setConnected,
  setMark,
  updateChoice,
  updateSettings,
} from './store.ts';

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

function dateParam(raw: unknown): number {
  const day = typeof raw === 'string' ? dayFromKey(raw) : null;
  if (day === null) throw new BadRequestError('Dates must be YYYY-MM-DD.');
  return day;
}

function rangeParams(query: Record<string, unknown>): { start: number; end: number } {
  const start = dateParam(query.from);
  const end = dateParam(query.to);
  if (end <= start) throw new BadRequestError('to must be after from.');
  if (end > addLocalDays(start, CALENDAR_RANGE_MAX_DAYS)) {
    throw new BadRequestError(`A range is at most ${CALENDAR_RANGE_MAX_DAYS} days.`);
  }
  return { start, end };
}

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
      const key = paramId(req, 'key');
      const changed = await updateChoice(deps.db, deps.workspaceId, key, patch);
      if (
        !changed &&
        patch.agentsEdit &&
        (await googleEditBlocked(deps.db, deps.workspaceId, key))
      ) {
        throw new BadRequestError(GOOGLE_EDIT_NEEDS_GRANT);
      }
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
      const day = req.query.date === undefined ? localDayStart(now()) : dateParam(req.query.date);
      const state = await calendarState(service, dayAndWeek(day, now()));
      return calendarDay(state, day, now());
    }),
  );

  router.get('/calendar/range', (req, res) =>
    guarded(res, async () => {
      const range = rangeParams(req.query);
      return calendarRange(await calendarState(service, [range]), range, now());
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
      return needHost().request({
        op: 'open',
        eventId: occurrence.eventId,
        start: occurrence.start,
      });
    }),
  );

  router.post('/calendar/event', (req, res) =>
    guarded(res, async () => {
      const occurrence = parseBody(calendarOccurrenceSchema, req);
      if (!isGoogleEventId(occurrence.eventId)) return eventDetail(needHost(), occurrence);
      const detail = await googleDetail(occurrence);
      if (!detail) throw new CalendarHostError('not_found', 'That event is gone.');
      return detail;
    }),
  );

  const googleDetail = async (occurrence: CalendarOccurrence) => {
    if (!google) return null;
    const choices = occurrence.calendarKey ? await savedChoices(deps.db, deps.workspaceId) : [];
    const calendarId =
      choices.find((choice) => choice.key === occurrence.calendarKey)?.calendarId ?? null;
    try {
      return await google.detail({
        eventId: occurrence.eventId,
        start: occurrence.start,
        calendarId,
      });
    } catch (error) {
      if (error instanceof GoogleSignInNeeded) {
        throw new CalendarHostError('not_authorized', error.message);
      }
      if (error instanceof GoogleApiError || error instanceof GoogleAuthError) {
        throw new CalendarHostError('failed', error.message);
      }
      throw error;
    }
  };

  const macUids = async () => {
    const mac = await calendarState({ ...service, google: null });
    return mac.events.map((event) => event.uid ?? event.id);
  };
  router.use(googleCalendarRoutes({ google, status: () => calendarStatus(service), macUids }));

  return router;
}

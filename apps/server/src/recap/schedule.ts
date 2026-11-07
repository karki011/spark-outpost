import type { Db } from '../persistence/db.ts';
import { sparkPaused } from '../persistence/spark-pause.ts';
import { claimWeekRecap, latestRecap, recapSetting } from '../persistence/week-recaps.ts';
import { requestRecap } from './service.ts';
import { localDay, recapDue, weekStart } from './week.ts';

const CHECK_EVERY_MS = 10 * 60_000;

export interface WeekRecapSchedule {
  stop(): void;
  tick(): Promise<void>;
}

export function startWeekRecap(
  db: Db,
  workspaceId: string,
  everyMs = CHECK_EVERY_MS,
): WeekRecapSchedule {
  let triedWeek: string | null = null;
  let running = false;
  const attempt = async (now: Date, week: string) => {
    const setting = await recapSetting(db, workspaceId);
    if (!setting.enabled || !recapDue(now, setting.day, setting.time)) return;
    if (await sparkPaused(db, workspaceId)) return;
    triedWeek = week;
    if (await latestRecap(db, workspaceId, week, now)) return;
    if (!(await claimWeekRecap(db, workspaceId, week))) return;
    await requestRecap(db, workspaceId, now);
  };
  const tick = async () => {
    const now = new Date();
    const week = localDay(weekStart(now));
    if (running || triedWeek === week) return;
    running = true;
    try {
      await attempt(now, week);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    tick().catch((error: unknown) => console.error('The week recap failed', error));
  }, everyMs);
  timer.unref();
  return { stop: () => clearInterval(timer), tick };
}

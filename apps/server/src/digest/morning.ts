import type { Db } from '../persistence/db.ts';
import { asLast, latestDigests } from '../persistence/digests.ts';
import { claimMorningBrief, morningBriefSetting } from '../persistence/setup.ts';
import { morningDue } from './policy.ts';
import { requestDigest } from './service.ts';

const CHECK_EVERY_MS = 10 * 60_000;

export interface MorningBrief {
  stop(): void;
}

const pad = (value: number) => String(value).padStart(2, '0');

const localDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function startMorningBrief(
  db: Db,
  workspaceId: string,
  refreshTickets: () => Promise<unknown>,
  everyMs = CHECK_EVERY_MS,
): MorningBrief {
  let triedOn: string | null = null;
  let running = false;
  const attempt = async (now: Date) => {
    const day = localDay(now);
    const setting = await morningBriefSetting(db, workspaceId);
    if (!setting.enabled) return;
    const { latest } = await latestDigests(db, workspaceId, now);
    if (!morningDue(asLast(latest), now, setting.time)) return;
    triedOn = day;
    if (!(await claimMorningBrief(db, workspaceId, day))) return;
    await refreshTickets().catch((error: unknown) => {
      console.error('Could not refresh tickets for the morning brief', error);
    });
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    await requestDigest(db, workspaceId, 'morning', timeZone, new Date(), setting.time);
  };
  const tick = async () => {
    const now = new Date();
    if (running || triedOn === localDay(now)) return;
    running = true;
    try {
      await attempt(now);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    tick().catch((error: unknown) => console.error('The morning brief failed', error));
  }, everyMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

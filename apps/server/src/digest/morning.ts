import type { Db } from '../persistence/db.ts';
import { asLast, latestDigests } from '../persistence/digests.ts';
import { morningDue } from './policy.ts';
import { requestDigest } from './service.ts';

const CHECK_EVERY_MS = 10 * 60_000;

export interface MorningBrief {
  stop(): void;
}

const dayOf = (date: Date) => date.toDateString();

export function startMorningBrief(
  db: Db,
  workspaceId: string,
  refreshTickets: () => Promise<unknown>,
  everyMs = CHECK_EVERY_MS,
): MorningBrief {
  let triedOn: string | null = null;
  const tick = async () => {
    const now = new Date();
    if (triedOn === dayOf(now)) return;
    const { latest } = await latestDigests(db, workspaceId, now);
    if (!morningDue(asLast(latest), now)) return;
    triedOn = dayOf(now);
    await refreshTickets().catch((error: unknown) => {
      console.error('Could not refresh tickets for the morning brief', error);
    });
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    await requestDigest(db, workspaceId, 'morning', timeZone);
  };
  const timer = setInterval(() => {
    tick().catch((error: unknown) => console.error('The morning brief failed', error));
  }, everyMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

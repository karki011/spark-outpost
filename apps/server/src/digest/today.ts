import {
  TODAY_CHATS_MAX,
  type SpendSummary,
  type TodayChat,
  type TodaySummary,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { loadActivity } from '../persistence/digests.ts';
import { spendSummary } from '../persistence/spend.ts';
import { chatWins, type ChatWins } from '../persistence/today-wins.ts';
import type { ActivityChat } from './input.ts';
import { computeDigestStats } from './stats.ts';

const NO_WINS = { kept: 0, prs: 0, tickets: 0 };

function sum(chats: readonly TodayChat[], key: 'kept' | 'prs' | 'tickets'): number {
  return chats.reduce((total, chat) => total + chat[key], 0);
}

export function buildToday(
  spend: Pick<SpendSummary, 'since' | 'costUsd' | 'costSource'>,
  activity: readonly ActivityChat[],
  wins: readonly ChatWins[],
): TodaySummary {
  const winsById = new Map(wins.map((row) => [row.id, row]));
  const chats = activity
    .map((chat): TodayChat => {
      const found = winsById.get(chat.id) ?? NO_WINS;
      return {
        id: chat.id,
        title: chat.title,
        project: chat.project,
        state: chat.state,
        kept: found.kept,
        prs: found.prs,
        tickets: found.tickets,
        updatedAt: chat.updatedAt,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    since: spend.since,
    chats: chats.length,
    waiting: computeDigestStats(activity).waiting,
    kept: sum(chats, 'kept'),
    prs: sum(chats, 'prs'),
    tickets: sum(chats, 'tickets'),
    costUsd: spend.costUsd,
    costSource: spend.costSource,
    recent: chats.slice(0, TODAY_CHATS_MAX),
  };
}

export async function todaySummary(
  db: Queryable,
  workspaceId: string,
  timeZone: string,
): Promise<TodaySummary> {
  const spend = await spendSummary(db, workspaceId, 'today', timeZone);
  const since = new Date(spend.since);
  const activity = await loadActivity(db, workspaceId, since);
  const wins = await chatWins(
    db,
    activity.map((chat) => chat.id),
    since,
  );
  return buildToday(spend, activity, wins);
}

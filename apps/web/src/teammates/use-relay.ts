import type { TeammateView } from '@spark-outpost/contracts';
import { useTeammates } from './use-teammates.ts';

export const FALLBACK_RELAY_NAME = 'Spark';

export function relayOf(teammates: readonly TeammateView[]): TeammateView | null {
  return teammates.find((teammate) => teammate.kind === 'pr_follow_up') ?? null;
}

export function userMade(teammates: readonly TeammateView[]): TeammateView[] {
  return teammates.filter((teammate) => !teammate.kind);
}

export function useRelay(): TeammateView | null {
  return relayOf(useTeammates().teammates);
}

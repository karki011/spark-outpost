import type { AnalyticsWindow } from '@spark-outpost/contracts';

export const WINDOW_FILTER = `r.created_at >= ($2::date)::timestamp AT TIME ZONE $4
  AND r.created_at < ($3::date + 1)::timestamp AT TIME ZONE $4`;

export function windowParams(workspaceId: string, window: AnalyticsWindow): unknown[] {
  return [workspaceId, window.from, window.to, window.timeZone];
}

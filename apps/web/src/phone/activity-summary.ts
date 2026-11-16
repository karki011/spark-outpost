import type { RemoteAuditAction, RemoteAuditEntry } from '@spark-outpost/contracts';

const REFUSALS: readonly RemoteAuditAction[] = [
  'refused',
  'pairing_failed',
  'card_step_up_failed',
  'passkey_sign_in_failed',
];

function startOfDay(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function activitySummary(
  entries: readonly RemoteAuditEntry[],
  now: number,
): { today: number; refused: number } {
  const since = startOfDay(now);
  const todays = entries.filter((entry) => Date.parse(entry.at) >= since);
  return {
    today: todays.length,
    refused: todays.filter((entry) => REFUSALS.includes(entry.action)).length,
  };
}

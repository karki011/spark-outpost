import type { ShareEnv } from './env.ts';

export type ShareEvent =
  | 'share_created'
  | 'share_viewed'
  | 'unlock_ok'
  | 'unlock_wrong'
  | 'unlock_locked'
  | 'share_deleted'
  | 'share_expired'
  | 'report_filed'
  | 'create_rate_limited'
  | 'create_global_limited'
  | 'create_rejected';

export interface EventPoint {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

export interface EventDataset {
  writeDataPoint(point: EventPoint): void;
}

const ONE_INDEX = 'share-worker';

export function recordEvent(
  env: ShareEnv,
  event: ShareEvent,
  detail: { kind?: string; amount?: number } = {},
): void {
  try {
    env.EVENTS?.writeDataPoint({
      indexes: [ONE_INDEX],
      blobs: [event, detail.kind ?? ''],
      doubles: [detail.amount ?? 1],
    });
  } catch {
    return;
  }
}

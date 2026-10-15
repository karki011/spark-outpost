import webpush from 'web-push';
import type { VapidKeys } from './push-keys.ts';

export type PushOutcome = 'sent' | 'gone' | 'failed';

export interface PushResult {
  outcome: PushOutcome;
  status: number | null;
  reason: string | null;
}

export interface PushDelivery {
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: string;
  keys: VapidKeys;
  subject: string;
}

export type PushSend = (delivery: PushDelivery) => Promise<PushResult>;

const PUSH_TTL_SECONDS = 60 * 60;
const PUSH_TIMEOUT_MS = 15_000;
const GONE = new Set([404, 410]);
const REASON = /^[A-Za-z]{1,40}$/;

export function pushFailureReason(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(body);
    const reason = (parsed as { reason?: unknown } | null)?.reason;
    return typeof reason === 'string' && REASON.test(reason) ? reason : null;
  } catch {
    return null;
  }
}

export function generateVapidKeys(): VapidKeys {
  return webpush.generateVAPIDKeys();
}

export const webPushSend: PushSend = async (delivery) => {
  try {
    await webpush.sendNotification(
      { endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } },
      delivery.payload,
      {
        vapidDetails: { subject: delivery.subject, ...delivery.keys },
        TTL: PUSH_TTL_SECONDS,
        urgency: 'high',
        timeout: PUSH_TIMEOUT_MS,
      },
    );
    return { outcome: 'sent', status: null, reason: null };
  } catch (error) {
    if (!(error instanceof webpush.WebPushError)) {
      console.error('Push notification failed', (error as Error).message);
      return { outcome: 'failed', status: null, reason: null };
    }
    const status = error.statusCode;
    const reason = pushFailureReason(error.body);
    if (GONE.has(status)) return { outcome: 'gone', status, reason };
    console.error('Push notification refused', status, reason ?? '');
    return { outcome: 'failed', status, reason };
  }
};

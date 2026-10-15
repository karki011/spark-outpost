import webpush from 'web-push';
import type { VapidKeys } from './push-keys.ts';

export type PushOutcome = 'sent' | 'gone' | 'failed';

export interface PushDelivery {
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: string;
  keys: VapidKeys;
}

export type PushSend = (delivery: PushDelivery) => Promise<PushOutcome>;

export const VAPID_SUBJECT = 'mailto:notifications@spark-outpost.invalid';
const PUSH_TTL_SECONDS = 60 * 60;
const PUSH_TIMEOUT_MS = 15_000;
const GONE = new Set([404, 410]);

export function generateVapidKeys(): VapidKeys {
  return webpush.generateVAPIDKeys();
}

export const webPushSend: PushSend = async (delivery) => {
  try {
    await webpush.sendNotification(
      { endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } },
      delivery.payload,
      {
        vapidDetails: { subject: VAPID_SUBJECT, ...delivery.keys },
        TTL: PUSH_TTL_SECONDS,
        urgency: 'high',
        timeout: PUSH_TIMEOUT_MS,
      },
    );
    return 'sent';
  } catch (error) {
    if (error instanceof webpush.WebPushError && GONE.has(error.statusCode)) return 'gone';
    console.error('Push notification failed', (error as Error).message);
    return 'failed';
  }
};

import { z } from 'zod';

export const PUSH_ENDPOINT_MAX = 2048;

const base64Url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+=*$/);

export const pushSubscribeRequestSchema = z.object({
  endpoint: z.string().min(1).max(PUSH_ENDPOINT_MAX),
  keys: z.object({ p256dh: base64Url(200), auth: base64Url(100) }),
});
export type PushSubscribeRequest = z.infer<typeof pushSubscribeRequestSchema>;

export const pushUnsubscribeRequestSchema = z.object({
  endpoint: z.string().min(1).max(PUSH_ENDPOINT_MAX),
});

export const pushStateSchema = z.object({
  publicKey: z.string(),
  endpoints: z.array(z.string()),
});
export type PushState = z.infer<typeof pushStateSchema>;

export const PUSH_CONTACT_DEFAULT = 'https://github.com/karki011/spark-outpost';
export const PUSH_CONTACT_MAX = 200;

export const updatePushContactRequestSchema = z.object({
  contact: z.string().trim().max(PUSH_CONTACT_MAX).nullable(),
});
export type UpdatePushContactRequest = z.infer<typeof updatePushContactRequestSchema>;

export const pushFailureSchema = z.object({
  at: z.string(),
  deviceName: z.string().nullable(),
  status: z.number().int().nullable(),
  reason: z.string().nullable(),
});
export type PushFailure = z.infer<typeof pushFailureSchema>;

export const pushTestResultSchema = z.object({
  outcome: z.enum(['sent', 'off', 'none', 'gone', 'failed']),
  reason: z.string().nullable(),
});
export type PushTestResult = z.infer<typeof pushTestResultSchema>;

export const pushContactStateSchema = z.object({
  contact: z.string().nullable(),
  inUse: z.string(),
  failures: z.array(pushFailureSchema),
});
export type PushContactState = z.infer<typeof pushContactStateSchema>;

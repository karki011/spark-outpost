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

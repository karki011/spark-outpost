import { z } from 'zod';
import { googleSignInFlowSchema } from './calendar-google.ts';

export const zoomStatusSchema = z.object({
  available: z.boolean(),
  account: z.object({ email: z.string().max(320), needsSignIn: z.boolean() }).nullable(),
  signIn: googleSignInFlowSchema,
});
export type ZoomStatus = z.infer<typeof zoomStatusSchema>;

export const zoomDisconnectedSchema = z.object({
  status: zoomStatusSchema,
  message: z.string().max(500).nullable(),
});
export type ZoomDisconnected = z.infer<typeof zoomDisconnectedSchema>;

export const ZOOM_SIGN_IN_AGAIN =
  'Zoom sign-in ran out. Select Sign in again on the Zoom card in Connections → Connectors.';
export const ZOOM_NOT_CONNECTED = 'Connect Zoom in Connections → Connectors first.';

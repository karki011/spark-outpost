import { z } from 'zod';

export const MAC_PRESENCE_IDLE_SECONDS = 120;

export const presenceBridgeToHostSchema = z.object({ kind: z.literal('presence:status') });
export type PresenceBridgeToHost = z.infer<typeof presenceBridgeToHostSchema>;

export const presenceBridgeFromHostSchema = z.object({
  kind: z.literal('presence:state'),
  present: z.boolean(),
});
export type PresenceBridgeFromHost = z.infer<typeof presenceBridgeFromHostSchema>;

export interface MacActivity {
  idleSeconds: number;
  locked: boolean;
  asleep: boolean;
}

export function isAtMac(activity: MacActivity): boolean {
  return !activity.locked && !activity.asleep && activity.idleSeconds < MAC_PRESENCE_IDLE_SECONDS;
}

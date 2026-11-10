import { z } from 'zod';

export const homeSeenSchema = z.object({ seenAt: z.string().nullable() });
export type HomeSeen = z.infer<typeof homeSeenSchema>;

export const AWAY_MINUTES = 30;
export const AWAY_MS = AWAY_MINUTES * 60_000;
export const HOME_SEEN_DWELL_MS = 5_000;

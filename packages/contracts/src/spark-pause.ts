import { z } from 'zod';

export const sparkPauseSchema = z.object({
  pausedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type SparkPause = z.infer<typeof sparkPauseSchema>;

export const sparkPauseRequestSchema = z.object({ paused: z.boolean() }).strict();
export type SparkPauseRequest = z.infer<typeof sparkPauseRequestSchema>;

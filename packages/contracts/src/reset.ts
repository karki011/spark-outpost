import { z } from 'zod';

export const resetRequestSchema = z.object({ keepApiKeys: z.boolean() });
export type ResetRequest = z.infer<typeof resetRequestSchema>;

export const resetReportSchema = z.object({
  secretsRemoved: z.number().int().nonnegative(),
  worktreesRemoved: z.number().int().nonnegative(),
  problems: z.array(z.string()),
});
export type ResetReport = z.infer<typeof resetReportSchema>;

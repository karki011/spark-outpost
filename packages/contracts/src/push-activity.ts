import { z } from 'zod';

export const pushActivitySchema = z.object({
  outcome: z.enum(['pushed', 'failed', 'cancelled', 'timed_out', 'refused']),
  branch: z.string(),
  repo: z.string().nullable(),
  hook: z.string().nullable(),
  message: z.string(),
  output: z.string(),
});
export type PushActivity = z.infer<typeof pushActivitySchema>;

export function pushActivityTitle(push: PushActivity): string {
  if (push.outcome === 'pushed') return `Pushed ${push.branch}`;
  if (push.hook) return `Push stopped by the ${push.hook} check`;
  if (push.outcome === 'cancelled') return 'Push cancelled';
  if (push.outcome === 'timed_out') return 'Push timed out';
  return push.outcome === 'refused' ? 'Push refused' : 'Push failed';
}

export const pushNoticeSchema = pushActivitySchema.extend({
  id: z.string(),
  runId: z.uuid(),
  at: z.string(),
});
export type PushNotice = z.infer<typeof pushNoticeSchema>;

export const pushNoticesSchema = z.object({ pushes: z.array(pushNoticeSchema) });
export type PushNotices = z.infer<typeof pushNoticesSchema>;

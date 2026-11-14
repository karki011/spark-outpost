import { z } from 'zod';

export const roundOutcomeSchema = z.object({
  runId: z.uuid(),
  round: z.number().int().nonnegative(),
  ended: z.enum(['settled', 'stopped', 'failed']),
  pushed: z.boolean(),
  merged: z.boolean().default(false),
  replied: z.number().int().nonnegative(),
  rerequested: z.boolean(),
  needs: z.number().int().nonnegative(),
  unpushed: z.boolean(),
});
export type RoundOutcome = z.infer<typeof roundOutcomeSchema>;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function roundOutcomeLine(outcome: RoundOutcome): string {
  if (outcome.ended === 'stopped') return 'Follow-up round was stopped';
  if (outcome.ended === 'failed') return 'Follow-up round did not finish';
  const done = [
    outcome.replied > 0 ? `replied to ${plural(outcome.replied, 'comment', 'comments')}` : null,
    outcome.pushed ? (outcome.merged ? 'merged the base and pushed' : 'pushed a fix') : null,
    outcome.rerequested ? 're-requested review' : null,
  ].filter((part): part is string => part !== null);
  const needs =
    outcome.needs > 0 ? `; ${plural(outcome.needs, 'item needs', 'items need')} you` : '';
  if (done.length === 0) {
    if (outcome.unpushed) return `Follow-up made a fix that was not pushed${needs}`;
    return `Follow-up stopped: nothing changed${needs}`;
  }
  return `Follow-up ${done.join(', ')}${needs}`;
}

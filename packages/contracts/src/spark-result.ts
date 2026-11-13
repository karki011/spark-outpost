import { z } from 'zod';
import type { SparkAction, SparkActionName } from './spark-actions.ts';

export const sparkResultStateSchema = z.enum(['waiting', 'running', 'done', 'failed', 'unknown']);
export type SparkResultState = z.infer<typeof sparkResultStateSchema>;

export const sparkResultSchema = z.object({
  state: sparkResultStateSchema,
  message: z.string().max(2000).nullable(),
  url: z.string().max(2000).nullable(),
  output: z.record(z.string(), z.unknown()).optional(),
});
export type SparkResult = z.infer<typeof sparkResultSchema>;

export function sparkResultFinished(result: SparkResult | undefined): boolean {
  return result?.state === 'done' || result?.state === 'failed' || result?.state === 'unknown';
}

const REPEATABLE: ReadonlySet<SparkActionName> = new Set([
  'pr_follow_up_round',
  'transition_ticket',
  'assign_ticket',
  'update_teammate',
  'update_mcp_server',
  'switch_mcp_server',
  'remove_mcp_server',
  'read_page',
  'open_page',
  'act_page',
  'browser_sign_in',
  'mac_use_app',
  'mac_act',
  'mac_press',
  'calendar_read',
  'github_read',
]);

export function sparkRetryAllowed(action: SparkAction, result: SparkResult | undefined): boolean {
  if (result?.state === 'failed') return true;
  return result?.state === 'unknown' && REPEATABLE.has(action.action);
}

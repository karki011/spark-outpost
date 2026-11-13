import { z } from 'zod';
import { approvalSchema } from './approvals.ts';
import { totalCostSourceSchema } from './audit.ts';
import { crewSlugSchema } from './crew-files.ts';
import { workflowRunSchema } from './crew-run.ts';

export const TEST_RUN_CHAT_KIND = 'crew';
export const TRY_IT_WORKFLOW_ID = 'try-it';
export const HELD_SEND_SUMMARY_MAX = 200;

export const TEST_RUN_LIMITS =
  'Tokens are spent and the cost is real. A script that reaches an outside service by itself is not stopped by Spark.';

export const heldSendKindSchema = z.enum([
  'push',
  'pull_request',
  'command',
  'ticket',
  'confluence',
  'slack',
  'calendar',
  'browser',
  'mac',
  'spark_action',
]);
export type HeldSendKind = z.infer<typeof heldSendKindSchema>;

export const HELD_SEND_LABELS: Record<HeldSendKind, string> = {
  push: 'Push',
  pull_request: 'Pull request',
  command: 'Command',
  ticket: 'Ticket',
  confluence: 'Confluence',
  slack: 'Slack',
  calendar: 'Calendar',
  browser: 'Browser',
  mac: 'Mac control',
  spark_action: 'Spark action',
};

export const heldSendSchema = z.object({
  id: z.uuid(),
  stepId: crewSlugSchema.nullable(),
  kind: heldSendKindSchema,
  summary: z.string(),
  at: z.iso.datetime({ offset: true }),
});
export type HeldSend = z.infer<typeof heldSendSchema>;

export const testRunUsageSchema = z.object({
  totalTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
  costSource: totalCostSourceSchema.nullable(),
});
export type TestRunUsage = z.infer<typeof testRunUsageSchema>;

export const workflowTestRunSchema = z.object({
  run: workflowRunSchema,
  message: z.string(),
  projectId: z.uuid().nullable(),
  projectName: z.string().nullable(),
  oneSpark: z.boolean(),
  held: z.array(heldSendSchema),
  waiting: z.array(approvalSchema),
  usage: testRunUsageSchema,
});
export type WorkflowTestRun = z.infer<typeof workflowTestRunSchema>;

export const startSparkTestRunSchema = z.object({
  projectId: z.uuid().nullable().default(null),
  message: z.string().max(4000).default(''),
});
export type StartSparkTestRun = z.infer<typeof startSparkTestRunSchema>;

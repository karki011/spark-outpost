import { z } from 'zod';
import { crewSlugSchema } from './crew-files.ts';
import { workflowRunSourceSchema } from './crew-run.ts';
import { runStatusSchema } from './runs.ts';

export const usageTotalsSchema = z.object({
  count: z.number().int().nonnegative(),
  lastAt: z.string().nullable(),
  tokens: z.number().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});
export type UsageTotals = z.infer<typeof usageTotalsSchema>;

export const NO_USAGE: UsageTotals = { count: 0, lastAt: null, tokens: 0, costUsd: null };

export const sparkUsageWorkflowSchema = z.object({
  id: crewSlugSchema,
  name: z.string(),
  steps: z.array(z.number().int().positive()),
  stepCount: z.number().int().positive(),
});
export type SparkUsageWorkflow = z.infer<typeof sparkUsageWorkflowSchema>;

export const sparkActivityKindSchema = z.enum(['chat', 'job', 'step']);
export type SparkActivityKind = z.infer<typeof sparkActivityKindSchema>;

export const sparkActivitySchema = z.object({
  id: z.uuid(),
  kind: sparkActivityKindSchema,
  conversationId: z.uuid().nullable(),
  title: z.string(),
  workflowName: z.string().nullable(),
  status: runStatusSchema.nullable(),
  at: z.string(),
  tokens: z.number().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});
export type SparkActivity = z.infer<typeof sparkActivitySchema>;

export const SPARK_ACTIVITY_MAX = 30;

export const sparkUsageSchema = z.object({
  workflows: z.array(sparkUsageWorkflowSchema),
  sparks: z.array(z.object({ id: z.uuid(), name: z.string() })),
  chats: usageTotalsSchema,
  jobs: usageTotalsSchema,
  steps: usageTotalsSchema,
  recent: z.array(sparkActivitySchema),
});
export type SparkUsage = z.infer<typeof sparkUsageSchema>;

export const workflowUsageSchema = z.object({
  total: usageTotalsSchema,
  sources: z.array(usageTotalsSchema.extend({ source: workflowRunSourceSchema })),
  chats: z.array(
    z.object({
      conversationId: z.uuid(),
      title: z.string(),
      runs: z.number().int().positive(),
      lastAt: z.string(),
    }),
  ),
});
export type WorkflowUsage = z.infer<typeof workflowUsageSchema>;

export const WORKFLOW_USAGE_CHATS_MAX = 50;

export function sparkUsedInLine(workflow: SparkUsageWorkflow): string {
  const [first] = workflow.steps;
  if (workflow.steps.length === 1 && first !== undefined) {
    return `Workflow · step ${first} of ${workflow.stepCount}`;
  }
  return `Workflow · steps ${workflow.steps.join(', ')} of ${workflow.stepCount}`;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

export function namesSpark(instructions: string, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return false;
  const text = instructions.toLowerCase();
  let from = text.indexOf(wanted);
  while (from !== -1) {
    const before = text[from - 1] ?? ' ';
    const after = text[from + wanted.length] ?? ' ';
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true;
    from = text.indexOf(wanted, from + 1);
  }
  return false;
}

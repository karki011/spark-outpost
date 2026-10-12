import { z } from 'zod';

export const SUBAGENT_REPORT = 'spark.subagent_report';

export const subagentUsageSchema = z.object({
  tokens: z.number().nonnegative().optional(),
  toolUses: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  turns: z.number().int().nonnegative().optional(),
  model: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
});
export type SubagentUsage = z.infer<typeof subagentUsageSchema>;

export const subagentReportSchema = z.object({
  id: z.string().min(1),
  usage: subagentUsageSchema.optional(),
  files: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  message: z.string().optional(),
  summary: z.string().optional(),
});
export type SubagentReport = z.infer<typeof subagentReportSchema>;

export const subagentStepSchema = z.object({ name: z.string(), done: z.boolean() });
export type SubagentStep = z.infer<typeof subagentStepSchema>;

export const subagentRecordSchema = z.object({
  steps: z.array(subagentStepSchema).default([]),
  files: z.array(z.string()).default([]),
  commands: z.array(z.string()).default([]),
  usage: subagentUsageSchema.optional(),
  message: z.string().optional(),
  summary: z.string().optional(),
});
export type SubagentRecord = z.infer<typeof subagentRecordSchema>;

export const emptySubagentRecord: SubagentRecord = { steps: [], files: [], commands: [] };

function joined(known: readonly string[], added: readonly string[] | undefined): string[] {
  return [...new Set([...known, ...(added ?? [])])];
}

export function withSubagentReport<Row extends SubagentRecord>(
  row: Row,
  report: SubagentReport,
): Row {
  return {
    ...row,
    files: joined(row.files, report.files),
    commands: [...row.commands, ...(report.commands ?? [])],
    ...(report.usage ? { usage: { ...row.usage, ...report.usage } } : {}),
    ...(report.message ? { message: report.message } : {}),
    ...(report.summary ? { summary: report.summary } : {}),
  };
}

export function withSubagentStep<Row extends SubagentRecord>(
  row: Row,
  name: string,
  started: boolean,
): Row {
  if (started) return { ...row, steps: [...row.steps, { name, done: false }] };
  const index = row.steps.findIndex((step) => !step.done && step.name === name);
  if (index < 0) return row;
  return {
    ...row,
    steps: row.steps.map((step, at) => (at === index ? { ...step, done: true } : step)),
  };
}

function compact(count: number): string {
  if (count < 1000) return String(Math.round(count));
  if (count < 1_000_000)
    return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function seconds(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const rest = total % 60;
  return rest ? `${Math.floor(total / 60)}m ${rest}s` : `${Math.floor(total / 60)}m`;
}

function cost(usd: number): string {
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

export function subagentUsageParts(
  record: Pick<SubagentRecord, 'steps' | 'usage'>,
  durationMs: number | null,
): string[] {
  const { usage } = record;
  const steps = record.steps.length;
  const shownMs = usage?.durationMs ?? durationMs;
  return [
    steps > 0 ? `${steps} ${steps === 1 ? 'step' : 'steps'}` : null,
    usage?.turns ? `${usage.turns} ${usage.turns === 1 ? 'turn' : 'turns'}` : null,
    usage?.tokens !== undefined ? `${compact(usage.tokens)} tokens` : null,
    usage?.costUsd !== undefined ? cost(usage.costUsd) : null,
    shownMs !== null && shownMs !== undefined ? seconds(shownMs) : null,
    usage?.model ?? null,
  ].filter((part): part is string => part !== null);
}

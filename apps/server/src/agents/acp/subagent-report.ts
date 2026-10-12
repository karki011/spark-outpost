import { z } from 'zod';
import { objectFields } from './object-fields.ts';

const claudeUsageSchema = z.object({
  total_tokens: z.number().nonnegative(),
  tool_uses: z.number().int().nonnegative(),
  duration_ms: z.number().nonnegative(),
});

const codexUsageSchema = z.object({
  totalTokens: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(),
  cachedInputTokens: z.number().nonnegative().default(0),
  outputTokens: z.number().nonnegative(),
});

export const reportedSchema = z.object({
  tokens: z.number().optional(),
  toolUses: z.number().optional(),
  durationMs: z.number().optional(),
  turns: z.number().optional(),
  model: z.string().optional(),
  input: z.number().optional(),
  cachedRead: z.number().optional(),
  output: z.number().optional(),
  summary: z.string().optional(),
});
export type Reported = z.infer<typeof reportedSchema>;

function fromClaude(meta: Record<string, unknown>): Reported {
  const usage = claudeUsageSchema.safeParse(meta.usage);
  const summary = typeof meta.summary === 'string' ? meta.summary.trim() : '';
  return {
    ...(usage.success
      ? {
          tokens: usage.data.total_tokens,
          toolUses: usage.data.tool_uses,
          durationMs: usage.data.duration_ms,
        }
      : {}),
    ...(summary ? { summary } : {}),
  };
}

function fromCodex(meta: Record<string, unknown>): Reported {
  const usage = codexUsageSchema.safeParse(meta.usage);
  const turns = typeof meta.turns === 'number' && meta.turns > 0 ? meta.turns : null;
  const model = typeof meta.model === 'string' ? meta.model.trim() : '';
  return {
    ...(usage.success
      ? {
          tokens: usage.data.totalTokens,
          input: usage.data.inputTokens,
          cachedRead: usage.data.cachedInputTokens,
          output: usage.data.outputTokens,
        }
      : {}),
    ...(turns ? { turns } : {}),
    ...(model ? { model } : {}),
  };
}

export function reportedByAdapter(meta: unknown): Reported | null {
  const fields = objectFields(meta);
  const reported = {
    ...fromClaude(objectFields(fields.claudeCode)),
    ...fromCodex(objectFields(fields.codex)),
  };
  return Object.keys(reported).length > 0 ? reported : null;
}

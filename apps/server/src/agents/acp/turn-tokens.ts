import type { Usage } from '@agentclientprotocol/sdk';
import type { TokenUsage } from '@spark-outpost/contracts';
import { z } from 'zod';
import type { ProviderOutput } from '../../providers/provider.ts';
import { objectFields } from './object-fields.ts';
import { promptTokens } from './prompt-usage.ts';

const modelRowSchema = z.object({
  token_count: z.object({
    totalTokens: z.number().nonnegative(),
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    cachedInputTokens: z.number().nonnegative().default(0),
    cachedWriteTokens: z.number().nonnegative().default(0),
  }),
});

interface PromptResponse {
  usage?: Usage | null | undefined;
  _meta?: unknown;
}

export interface TurnTokens {
  add(response: PromptResponse, subagentTokens: number): ProviderOutput[];
}

function perModelTally(meta: unknown): TokenUsage | null {
  const rows = z
    .array(modelRowSchema)
    .safeParse(objectFields(objectFields(meta).quota).model_usage);
  if (!rows.success || rows.data.length === 0) return null;
  const sum = (pick: (count: z.infer<typeof modelRowSchema>['token_count']) => number) =>
    rows.data.reduce((total, row) => total + pick(row.token_count), 0);
  return {
    input: sum((count) => count.inputTokens),
    output: sum((count) => count.outputTokens),
    total: sum((count) => count.totalTokens),
    cachedRead: sum((count) => count.cachedInputTokens),
    cachedWrite: sum((count) => count.cachedWriteTokens),
    thought: null,
  };
}

function plus(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

function added(earlier: TokenUsage | null, next: TokenUsage): TokenUsage {
  if (!earlier) return next;
  return {
    input: earlier.input + next.input,
    output: earlier.output + next.output,
    total: earlier.total + next.total,
    cachedRead: plus(earlier.cachedRead, next.cachedRead),
    cachedWrite: plus(earlier.cachedWrite, next.cachedWrite),
    thought: plus(earlier.thought, next.thought),
  };
}

export function createTurnTokens(countsSubagentsApart: boolean): TurnTokens {
  let earlier: TokenUsage | null = null;
  return {
    add(response, subagentTokens) {
      const own = promptTokens(response.usage)[0];
      if (!own || own.kind !== 'tokens') return [];
      const tally = countsSubagentsApart ? perModelTally(response._meta) : null;
      const fuller = tally && tally.total > own.tokens.total ? tally : own.tokens;
      const withSubagents = countsSubagentsApart ? own.tokens.total + subagentTokens : 0;
      const prompt = { ...fuller, total: Math.max(fuller.total, withSubagents) };
      earlier = added(earlier, prompt);
      return [{ kind: 'tokens', tokens: earlier }];
    },
  };
}

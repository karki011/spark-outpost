import type { Usage } from '@agentclientprotocol/sdk';
import type { TokenUsage } from '@spark-outpost/contracts';
import { z } from 'zod';
import type { ProviderOutput, RequestUsage } from '../../providers/provider.ts';
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
  addCycle(requests: readonly RequestUsage[], subagentTokens: number): ProviderOutput[];
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

function plus(a: number | null | undefined, b: number | null | undefined): number | null {
  const [left, right] = [a ?? null, b ?? null];
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0);
}

function apart(subagents: number | null): { subagents?: number } {
  return subagents ? { subagents } : {};
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
    ...apart(plus(earlier.subagents, next.subagents)),
  };
}

function withSubagents(own: TokenUsage, tally: TokenUsage | null, reported: number): TokenUsage {
  const total = own.total + reported;
  if (tally && tally.total > total) return tally;
  return { ...own, total, ...apart(reported) };
}

function requestTokens(requests: readonly RequestUsage[]): TokenUsage {
  const sum = (pick: (request: RequestUsage) => number) =>
    requests.reduce((total, request) => total + pick(request), 0);
  const input = sum((request) => request.input);
  const output = sum((request) => request.output);
  const cachedRead = sum((request) => request.cachedRead);
  const cachedWrite = sum((request) => request.cachedWrite);
  return {
    input,
    output,
    total: input + output + cachedRead + cachedWrite,
    cachedRead,
    cachedWrite,
    thought: null,
  };
}

export function createTurnTokens(countsSubagentsApart: boolean): TurnTokens {
  let earlier: TokenUsage | null = null;
  return {
    addCycle(requests, subagentTokens) {
      if (requests.length === 0 && subagentTokens === 0) return [];
      const own = requestTokens(requests);
      const cycle = countsSubagentsApart ? withSubagents(own, null, subagentTokens) : own;
      earlier = added(earlier, cycle);
      return [{ kind: 'tokens', tokens: earlier }];
    },
    add(response, subagentTokens) {
      const own = promptTokens(response.usage)[0];
      if (!own || own.kind !== 'tokens') return [];
      const prompt = countsSubagentsApart
        ? withSubagents(own.tokens, perModelTally(response._meta), subagentTokens)
        : own.tokens;
      earlier = added(earlier, prompt);
      return [{ kind: 'tokens', tokens: earlier }];
    },
  };
}

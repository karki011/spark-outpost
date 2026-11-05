import type { Usage } from '@agentclientprotocol/sdk';
import type { ProviderOutput } from '../../providers/provider.ts';

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

export function promptTokens(usage: Usage | null | undefined): ProviderOutput[] {
  if (!usage) return [];
  const input = count(usage.inputTokens);
  const output = count(usage.outputTokens);
  if (input === null || output === null) return [];
  return [
    {
      kind: 'tokens',
      tokens: {
        input,
        output,
        total: count(usage.totalTokens) ?? input + output,
        cachedRead: count(usage.cachedReadTokens),
        cachedWrite: count(usage.cachedWriteTokens),
        thought: count(usage.thoughtTokens),
      },
    },
  ];
}

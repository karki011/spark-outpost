import type { TokenUsage } from '@spark-outpost/contracts';
import type { ProviderOutput } from '../../providers/provider.ts';
import type { AgentDefinition } from './agents.ts';
import { offeredCapabilities } from './capabilities.ts';

export function asReported(definition: AgentDefinition, output: ProviderOutput): ProviderOutput {
  if (output.kind === 'usage') {
    const readings = definition.usageReadings ? { readings: definition.usageReadings } : {};
    return { ...output, ...readings, ...(definition.estimatesCost ? { costUsd: null } : {}) };
  }
  if (output.kind === 'tokens' && definition.inputExcludesCache) {
    return { ...output, tokens: withCachedInput(output.tokens) };
  }
  if (output.kind === 'capabilities') {
    return { ...output, report: offeredCapabilities(output.report, definition.offers) };
  }
  if (output.kind === 'session_settings' && definition.usedModel) {
    return { ...output, model: definition.usedModel(output.model) };
  }
  return output;
}

function withCachedInput(tokens: TokenUsage): TokenUsage {
  return { ...tokens, input: tokens.input + (tokens.cachedRead ?? 0) };
}

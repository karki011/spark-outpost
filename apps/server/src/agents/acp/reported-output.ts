import type { TokenUsage } from '@spark-outpost/contracts';
import type { ProviderOutput, SubagentReportedUsage } from '../../providers/provider.ts';
import { estimateCostUsd } from '../../usage/prices.ts';
import type { AgentDefinition } from './agents.ts';
import { offeredCapabilities } from './capabilities.ts';

export function asReported(definition: AgentDefinition, output: ProviderOutput): ProviderOutput {
  if (output.kind === 'usage') {
    const readings = definition.usageReadings ? { readings: definition.usageReadings } : {};
    const provisional = definition.windowAtResult === true && output.costUsd === null;
    return {
      ...output,
      ...readings,
      ...(provisional ? { provisionalWindow: true } : {}),
      ...(definition.estimatesCost ? { costUsd: null } : {}),
    };
  }
  if (output.kind === 'tokens' && definition.inputExcludesCache) {
    return { ...output, tokens: withCachedInput(output.tokens) };
  }
  if (output.kind === 'subagent_report' && output.report.usage) {
    return {
      ...output,
      report: { ...output.report, usage: priced(definition, output.report.usage) },
    };
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

function priced(definition: AgentDefinition, usage: SubagentReportedUsage): SubagentReportedUsage {
  const { model, input, output, cachedRead } = usage;
  if (!model || input === undefined || output === undefined) return usage;
  const costUsd = estimateCostUsd(definition.id, model, {
    input,
    output,
    cachedRead: cachedRead ?? null,
  });
  return costUsd === null ? usage : { ...usage, costUsd };
}

import { useQuery } from '@tanstack/react-query';
import {
  providerIdSchema,
  type AgentModeOption,
  type CrewSpark,
  type SparkSettingFrom,
} from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../api/client.ts';
import { modeLabel } from '../chat/composer/mode-summary.ts';

export type SparkSettings = Pick<CrewSpark, 'agentMode' | 'agentFrom' | 'modeFrom'>;

const SOURCE_WORDS: Record<Exclude<SparkSettingFrom, 'spark'>, string> = {
  chat: '(from chat)',
  default: '(your default)',
};

function sourceWords(from: SparkSettingFrom | undefined): string | null {
  return from && from !== 'spark' ? SOURCE_WORDS[from] : null;
}

export function agentSourceWords(spark: SparkSettings | undefined): string | null {
  if (!spark || spark.agentFrom === spark.modeFrom) return null;
  return sourceWords(spark.agentFrom);
}

export function modeText(
  spark: SparkSettings | undefined,
  modes: readonly AgentModeOption[],
): string | null {
  if (!spark?.agentMode) return null;
  const source = sourceWords(spark.modeFrom);
  const label = modeLabel(modes, spark.agentMode);
  return source ? `${label} ${source}` : label;
}

export function useSparkModeText(
  provider: string,
  spark: SparkSettings | undefined,
): string | null {
  const known = providerIdSchema.safeParse(provider);
  const capabilities = useQuery({
    ...capabilitiesQuery(known.data ?? 'claude'),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: known.success && Boolean(spark?.agentMode),
  });
  return modeText(spark, capabilities.data?.modes ?? []);
}

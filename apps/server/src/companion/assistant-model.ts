import type { AssistantSettings, ProviderId } from '@spark-outpost/contracts';
import { cardFor } from '../model-cards/cards.ts';

export interface FastTier {
  card: string;
  effort: string;
}

export const ASK_SPARK_FAST_TIER: Readonly<Record<ProviderId, FastTier | null>> = {
  claude: { card: 'claude-sonnet-5-5', effort: 'low' },
  codex: { card: 'gpt-6-luna', effort: 'low' },
  zai: { card: 'glm-5.3-flash', effort: 'low' },
  custom: null,
};

export interface OfferedModel {
  id: string;
  label?: string | null;
}

export interface AssistantPick {
  model: string | null;
  effort: string | null;
  fastEffort: string | null;
  noFastModel: boolean;
}

function offeredEffort(effort: string | null, efforts: readonly string[]): string | null {
  if (effort === null) return null;
  return efforts.length === 0 || efforts.includes(effort) ? effort : null;
}

export function fastModelFor(
  provider: ProviderId,
  offered: readonly OfferedModel[],
): OfferedModel | null {
  const tier = ASK_SPARK_FAST_TIER[provider];
  if (!tier) return null;
  return offered.find((model) => cardFor(model, provider)?.id === tier.card) ?? null;
}

export function assistantPick(
  settings: Pick<AssistantSettings, 'modelChoice' | 'model' | 'effort'>,
  provider: ProviderId,
  offered: readonly OfferedModel[],
  efforts: readonly string[],
): AssistantPick {
  const fastEffort = offeredEffort(ASK_SPARK_FAST_TIER[provider]?.effort ?? null, efforts);
  const chosenEffort = offeredEffort(settings.effort, efforts);
  if (settings.modelChoice === 'fast') {
    const fast = fastModelFor(provider, offered);
    return {
      model: fast?.id ?? null,
      effort: chosenEffort ?? fastEffort,
      fastEffort,
      noFastModel: fast === null,
    };
  }
  const picked =
    settings.modelChoice === 'pick' && offered.some((model) => model.id === settings.model)
      ? settings.model
      : null;
  return { model: picked, effort: chosenEffort, fastEffort, noFastModel: false };
}

import type { AssistantSettings, ProviderId } from '@spark-outpost/contracts';
import { cardFor } from '../model-cards/cards.ts';

export const ASK_SPARK_FAST_TIER: Readonly<Record<ProviderId, string | null>> = {
  claude: 'claude-sonnet-5-5',
  codex: 'gpt-6-luna',
  zai: 'glm-5.3-flash',
  custom: null,
};

const FAST_EFFORTS = ['medium', 'low'];

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

function fastEffortFor(provider: ProviderId, efforts: readonly string[]): string | null {
  if (!ASK_SPARK_FAST_TIER[provider]) return null;
  if (efforts.length === 0) return FAST_EFFORTS[0] ?? null;
  return FAST_EFFORTS.find((effort) => efforts.includes(effort)) ?? null;
}

function offeredEffort(effort: string | null, efforts: readonly string[]): string | null {
  if (effort === null) return null;
  return efforts.length === 0 || efforts.includes(effort) ? effort : null;
}

export function fastModelFor(
  provider: ProviderId,
  offered: readonly OfferedModel[],
): OfferedModel | null {
  const card = ASK_SPARK_FAST_TIER[provider];
  if (!card) return null;
  return offered.find((model) => cardFor(model, provider)?.id === card) ?? null;
}

export function assistantPick(
  settings: Pick<AssistantSettings, 'modelChoice' | 'model' | 'effort'>,
  provider: ProviderId,
  offered: readonly OfferedModel[],
  efforts: readonly string[],
): AssistantPick {
  const fastEffort = fastEffortFor(provider, efforts);
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

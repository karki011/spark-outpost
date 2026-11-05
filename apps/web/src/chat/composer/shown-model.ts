import type { ChatSettings, ProviderCapabilities, Run } from '@spark-outpost/contracts';
import { modelName } from '../../tasks/model-names.ts';

function lastTurnWith(pin: string, provider: string | null, runs: readonly Run[]): Run | null {
  const ran = runs.findLast(
    (run) =>
      !run.parentRunId &&
      run.provider === provider &&
      (run.model === pin || run.modelSwitch?.from.id === pin),
  );
  return ran ?? null;
}

export function unlistedPinName(
  settings: Pick<ChatSettings, 'provider' | 'model'>,
  capabilities: Pick<ProviderCapabilities, 'models'> | undefined,
  runs: readonly Run[],
): string | null {
  const pin = settings.model;
  if (!pin || !capabilities || capabilities.models.some((model) => model.id === pin)) return null;
  const ran = lastTurnWith(pin, settings.provider, runs);
  return modelName(capabilities.models, ran?.usedModel ?? ran?.model ?? pin);
}

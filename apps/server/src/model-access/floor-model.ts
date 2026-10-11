import { retirementOf } from '../model-cards/cards.ts';
import { modelTier, tierLadder, type TierModel } from './tiers.ts';

export const FLOOR_TIER = 1;

export function harnessModels<T extends TierModel>(
  models: readonly T[],
  provider: string,
  now: Date = new Date(),
): T[] {
  return models.filter((model) => retirementOf(model, provider, now) === null);
}

export function builderModels<T extends TierModel>(
  models: readonly T[],
  provider: string,
  now: Date,
): T[] {
  return tierLadder(harnessModels(models, provider, now), provider).filter(
    (model) => (modelTier(model, provider) ?? -1) >= FLOOR_TIER,
  );
}

export function floorModel<T extends TierModel>(
  models: readonly T[],
  provider: string,
  now: Date = new Date(),
): T | null {
  return builderModels(models, provider, now)[0] ?? null;
}

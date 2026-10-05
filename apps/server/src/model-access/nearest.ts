import type { ModelAvailability } from '@spark-outpost/contracts';
import { cardFor, FRONTIER_RANK, retirementOf } from '../model-cards/cards.ts';
import { tierInfo, type TierModel } from '../orchestration/tiers.ts';

export interface RankedModel extends TierModel {
  availability?: ModelAvailability | undefined;
}

const UNKNOWN_DISTANCE = 99;

function familyWords(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 2);
}

function sharesFamily(a: TierModel, b: TierModel): boolean {
  const words = new Set(familyWords(`${a.label} ${a.id}`));
  return familyWords(`${b.label} ${b.id}`).some((word) => words.has(word) && word !== 'gpt');
}

interface Scored<T> {
  model: T;
  known: number;
  distance: number;
  below: number;
  carded: number;
  family: number;
  order: number;
}

const SCORE_KEYS = ['known', 'distance', 'below', 'carded', 'family', 'order'] as const;

function compare<T>(a: Scored<T>, b: Scored<T>): number {
  for (const key of SCORE_KEYS) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  return 0;
}

export function nearestUsable<T extends RankedModel>(
  target: TierModel,
  pool: readonly T[],
  provider: string,
  now: Date = new Date(),
): T | null {
  const wanted = tierInfo(target, provider).tier;
  const eligible = pool.filter(
    (model) =>
      model.id !== target.id &&
      model.availability !== 'unusable' &&
      retirementOf(model, provider, now) === null,
  );
  const affordable = eligible.filter(
    (model) => wanted === FRONTIER_RANK || tierInfo(model, provider).tier !== FRONTIER_RANK,
  );
  const scored = (affordable.length > 0 ? affordable : eligible).map((model, order): Scored<T> => {
    const tier = tierInfo(model, provider).tier;
    const measurable = wanted !== null && tier !== null;
    return {
      model,
      known: model.availability === 'usable' ? 0 : 1,
      distance: measurable ? Math.abs(tier - wanted) : UNKNOWN_DISTANCE,
      below: measurable && tier > wanted ? 1 : 0,
      carded: cardFor(model, provider) ? 0 : 1,
      family: sharesFamily(target, model) ? 0 : 1,
      order,
    };
  });
  return scored.sort(compare)[0]?.model ?? null;
}

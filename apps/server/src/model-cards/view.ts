import {
  type AllowFrontier,
  type CapabilityOption,
  type ModelCardsResponse,
  type ModelStat,
  type ProviderCardsView,
  type ProviderId,
} from '@spark-outpost/contracts';
import { cardFor, VENDOR_CARDS } from './cards.ts';
import { cardText, staleness, statFor, usableStats } from './card-text.ts';

export interface ProviderSnapshot {
  provider: ProviderId;
  connected: boolean;
  doAvailable: boolean;
  models: readonly CapabilityOption[];
  defaultModel: string | null;
}

const AGENT_DEFAULT_MODEL = 'default';

function providerView(
  snapshot: ProviderSnapshot,
  allowFrontier: AllowFrontier,
  stats: readonly ModelStat[],
  now: Date,
): ProviderCardsView | null {
  const provider = VENDOR_CARDS.providers.find((card) => card.provider === snapshot.provider);
  if (!provider) return null;
  const cards = VENDOR_CARDS.cards.filter((card) => card.provider === snapshot.provider);
  const offered = snapshot.models.filter((model) => model.id !== AGENT_DEFAULT_MODEL);
  const offeredCard = (cardId: string) =>
    offered.find((model) => cardFor(model, snapshot.provider)?.id === cardId);
  const recent = usableStats(stats, now);
  const models = cards.map((card) => {
    const model = offeredCard(card.id);
    return {
      card,
      offered: model !== undefined,
      isDefault: model !== undefined && model.id === snapshot.defaultModel,
      staleness: staleness(card, now),
      jevText: cardText(card, statFor(recent, card, null), now),
      stats: stats.filter((stat) => stat.provider === card.provider && stat.model === card.id),
    };
  });
  const uncardedModels = offered
    .filter((model) => cardFor(model, snapshot.provider) === null)
    .map(({ id, label }) => ({ id, label }));
  return {
    provider: { ...provider, doMode: snapshot.doAvailable ? 'yes' : 'no' },
    connected: snapshot.connected,
    allowFrontier: allowFrontier[snapshot.provider] ?? false,
    hasFrontier: cards.some((card) => card.tier === 'frontier'),
    models,
    uncardedModels,
  };
}

export function modelCardsView(
  snapshots: readonly ProviderSnapshot[],
  allowFrontier: AllowFrontier,
  stats: readonly ModelStat[],
  now: Date,
): ModelCardsResponse {
  return {
    checkedAt: VENDOR_CARDS.checkedAt,
    providers: snapshots.flatMap(
      (snapshot) => providerView(snapshot, allowFrontier, stats, now) ?? [],
    ),
  };
}

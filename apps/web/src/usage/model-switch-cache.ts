import { shortModelLabel, type ModelCard, type PromptCacheLast } from '@spark-outpost/contracts';
import { formatTokens } from '../chat/composer/model-options.ts';
import { cacheView } from './cache-view.ts';
import { formatCost } from './format.ts';

const AGENT_DEFAULT = 'default';
const LONG_WRITE_FACTOR = 2;

export interface CacheRun {
  parentRunId?: string | null | undefined;
  startedAt: string | null;
  provider: string | null;
  model: string | null;
  usedModel?: string | null | undefined;
}

export interface ModelChoice {
  provider: string | null;
  model: string | null;
  used?: string | null;
  label?: string | null;
}

export interface SwitchNote {
  key: string;
  text: string;
}

function bareModel(model: string | null | undefined): string {
  const id = model?.trim() ?? '';
  return id === '' ? AGENT_DEFAULT : id.replace(/\[[^\]]*\]$/, '');
}

function byId(cards: readonly ModelCard[], id: string | null | undefined): ModelCard | null {
  if (!id || bareModel(id) === AGENT_DEFAULT) return null;
  const bare = bareModel(id);
  return cards.find((card) => card.match.ids.includes(id) || card.match.ids.includes(bare)) ?? null;
}

function byLabel(cards: readonly ModelCard[], label: string | null | undefined): ModelCard | null {
  const text = label?.trim();
  if (!text) return null;
  const short = shortModelLabel(text);
  return (
    cards.find((card) => card.match.labels.some((name) => name === text || name === short)) ?? null
  );
}

export function cardForChoice(cards: readonly ModelCard[], choice: ModelChoice): ModelCard | null {
  const pool = cards.filter((card) => card.provider === choice.provider);
  return byId(pool, choice.used) ?? byId(pool, choice.model) ?? byLabel(pool, choice.label);
}

export function uncachedUsd(
  card: ModelCard | null,
  tokens: number,
  ttlSeconds: PromptCacheLast['ttlSeconds'],
): number | null {
  const price = card?.price;
  if (!price) return null;
  const perMillion =
    ttlSeconds === 3600
      ? price.inputPerMillion * LONG_WRITE_FACTOR
      : (price.cacheWritePerMillion ?? price.inputPerMillion);
  return (tokens * perMillion) / 1_000_000;
}

export function cacheOwner(
  runs: readonly CacheRun[],
  last: Pick<PromptCacheLast, 'at' | 'model'> | null,
): ModelChoice | null {
  const latest = runs.findLast((entry) => !entry.parentRunId);
  if (last?.model) {
    return { provider: latest?.provider ?? null, model: last.model, used: last.model };
  }
  const at = last ? Date.parse(last.at) : Number.NaN;
  const run = runs.findLast(
    (entry) =>
      !entry.parentRunId &&
      entry.startedAt !== null &&
      (Number.isNaN(at) || Date.parse(entry.startedAt) <= at),
  );
  return run ? { provider: run.provider, model: run.model, used: run.usedModel ?? null } : null;
}

export function switchesModel(
  previous: ModelChoice | null,
  next: ModelChoice,
  cards: readonly ModelCard[],
): boolean {
  if (!previous?.provider || previous.provider !== next.provider) return false;
  const before = cardForChoice(cards, previous);
  const after = cardForChoice(cards, next);
  if (before && after) return before.id !== after.id;
  const requested = bareModel(next.model);
  if (requested === AGENT_DEFAULT) return false;
  return bareModel(previous.model) !== requested && bareModel(previous.used) !== requested;
}

export function modelSwitchNote(
  last: PromptCacheLast | null,
  previous: ModelChoice | null,
  next: ModelChoice,
  cards: readonly ModelCard[],
  now: number,
): SwitchNote | null {
  if (!last || cacheView(last, now).state !== 'warm') return null;
  if (!switchesModel(previous, next, cards)) return null;
  const usd = uncachedUsd(cardForChoice(cards, next), last.contextTokens, last.ttlSeconds);
  const cost = usd === null ? '' : ` (≈${formatCost(usd)})`;
  return {
    key: `${next.provider}:${next.model}:${last.at}`,
    text: `Next message re-sends ~${formatTokens(last.contextTokens)} tokens uncached${cost}`,
  };
}

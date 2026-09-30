import type { CardSource, VendorCardsFile } from '@spark-outpost/contracts';
import { CHECK_STALE_DAYS, FACTS_EXPIRE_DAYS, sourceAge } from './card-text.ts';
import { cardRetired } from './cards.ts';

export interface CardsCheck {
  warnings: string[];
  failures: string[];
}

interface Checked {
  id: string;
  sources: readonly CardSource[];
}

function oldestSources(entry: Checked): string {
  const oldest = entry.sources.map((source) => source.checkedAt).sort()[0];
  return entry.sources
    .filter((source) => source.checkedAt === oldest)
    .map((source) => `${source.url} (${source.checkedAt})`)
    .join(', ');
}

function sourceProblem(entry: Checked, now: Date): { failed: boolean; line: string } | null {
  const age = sourceAge(entry.sources, now);
  if (!age.checkStale) return null;
  const limit = age.factsExpired ? FACTS_EXPIRE_DAYS : CHECK_STALE_DAYS;
  return {
    failed: age.factsExpired,
    line: `${entry.id}: checked ${age.checkedDaysAgo} days ago, over ${limit}: ${oldestSources(entry)}`,
  };
}

export function checkModelCards(file: VendorCardsFile, now: Date): CardsCheck {
  const result: CardsCheck = { warnings: [], failures: [] };
  const entries = [
    ...file.providers.map((card) => ({ id: `provider ${card.provider}`, sources: card.sources })),
    ...file.cards,
  ];
  for (const entry of entries) {
    const problem = sourceProblem(entry, now);
    if (problem) (problem.failed ? result.failures : result.warnings).push(problem.line);
  }
  for (const card of file.cards) {
    if (!card.retired && cardRetired(card, now)) {
      result.warnings.push(
        `${card.id}: retired on ${card.retiresNotBefore} and already treated as retired; set "retired": true and rewrite its card in the past tense`,
      );
    }
  }
  return result;
}

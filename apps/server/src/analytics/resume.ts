import type { ResumeSavings } from '@spark-outpost/contracts';
import { cardFor } from '../model-cards/cards.ts';
import { roundTo } from './tally.ts';

export interface SessionRun {
  provider: string;
  model: string | null;
  modelLabel: string | null;
  cachedReadTokens: number | null;
  resumed: boolean;
}

export function cacheSavingUsd(run: SessionRun): number {
  if (!run.model || !run.cachedReadTokens) return 0;
  const price = cardFor({ id: run.model, label: run.modelLabel }, run.provider)?.price;
  if (!price) return 0;
  const perToken = (price.inputPerMillion - price.cachedInputPerMillion) / 1_000_000;
  return Math.max(0, run.cachedReadTokens * perToken);
}

export function resumeSavings(runs: readonly SessionRun[]): ResumeSavings {
  const resumed = runs.filter((run) => run.resumed);
  return {
    resumedRuns: resumed.length,
    sessionRuns: runs.length,
    cachedTokens: resumed.reduce((sum, run) => sum + (run.cachedReadTokens ?? 0), 0),
    savedUsd: roundTo(
      resumed.reduce((sum, run) => sum + cacheSavingUsd(run), 0),
      6,
    ),
  };
}

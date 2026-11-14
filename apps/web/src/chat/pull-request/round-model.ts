import { roundOutcomeLine, type PrWatch, type RoundOutcome } from '@spark-outpost/contracts';

export interface TurnOutcome {
  key: string;
  watch: PrWatch;
  outcome: RoundOutcome;
}

export function outcomesIn(watches: readonly PrWatch[], runIds: readonly string[]): TurnOutcome[] {
  return watches.flatMap((watch) =>
    (watch.roundOutcomes ?? [])
      .filter((outcome) => runIds.includes(outcome.runId))
      .map((outcome) => ({ key: `${watch.id}:${outcome.runId}`, watch, outcome })),
  );
}

export function turnOutcomeLine(item: TurnOutcome): string {
  return `${roundOutcomeLine(item.outcome)} on #${item.watch.number}.`;
}

export function lastOutcome(watch: PrWatch): RoundOutcome | null {
  return watch.roundOutcomes?.at(-1) ?? null;
}

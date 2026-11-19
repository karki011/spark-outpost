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

const WHY_LINE = /^Spark: (.+?), so I asked this chat to look\./;

export function roundSummary(message: string): string {
  const first = message.trimStart().split('\n', 1)[0] ?? '';
  const why = WHY_LINE.exec(first)?.[1];
  if (why) return why.charAt(0).toUpperCase() + why.slice(1);
  return first.replace(/\.$/, '');
}

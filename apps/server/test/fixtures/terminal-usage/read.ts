import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  TranscriptParser,
  TranscriptRecord,
} from '../../../src/terminal/native-transcript.ts';
import { createTurnUsage, type TurnTotals } from '../../../src/terminal/turn-usage.ts';

export function fixtureLines(name: string): string[] {
  return readFileSync(join(import.meta.dirname, name), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

export function fixtureRecords(name: string, parser: TranscriptParser): TranscriptRecord[] {
  return fixtureLines(name).flatMap((line) => parser.push(line));
}

export function turnTotals(
  provider: string,
  records: readonly TranscriptRecord[],
): Map<string | null, TurnTotals> {
  const turns = new Map<string | null, ReturnType<typeof createTurnUsage>>();
  for (const record of records) {
    if (record.kind !== 'response') continue;
    const turn = turns.get(record.turnId) ?? createTurnUsage(provider);
    turn.add(record);
    turns.set(record.turnId, turn);
  }
  return new Map(
    [...turns].flatMap(([turnId, turn]) => {
      const totals = turn.totals();
      return totals ? [[turnId, totals] as const] : [];
    }),
  );
}

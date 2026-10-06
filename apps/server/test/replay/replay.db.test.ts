import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { HarnessSetting } from '@spark-outpost/contracts';
import { REPLAY_CASES } from './replay-cases.ts';
import { replayTable, type ReplayRow } from './replay-metrics.ts';
import { runReplay } from './replay-support.ts';

const SETTINGS: readonly HarnessSetting[] =
  process.env.REPLAY_HARNESS === 'simple' ? ['simple'] : ['current'];
const ONLY = process.env.REPLAY_CASE ?? null;
const rows: ReplayRow[] = [];

afterAll(() => {
  if (rows.length === 0) return;
  const table = replayTable(rows);
  console.log(`\n${table}\n`);
  if (process.env.REPLAY_TABLE) writeFileSync(process.env.REPLAY_TABLE, `${table}\n`);
});

describe.each(SETTINGS)('replay under HARNESS=%s', (harness) => {
  const cases = REPLAY_CASES.filter((replay) => ONLY === null || replay.id === ONLY);

  it.each(cases)(
    '$title: the export reproduces the run and session counts',
    async (replay) => {
      const result = await runReplay(replay, harness);
      try {
        const { row, ledger } = result;
        rows.push(row);
        expect(row.turns).toBe(replay.turns.length);
        expect(row.runs).toBe(ledger.agentRuns);
        expect(row.opened + row.replaced).toBe(ledger.sessionsNew);
        expect(row.resumed).toBe(ledger.sessionsResumed);
      } finally {
        await result.cleanup();
      }
    },
    300_000,
  );
});

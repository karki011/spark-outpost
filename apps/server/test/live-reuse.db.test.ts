import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startReuseHarness,
  type Level,
  type ReuseHarness,
  type TurnKind,
  type TurnMeasure,
} from './live-reuse-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { connectAgents } from './turn-worker.ts';

const store = mkdtempSync(join(tmpdir(), 'live-reuse-'));
afterAll(() => rmSync(store, { recursive: true, force: true }));

let t: TestDb;
let harness: ReuseHarness;

beforeEach(async () => {
  t = await createTestDb();
  await connectAgents(t);
  harness = await startReuseHarness(t, store);
});

afterEach(async () => {
  await harness.stop();
  await t.cleanup();
});

async function sequence(kinds: readonly TurnKind[], level: Level): Promise<TurnMeasure[]> {
  const conversationId = await harness.chat(level);
  const measured: TurnMeasure[] = [];
  for (const kind of kinds) measured.push(await harness.run(conversationId, kind, level));
  const report = process.env.SPARK_REUSE_REPORT;
  if (report) {
    const rows = measured.map(
      (turn) =>
        `${turn.kind.padEnd(8)} ${turn.reused ? 'reused  ' : 'reopened'} first ${String(turn.firstEventMs).padStart(5)} ms  done ${String(turn.doneMs).padStart(5)} ms`,
    );
    appendFileSync(report, `REUSE ${level} ${kinds.join(',')}\n${rows.join('\n')}\n`);
  }
  return measured;
}

const reused = (turns: readonly TurnMeasure[]) => turns.map((turn) => turn.reused);

describe.each(['hands-off', 'full-auto'] as const)(
  'which turn kinds reuse the live agent session of a chat at %s',
  (level) => {
    it('reuses it across plain user turns', async () => {
      expect(reused(await sequence(['user', 'user', 'user'], level))).toEqual([false, true, true]);
    });

    it('after a follow-up round', async () => {
      expect(reused(await sequence(['user', 'relay', 'user'], level))).toEqual(
        level === 'hands-off' ? [false, false, false] : [false, true, true],
      );
    });

    it('after an outpost request', async () => {
      expect(reused(await sequence(['user', 'outpost', 'user'], level))).toEqual([
        false,
        true,
        true,
      ]);
    });

    it('after a publish request', async () => {
      expect(reused(await sequence(['user', 'push', 'user'], level))).toEqual(
        level === 'hands-off' ? [false, false, false] : [false, true, true],
      );
    });
  },
  120_000,
);

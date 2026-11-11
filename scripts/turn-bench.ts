import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { startDetailReader } from './turn-bench/detail.ts';
import { startBenchSession, type BenchSession, type TurnMeasure } from './turn-bench/session.ts';
import { formatTable, summarize, type Summary } from './turn-bench/stats.ts';
import { isTestDatabase } from '../apps/server/src/persistence/startup-backup.ts';

const STEPS_PER_TURN = 4;
const progress = (line: string) => {
  if (process.stderr.isTTY) process.stderr.write(line);
};

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '5' },
    out: { type: 'string' },
    ladder: { type: 'string', default: '1,10,50' },
  },
});

const runs = Number(values.runs);
const ladder = values.ladder!.split(',').map(Number);
if (!Number.isInteger(runs) || runs < 1)
  throw new Error('--runs needs a whole number of 1 or more.');
if (ladder.some((size) => !Number.isInteger(size) || size < 1)) {
  throw new Error('--ladder needs whole numbers such as 1,10,50.');
}

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !isTestDatabase(testUrl)) {
  throw new Error('TEST_DATABASE_URL must name a *_test database.');
}
process.env.DATABASE_URL = testUrl;

interface DetailResult {
  turns: number;
  ms: number[];
  bytes: number;
}

async function measureTurns(session: BenchSession) {
  const first: TurnMeasure[] = [];
  const second: TurnMeasure[] = [];
  const warm = await session.chat();
  await session.turn(warm, 'warm up');
  await session.turn(warm, 'warm up again');
  for (let run = 0; run < runs; run++) {
    const conversationId = await session.chat();
    first.push(await session.turn(conversationId, 'first message'));
    second.push(await session.turn(conversationId, 'second message'));
    progress(`turns ${run + 1}/${runs}\r`);
  }
  return { first, second };
}

async function measureDetail(session: BenchSession): Promise<DetailResult[]> {
  const reader = await startDetailReader(session.t);
  try {
    const results: DetailResult[] = [];
    for (const turns of ladder) {
      const conversationId = await session.chat();
      for (let turn = 1; turn <= turns; turn++) {
        await session.turn(conversationId, `turn ${turn} #steps ${STEPS_PER_TURN}`);
        progress(`seeding ${turns}: ${turn}/${turns}\r`);
      }
      await reader.read(conversationId);
      const reads = [];
      for (let read = 0; read < runs; read++) reads.push(await reader.read(conversationId));
      results.push({
        turns,
        ms: reads.map((entry) => entry.ms),
        bytes: reads[reads.length - 1]!.bytes,
      });
    }
    return results;
  } finally {
    await reader.close();
  }
}

const cell = (summary: Summary) => [summary.median.toFixed(1), summary.p90.toFixed(1)];

function report(
  first: readonly TurnMeasure[],
  second: readonly TurnMeasure[],
  detail: readonly DetailResult[],
): string {
  const reusedCount = (turns: readonly TurnMeasure[]) =>
    `${turns.filter((turn) => turn.reused).length}/${turns.length}`;
  const turnRows = [
    ['first turn', first],
    ['second turn', second],
  ].map(([label, turns]) => {
    const measured = turns as TurnMeasure[];
    return [
      label as string,
      ...cell(summarize(measured.map((turn) => turn.firstTextMs))),
      ...cell(summarize(measured.map((turn) => turn.doneMs))),
      reusedCount(measured),
    ];
  });
  const detailRows = detail.map((entry) => [
    String(entry.turns),
    ...cell(summarize(entry.ms)),
    String(entry.bytes),
  ]);
  return [
    `Turn timings, ms (${runs} runs)`,
    formatTable(['turn', 'first text p50', 'p90', 'done p50', 'p90', 'session reused'], turnRows),
    '',
    `Chat detail read, ${STEPS_PER_TURN} tool steps per turn (${runs} reads)`,
    formatTable(['finished turns', 'ms p50', 'p90', 'bytes'], detailRows),
  ].join('\n');
}

const session = await startBenchSession();
let failed = false;
try {
  const { first, second } = await measureTurns(session);
  const detail = await measureDetail(session);
  console.log(report(first, second, detail));
  if (values.out) {
    await mkdir(dirname(values.out), { recursive: true });
    const summary = {
      startedAt: new Date().toISOString(),
      node: process.version,
      runs,
      ladder,
      stepsPerTurn: STEPS_PER_TURN,
      turns: { first, second },
      detail,
    };
    await writeFile(values.out, `${JSON.stringify(summary, null, 2)}\n`);
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await session.stop();
}
process.exit(failed ? 1 : 0);

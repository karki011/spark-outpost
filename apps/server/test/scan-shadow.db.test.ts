import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { createCodeScanner, type CodeScanner } from '../src/codescan/scanner.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import {
  SCENARIOS,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const NORMAL = SCENARIOS[2] as Scenario;
const QUESTION = SCENARIOS[0] as Scenario;

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await writeFile(
    join(root, 'divider.ts'),
    'export function dayDivider(at: number) { return at; }\n',
  );
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

afterAll(async () => {
  await stopParseWorker();
});

interface ScanRow {
  jev_status: string;
  role: string | null;
  body: { summary: string; latencyMs: number; answer: Record<string, unknown> };
}

async function scanRows(runId: string): Promise<ScanRow[]> {
  const { rows } = await t.db.query<ScanRow>(
    `SELECT jev_status, role, body FROM run_advice WHERE run_id = $1 AND purpose = 'scan'`,
    [runId],
  );
  return rows;
}

async function runScenario(codeScan: CodeScanner, scenario: Scenario) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario }), { codeScan });
  const { conversationId, runId } = await startScenario(t, root, scenario, 'full-auto');
  const { orchestration } = await driveToEnd(t, conversationId, runId);
  return { orchestration, runId };
}

describe('code scan in shadow mode', { timeout: 60_000 }, () => {
  it('records the scan next to a Do task without changing the task', async () => {
    const scanner = createCodeScanner(t.db, { deadlineMs: 10_000 });
    const { orchestration, runId } = await runScenario(scanner, NORMAL);
    await scanner.idle();
    expect(orchestration.status).toBe('succeeded');
    const [row] = await scanRows(runId);
    expect(row).toMatchObject({ jev_status: 'not_asked', role: null });
    expect(row?.body.summary).toMatch(/^Code scan ranked \d+ files in \d+ ms/);
    expect(row?.body.answer).toMatchObject({
      observation: true,
      status: 'done',
      error: null,
      candidates: expect.any(Number),
      topFiles: expect.any(Array),
      jevState: { tokens: expect.any(Number), files: expect.any(Number) },
    });
    const view = await loadOrchestration(t.db, runId);
    expect(view?.decisions.map((decision) => decision.kind)).not.toContain('scan');
  });

  it('records a failed scan and still finishes the task', async () => {
    const failing: CodeScanner = {
      scan: () => Promise.reject(new Error('disk on fire')),
      ensureIndexed: () => Promise.resolve(null),
      idle: () => Promise.resolve(),
    };
    const { orchestration, runId } = await runScenario(failing, NORMAL);
    expect(orchestration.status).toBe('succeeded');
    const [row] = await scanRows(runId);
    expect(row?.body.answer).toMatchObject({ status: 'failed', error: 'disk on fire' });
  });

  it('does not scan for a question', async () => {
    let scans = 0;
    const counting: CodeScanner = {
      ...createCodeScanner(t.db),
      scan: (...args) => {
        scans += 1;
        return createCodeScanner(t.db).scan(...args);
      },
    };
    const { runId } = await runScenario(counting, QUESTION);
    expect(scans).toBe(0);
    expect(await scanRows(runId)).toEqual([]);
  });
});

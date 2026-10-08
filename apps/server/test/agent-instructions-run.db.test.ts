import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { updateProfile } from '../src/persistence/setup.ts';
import {
  TRIVIAL,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const NOTE = 'Instruction file could not be read: it was moved or deleted. Went on without it.';

let t: TestDb;
let root: string;
let store: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

async function stepNames(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ name: string }>(
    `SELECT payload ->> 'stepName' AS name FROM run_events
     WHERE run_id = $1 AND type = 'STEP_STARTED' ORDER BY seq`,
    [runId],
  );
  return rows.map((row) => row.name);
}

it(
  'runs a chat without a removed instruction file and notes it once',
  { timeout: 60_000 },
  async () => {
    const file = join(store, 'instructions.md');
    writeFileSync(file, 'Use tests.');
    await updateProfile(t.db, t.workspaceId, { agentInstructionsFile: file });
    unlinkSync(file);
    harness = startOrchestrator(t, jevFetch({ calls: [], scenario: TRIVIAL }), { sessions: store });
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    expect((await stepNames(runId)).filter((name) => name === NOTE)).toEqual([NOTE]);
  },
);

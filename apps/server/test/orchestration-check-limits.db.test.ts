import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckBody } from '@spark-outpost/contracts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { requestCancel } from '../src/persistence/runs.ts';
import { recoverExpiredLeases } from '../src/workflow/recovery.ts';
import {
  TRIVIAL,
  artifactBodies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  setCheckCommands,
  startOrchestrator,
  startScenario,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const FAILS_UNTIL_FIXED = `import { existsSync, readFileSync } from 'node:fs';
if (readFileSync('notes.txt', 'utf8').includes('step') && !existsSync('fixed.txt')) {
  console.error('expected fixed.txt to exist');
  process.exit(1);
}
`;

const REGISTRY_LOGIN = `console.error('npm error code E401');
console.error('npm error Unable to authenticate, need: Basic realm="registry"');
process.exit(1);
`;

let t: TestDb;
let root: string;
let store: string;
let marker: string;
let harness: Harness | null = null;

const slowCheck = () => `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'started');
await new Promise((resolve) => setTimeout(resolve, 60_000));
`;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  marker = join(store, 'check-started');
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

async function begin(files: Record<string, string>, commands: string[], checkTimeoutMs?: number) {
  for (const [file, text] of Object.entries(files)) await writeFile(join(root, file), text);
  await setCheckCommands(t, root, commands);
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: TRIVIAL }), {
    sessions: store,
    ...(checkTimeoutMs ? { checkTimeoutMs } : {}),
  });
  return startScenario(t, root, TRIVIAL, 'full-auto');
}

async function builders(runId: string): Promise<number> {
  const { rows } = await t.db.query(
    `SELECT id FROM runs WHERE parent_run_id = $1 AND role = 'builder'`,
    [runId],
  );
  return rows.length;
}

const bodies = () => artifactBodies<CheckBody>(t, 'check');
const checkStarted = () => eventually(async () => existsSync(marker) || null, 30_000);

describe('checks that cannot say anything about the change', { timeout: 120_000 }, () => {
  it('reports a check that ran out of time once and never sends the Builder back for it', async () => {
    const { conversationId, runId } = await begin(
      { 'slow.mjs': slowCheck(), 'check.mjs': FAILS_UNTIL_FIXED },
      ['node slow.mjs', 'node check.mjs'],
      1_500,
    );
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    const rounds = await bodies();
    expect(rounds.map((body) => body.status)).toEqual(['failed', 'passed']);
    expect(rounds[0]!.results.map((result) => [result.outcome, result.cause ?? null])).toEqual([
      ['timed_out', 'timeout'],
      ['failed', 'change'],
    ]);
    expect(rounds[0]!.results[0]!.note).toContain('not counted against this change');
    expect(rounds[1]!.results.map((result) => result.outcome)).toEqual(['skipped', 'passed']);
    expect(rounds[1]!.results[0]!.note).toContain('not run again');
    expect(await builders(runId)).toBe(2);
  });

  it('does not start a Builder round when only a timeout is left', async () => {
    const { conversationId, runId } = await begin(
      { 'slow.mjs': slowCheck() },
      ['node slow.mjs'],
      1_500,
    );
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    const rounds = await bodies();
    expect(rounds.map((body) => body.status)).toEqual(['skipped']);
    expect(await builders(runId)).toBe(1);
  });

  it('names a registry login or a missing tool as setup, not as a failure of the change', async () => {
    const { conversationId, runId } = await begin({ 'registry.mjs': REGISTRY_LOGIN }, [
      'node registry.mjs',
      'spark-no-such-tool --version',
    ]);
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    const [round] = await bodies();
    expect(round!.status).toBe('skipped');
    expect(round!.results.map((result) => result.cause)).toEqual(['environment', 'environment']);
    expect(round!.results[0]!.note).toContain('Run `npm login`');
    expect(round!.results[1]!.note).toContain('`spark-no-such-tool` was not found');
    expect(await builders(runId)).toBe(1);
  });

  it('stops a running check when the run is stopped, and records no round', async () => {
    const { conversationId, runId } = await begin({ 'slow.mjs': slowCheck() }, ['node slow.mjs']);
    await checkStarted();
    const stopped = Date.now();
    await requestCancel(t.db, runId);
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('cancelled');
    expect(Date.now() - stopped).toBeLessThan(20_000);
    expect(await bodies()).toEqual([]);
    expect(await builders(runId)).toBe(1);
  });

  it('counts nothing against the change when the app restarts in the middle of a check', async () => {
    const { runId } = await begin({ 'slow.mjs': slowCheck() }, ['node slow.mjs']);
    await checkStarted();
    await t.db.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second'`);
    await recoverExpiredLeases(t.db);
    const orchestration = await eventually(async () => {
      const view = await loadOrchestration(t.db, runId);
      return view?.status === 'outcome_unknown' ? view : null;
    });
    expect(orchestration.phase).toBe('finished');
    await harness?.stop();
    harness = null;
    expect(await bodies()).toEqual([]);
    expect(await builders(runId)).toBe(1);
  });
});

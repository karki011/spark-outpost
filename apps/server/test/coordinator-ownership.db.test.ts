import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InvolvementLevel, PieceList } from '@spark-outpost/contracts';
import { BUILDER_GIT_REASON } from '../src/approvals/piece-guard.ts';
import { currentPieceList } from '../src/persistence/pieces.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { PIECE_CHECK_SCRIPT } from './fake-acp-coordinator.ts';
import {
  NORMAL,
  answerEverything,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  withTag,
  type Answerer,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await writeFile(join(root, 'piece-check.mjs'), PIECE_CHECK_SCRIPT);
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function build(
  tags: string,
  level: InvolvementLevel,
  answer: Answerer = answerEverything,
  prepare?: () => Promise<void>,
) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL }), {
    coordinator: 'in_order',
  });
  const scenario = withTag(NORMAL, `Split this up. #pieces ${tags}`);
  const { conversationId, runId } = await startScenario(
    t,
    root,
    scenario,
    level,
    'auto',
    'sonnet',
    'acceptEdits',
    prepare,
  );
  const done = await driveToEnd(t, conversationId, runId, answer, 90_000);
  const view = await loadOrchestration(t.db, runId);
  const list = (await currentPieceList(t.db, view!.taskId!)) as PieceList;
  return { ...done, runId, list };
}

async function refusals(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ reason: string }>(
    `SELECT a.reason FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.parent_run_id = $1 AND a.status = 'denied' AND a.decided_by = 'policy'`,
    [runId],
  );
  return rows.map((row) => row.reason);
}

describe('ownership and git guards', { timeout: 120_000 }, () => {
  it('refuses a Builder’s edit to a file another piece owns', async () => {
    const { orchestration, runId, list } = await build('#strayedit', 'hands-off');
    expect(orchestration.status).toBe('succeeded');
    expect(await refusals(runId)).toEqual([
      expect.stringMatching(
        /^Tack \(P3\) owns `view.ts`; this piece \(Rivet \(P2\)\) owns `api.ts`/,
      ),
    ]);
    expect(await readFile(join(root, 'view.ts'), 'utf8')).toBe('built by P3\n');
    expect(list.pieces.every((piece) => piece.status === 'landed')).toBe(true);
  });

  it('lets a piece install packages when it has the tree to itself', async () => {
    const { orchestration, runId } = await build('#addpkg', 'hands-off');
    expect(orchestration.status).toBe('succeeded');
    expect(await refusals(runId)).toEqual([]);
    const { rows } = await t.db.query<{ status: string }>(
      `SELECT a.status FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.parent_run_id = $1 AND a.title = 'pnpm add left-pad'`,
      [runId],
    );
    expect(rows).toEqual([{ status: 'allowed' }]);
  });

  it('refuses git stash to a piece Builder', async () => {
    const { runId } = await build('#gitstash', 'hands-off');
    expect(await refusals(runId)).toEqual([BUILDER_GIT_REASON]);
  });

  it('reverts a shell write to another piece’s file and says so in the report', async () => {
    const { runId, list } = await build('#shellwrite', 'hands-off');
    expect(list.pieces[1]!.violations).toEqual([
      { path: 'view.ts', action: 'reverted', owner: 'Tack (P3)' },
    ]);
    expect(list.pieces[1]!.filesChanged).toEqual(['api.ts']);
    expect(await readFile(join(root, 'view.ts'), 'utf8')).toBe('built by P3\n');
    const reply = (await assistantReplies(t, runId)).at(-1);
    expect(reply).toContain('`view.ts` reverted (P2, Tack (P3) owns it)');
  });

  it('moves a shell write to a file no piece owns into the piece at Automatic', async () => {
    const { list } = await build('#shellstray', 'hands-off');
    expect(list.pieces[1]).toMatchObject({
      violations: [{ path: 'stray.ts', action: 'moved', owner: null }],
      owns: ['api.ts', 'stray.ts'],
    });
    expect(await readFile(join(root, 'stray.ts'), 'utf8')).toBe('shell stray\n');
  });

  it('gives each Builder its slot and name in its environment and its checks', async () => {
    await writeFile(
      join(root, 'piece-check.mjs'),
      `${PIECE_CHECK_SCRIPT}\nimport { appendFileSync } from 'node:fs';\nappendFileSync('env.log', process.env.SPARK_BUILDER_SLOT + ' ' + process.env.SPARK_BUILDER_NAME + ' ' + process.env.TEST_DATABASE_URL + '\\n');\n`,
    );
    const perBuilder = async () => {
      await t.db.query(`UPDATE projects SET builder_env = $1 WHERE root_path = $2`, [
        JSON.stringify({ TEST_DATABASE_URL: 'postgres://x/test_b{slot}' }),
        root,
      ]);
    };
    const { orchestration } = await build('', 'hands-off', answerEverything, perBuilder);
    expect(orchestration.status).toBe('succeeded');
    expect((await readFile(join(root, 'env.log'), 'utf8')).trim().split('\n')).toEqual([
      '1 Bolt postgres://x/test_b1',
      '1 Rivet postgres://x/test_b1',
      '1 Tack postgres://x/test_b1',
    ]);
  });
});

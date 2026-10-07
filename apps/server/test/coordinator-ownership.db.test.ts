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
  it.each([
    ['#strayedit', 'edited by P2\nbuilt by P3\nnoted\n'],
    ['#shellwrite', 'shell write by P2\nbuilt by P3\nnoted\n'],
  ])(
    'flags a change to another piece’s file, keeps it and tells the owner: %s',
    async (tag, kept) => {
      const { orchestration, runId, list } = await build(tag, 'hands-off');
      expect(orchestration.status).toBe('succeeded');
      expect(list.pieces.every((piece) => piece.status === 'landed')).toBe(true);
      expect(await refusals(runId)).toEqual([]);
      expect(await readFile(join(root, 'view.ts'), 'utf8')).toBe(kept);
      expect(list.pieces[1]!.violations).toEqual([
        { path: 'view.ts', action: 'kept', owner: 'Tack (P3)' },
      ]);
      const flags = await t.db.query<{ rail: string; title: string; status: string; role: string }>(
        `SELECT f.rail, f.title, f.status, r.route->>'pieceKey' AS role FROM rail_flags f
         JOIN runs r ON r.id = f.run_id WHERE r.parent_run_id = $1`,
        [runId],
      );
      expect(flags.rows).toEqual([
        {
          rail: 'other_piece',
          title: 'Rivet changed a file another piece owns: view.ts',
          status: 'open',
          role: 'P2',
        },
      ]);
      const audit = await t.db.query<{ paths: string[] }>(
        `SELECT l.payload->'paths' AS paths FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
         WHERE r.parent_run_id = $1 AND l.method = 'spark/rail_crossed'`,
        [runId],
      );
      expect(audit.rows).toEqual([{ paths: ['view.ts'] }]);
      const owner = await t.db.query<{ prompt: string }>(
        `SELECT prompt FROM runs WHERE parent_run_id = $1 AND route->>'pieceKey' = 'P3'`,
        [runId],
      );
      expect(owner.rows[0]!.prompt).toContain(
        'Rivet (P2) changed `view.ts`, which your piece owns',
      );
      const reply = (await assistantReplies(t, runId)).at(-1);
      expect(reply).toContain('`view.ts` kept (P2, Tack (P3) owns it)');
    },
  );

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

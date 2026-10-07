import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pieceGuardSchema } from '../src/approvals/piece-guard.ts';
import { pieceReport } from '../src/coordinator/report.ts';
import { currentPieceList, insertPieceList } from '../src/persistence/pieces.ts';
import { seedConversation, seedTask, seedTurn } from './outcome-seed.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

describe('a piece list stored before pieces shared one tree in every mode', () => {
  it('loads and reports its worktree placement and its reverted change', async () => {
    const conversationId = await seedConversation(t.db, t.workspaceId);
    const taskId = await seedTask(t.db, conversationId);
    const runId = await seedTurn(t.db, conversationId, { taskId, status: 'succeeded' });
    const stored = await insertPieceList(t.db, {
      taskId,
      orchestrationRunId: runId,
      planDocumentId: null,
      planVersion: null,
      piecesHash: 'hash',
      placement: 'worktree',
      placementReason:
        "the agent's mode runs without the approval gate, so each piece works in its own copy",
      integration: null,
      approvedBy: 'level',
      pieces: [
        {
          key: 'P1',
          title: 'Store',
          goal: 'Add the store',
          owns: ['store.ts'],
          reads: [],
          dependsOn: [],
          contract: null,
          acceptance: [],
          checks: [],
          research: false,
          sizeEstimate: 1_000,
          placement: 'worktree',
          provider: 'claude',
          model: 'sonnet',
          pickNote: null,
        },
      ],
    });
    await t.db.query(
      `UPDATE task_pieces SET status = 'landed', landed_at = now(), files_changed = '{store.ts}',
         violations = $2::jsonb WHERE id = $1`,
      [
        stored.pieces[0]!.id,
        JSON.stringify([{ path: 'view.ts', action: 'reverted', owner: 'Tack (P2)' }]),
      ],
    );
    const list = await currentPieceList(t.db, taskId);
    expect(list).toMatchObject({ placement: 'worktree' });
    expect(list!.pieces[0]).toMatchObject({
      placement: 'worktree',
      status: 'landed',
      violations: [{ path: 'view.ts', action: 'reverted', owner: 'Tack (P2)' }],
    });
    const report = pieceReport({ list, fallback: null, integrator: null })!;
    expect(report).toContain('Pieces (1, in worktrees, list v1):');
    expect(report).toContain('`view.ts` reverted (P1, Tack (P2) owns it)');
  });

  it('still reads a stored run guard that says the piece shared its tree', () => {
    const guard = pieceGuardSchema.parse({
      coordinated: true,
      sharesTree: true,
      owned: { key: 'P1', name: 'Bolt', paths: ['store.ts'], globs: [], others: [] },
    });
    expect(guard.owned?.paths).toEqual(['store.ts']);
  });
});

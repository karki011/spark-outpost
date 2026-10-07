import { describe, expect, it } from 'vitest';
import type { PieceList, TaskPiece } from '@spark-outpost/contracts';
import { pieceReport } from './report.ts';

function piece(key: string, extra: Partial<TaskPiece> = {}): TaskPiece {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    key,
    title: `Piece ${key}`,
    goal: 'Goal',
    owns: [`${key}.ts`],
    reads: [],
    dependsOn: [],
    contract: null,
    contractVersion: 1,
    acceptance: [],
    checks: [],
    research: false,
    sizeEstimate: 20_000,
    placement: 'in_order',
    provider: 'claude',
    model: 'sonnet',
    builderRunId: null,
    builderName: 'Bolt',
    status: 'landed',
    attempts: 1,
    fixTurns: 0,
    filesChanged: [`${key}.ts`],
    violations: [],
    check: 'passed',
    costUsd: 0.25,
    landedAt: null,
    note: null,
    notesQueued: 0,
    pickNote: null,
    ...extra,
  };
}

function list(pieces: TaskPiece[], integration: string | null = null): PieceList {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    taskId: '00000000-0000-4000-8000-000000000003',
    version: 2,
    planVersion: null,
    piecesHash: 'hash',
    placement: 'in_order',
    placementReason: 'in order',
    status: 'approved',
    integration,
    pieces,
    createdAt: '2026-09-29T00:00:00.000Z',
  };
}

describe('pieceReport', () => {
  it('builds a table of pieces, the integration step and what did not land', () => {
    const report = pieceReport({
      list: list(
        [
          piece('P1'),
          piece('P2', {
            builderName: 'Rivet',
            check: 'failed',
            fixTurns: 2,
            violations: [
              { path: 'stray.ts', action: 'moved', owner: null },
              { path: 'P3.ts', action: 'reverted', owner: 'P3' },
            ],
          }),
          piece('P3', {
            builderName: null,
            status: 'failed',
            filesChanged: [],
            check: null,
            costUsd: null,
            note: 'Provider | crashed',
          }),
        ],
        'Wire the route',
      ),
      fallback: null,
      integrator: 'Weld',
    })!;
    expect(report).toContain('Pieces (3, in order, list v2):');
    expect(report).toContain(
      '| P1 · Piece P1 | Bolt | in order | claude · sonnet | landed | 1 | passed | $0.25 |',
    );
    expect(report).toContain(
      '| P2 · Piece P2 | Rivet | in order | claude · sonnet | landed | 1 | failed after 2 fix turns | $0.25 |',
    );
    expect(report).toContain(
      '| P3 · Piece P3 | — | in order | claude · sonnet | failed | 0 | none | — |',
    );
    expect(report).toContain('Integration: Weld — Wire the route');
    expect(report).toContain(
      'Changes outside a piece: `stray.ts` moved (P2); `P3.ts` reverted (P2, P3 owns it).',
    );
    expect(report).toContain('Incomplete: P3 · Piece P3 (failed: Provider \\| crashed).');
  });

  it('marks a docs-only piece without a check', () => {
    const report = pieceReport({
      list: list([piece('P1', { owns: ['README.md'], filesChanged: ['README.md'], check: null })]),
      fallback: null,
      integrator: null,
    })!;
    expect(report).toContain(
      '| P1 · Piece P1 | Bolt | in order | claude · sonnet | landed | 1 | none — docs only | $0.25 |',
    );
  });

  it('still words a stored list that was placed in worktrees', () => {
    const report = pieceReport({
      list: { ...list([piece('P1', { placement: 'worktree' })]), placement: 'worktree' },
      fallback: null,
      integrator: null,
    })!;
    expect(report).toContain('Pieces (1, in worktrees, list v2):');
  });

  it('says why the coordinator fell back to one Builder', () => {
    expect(pieceReport({ list: null, fallback: 'the list had a cycle', integrator: null })).toBe(
      'Coordinator: built with one Builder instead (the list had a cycle).',
    );
    expect(pieceReport({ list: null, fallback: null, integrator: null })).toBeNull();
  });
});

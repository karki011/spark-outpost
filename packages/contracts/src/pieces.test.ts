import { describe, expect, it } from 'vitest';
import { pieceStatusSchema, placementLabel, taskPieceSchema, type TaskPiece } from './pieces.ts';

function piece(key: string, extra: Partial<TaskPiece> = {}): TaskPiece {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    key,
    title: `Piece ${key}`,
    goal: 'Goal',
    owns: ['a.ts', 'b.ts'],
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
    builderName: null,
    status: 'pending',
    attempts: 0,
    fixTurns: 0,
    filesChanged: [],
    violations: [],
    check: null,
    costUsd: null,
    landedAt: null,
    note: null,
    notesQueued: 0,
    pickNote: null,
    ...extra,
  };
}

describe('a stored piece', () => {
  it('names where it ran and still reads a piece the user stopped', () => {
    expect(pieceStatusSchema.parse('stopped')).toBe('stopped');
    expect(taskPieceSchema.parse(piece('P1', { status: 'stopped' })).status).toBe('stopped');
    expect(placementLabel(piece('P3', { placement: 'shared' }))).toBe('shared tree · owns 2 files');
    expect(placementLabel(piece('P4', { placement: 'worktree', builderName: 'Tack' }))).toBe(
      "Tack's copy",
    );
    expect(placementLabel(piece('R1', { placement: 'read_only' }))).toBe('read-only');
    expect(placementLabel(piece('P1'))).toBe('in order');
  });
});

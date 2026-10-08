import { describe, expect, it } from 'vitest';
import { pieceBoard, pieceStatusSchema, type TaskPiece } from './pieces.ts';

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

describe('pieceBoard', () => {
  it('shows what each piece waits on, its placement and folds landed rows', () => {
    const rows = pieceBoard({
      pieces: [
        piece('P1', { status: 'landed', builderName: 'Bolt', check: 'passed', costUsd: 0.4 }),
        piece('P2', {
          dependsOn: ['P1'],
          status: 'running',
          builderName: 'Rivet',
          notesQueued: 2,
        }),
        piece('P3', { dependsOn: ['P1', 'P2'], placement: 'shared' }),
        piece('P4', { placement: 'worktree', builderName: 'Tack' }),
        piece('R1', { placement: 'read_only', research: true, owns: [] }),
      ],
    });
    expect(rows.map((row) => [row.key, row.status, row.placement, row.folded])).toEqual([
      ['P1', 'landed', 'in order', true],
      ['P2', 'running', 'in order', false],
      ['P3', 'waiting on P2', 'shared tree · owns 2 files', false],
      ['P4', 'ready', "Tack's copy", false],
      ['R1', 'ready', 'read-only', false],
    ]);
    expect(rows[0]).toMatchObject({ builder: 'Bolt', check: 'scoped check passed', tone: 'done' });
    expect(rows.map((row) => row.notes)).toEqual([null, '2 notes queued', null, null, null]);
  });

  it('keeps the reason only for a piece that failed or was skipped', () => {
    const rows = pieceBoard({
      pieces: [
        piece('P1', { status: 'failed', note: 'scoped check failed twice' }),
        piece('P2', { status: 'skipped', note: 'skipped by you' }),
        piece('P3', { status: 'running', note: 'stale' }),
      ],
    });
    expect(rows.map((row) => [row.status, row.note])).toEqual([
      ['failed', 'scoped check failed twice'],
      ['skipped', 'skipped by you'],
      ['running', null],
    ]);
  });

  it('shows a piece the user stopped as stopped, not failed', () => {
    expect(pieceStatusSchema.parse('stopped')).toBe('stopped');
    const rows = pieceBoard({
      pieces: [piece('P1', { status: 'stopped', note: 'You stopped the run.' })],
    });
    expect(rows[0]).toMatchObject({
      status: 'stopped',
      tone: 'stopped',
      note: 'You stopped the run.',
      folded: false,
    });
  });
});

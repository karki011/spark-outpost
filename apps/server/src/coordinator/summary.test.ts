import { describe, expect, it } from 'vitest';
import type { PieceList, TaskPiece } from '@spark-outpost/contracts';
import type { MemberResult } from '../orchestration/session.ts';
import type { Coordination } from './state.ts';
import { piecesSummary } from './summary.ts';

function piece(key: string, extra: Partial<TaskPiece>): TaskPiece {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    key,
    title: `Piece ${key}`,
    goal: `Goal of ${key}`,
    owns: [],
    reads: [],
    dependsOn: [],
    contract: null,
    contractVersion: 1,
    acceptance: [],
    checks: [],
    research: false,
    sizeEstimate: 1_000,
    placement: 'in_order',
    provider: 'claude',
    model: 'sonnet',
    builderRunId: null,
    builderName: null,
    status: 'landed',
    attempts: 1,
    fixTurns: 0,
    filesChanged: [],
    violations: [],
    check: 'passed',
    costUsd: 0.1,
    landedAt: null,
    note: null,
    notesQueued: 0,
    pickNote: null,
    ...extra,
  };
}

function coordination(pieces: TaskPiece[]): Coordination {
  const list: PieceList = {
    id: '00000000-0000-4000-8000-000000000002',
    taskId: '00000000-0000-4000-8000-000000000003',
    version: 1,
    planVersion: null,
    piecesHash: 'hash',
    placement: 'in_order',
    placementReason: 'in order',
    status: 'approved',
    integration: null,
    pieces,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
  return { list } as Coordination;
}

function reply(role: MemberResult['role'], runId: string, name: string, text: string) {
  return { role, runId, name, text, outcome: 'succeeded' as const, inPlace: false };
}

const C2_PIECES = [
  piece('P1', {
    title: 'CSV export of uploads',
    builderRunId: 'run-bolt',
    builderName: 'Bolt',
    filesChanged: ['src/csv-export.ts', 'test/csv-export.test.ts'],
  }),
  piece('P2', {
    title: 'Fixed-window rate limiter',
    builderRunId: 'run-rivet',
    builderName: 'Rivet',
    filesChanged: ['src/rate-limit.ts', 'test/rate-limit.test.ts'],
  }),
  piece('P3', {
    title: 'README lists the new modules',
    goal: 'Update README.md to list both modules',
    builderRunId: 'run-tack',
    builderName: 'Tack',
    filesChanged: ['README.md'],
    check: 'none',
  }),
];

describe('piecesSummary', () => {
  it('gives every piece one line with what changed and its files, then later turns', () => {
    const summary = piecesSummary(coordination(C2_PIECES), [
      reply('coordinator', 'run-atlas', 'Atlas', 'Here is the split.'),
      reply(
        'builder',
        'run-bolt',
        'Bolt',
        '**Added `uploadsToCsv`** with RFC 4180 quoting. Five tests cover it.',
      ),
      reply('builder', 'run-rivet', 'Rivet', '## Done\n\nAdded a fixed-window RateLimiter.'),
      reply('builder', 'run-tack', 'Tack', ''),
      reply('critic', 'run-hawk', 'Hawk', 'Verdict: concerns'),
      reply('builder', 'run-fix', 'Rivet', 'Fixed the limit: 0 bug. All 18 tests pass.'),
    ]);
    expect(summary).toBe(
      [
        'Built in 3 pieces:',
        '- P1 · CSV export of uploads (Bolt): Added uploadsToCsv with RFC 4180 quoting. Five tests cover it. Files: `src/csv-export.ts`, `test/csv-export.test.ts`. Scoped check: passed.',
        '- P2 · Fixed-window rate limiter (Rivet): Added a fixed-window RateLimiter. Files: `src/rate-limit.ts`, `test/rate-limit.test.ts`. Scoped check: passed.',
        '- P3 · README lists the new modules (Tack): Update README.md to list both modules. Files: `README.md`. Scoped check: none.',
        '- Then Rivet: Fixed the limit: 0 bug.',
      ].join('\n'),
    );
  });

  it("drops the user's name from the Builder's first sentence", () => {
    const summary = piecesSummary(
      coordination(C2_PIECES.slice(0, 2)),
      [
        reply('builder', 'run-bolt', 'Bolt', 'E2E, I added migrations/002_upload_tags.sql.'),
        reply('builder', 'run-rivet', 'Rivet', 'Hi e2e: the slugify piece (P2) is in place.'),
        reply('integrator', 'run-weld', 'Weld', 'I fixed the review finding, E2E. Tests pass.'),
        reply('integrator', 'run-weld-2', 'Weld', 'Rechecked the E2E test naming.'),
      ],
      'E2E',
    );
    expect(summary!.split('\n')).toEqual([
      'Built in 2 pieces:',
      '- P1 · CSV export of uploads (Bolt): I added migrations/002_upload_tags.sql. Files: `src/csv-export.ts`, `test/csv-export.test.ts`. Scoped check: passed.',
      '- P2 · Fixed-window rate limiter (Rivet): Goal of P2. Files: `src/rate-limit.ts`, `test/rate-limit.test.ts`. Scoped check: passed.',
      '- Then Weld: I fixed the review finding.',
      '- Then Weld: Rechecked the E2E test naming.',
    ]);
  });

  it('builds each line from the final summary, never a status line or a mid-turn fragment (C2)', () => {
    const summary = piecesSummary(coordination(C2_PIECES), [
      reply(
        'builder',
        'run-bolt',
        'Bolt',
        'P1 is finished.\n\nAdded `uploadsToCsv`, which quotes commas, quotes and newlines.\n\n- src/csv-export.ts\n- test/csv-export.test.ts\n\nAll 4 tests pass.',
      ),
      reply('builder', 'run-rivet', 'Rivet', 'Now let me check the window logic:'),
      reply(
        'builder',
        'run-tack',
        'Tack',
        'Listed both modules in README.md.\n\nHere is the diff:',
      ),
      reply(
        'integrator',
        'run-weld',
        'Weld',
        'Fixed the CRLF quoting.\n\nNow let me add a test for this case.',
      ),
      reply('integrator', 'run-weld-2', 'Weld', 'All 19 tests pass.'),
    ]);
    expect(summary!.split('\n')).toEqual([
      'Built in 3 pieces:',
      '- P1 · CSV export of uploads (Bolt): Added uploadsToCsv, which quotes commas, quotes and newlines. Files: `src/csv-export.ts`, `test/csv-export.test.ts`. Scoped check: passed.',
      '- P2 · Fixed-window rate limiter (Rivet): Goal of P2. Files: `src/rate-limit.ts`, `test/rate-limit.test.ts`. Scoped check: passed.',
      '- P3 · README lists the new modules (Tack): Listed both modules in README.md. Files: `README.md`. Scoped check: none.',
      '- Then Weld: Fixed the CRLF quoting.',
    ]);
  });

  it('leads each line with what was built, never a closing "Skipped" note (D, C2)', () => {
    const summary = piecesSummary(coordination(C2_PIECES.slice(0, 2)), [
      reply(
        'builder',
        'run-bolt',
        'Bolt',
        'Added `uploadsToCsv` with RFC 4180 quoting.\n\nSkipped: lines end with \\n, not \\r\\n. Add that if a reader needs it.',
      ),
      reply(
        'builder',
        'run-rivet',
        'Rivet',
        'Added a fixed-window RateLimiter.\n\nNothing was skipped.',
      ),
      reply(
        'integrator',
        'run-weld',
        'Weld',
        'No changes were needed.\n\nI skipped the optional database check.',
      ),
    ]);
    expect(summary!.split('\n')).toEqual([
      'Built in 2 pieces:',
      '- P1 · CSV export of uploads (Bolt): Added uploadsToCsv with RFC 4180 quoting. Files: `src/csv-export.ts`, `test/csv-export.test.ts`. Scoped check: passed.',
      '- P2 · Fixed-window rate limiter (Rivet): Added a fixed-window RateLimiter. Files: `src/rate-limit.ts`, `test/rate-limit.test.ts`. Scoped check: passed.',
      '- Then Weld: No changes were needed.',
    ]);
  });

  it('says why a piece did not land and skips research pieces', () => {
    const summary = piecesSummary(
      coordination([
        piece('R1', { research: true }),
        piece('P1', { status: 'failed', note: 'Provider crashed', builderName: 'Bolt' }),
      ]),
      [],
    );
    expect(summary).toBe('Built in 1 piece:\n- P1 · Piece P1 (Bolt): failed — Provider crashed');
  });

  it('is absent without a piece list', () => {
    expect(piecesSummary(null, [])).toBeNull();
    expect(piecesSummary({ list: null } as Coordination, [])).toBeNull();
  });
});

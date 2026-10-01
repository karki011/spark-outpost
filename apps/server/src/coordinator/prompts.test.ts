import { describe, expect, it } from 'vitest';
import type { TaskPiece } from '@spark-outpost/contracts';
import { coordinatorPrompt, pieceSection } from './prompts.ts';

function piece(extra: Partial<TaskPiece>): TaskPiece {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    key: 'P3',
    title: 'README lists the new modules',
    goal: 'List both modules',
    owns: ['README.md'],
    reads: [],
    dependsOn: [],
    contract: null,
    contractVersion: 1,
    acceptance: [],
    checks: [],
    research: false,
    sizeEstimate: 1_000,
    placement: 'in_order',
    provider: null,
    model: null,
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

function brief(extra: Partial<TaskPiece>): string {
  return pieceSection({
    piece: piece(extra),
    owner: 'Tack',
    others: [],
    landed: [],
    scoutNotes: null,
  });
}

describe('piece prompts', () => {
  it('tells the coordinator that docs-only pieces need no check', () => {
    const prompt = coordinatorPrompt({
      request: 'Update README.md',
      agreedPlan: null,
      likelyFiles: [],
      planFiles: [],
      checks: [],
      budgetTokens: 100_000,
    });
    expect(prompt).toContain('only changes docs or text files');
  });

  it('says a docs-only piece has no scoped check', () => {
    expect(brief({})).toContain('Scoped checks: none — docs only.');
    expect(brief({ owns: ['src/a.ts'] })).not.toContain('Scoped checks');
    expect(brief({ checks: ['pnpm markdownlint README.md'] })).toContain(
      'Scoped checks (the harness runs them after your turn):\n- pnpm markdownlint README.md',
    );
  });
});

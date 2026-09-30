import { describe, expect, it } from 'vitest';
import type { TaskPiece } from '@spark-outpost/contracts';
import { listQuestion, widestLevel } from './place-list.ts';

const piece = (key: string, dependsOn: string[] = [], research = false) =>
  ({ key, dependsOn, research }) as TaskPiece;

describe('the piece-list card question', () => {
  it('counts how many pieces can run at once', () => {
    expect(widestLevel([piece('P1'), piece('P2'), piece('P3', ['P1'])])).toBe(2);
    expect(widestLevel([piece('P1'), piece('P2', ['P1']), piece('P3', ['P2'])])).toBe(1);
  });

  it('names the placement and caps the count at the slots', () => {
    const pieces = [piece('P1'), piece('P2'), piece('P3'), piece('P4', ['P1'])];
    expect(listQuestion({ placement: 'worktree', pieces }, 2)).toBe(
      'Build in 4 pieces, 2 at once in worktrees?',
    );
    expect(listQuestion({ placement: 'shared', pieces }, 3)).toBe(
      'Build in 4 pieces, 3 at once in the shared tree?',
    );
    expect(listQuestion({ placement: 'in_order', pieces }, 3)).toBe(
      'Build in 4 pieces, one at a time?',
    );
  });

  it('leaves read-only pieces out of the count at once', () => {
    const pieces = [piece('R1', [], true), piece('P1'), piece('P2')];
    expect(listQuestion({ placement: 'shared', pieces }, 3)).toBe(
      'Build in 3 pieces, 2 at once in the shared tree?',
    );
  });
});

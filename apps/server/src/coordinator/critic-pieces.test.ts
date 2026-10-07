import { describe, expect, it } from 'vitest';
import type { PieceList, TaskPiece } from '@spark-outpost/contracts';
import { PATCH_LIMIT } from '../orchestration/context.ts';
import { patchByFile } from '../orchestration/critic-diff.ts';
import { pieceReviews } from './critic-pieces.ts';

function fileDiff(path: string, size: number): string {
  return [`diff --git a/${path} b/${path}`, `+++ b/${path}`, `+${'x'.repeat(size)}`].join('\n');
}

function piece(key: string, files: string[], extra: Partial<TaskPiece> = {}): TaskPiece {
  return {
    key,
    title: `Piece ${key}`,
    goal: `Goal ${key}`,
    contract: `${key.toLowerCase()}(): void`,
    acceptance: [`${key} works`],
    filesChanged: files,
    status: 'landed',
    research: false,
    builderName: key === 'P1' ? 'Bolt' : null,
    ...extra,
  } as TaskPiece;
}

const list = {
  pieces: [
    piece('P1', ['a.ts']),
    piece('P2', ['b.ts']),
    piece('P3', ['c.ts'], { status: 'skipped' }),
  ],
} as PieceList;

describe('pieceReviews', () => {
  it('splits a diff by file', () => {
    const files = patchByFile(`${fileDiff('a.ts', 3)}\n${fileDiff('b.ts', 3)}`);
    expect([...files.keys()]).toEqual(['a.ts', 'b.ts']);
    expect(files.get('b.ts')).toBe(fileDiff('b.ts', 3));
  });

  it('keeps one diff when it fits the cap', () => {
    expect(pieceReviews(list, fileDiff('a.ts', 10))).toBeNull();
  });

  it('reviews a diff over the cap piece by piece with each contract, glue last', () => {
    const half = PATCH_LIMIT / 2 + 100;
    const patch = [fileDiff('a.ts', half), fileDiff('b.ts', half), fileDiff('glue.ts', 5)].join(
      '\n',
    );
    const reviews = pieceReviews(list, patch)!;
    expect(reviews.map((review) => review.heading)).toEqual([
      'P1 · Piece P1 (Bolt)',
      'P2 · Piece P2',
      'Integration and other files',
    ]);
    expect(reviews[0]!.contract).toBe(
      'Goal: Goal P1\nContract: p1(): void\nAcceptance:\n- P1 works',
    );
    expect(reviews[1]!.patch).toBe(fileDiff('b.ts', half));
    expect(reviews[2]!.patch).toBe(fileDiff('glue.ts', 5));
  });
});

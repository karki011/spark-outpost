import { describe, expect, it } from 'vitest';
import {
  NOT_GIT_REASON,
  placePieces,
  SHARED_TREE_REASON,
  type PlaceablePiece,
} from './placement.ts';

const PIECES: PlaceablePiece[] = [
  { key: 'P1', research: false },
  { key: 'P2', research: false },
];

describe('placePieces', () => {
  it('shares one tree in a git project, whatever the agent mode', () => {
    expect(placePieces(PIECES, { git: true })).toEqual({
      placement: 'shared',
      reason: SHARED_TREE_REASON,
      pieces: [
        { key: 'P1', placement: 'shared' },
        { key: 'P2', placement: 'shared' },
      ],
    });
  });

  it('runs in order outside git', () => {
    expect(placePieces(PIECES, { git: false })).toMatchObject({
      placement: 'in_order',
      reason: NOT_GIT_REASON,
    });
  });

  it('keeps research pieces read-only', () => {
    const placed = placePieces([...PIECES, { key: 'R1', research: true }], { git: true });
    expect(placed.pieces.at(-1)).toEqual({ key: 'R1', placement: 'read_only' });
  });
});

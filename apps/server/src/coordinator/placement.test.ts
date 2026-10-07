import { describe, expect, it } from 'vitest';
import {
  NOT_GIT_REASON,
  OWN_COPIES_REASON,
  placePieces,
  SHARED_TREE_REASON,
  sharedTreeBlocker,
  type PlaceablePiece,
} from './placement.ts';

const PIECES: PlaceablePiece[] = [
  { key: 'P1', research: false },
  { key: 'P2', research: false },
];

describe('placePieces', () => {
  it('shares one tree when the approval gate sees the edits', () => {
    expect(placePieces(PIECES, { git: true, skipsGate: false })).toEqual({
      placement: 'shared',
      reason: SHARED_TREE_REASON,
      pieces: [
        { key: 'P1', placement: 'shared' },
        { key: 'P2', placement: 'shared' },
      ],
    });
  });

  it('gives each piece its own copy when the mode runs without the gate', () => {
    expect(placePieces(PIECES, { git: true, skipsGate: true })).toMatchObject({
      placement: 'worktree',
      reason: OWN_COPIES_REASON,
    });
  });

  it('runs in order outside git, where there is nothing to copy or merge', () => {
    expect(placePieces(PIECES, { git: false, skipsGate: true })).toMatchObject({
      placement: 'in_order',
      reason: NOT_GIT_REASON,
    });
  });

  it('keeps research pieces read-only in every placement', () => {
    const withResearch = [...PIECES, { key: 'R1', research: true }];
    for (const skipsGate of [false, true]) {
      const placed = placePieces(withResearch, { git: true, skipsGate });
      expect(placed.pieces.at(-1)).toEqual({ key: 'R1', placement: 'read_only' });
    }
  });
});

describe('sharedTreeBlocker', () => {
  it('names the kinds of file a piece may not adopt', () => {
    expect(sharedTreeBlocker('apps/web/package.json')).toBe('a manifest');
    expect(sharedTreeBlocker('pnpm-lock.yaml')).toBe('a lockfile');
    expect(sharedTreeBlocker('dist/index.js')).toBe('a generated file');
    expect(sharedTreeBlocker('apps/server/migrations/0059_x.sql')).toBe('a migration');
    expect(sharedTreeBlocker('apps/server/src/a.ts')).toBeNull();
  });
});

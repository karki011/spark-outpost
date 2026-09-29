import { describe, expect, it } from 'vitest';
import { needsHandoff, pieceKey } from './piece-run.ts';

describe('needsHandoff', () => {
  it('hands off at 75% of the context window', () => {
    expect(needsHandoff(150_000, 200_000)).toBe(true);
    expect(needsHandoff(149_999, 200_000)).toBe(false);
    expect(needsHandoff(null, 200_000)).toBe(false);
    expect(needsHandoff(100, 0)).toBe(false);
  });
});

describe('pieceKey', () => {
  it('gives each handoff generation its own session key', () => {
    expect(pieceKey('task', 'P1', 1)).toBe('task:piece:P1');
    expect(pieceKey('task', 'P1', 2)).toBe('task:piece:P1:2');
  });
});

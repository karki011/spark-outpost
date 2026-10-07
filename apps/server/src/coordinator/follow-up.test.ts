import { describe, expect, it } from 'vitest';
import type { TaskPiece } from '@spark-outpost/contracts';
import { requirementTarget } from './follow-up.ts';

function piece(key: string, status: TaskPiece['status'], owns: string[], research = false) {
  return { key, status, owns, research } as TaskPiece;
}

describe('requirementTarget', () => {
  const pieces = [
    piece('P1', 'landed', ['store.ts']),
    piece('P2', 'pending', ['api.ts', 'shared/**']),
    piece('P3', 'running', ['view.ts', 'shared/**']),
    piece('R1', 'running', [], true),
  ];

  it('prefers the worker already working on the file', () => {
    expect(requirementTarget(pieces, { files: ['shared/x.ts'] })?.key).toBe('P3');
    expect(requirementTarget(pieces, { files: ['view.ts'] })?.key).toBe('P3');
  });

  it('falls back to a piece that has not started', () => {
    expect(requirementTarget(pieces, { files: ['api.ts'] })?.key).toBe('P2');
  });

  it('never hands a need back to the piece that reported it', () => {
    expect(requirementTarget(pieces, { files: ['shared/x.ts'], from: 'P3' })?.key).toBe('P2');
  });

  it('has no target when the owner has landed or nobody owns the file', () => {
    expect(requirementTarget(pieces, { files: ['store.ts'] })).toBeNull();
    expect(requirementTarget(pieces, { files: ['new.ts'] })).toBeNull();
    expect(requirementTarget(pieces, { files: [] })).toBeNull();
  });
});

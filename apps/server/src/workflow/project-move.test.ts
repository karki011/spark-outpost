import { describe, expect, it } from 'vitest';
import { projectMoveNote, projectMoveStep, withMoveNote } from './project-move.ts';

const move = { from: '/work/live-crew', to: '/work/spark-outpost' };

describe('a project move between turns', () => {
  it('names both folders in the work log and warns the agent about earlier paths', () => {
    expect(projectMoveStep(move)).toBe(
      'Project changed since the last turn: live-crew → spark-outpost',
    );
    expect(projectMoveNote(move)).toContain('/work/live-crew to /work/spark-outpost');
  });

  it('puts the note before any other preamble, and adds nothing without a move', () => {
    const preamble = 'Agreed plan: add a retry.';
    expect(withMoveNote({ preamble, projectMove: move })).toBe(
      `${projectMoveNote(move)}\n\n${preamble}`,
    );
    expect(withMoveNote({ preamble, projectMove: null })).toBe(preamble);
    expect(withMoveNote({ preamble: null, projectMove: null })).toBeNull();
  });
});

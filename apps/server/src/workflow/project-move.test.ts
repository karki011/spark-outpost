import { describe, expect, it } from 'vitest';
import { builderPrompt } from '../orchestration/context.ts';
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

  it('tells the Builder before the earlier conversation', () => {
    const prompt = builderPrompt({
      request: 'wrap up',
      history: [{ role: 'user', content: 'show me src/dates.ts' }],
      note: null,
      findings: [],
      projectNote: projectMoveNote(move),
    });
    expect(prompt.indexOf('project folder changed')).toBeGreaterThan(-1);
    expect(prompt.indexOf('project folder changed')).toBeLessThan(
      prompt.indexOf('Earlier conversation'),
    );
  });
});

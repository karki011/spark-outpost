import { describe, expect, it } from 'vitest';
import { previewWorkflow, type WorkflowStep } from '@spark-outpost/contracts';
import { positionLabel, previewResult, statesAt } from './preview-model.ts';

const step = (id: string, dependsOn: string[] = [], extra: Partial<WorkflowStep> = {}) => ({
  id,
  sparkId: '00000000-0000-4000-8000-000000000001',
  prompt: '',
  dependsOn,
  join: 'all' as const,
  onFailure: 'stop' as const,
  ...extra,
});

const STEPS: WorkflowStep[] = [
  step('security'),
  step('lint'),
  step('types'),
  step('comment', ['security', 'lint', 'types']),
  step('ticketing', ['comment']),
];
const LABELS = new Map([
  ['security', 'Security'],
  ['lint', 'Lint'],
  ['types', 'Types'],
  ['comment', 'Comment'],
  ['ticketing', 'Ticketing'],
]);

describe('stepping through a preview', () => {
  it('shows nothing run at the start and one more round at each step', () => {
    const preview = previewWorkflow(STEPS, new Set());
    expect(Object.values(statesAt(preview, 0))).toEqual(Array(5).fill('waiting'));
    expect(statesAt(preview, 1)).toMatchObject({ security: 'succeeded', comment: 'waiting' });
    expect(statesAt(preview, 2)).toMatchObject({ comment: 'succeeded', ticketing: 'waiting' });
    expect(statesAt(preview, 3)).toEqual(preview.states);
    expect(positionLabel(preview, 0)).toBe('Before the start · 3 rounds');
    expect(positionLabel(preview, 2)).toBe('Round 2 of 3');
  });

  it('shows skipped steps once the last round has played', () => {
    const preview = previewWorkflow(STEPS, new Set(['types']));
    expect(preview.rounds).toHaveLength(1);
    expect(statesAt(preview, 0).comment).toBe('waiting');
    expect(statesAt(preview, 1)).toMatchObject({ types: 'failed', comment: 'skipped' });
  });
});

describe('the result in words', () => {
  it('says every step runs when nothing fails', () => {
    expect(previewResult(STEPS, previewWorkflow(STEPS, new Set()), LABELS)).toEqual({
      headline: 'Every step runs.',
      lines: ['5 steps in 3 rounds.'],
      stoppedBy: null,
    });
  });

  it('names what stopped, what did not start and what still finished', () => {
    const result = previewResult(STEPS, previewWorkflow(STEPS, new Set(['types'])), LABELS);
    expect(result.headline).toBe('The workflow stops at round 1.');
    expect(result.stoppedBy).toBe('types');
    expect(result.lines).toEqual([
      'Types is set to Stop workflow when it fails.',
      "Comment and Ticketing don't start.",
      'Security and Lint still finish and keep their output.',
    ]);
  });

  it('says the workflow keeps going when the failing step is set to Continue', () => {
    const steps = STEPS.map((entry) =>
      entry.id === 'types' ? { ...entry, onFailure: 'continue' as const } : entry,
    );
    const result = previewResult(steps, previewWorkflow(steps, new Set(['types'])), LABELS);
    expect(result).toEqual({
      headline: 'The workflow keeps going.',
      lines: ['Types fails and is set to Continue, so the steps after still run and get the note.'],
      stoppedBy: null,
    });
  });

  it('uses the singular for one skipped step', () => {
    const result = previewResult(STEPS, previewWorkflow(STEPS, new Set(['comment'])), LABELS);
    expect(result.headline).toBe('The workflow stops at round 2.');
    expect(result.lines).toEqual([
      'Comment is set to Stop workflow when it fails.',
      "Ticketing doesn't start.",
    ]);
  });
});

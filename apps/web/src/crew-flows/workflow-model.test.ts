import { describe, expect, it } from 'vitest';
import { workflowProblems, workflowStages, type WorkflowStep } from '@spark-outpost/contracts';
import {
  addStage,
  addStep,
  afterLabel,
  canMove,
  dependencyChanges,
  moveStep,
  namesInside,
  removeStep,
  retargetStep,
  stagePreview,
  stepLabels,
  toggleParent,
  workflowId,
} from './workflow-model.ts';
import { suggestWorkflows } from './workflow-suggestions.ts';

const spark = (name: string) => ({
  id: `00000000-0000-4000-8000-${name.length.toString().padStart(4, '0')}${name
    .toLowerCase()
    .replace(/[^a-f0-9]/g, '0')
    .padEnd(8, '0')
    .slice(0, 8)}`,
  name,
});
const SECURITY = spark('Security');
const LINT = spark('Lint');
const COMMENT = spark('Comment');
const TICKETING = spark('Ticketing');
const SPARKS = [SECURITY, LINT, COMMENT, TICKETING];
const NIGHTLY = { id: 'nightly', name: 'Nightly review', workflow: true };

function review(): WorkflowStep[] {
  let steps = addStep([], 0, SECURITY);
  steps = addStep(steps, 0, LINT);
  steps = addStage(steps, COMMENT);
  return addStage(steps, TICKETING);
}

const parents = (steps: readonly WorkflowStep[], id: string) =>
  steps.find((step) => step.id === id)!.dependsOn;
const noProblems = (steps: readonly WorkflowStep[]) =>
  workflowProblems(steps, new Set(SPARKS.map((entry) => entry.id)));

describe('building a workflow', () => {
  it('puts Sparks added to one stage side by side and a new stage after all of the last', () => {
    const steps = review();
    expect(workflowStages(steps)).toEqual([['security', 'lint'], ['comment'], ['ticketing']]);
    expect(parents(steps, 'comment')).toEqual(['security', 'lint']);
    expect(parents(steps, 'ticketing')).toEqual(['comment']);
    expect(noProblems(steps)).toEqual([]);
  });

  it('gives a second step for the same Spark its own id and a numbered label', () => {
    const steps = addStage(review(), LINT);
    expect(steps.map((step) => step.id)).toContain('lint-2');
    const labels = stepLabels(steps, SPARKS);
    expect(labels.get('lint')).toBe('Lint (1)');
    expect(labels.get('lint-2')).toBe('Lint (2)');
    expect(labels.get('comment')).toBe('Comment');
  });

  it('adds a Spark to a later stage after everything in the stage before it', () => {
    const steps = addStep(review(), 1, TICKETING);
    expect(parents(steps, 'ticketing-2')).toEqual(['security', 'lint']);
    expect(workflowStages(steps)[1]).toEqual(['comment', 'ticketing-2']);
  });

  it('keeps a workflow id unique and inside the slug limit', () => {
    expect(workflowId('Pre-PR review', [])).toBe('pre-pr-review');
    expect(workflowId('Pre-PR review', ['pre-pr-review', 'pre-pr-review-2'])).toBe(
      'pre-pr-review-3',
    );
    const long = 'a'.repeat(60);
    expect(workflowId(long, [workflowId(long, [])])).toHaveLength(40);
  });
});

describe('moving a step between stages', () => {
  it('moves a step earlier to run beside the stage before it', () => {
    const steps = moveStep(review(), 'comment', 'earlier');
    expect(workflowStages(steps)).toEqual([['security', 'lint', 'comment'], ['ticketing']]);
    expect(parents(steps, 'comment')).toEqual([]);
    expect(parents(steps, 'ticketing')).toEqual(['comment']);
    expect(noProblems(steps)).toEqual([]);
  });

  it('moves one of several side-by-side steps later into the next stage', () => {
    const steps = moveStep(review(), 'security', 'later');
    expect(workflowStages(steps)).toEqual([['lint'], ['security', 'comment'], ['ticketing']]);
    expect(parents(steps, 'security')).toEqual(['lint']);
    expect(parents(steps, 'comment')).toEqual(['lint']);
    expect(noProblems(steps)).toEqual([]);
  });

  it('swaps a step that is alone in its stage with the stage after it', () => {
    const steps = moveStep(review(), 'comment', 'later');
    expect(workflowStages(steps)).toEqual([['security', 'lint'], ['ticketing'], ['comment']]);
    expect(parents(steps, 'ticketing')).toEqual(['security', 'lint']);
    expect(parents(steps, 'comment')).toEqual(['ticketing']);
    expect(noProblems(steps)).toEqual([]);
  });

  it('refuses moves that have nowhere to go', () => {
    const steps = review();
    expect(canMove(steps, 'security', 'earlier')).toBe(false);
    expect(canMove(steps, 'ticketing', 'later')).toBe(false);
    expect(canMove(steps, 'ticketing', 'earlier')).toBe(true);
    expect(moveStep(steps, 'ticketing', 'later')).toEqual(steps);
    expect(canMove(steps, 'gone', 'later')).toBe(false);
  });

  it('keeps the order of the list when a step moves later', () => {
    const steps = moveStep(review(), 'security', 'later');
    expect(steps.map((step) => step.id)).toEqual(['security', 'lint', 'comment', 'ticketing']);
  });
});

describe('parents', () => {
  it('adds and removes a parent', () => {
    const added = toggleParent(review(), 'ticketing', 'lint');
    expect(parents(added, 'ticketing')).toEqual(['comment', 'lint']);
    const removed = toggleParent(added, 'ticketing', 'comment');
    expect(parents(removed, 'ticketing')).toEqual(['lint']);
    expect(workflowStages(removed)).toEqual([
      ['security', 'lint'],
      ['comment', 'ticketing'],
    ]);
  });

  it('lets the user tick a parent that makes a loop, which the checks then report', () => {
    const looped = toggleParent(review(), 'security', 'ticketing');
    expect(noProblems(looped).map((problem) => problem.kind)).toEqual(['cycle']);
  });

  it('hands a removed step’s parents to the steps that waited on it', () => {
    const steps = removeStep(review(), 'comment');
    expect(parents(steps, 'ticketing')).toEqual(['security', 'lint']);
    expect(workflowStages(steps)).toEqual([['security', 'lint'], ['ticketing']]);
    expect(noProblems(steps)).toEqual([]);
  });

  it('says in words what each step runs after', () => {
    const steps = review();
    const labels = stepLabels(steps, SPARKS);
    expect(afterLabel(steps, 'security', labels)).toBe('Starts first');
    expect(afterLabel(steps, 'comment', labels)).toBe('After all of Stage 1');
    expect(afterLabel(steps, 'ticketing', labels)).toBe('After Comment');
    const mixed = toggleParent(steps, 'ticketing', 'lint');
    expect(afterLabel(mixed, 'ticketing', stepLabels(mixed, SPARKS))).toBe(
      'After Comment and Lint',
    );
    const any = mixed.map((step) =>
      step.id === 'ticketing' ? { ...step, join: 'any' as const } : step,
    );
    expect(afterLabel(any, 'ticketing', labels)).toBe('After any of Comment and Lint');
  });
});

describe('the stage preview', () => {
  it('lists each stage with the Spark of every step, side-by-side steps together', () => {
    expect(stagePreview(review())).toEqual([
      [
        { stepId: 'security', sparkId: SECURITY.id, workflowId: null },
        { stepId: 'lint', sparkId: LINT.id, workflowId: null },
      ],
      [{ stepId: 'comment', sparkId: COMMENT.id, workflowId: null }],
      [{ stepId: 'ticketing', sparkId: TICKETING.id, workflowId: null }],
    ]);
  });

  it('marks a step that runs a workflow', () => {
    const steps = addStage(addStep([], 0, SECURITY), NIGHTLY);
    expect(stagePreview(steps)[1]).toEqual([
      { stepId: 'nightly-review', sparkId: null, workflowId: 'nightly' },
    ]);
  });

  it('is empty for a workflow with no steps', () => {
    expect(stagePreview([])).toEqual([]);
  });
});

describe('suggestions from the crew', () => {
  it('offers nothing with fewer than two Sparks', () => {
    expect(suggestWorkflows([])).toEqual([]);
    expect(suggestWorkflows([SECURITY])).toEqual([]);
  });

  it('offers side by side and in order for two Sparks', () => {
    const [together, chain, ...rest] = suggestWorkflows([SECURITY, LINT]);
    expect(rest).toEqual([]);
    expect(workflowStages(together!.steps)).toEqual([['security', 'lint']]);
    expect(workflowStages(chain!.steps)).toEqual([['security'], ['lint']]);
  });

  it('adds a wrap-up by the last Spark from three Sparks up, using at most four', () => {
    const suggestions = suggestWorkflows([...SPARKS, spark('Extra')]);
    const wrap = suggestions.find((suggestion) => suggestion.id === 'wrap-up')!;
    expect(wrap.name).toBe('Then Ticketing wraps up');
    expect(workflowStages(wrap.steps)).toEqual([['security', 'lint', 'comment'], ['ticketing']]);
    for (const suggestion of suggestions) expect(noProblems(suggestion.steps)).toEqual([]);
  });
});

describe('dependencyChanges', () => {
  it('says which steps wait on something else after a move', () => {
    const steps = review();
    const labels = stepLabels(steps, SPARKS);
    expect(dependencyChanges(steps, moveStep(steps, 'lint', 'later'), labels)).toEqual([
      'Lint: After Security · was Starts first',
      'Comment: After Security · was After all of Stage 1',
    ]);
    expect(dependencyChanges(steps, moveStep(steps, 'comment', 'earlier'), labels)).toEqual([
      'Comment: Starts first · was After all of Stage 1',
    ]);
    expect(dependencyChanges(steps, steps, labels)).toEqual([]);
  });
});

describe('a step that runs a workflow', () => {
  it('is added with the workflow’s id and labelled with its name', () => {
    const steps = addStage(addStep([], 0, SECURITY), NIGHTLY);
    expect(steps[1]).toMatchObject({ id: 'nightly-review', workflowId: 'nightly' });
    expect(steps[1]).not.toHaveProperty('sparkId');
    expect(stepLabels(steps, SPARKS, [NIGHTLY]).get('nightly-review')).toBe('Nightly review');
    expect(stepLabels(steps, SPARKS).get('nightly-review')).toBe('Missing workflow');
    expect(workflowProblems(steps, new Set(SPARKS.map((spark) => spark.id)))).toEqual([]);
  });

  it('swaps between a Spark and a workflow without keeping both', () => {
    const steps = addStep([], 0, SECURITY);
    const nested = retargetStep(steps, 'security', NIGHTLY);
    expect(nested[0]).toMatchObject({ id: 'security', workflowId: 'nightly' });
    expect(nested[0]).not.toHaveProperty('sparkId');
    const back = retargetStep(nested, 'security', LINT);
    expect(back[0]).toMatchObject({ sparkId: LINT.id });
    expect(back[0]).not.toHaveProperty('workflowId');
  });

  it('labels the steps of a run by the step they are inside', () => {
    const labels = stepLabels(
      [
        { id: 'check.security', sparkId: SECURITY.id },
        { id: 'check.lint', sparkId: LINT.id },
        { id: 'again.security', sparkId: SECURITY.id },
        { id: 'comment', sparkId: COMMENT.id },
      ],
      SPARKS,
    );
    expect([...labels.values()]).toEqual([
      'check › Security',
      'check › Lint',
      'again › Security',
      'Comment',
    ]);
  });

  it('names the workflow an inner step is in, and falls back to the step id', () => {
    const review = { name: 'Review', steps: [{ id: 'security', sparkId: SECURITY.id }] };
    const ship = { name: 'Ship', steps: [{ id: 'check', workflowId: 'review' }] };
    const release = { name: 'Release', steps: [{ id: 'gate', workflowId: 'ship' }] };
    const find = (id: string) => ({ review, ship })[id] ?? null;
    const steps = [{ id: 'gate.check.security', sparkId: SECURITY.id }];

    expect(stepLabels(steps, SPARKS, [], namesInside(release, find)).get(steps[0]!.id)).toBe(
      'Ship › Review › Security',
    );
    expect(stepLabels(steps, SPARKS, [], namesInside(null, find)).get(steps[0]!.id)).toBe(
      'gate › check › Security',
    );
  });
});

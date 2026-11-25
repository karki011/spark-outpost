import { lazy, Suspense, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { workflowStages, type WorkflowProblem, type WorkflowStep } from '@spark-outpost/contracts';
import type { CrewSpark } from './spark-lookup.ts';
import { StageList, stepButton } from './StageList.tsx';
import { StepInspector } from './StepInspector.tsx';
import {
  canMove,
  dependencyChanges,
  moveStep,
  removeStep,
  type MoveDirection,
  type SparkName,
} from './workflow-model.ts';

const FlowGraph = lazy(() => import('./FlowGraph.tsx'));

interface StepsTabProps {
  steps: readonly WorkflowStep[];
  labels: ReadonlyMap<string, string>;
  sparks: readonly CrewSpark[];
  sparkById: ReadonlyMap<string, CrewSpark>;
  workflows: readonly SparkName[];
  problems: readonly WorkflowProblem[];
  selected: string | null;
  onSelect: (stepId: string | null) => void;
  onChange: (steps: WorkflowStep[]) => void;
  footer: ReactNode;
}

function count(total: number, word: string): string {
  return `${total} ${word}${total === 1 ? '' : 's'}`;
}

export function StepsTab(props: StepsTabProps) {
  const { steps, labels, sparks, sparkById, workflows, problems, selected, onSelect, onChange } =
    props;
  const root = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  const [moved, setMoved] = useState<{ stepId: string; lines: string[] } | null>(null);
  const step = steps.find((candidate) => candidate.id === selected) ?? null;
  const stages = workflowStages(steps).length;

  useLayoutEffect(() => {
    const selector = focusNext.current;
    if (selector === null) return;
    focusNext.current = null;
    root.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  const change = (next: WorkflowStep[]) => {
    setMoved(null);
    onChange(next);
  };
  const add = (next: WorkflowStep[]) => {
    const known = new Set(steps.map((existing) => existing.id));
    const added = next.find((candidate) => !known.has(candidate.id));
    if (added) {
      focusNext.current = stepButton(added.id);
      onSelect(added.id);
    }
    change(next);
  };
  const move = (direction: MoveDirection) => {
    if (!step) return;
    const next = moveStep(steps, step.id, direction);
    const other = direction === 'earlier' ? 'later' : 'earlier';
    const control = canMove(next, step.id, direction) ? direction : other;
    focusNext.current = `[data-inspect] [data-act="${control}"]`;
    setMoved({ stepId: step.id, lines: dependencyChanges(steps, next, labels) });
    onChange(next);
  };
  const remove = () => {
    if (!step) return;
    focusNext.current = '[data-add-stage-wrap] button';
    onSelect(null);
    change(removeStep(steps, step.id));
  };

  return (
    <div className="wf-body wf-steps-tab" ref={root} role="tabpanel" aria-label="Steps">
      <div className="wf-col">
        <p className="wf-hint">Steps in the same stage run at the same time.</p>
        <StageList
          steps={steps}
          labels={labels}
          sparks={sparks}
          sparkById={sparkById}
          workflows={workflows}
          problems={problems}
          selected={selected}
          onSelect={onSelect}
          onAdd={add}
        />
        {props.footer}
      </div>
      <div className="wf-canvas">
        <Suspense fallback={null}>
          <FlowGraph
            steps={steps}
            labels={labels}
            sparks={sparkById}
            selected={selected}
            onSelect={onSelect}
            label={`Graph of the workflow: ${count(steps.length, 'step')} in ${count(stages, 'stage')}`}
          />
        </Suspense>
      </div>
      <StepInspector
        step={step}
        steps={steps}
        labels={labels}
        sparks={sparks}
        sparkById={sparkById}
        workflows={workflows}
        problems={problems}
        moved={moved && moved.stepId === step?.id ? moved.lines : []}
        onChange={change}
        onMove={move}
        onRemove={remove}
      />
    </div>
  );
}

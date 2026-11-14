import { useLayoutEffect, useRef, useState } from 'react';
import { workflowStages, type WorkflowProblem, type WorkflowStep } from '@spark-outpost/contracts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { sparkChoices, type CrewSpark } from './spark-lookup.ts';
import { StepRow, stepControl, type EditSteps } from './StepRow.tsx';
import { addStage, addStep, afterLabel } from './workflow-model.ts';

interface StageListProps {
  steps: readonly WorkflowStep[];
  labels: ReadonlyMap<string, string>;
  sparks: readonly CrewSpark[];
  sparkById: ReadonlyMap<string, CrewSpark>;
  problems: readonly WorkflowProblem[];
  onChange: (steps: WorkflowStep[]) => void;
}

function newStepId(before: readonly WorkflowStep[], after: readonly WorkflowStep[]): string | null {
  const known = new Set(before.map((step) => step.id));
  return after.find((step) => !known.has(step.id))?.id ?? null;
}

export function StageList({
  steps,
  labels,
  sparks,
  sparkById,
  problems,
  onChange,
}: StageListProps) {
  const root = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const stages = workflowStages(steps);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const choices = sparkChoices(sparks);

  useLayoutEffect(() => {
    const selector = focusNext.current;
    if (selector === null) return;
    focusNext.current = null;
    root.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  const edit: EditSteps = (change, focus) => {
    focusNext.current = focus ?? null;
    onChange(change(steps));
  };
  const add = (next: WorkflowStep[]) => {
    const id = newStepId(steps, next);
    focusNext.current = id ? stepControl(id, 'details') : null;
    onChange(next);
  };
  const pick = (sparkId: string, place: (spark: CrewSpark) => WorkflowStep[]) => {
    const spark = sparkById.get(sparkId);
    if (spark) add(place(spark));
  };

  return (
    <div className="wf-stages" ref={root}>
      {stages.map((stage, index) => (
        <section key={stage[0]} className="wf-stage" aria-label={`Stage ${index + 1}`}>
          <h4 className="wf-stage-h">
            Stage {index + 1}
            {stage.length > 1 && <span className="wf-tag">{stage.length} at the same time</span>}
          </h4>
          <ul className="wf-steps">
            {stage.map((id) => {
              const step = byId.get(id)!;
              return (
                <StepRow
                  key={id}
                  step={step}
                  steps={steps}
                  label={labels.get(id) ?? id}
                  after={afterLabel(steps, id, labels)}
                  labels={labels}
                  sparks={sparks}
                  sparkById={sparkById}
                  problems={problems.filter((problem) => problem.stepId === id)}
                  open={open === id}
                  onToggle={() => setOpen(open === id ? null : id)}
                  edit={edit}
                />
              );
            })}
          </ul>
          <div className="wf-add">
            <ChoicePicker
              label={`Add a Spark to Stage ${index + 1}`}
              placeholder="Add a Spark to this stage"
              showNote={false}
              value=""
              choices={choices}
              onChange={(sparkId) => pick(sparkId, (spark) => addStep(steps, index, spark))}
            />
          </div>
        </section>
      ))}
      <div className="wf-add wf-add-stage" data-add-stage-wrap>
        <ChoicePicker
          label={steps.length === 0 ? 'Add the first Spark' : 'Add a stage'}
          placeholder={
            steps.length === 0 ? 'Add the first Spark' : 'Add a stage that runs after the last one'
          }
          showNote={false}
          value=""
          choices={choices}
          onChange={(sparkId) => pick(sparkId, (spark) => addStage(steps, spark))}
        />
      </div>
    </div>
  );
}

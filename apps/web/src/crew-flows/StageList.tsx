import { workflowStages, type WorkflowProblem, type WorkflowStep } from '@spark-outpost/contracts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { WarnIcon } from '../ui/icons.tsx';
import { chosenTarget, stepChoices, type CrewSpark } from './spark-lookup.ts';
import { SparkDot } from './StagePreview.tsx';
import {
  addStage,
  addStep,
  afterLabel,
  type SparkName,
  type StepTarget,
} from './workflow-model.ts';

interface StageListProps {
  steps: readonly WorkflowStep[];
  labels: ReadonlyMap<string, string>;
  sparks: readonly CrewSpark[];
  sparkById: ReadonlyMap<string, CrewSpark>;
  workflows: readonly SparkName[];
  problems: readonly WorkflowProblem[];
  selected: string | null;
  onSelect: (stepId: string) => void;
  onAdd: (steps: WorkflowStep[]) => void;
}

export function stepButton(stepId: string): string {
  return `[data-step="${stepId}"] [data-act="select"]`;
}

export function StageList({
  steps,
  labels,
  sparks,
  sparkById,
  workflows,
  problems,
  selected,
  onSelect,
  onAdd,
}: StageListProps) {
  const stages = workflowStages(steps);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const choices = stepChoices(sparks, workflows);
  const pick = (choice: string, place: (target: StepTarget) => WorkflowStep[]) => {
    const target = chosenTarget(choice, sparkById, workflows);
    if (target) onAdd(place(target));
  };

  return (
    <div className="wf-stages">
      {stages.map((stage, index) => (
        <section key={stage[0]} className="wf-stage" aria-label={`Stage ${index + 1}`}>
          <h4 className="wf-stage-h">
            Stage {index + 1}
            {stage.length > 1 && <span className="wf-tag">{stage.length} at the same time</span>}
          </h4>
          <ul className="wf-steps">
            {stage.map((id) => {
              const step = byId.get(id)!;
              const label = labels.get(id) ?? id;
              const bad = problems.filter((problem) => problem.stepId === id).length;
              return (
                <li key={id} className="wf-step" data-step={id} data-bad={bad > 0 || undefined}>
                  <button
                    type="button"
                    className="wf-step-pick"
                    data-act="select"
                    aria-pressed={selected === id}
                    aria-label={`Edit ${label}`}
                    onClick={() => onSelect(id)}
                  >
                    <SparkDot
                      spark={sparkById.get(step.sparkId ?? '')}
                      workflow={step.workflowId !== undefined}
                      size={26}
                    />
                    <span className="wf-step-name">
                      <b>{label}</b>
                      <small>{afterLabel(steps, id, labels)}</small>
                    </span>
                    {bad > 0 && (
                      <span className="wf-state" data-state="failed">
                        <WarnIcon />
                        {bad === 1 ? 'Problem' : `${bad} problems`}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="wf-add">
            <ChoicePicker
              label={`Add a step to Stage ${index + 1}`}
              placeholder="Add a Spark or workflow to this stage"
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
          label={steps.length === 0 ? 'Add the first step' : 'Add a stage'}
          placeholder={
            steps.length === 0
              ? 'Add the first Spark or workflow'
              : 'Add a stage that runs after the last one'
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

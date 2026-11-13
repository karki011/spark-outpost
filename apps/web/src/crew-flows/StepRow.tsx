import { useId } from 'react';
import {
  WORKFLOW_PROMPT_MAX,
  type WorkflowProblem,
  type WorkflowStep,
} from '@spark-outpost/contracts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { ArrowDownIcon, ArrowUpIcon, ChevronIcon, TrashIcon, WarnIcon } from '../ui/icons.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { sparkChoices, type CrewSpark } from './spark-lookup.ts';
import { SparkDot } from './StagePreview.tsx';
import {
  canMove,
  moveStep,
  removeStep,
  toggleParent,
  updateStep,
  type MoveDirection,
} from './workflow-model.ts';

export type EditSteps = (
  change: (steps: readonly WorkflowStep[]) => WorkflowStep[],
  focus?: string,
) => void;

interface StepRowProps {
  step: WorkflowStep;
  steps: readonly WorkflowStep[];
  label: string;
  after: string;
  labels: ReadonlyMap<string, string>;
  sparks: readonly CrewSpark[];
  sparkById: ReadonlyMap<string, CrewSpark>;
  problems: readonly WorkflowProblem[];
  open: boolean;
  onToggle: () => void;
  edit: EditSteps;
}

const JOINS = [
  { id: 'all', label: 'All finish' },
  { id: 'any', label: 'Any finishes' },
];
const FAILURES = [
  { id: 'stop', label: 'Stop workflow' },
  { id: 'continue', label: 'Continue' },
];

export function stepControl(stepId: string, control: string): string {
  return `[data-step="${stepId}"] [data-act="${control}"]`;
}

function StepDetails({ step, steps, label, labels, sparks, edit }: StepRowProps) {
  const promptId = useId();
  const joinId = useId();
  const failId = useId();
  const others = steps.filter((other) => other.id !== step.id);
  const parents = new Set(step.dependsOn);
  return (
    <div className="wf-step-more">
      <div className="wf-fieldrow">
        <span className="wf-lbl">Spark</span>
        <ChoicePicker
          label={`Spark for ${label}`}
          showNote={false}
          value={step.sparkId}
          placeholder="Choose a Spark"
          choices={sparkChoices(sparks)}
          onChange={(sparkId) => edit((current) => updateStep(current, step.id, { sparkId }))}
        />
      </div>
      <fieldset className="wf-parents">
        <legend className="wf-lbl">Runs after</legend>
        {others.length === 0 && <p className="wf-hint">There are no other steps yet.</p>}
        {others.map((other) => (
          <label key={other.id} className="wf-check">
            <input
              type="checkbox"
              checked={parents.has(other.id)}
              onChange={() =>
                edit(
                  (current) => toggleParent(current, step.id, other.id),
                  `[data-step="${step.id}"] [data-parent="${other.id}"]`,
                )
              }
              data-parent={other.id}
            />
            {labels.get(other.id) ?? other.id}
          </label>
        ))}
        {others.length > 0 && parents.size === 0 && (
          <p className="wf-hint">Nothing ticked, so it starts first.</p>
        )}
      </fieldset>
      {parents.size > 1 && (
        <div className="wf-fieldrow">
          <span className="wf-lbl" id={joinId}>
            Start when
          </span>
          <Segmented
            ariaLabel={`When ${label} starts`}
            describedBy={joinId}
            options={JOINS}
            value={step.join}
            onChange={(join) =>
              edit((current) =>
                updateStep(current, step.id, { join: join === 'any' ? 'any' : 'all' }),
              )
            }
          />
        </div>
      )}
      <div className="wf-fieldrow">
        <span className="wf-lbl" id={failId}>
          If it fails
        </span>
        <Segmented
          ariaLabel={`If ${label} fails`}
          describedBy={failId}
          options={FAILURES}
          value={step.onFailure}
          onChange={(onFailure) =>
            edit((current) =>
              updateStep(current, step.id, {
                onFailure: onFailure === 'continue' ? 'continue' : 'stop',
              }),
            )
          }
        />
      </div>
      <label className="field" htmlFor={promptId}>
        <span>Extra prompt</span>
        <textarea
          id={promptId}
          className="inp"
          rows={3}
          maxLength={WORKFLOW_PROMPT_MAX}
          placeholder="Optional. Added to what this Spark is told for this step."
          value={step.prompt}
          onChange={(event) => {
            const prompt = event.target.value;
            edit((current) => updateStep(current, step.id, { prompt }));
          }}
        />
      </label>
    </div>
  );
}

export function StepRow(props: StepRowProps) {
  const { step, steps, label, after, sparkById, problems, open, onToggle, edit } = props;
  const detailsId = useId();
  const move = (direction: MoveDirection) => {
    const moved = moveStep(steps, step.id, direction);
    const still = canMove(moved, step.id, direction);
    const other = direction === 'earlier' ? 'later' : 'earlier';
    edit(() => moved, stepControl(step.id, still ? direction : other));
  };
  return (
    <li className="wf-step" data-step={step.id} data-bad={problems.length > 0 || undefined}>
      <div className="wf-step-row">
        <SparkDot spark={sparkById.get(step.sparkId)} size={26} />
        <span className="wf-step-name">
          <b>{label}</b>
          <small>{after}</small>
        </span>
        <button
          type="button"
          className="wf-icon"
          data-act="earlier"
          aria-label={`Move ${label} to an earlier stage`}
          title="Move to an earlier stage"
          disabled={!canMove(steps, step.id, 'earlier')}
          onClick={() => move('earlier')}
        >
          <ArrowUpIcon />
        </button>
        <button
          type="button"
          className="wf-icon"
          data-act="later"
          aria-label={`Move ${label} to a later stage`}
          title="Move to a later stage"
          disabled={!canMove(steps, step.id, 'later')}
          onClick={() => move('later')}
        >
          <ArrowDownIcon />
        </button>
        <button
          type="button"
          className="wf-icon"
          data-act="remove"
          aria-label={`Remove ${label}`}
          title="Remove this step"
          onClick={() =>
            edit((current) => removeStep(current, step.id), '[data-add-stage-wrap] button')
          }
        >
          <TrashIcon />
        </button>
        <button
          type="button"
          className="wf-icon wf-more"
          data-act="details"
          aria-label={`Details for ${label}`}
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={onToggle}
        >
          <ChevronIcon />
        </button>
      </div>
      {problems.map((problem) => (
        <p key={`${problem.kind}:${problem.text}`} className="wf-problem">
          <WarnIcon />
          <span>
            <b>Problem</b> · {problem.text}
          </span>
        </p>
      ))}
      <div id={detailsId} hidden={!open}>
        {open && <StepDetails {...props} />}
      </div>
    </li>
  );
}

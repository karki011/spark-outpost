import { useId } from 'react';
import {
  WORKFLOW_PROMPT_MAX,
  type WorkflowProblem,
  type WorkflowStep,
} from '@spark-outpost/contracts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { ArrowDownIcon, ArrowUpIcon, TrashIcon, WarnIcon } from '../ui/icons.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { chosenTarget, stepChoices, type CrewSpark } from './spark-lookup.ts';
import { SparkDot } from './StagePreview.tsx';
import {
  canMove,
  retargetStep,
  targetKey,
  toggleParent,
  updateStep,
  type MoveDirection,
  type SparkName,
} from './workflow-model.ts';

interface StepInspectorProps {
  step: WorkflowStep | null;
  steps: readonly WorkflowStep[];
  labels: ReadonlyMap<string, string>;
  sparks: readonly CrewSpark[];
  sparkById: ReadonlyMap<string, CrewSpark>;
  workflows: readonly SparkName[];
  problems: readonly WorkflowProblem[];
  moved: readonly string[];
  onChange: (steps: WorkflowStep[]) => void;
  onMove: (direction: MoveDirection) => void;
  onRemove: () => void;
}

const JOINS = [
  { id: 'all', label: 'All finish' },
  { id: 'any', label: 'Any finishes' },
];
const FAILURES = [
  { id: 'stop', label: 'Stop workflow' },
  { id: 'continue', label: 'Continue' },
];

export function StepInspector(props: StepInspectorProps) {
  const { step, steps, labels, sparks, sparkById, workflows, problems, moved, onChange } = props;
  const ids = useId();
  if (!step) {
    return (
      <aside className="wf-inspector" aria-label="Step details">
        <p className="wf-hint">
          {steps.length === 0
            ? 'The details of the step you select show here.'
            : 'Select a step in the list or the graph to edit it.'}
        </p>
      </aside>
    );
  }
  const label = labels.get(step.id) ?? step.id;
  const others = steps.filter((other) => other.id !== step.id);
  const parents = new Set(step.dependsOn);
  const own = problems.filter((problem) => problem.stepId === step.id);
  const nested = step.workflowId !== undefined;
  return (
    <aside className="wf-inspector" aria-label={`Step ${label}`} data-inspect={step.id}>
      <header className="wf-inspector-head">
        <SparkDot spark={sparkById.get(step.sparkId ?? '')} workflow={nested} size={28} />
        <h3>{label}</h3>
        <button
          type="button"
          className="wf-icon"
          data-act="earlier"
          aria-label={`Move ${label} to an earlier stage`}
          title="Move to an earlier stage"
          disabled={!canMove(steps, step.id, 'earlier')}
          onClick={() => props.onMove('earlier')}
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
          onClick={() => props.onMove('later')}
        >
          <ArrowDownIcon />
        </button>
        <button
          type="button"
          className="wf-icon"
          data-act="remove"
          aria-label={`Remove ${label}`}
          title="Remove this step"
          onClick={props.onRemove}
        >
          <TrashIcon />
        </button>
      </header>
      <div className="wf-moved" role="status">
        {moved.length > 0 && (
          <>
            <b>What changed</b>
            <ul>
              {moved.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      {own.map((problem) => (
        <p key={`${problem.kind}:${problem.text}`} className="wf-problem">
          <WarnIcon />
          <span>
            <b>Problem</b> · {problem.text}
          </span>
        </p>
      ))}
      <div className="wf-fieldrow">
        <span className="wf-lbl">Runs</span>
        <ChoicePicker
          label={`Spark or workflow for ${label}`}
          showNote={false}
          value={targetKey(step)}
          placeholder="Choose a Spark or workflow"
          choices={stepChoices(sparks, workflows)}
          onChange={(choice) => {
            const target = chosenTarget(choice, sparkById, workflows);
            if (target) onChange(retargetStep(steps, step.id, target));
          }}
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
              onChange={() => onChange(toggleParent(steps, step.id, other.id))}
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
          <span className="wf-lbl" id={`${ids}-join`}>
            Start when
          </span>
          <Segmented
            ariaLabel={`When ${label} starts`}
            describedBy={`${ids}-join`}
            options={JOINS}
            value={step.join}
            onChange={(join) =>
              onChange(updateStep(steps, step.id, { join: join === 'any' ? 'any' : 'all' }))
            }
          />
        </div>
      )}
      <div className="wf-fieldrow">
        <span className="wf-lbl" id={`${ids}-fail`}>
          If it fails
        </span>
        <Segmented
          ariaLabel={`If ${label} fails`}
          describedBy={`${ids}-fail`}
          options={FAILURES}
          value={step.onFailure}
          onChange={(onFailure) =>
            onChange(
              updateStep(steps, step.id, {
                onFailure: onFailure === 'continue' ? 'continue' : 'stop',
              }),
            )
          }
        />
      </div>
      {nested && (
        <p className="wf-hint">
          Its steps run here as part of this workflow. Continue applies to every step inside it.
        </p>
      )}
      <label className="field" htmlFor={`${ids}-prompt`}>
        <span>Extra prompt</span>
        <textarea
          id={`${ids}-prompt`}
          className="inp"
          rows={4}
          maxLength={WORKFLOW_PROMPT_MAX}
          placeholder={
            nested
              ? 'Optional. Added to what every Spark in that workflow is told.'
              : 'Optional. Added to what this Spark is told for this step.'
          }
          value={step.prompt}
          onChange={(event) => onChange(updateStep(steps, step.id, { prompt: event.target.value }))}
        />
      </label>
    </aside>
  );
}

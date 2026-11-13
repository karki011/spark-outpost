import './workflow-editor.css';
import { lazy, Suspense, useId, useMemo, useRef, useState } from 'react';
import {
  WORKFLOW_NAME_MAX,
  workflowProblems,
  workflowStages,
  type Workflow,
  type WorkflowRun,
  type WorkflowStep,
} from '@spark-outpost/contracts';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { BackIcon, CheckIcon, EyeIcon, ResumeIcon, ShieldIcon, WarnIcon } from '../ui/icons.tsx';
import type { CrewSpark } from './spark-lookup.ts';
import { RunsList } from './RunsList.tsx';
import { StageList } from './StageList.tsx';
import { testRunApi } from './test-run-api.ts';
import { TestRun } from './TestRun.tsx';
import { useDeleteWorkflow, useSaveWorkflow, useStartWorkflowRun } from './use-workflows.ts';
import { WorkflowPreview } from './WorkflowPreview.tsx';
import { stepLabels, updateStep } from './workflow-model.ts';

const FlowGraph = lazy(() => import('./FlowGraph.tsx'));

interface WorkflowEditorProps {
  initial: Workflow | { id: string; name: string; steps: WorkflowStep[] };
  baseHash: string | null;
  sparks: readonly CrewSpark[];
  sparkById: ReadonlyMap<string, CrewSpark>;
  onClose: () => void;
  onOpenRun: (run: WorkflowRun) => void;
}

function count(total: number, word: string): string {
  return `${total} ${word}${total === 1 ? '' : 's'}`;
}

function blockers(name: string, steps: readonly WorkflowStep[], problems: number): string | null {
  if (name.trim() === '') return 'Give the workflow a name.';
  if (steps.length === 0) return 'Add a Spark to start.';
  if (problems > 0) return `Fix ${count(problems, 'problem')} to save.`;
  return null;
}

export function WorkflowEditor({
  initial,
  baseHash,
  sparks,
  sparkById,
  onClose,
  onOpenRun,
}: WorkflowEditorProps) {
  const nameId = useId();
  const [name, setName] = useState(initial.name);
  const [steps, setSteps] = useState<WorkflowStep[]>(initial.steps);
  const [hash, setHash] = useState(baseHash);
  const [saved, setSaved] = useState(() =>
    baseHash === null ? null : JSON.stringify([initial.name, initial.steps]),
  );
  const [previewing, setPreviewing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const realRun = useRef<WorkflowRun | null>(null);
  const save = useSaveWorkflow();
  const remove = useDeleteWorkflow();
  const run = useStartWorkflowRun();

  const sparkIds = useMemo(() => new Set(sparkById.keys()), [sparkById]);
  const problems = useMemo(() => workflowProblems(steps, sparkIds), [steps, sparkIds]);
  const labels = useMemo(() => stepLabels(steps, sparks), [steps, sparks]);
  const stages = workflowStages(steps).length;
  const dirty = saved !== JSON.stringify([name, steps]);
  const blocked = blockers(name, steps, problems.length);

  const onSave = () => {
    const workflow = { id: initial.id, name: name.trim(), steps };
    save.mutate(
      { workflow, baseHash: hash },
      {
        onSuccess: (file) => {
          setHash(file.hash);
          setSaved(JSON.stringify([name, steps]));
        },
      },
    );
  };
  const back = () => {
    if (previewing) setPreviewing(false);
    else if (dirty && !leaving) setLeaving(true);
    else onClose();
  };
  const error = save.error ?? remove.error ?? run.error;

  if (testing) {
    return (
      <section className="wf-editor" aria-label={`Workflow ${name.trim() || 'without a name'}`}>
        <TestRun
          name={name.trim()}
          steps={steps}
          labels={labels}
          sparkById={sparkById}
          form={{
            title: `Test run of ${name.trim()}`,
            hint: 'Real agents run every step on a throw-away copy of a project. Nothing is pushed, posted or saved.',
            placeholder: 'Review the last commit.',
            submitLabel: 'Start test run',
          }}
          start={(start) => testRunApi.startWorkflow(initial.id, start)}
          runForReal={async (start) => {
            realRun.current = await testRunApi.runForReal(initial.id, start);
          }}
          onClose={() => {
            setTesting(false);
            if (realRun.current) onOpenRun(realRun.current);
            realRun.current = null;
          }}
        />
      </section>
    );
  }

  return (
    <section className="wf-editor" aria-label={`Workflow ${name.trim() || 'without a name'}`}>
      <header className="wf-bar">
        <button type="button" className="btn ghost sm" onClick={back}>
          <BackIcon />
          {previewing ? 'Back to editing' : 'Workflows'}
        </button>
        <label className="sr-only" htmlFor={nameId}>
          Workflow name
        </label>
        <input
          id={nameId}
          className="inp wf-name"
          value={name}
          maxLength={WORKFLOW_NAME_MAX}
          placeholder="Workflow name"
          aria-invalid={name.trim() === '' || undefined}
          onChange={(event) => setName(event.target.value)}
        />
        <span className="wf-tag">
          {count(steps.length, 'step')} · {count(stages, 'stage')}
        </span>
        <span className="wf-bar-status" role="status">
          {!dirty && saved !== null && (
            <span className="wf-state" data-state="succeeded">
              <CheckIcon className="wf-state-ic" />
              Saved
            </span>
          )}
          {dirty && blocked === null && <span className="wf-hint">Not saved</span>}
        </span>
        <span className="wf-bar-acts">
          {!previewing && (
            <button
              type="button"
              className="btn line sm"
              disabled={steps.length === 0 || problems.length > 0}
              onClick={() => setPreviewing(true)}
            >
              <EyeIcon />
              Preview
            </button>
          )}
          <button
            type="button"
            className="btn line sm"
            disabled={blocked !== null || !dirty || save.isPending}
            onClick={onSave}
          >
            Save
          </button>
          <button
            type="button"
            className="btn line sm"
            disabled={blocked !== null || dirty}
            title={dirty ? 'Save before a test run' : undefined}
            onClick={() => setTesting(true)}
          >
            <ShieldIcon />
            Test run
          </button>
          <button
            type="button"
            className="btn primary sm"
            disabled={blocked !== null || dirty || run.isPending}
            title={dirty ? 'Save before running' : undefined}
            onClick={() => run.mutate(initial.id, { onSuccess: onOpenRun })}
          >
            <ResumeIcon />
            Run
          </button>
        </span>
      </header>
      {leaving && (
        <div className="wf-notice" role="alertdialog" aria-label="Leave without saving?">
          <span>
            <b>Leave without saving?</b> Your changes to this workflow will be lost.
          </span>
          <button type="button" className="btn line sm" autoFocus onClick={() => setLeaving(false)}>
            Keep editing
          </button>
          <button type="button" className="btn line sm" onClick={onClose}>
            Discard changes
          </button>
        </div>
      )}
      {error && (
        <p className="wf-problem wf-error" role="alert">
          <WarnIcon />
          <span>
            <b>Couldn’t finish</b> · {error.message}
          </span>
        </p>
      )}
      {previewing ? (
        <WorkflowPreview
          steps={steps}
          labels={labels}
          sparkById={sparkById}
          onContinue={(stepId) => setSteps(updateStep(steps, stepId, { onFailure: 'continue' }))}
        />
      ) : (
        <div className="wf-body">
          <div className="wf-col">
            <h3>Steps</h3>
            <p className="wf-hint">Steps in the same stage run at the same time.</p>
            {blocked !== null && (
              <p className="wf-problem" role="status">
                <WarnIcon />
                <span>
                  <b>Can’t save yet</b> · {blocked}
                </span>
              </p>
            )}
            <StageList
              steps={steps}
              labels={labels}
              sparks={sparks}
              sparkById={sparkById}
              problems={problems}
              onChange={setSteps}
            />
            {hash !== null && (
              <div className="wf-danger">
                <HoldToConfirm
                  label={`Hold to delete ${name.trim() || 'this workflow'}`}
                  hint="Hold to delete this workflow. This can’t be undone."
                  holdingHint="Keep holding to delete."
                  releasedHint="Released early. Nothing was deleted."
                  disabled={remove.isPending}
                  onConfirm={() => remove.mutate(initial.id, { onSuccess: onClose })}
                />
              </div>
            )}
          </div>
          <div className="wf-canvas">
            <p className="wf-canvas-cap">Preview · updates as you edit</p>
            <Suspense fallback={null}>
              <FlowGraph
                steps={steps}
                labels={labels}
                sparks={sparkById}
                label={`Graph of the workflow: ${count(steps.length, 'step')} in ${count(stages, 'stage')}`}
              />
            </Suspense>
          </div>
        </div>
      )}
      {!previewing && hash !== null && <RunsList workflowId={initial.id} onOpen={onOpenRun} />}
    </section>
  );
}

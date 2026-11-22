import './workflow-editor.css';
import { useMemo, useRef, useState } from 'react';
import {
  workflowProblems,
  workflowStages,
  type Workflow,
  type WorkflowRun,
  type WorkflowSchedule,
  type WorkflowStep,
  type WorkflowTriggers,
} from '@spark-outpost/contracts';
import { rememberWorkflowPlace, rememberedWorkflowPlace } from '../sparks-page/sparks-route.ts';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { WarnIcon } from '../ui/icons.tsx';
import { PageTabs } from '../ui/PageTabs.tsx';
import { EditorBar } from './EditorBar.tsx';
import { RunInChats } from './RunInChats.tsx';
import { RunStart } from './RunStart.tsx';
import { RunsTab } from './RunsTab.tsx';
import type { CrewSpark } from './spark-lookup.ts';
import { StepsTab } from './StepsTab.tsx';
import { testRunApi } from './test-run-api.ts';
import { TestRun } from './TestRun.tsx';
import { triggerLabels } from './triggers-model.ts';
import { useWorkflowActivity } from './use-activity.ts';
import { useWorkflowSchedule } from './use-schedule.ts';
import { useReleaseHold, useWorkflowTriggers } from './use-triggers.ts';
import { useWorkflowDraft } from './use-workflow-draft.ts';
import { useDeleteWorkflow, useStartWorkflowRun } from './use-workflows.ts';
import { WhenChips } from './WhenChips.tsx';
import { WhenTab } from './WhenTab.tsx';
import { baselineOf, draftProblems, toSchedule, type DraftTab } from './workflow-draft.ts';
import { WorkflowPreview } from './WorkflowPreview.tsx';
import { stepLabels, updateStep } from './workflow-model.ts';

type EditorTab = DraftTab | 'runs';
type Mode = 'edit' | 'preview' | 'test' | 'run';

const TAB_NAMES: Record<EditorTab, string> = {
  steps: 'Steps',
  when: 'When it runs',
  runs: 'Runs',
};

interface WorkflowEditorProps {
  initial: Workflow | { id: string; name: string; steps: WorkflowStep[] };
  baseHash: string | null;
  sparks: readonly CrewSpark[];
  sparkById: ReadonlyMap<string, CrewSpark>;
  onClose: () => void;
  onOpenRun: (run: WorkflowRun) => void;
}

interface EditorBodyProps extends WorkflowEditorProps {
  schedule: WorkflowSchedule | null;
  triggers: WorkflowTriggers | null;
}

function count(total: number, word: string): string {
  return `${total} ${word}${total === 1 ? '' : 's'}`;
}

function startTab(workflowId: string): EditorTab {
  const place = rememberedWorkflowPlace();
  const tab = place?.workflowId === workflowId ? place.tab : 'steps';
  return tab === 'when' || tab === 'runs' ? tab : 'steps';
}

function EditorBody({ initial, baseHash, sparks, sparkById, onClose, ...props }: EditorBodyProps) {
  const { id } = initial;
  const editor = useWorkflowDraft({
    id,
    hash: baseHash,
    fresh: { name: initial.name, steps: initial.steps },
    baseline: baselineOf(
      baseHash === null ? null : { name: initial.name, steps: initial.steps },
      props.schedule,
      props.triggers,
      new Date(),
    ),
  });
  const { draft, setDraft, hash, baseline } = editor;
  const saved = hash !== null;
  const [tab, setTab] = useState<EditorTab>(() => startTab(id));
  const [mode, setMode] = useState<Mode>('edit');
  const [selected, setSelected] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const realRun = useRef<WorkflowRun | null>(null);
  const remove = useDeleteWorkflow();
  const run = useStartWorkflowRun();
  const release = useReleaseHold(id);
  const activity = useWorkflowActivity(id, saved);
  const scheduleView = useWorkflowSchedule(id, saved);

  const sparkIds = useMemo(() => new Set(sparkById.keys()), [sparkById]);
  const stepProblems = useMemo(
    () => workflowProblems(draft.steps, sparkIds),
    [draft.steps, sparkIds],
  );
  const labels = useMemo(() => stepLabels(draft.steps, sparks), [draft.steps, sparks]);
  const problems = draftProblems(draft, stepProblems.length);
  const blocked = problems[0] ?? null;
  const busy = editor.saving || run.isPending;
  const name = draft.name.trim();
  const on = (draft.schedule.enabled ? 1 : 0) + triggerLabels(draft.triggers).length;
  const ran = activity.rows.filter((row) => row.runId !== null).length;

  const showTab = (next: EditorTab) => {
    setTab(next);
    if (saved) rememberWorkflowPlace({ workflowId: id, tab: next });
  };
  const saveThen = async (action: () => void) => {
    if (editor.dirty && !(await editor.save())) return;
    rememberWorkflowPlace({ workflowId: id, tab });
    action();
  };
  const back = () => {
    if (mode === 'preview') setMode('edit');
    else if (editor.dirty && !leaving) setLeaving(true);
    else onClose();
  };
  const openRun = (runId: string) => {
    const found = activity.runs.find((entry) => entry.id === runId);
    if (found) props.onOpenRun(found);
  };
  const prefix = editor.dirty ? 'Save and run' : 'Run';
  const runItems = [
    {
      id: 'now',
      label: `${prefix} now`,
      onSelect: () => void saveThen(() => run.mutate({ id }, { onSuccess: props.onOpenRun })),
    },
    {
      id: 'with',
      label: `${prefix} with a message and project…`,
      onSelect: () => void saveThen(() => setMode('run')),
    },
    {
      id: 'chats',
      label: `${prefix} in chats…`,
      onSelect: () => void saveThen(() => setPicking(true)),
    },
  ];
  const error = remove.error?.message ?? (mode === 'run' ? null : run.error?.message) ?? null;
  const label = `Workflow ${name || 'without a name'}`;

  if (mode === 'test') {
    return (
      <section className="wf-editor" aria-label={label}>
        <TestRun
          name={name}
          steps={draft.steps}
          labels={labels}
          sparkById={sparkById}
          form={{
            title: `Test run of ${name}`,
            hint: 'Real agents run every step on a throw-away copy of a project. Nothing is pushed, posted or saved.',
            placeholder: 'Review the last commit.',
            submitLabel: 'Start test run',
          }}
          start={(start) => testRunApi.startWorkflow(id, start)}
          runForReal={async (start) => {
            realRun.current = await testRunApi.runForReal(id, start);
          }}
          onClose={() => {
            setMode('edit');
            if (realRun.current) props.onOpenRun(realRun.current);
            realRun.current = null;
          }}
        />
      </section>
    );
  }
  if (mode === 'run') {
    return (
      <section className="wf-editor" aria-label={label}>
        <RunStart
          name={name}
          starting={run.isPending}
          error={run.error?.message ?? null}
          onStart={(start) => run.mutate({ id, ...start }, { onSuccess: props.onOpenRun })}
          onCancel={() => {
            run.reset();
            setMode('edit');
          }}
        />
      </section>
    );
  }

  return (
    <section className="wf-editor" aria-label={label}>
      <EditorBar
        name={draft.name}
        summary={`${count(draft.steps.length, 'step')} · ${count(workflowStages(draft.steps).length, 'stage')}`}
        chips={
          <WhenChips
            schedule={saved ? toSchedule(baseline.schedule) : null}
            triggers={saved ? baseline.triggers : null}
          />
        }
        previewing={mode === 'preview'}
        saved={saved}
        changes={editor.changes}
        blocked={blocked?.text ?? null}
        busy={busy}
        canPreview={draft.steps.length > 0 && stepProblems.length === 0}
        runItems={runItems}
        onName={(next) => setDraft({ ...draft, name: next })}
        onBack={back}
        onPreview={() => setMode('preview')}
        onTestRun={() => void saveThen(() => setMode('test'))}
        onSave={() => void saveThen(() => undefined)}
      />
      {leaving && (
        <div className="wf-notice" role="alertdialog" aria-label="Leave without saving?">
          <span>
            <b>Leave without saving?</b> Your {count(editor.changes, 'unsaved change')} to the
            steps, the schedule and the triggers will be lost.
          </span>
          <button type="button" className="btn line sm" autoFocus onClick={() => setLeaving(false)}>
            Keep editing
          </button>
          <button type="button" className="btn line sm" onClick={onClose}>
            Discard changes
          </button>
        </div>
      )}
      {editor.failure !== null && (
        <p className="wf-problem wf-error" role="alert">
          <WarnIcon />
          <span>
            <b>Not everything saved</b> · {editor.failure}
          </span>
        </p>
      )}
      {error !== null && (
        <p className="wf-problem wf-error" role="alert">
          <WarnIcon />
          <span>
            <b>Couldn’t finish</b> · {error}
          </span>
        </p>
      )}
      {blocked !== null && mode === 'edit' && (
        <p className="wf-problem wf-error" role="status">
          <WarnIcon />
          <span>
            <b>Can’t save yet</b> · {blocked.text}
          </span>
          {blocked.tab !== tab && (
            <button type="button" className="btn line sm" onClick={() => showTab(blocked.tab)}>
              Show in {TAB_NAMES[blocked.tab]}
            </button>
          )}
        </p>
      )}
      {mode === 'preview' ? (
        <WorkflowPreview
          steps={draft.steps}
          labels={labels}
          sparkById={sparkById}
          onContinue={(stepId) =>
            setDraft({
              ...draft,
              steps: updateStep(draft.steps, stepId, { onFailure: 'continue' }),
            })
          }
        />
      ) : (
        <>
          <PageTabs
            ariaLabel="Workflow sections"
            options={[
              { id: 'steps', label: TAB_NAMES.steps, count: draft.steps.length || null },
              { id: 'when', label: TAB_NAMES.when, count: on || null },
              { id: 'runs', label: TAB_NAMES.runs, count: ran || null },
            ]}
            value={tab}
            onChange={(next) => showTab(next as EditorTab)}
          />
          {tab === 'steps' && (
            <StepsTab
              steps={draft.steps}
              labels={labels}
              sparks={sparks}
              sparkById={sparkById}
              problems={stepProblems}
              selected={selected}
              onSelect={setSelected}
              onChange={(steps) => setDraft({ ...draft, steps })}
              footer={
                saved && (
                  <div className="wf-danger">
                    <HoldToConfirm
                      label={`Hold to delete ${name || 'this workflow'}`}
                      hint="Hold to delete this workflow. This can’t be undone."
                      holdingHint="Keep holding to delete."
                      releasedHint="Released early. Nothing was deleted."
                      disabled={remove.isPending}
                      onConfirm={() => remove.mutate(id, { onSuccess: onClose })}
                    />
                  </div>
                )
              }
            />
          )}
          {tab === 'when' && (
            <WhenTab
              draft={draft}
              problems={problems}
              sparkById={sparkById}
              lastRunCostUsd={scheduleView.data?.lastRunCostUsd ?? null}
              activity={activity}
              releasing={release.isPending}
              onChange={setDraft}
              onOpenRun={openRun}
              onRelease={(holdId) => release.mutate(holdId)}
              onAllRuns={() => showTab('runs')}
            />
          )}
          {tab === 'runs' && (
            <RunsTab
              saved={saved}
              activity={activity}
              releasing={release.isPending}
              releaseError={release.error?.message ?? null}
              onOpenRun={openRun}
              onRelease={(holdId) => release.mutate(holdId)}
            />
          )}
        </>
      )}
      {picking && (
        <RunInChats workflowId={id} workflowName={name} onClose={() => setPicking(false)} />
      )}
    </section>
  );
}

export function WorkflowEditor(props: WorkflowEditorProps) {
  const saved = props.baseHash !== null;
  const schedule = useWorkflowSchedule(props.initial.id, saved);
  const triggers = useWorkflowTriggers(props.initial.id, saved);
  if (!saved) return <EditorBody {...props} schedule={null} triggers={null} />;
  if (schedule.data && triggers.data) {
    return (
      <EditorBody {...props} schedule={schedule.data.schedule} triggers={triggers.data.triggers} />
    );
  }
  const error = schedule.error ?? triggers.error;
  if (!error) return <section className="wf-editor" aria-busy="true" />;
  return (
    <section className="wf-editor">
      <p className="wf-problem wf-error" role="alert">
        <WarnIcon />
        <span>
          <b>Couldn’t load when this workflow runs</b> · {error.message}
        </span>
      </p>
      <button type="button" className="btn line sm wf-load-back" onClick={props.onClose}>
        Back to workflows
      </button>
    </section>
  );
}

import './workflow-editor.css';
import './run-view.css';
import { lazy, Suspense, useMemo, useState } from 'react';
import type { WorkflowRun } from '@spark-outpost/contracts';
import { requestChat } from '../app/chat-request.ts';
import { agentAnchor, approvalAnchor } from '../crew/conversation-crew.ts';
import { JUMP_TRIES, scrollToAnchor } from '../crew/scroll-to-anchor.ts';
import { BackIcon, InfoIcon, WarnIcon, XIcon } from '../ui/icons.tsx';
import {
  SOURCE_WORDS,
  finishedEdges,
  isLive,
  outcomeText,
  passedTo,
  runWhen,
  statusParts,
  stepStates,
  waitingApproval,
} from './run-model.ts';
import { RunState } from './RunState.tsx';
import { RunStepList } from './RunStepList.tsx';
import { RunStepPanel } from './RunStepPanel.tsx';
import type { CrewSpark } from './spark-lookup.ts';
import { useNow, useRunChat, useStopWorkflowRun, useWorkflowRun } from './use-workflow-runs.ts';
import { stepLabels } from './workflow-model.ts';

const FlowGraph = lazy(() => import('./FlowGraph.tsx'));

interface RunViewProps {
  runId: string;
  seed?: WorkflowRun;
  sparks: readonly CrewSpark[];
  sparkById: ReadonlyMap<string, CrewSpark>;
  backLabel: string;
  onBack: () => void;
}

function followed(run: WorkflowRun): string | null {
  const running = run.steps.find((step) => step.state === 'running');
  return running?.stepId ?? run.stoppedBy ?? run.steps[0]?.stepId ?? null;
}

function Loaded({
  run,
  sparks,
  sparkById,
  backLabel,
  onBack,
}: Omit<RunViewProps, 'runId' | 'seed'> & { run: WorkflowRun }) {
  const [picked, setPicked] = useState<string | null>(null);
  const live = isLive(run);
  const now = useNow(live);
  const stop = useStopWorkflowRun();
  const chat = useRunChat(run.conversationId);
  const inChat = run.conversationId !== null;

  const graphSteps = useMemo(
    () =>
      run.steps.map((step) => ({
        id: step.stepId,
        sparkId: step.sparkId,
        dependsOn: step.dependsOn,
      })),
    [run.steps],
  );
  const labels = useMemo(() => stepLabels(graphSteps, sparks), [graphSteps, sparks]);
  const states = useMemo(() => stepStates(run.steps), [run.steps]);
  const finished = useMemo(() => finishedEdges(run.steps), [run.steps]);
  const approvals = chat.data?.approvals;
  const asking = useMemo(() => {
    const cards = new Map<string, string>();
    for (const step of run.steps) {
      const card = waitingApproval(step, approvals ?? []);
      if (card) cards.set(step.stepId, card);
    }
    return cards;
  }, [run.steps, approvals]);
  const askingIds = useMemo(() => new Set(asking.keys()), [asking]);

  const selectedId = picked ?? followed(run);
  const selected = run.steps.find((step) => step.stepId === selectedId) ?? null;
  const members = (run.runId && chat.data?.orchestrations?.[run.runId]?.crew) || [];
  const outcome = outcomeText(run, labels);
  const [done, ...numbers] = statusParts(run, now);
  const openChat = (anchor: string | null) => {
    if (run.conversationId === null) return;
    requestChat(run.conversationId);
    if (anchor) scrollToAnchor(anchor, JUMP_TRIES);
  };

  return (
    <section className="wf-editor wf-run" aria-label={`Run of ${run.workflowName}`}>
      <header className="wf-bar">
        <button type="button" className="btn ghost sm" onClick={onBack}>
          <BackIcon />
          {backLabel}
        </button>
        <h2 className="wf-run-title">{run.workflowName}</h2>
        <span className="wf-tag">
          {SOURCE_WORDS[run.source]} · {runWhen(run)}
        </span>
        <span className="wf-bar-acts">
          {inChat && (
            <button type="button" className="btn line sm" onClick={() => openChat(null)}>
              Open chat
            </button>
          )}
          {live && (
            <button
              type="button"
              className="btn line sm"
              disabled={stop.isPending || stop.isSuccess}
              onClick={() => stop.mutate(run.id)}
            >
              <XIcon />
              {stop.isPending || stop.isSuccess ? 'Stopping…' : 'Stop'}
            </button>
          )}
        </span>
      </header>
      <div className="wf-run-status">
        <span className="wf-run-live" role="status">
          <RunState status={run.status} />
          <span>{done}</span>
          {askingIds.size > 0 && <span>{askingIds.size} waiting for your answer</span>}
        </span>
        {numbers.map((part) => (
          <span key={part}>{part}</span>
        ))}
      </div>
      {stop.error && (
        <p className="wf-problem wf-error" role="alert">
          <WarnIcon />
          <span>
            <b>Couldn’t stop</b> · {stop.error.message}
          </span>
        </p>
      )}
      {outcome && (
        <p className="wf-run-outcome" data-state={run.status} role="status">
          {run.status === 'failed' ? <WarnIcon /> : <InfoIcon />}
          <span>{outcome}</span>
        </p>
      )}
      {!inChat && (
        <p className="wf-run-outcome" role="note">
          <InfoIcon />
          <span>The chat this ran in was deleted, so step details and links are gone.</span>
        </p>
      )}
      <div className="wf-body">
        <div className="wf-canvas">
          <Suspense fallback={null}>
            <FlowGraph
              steps={graphSteps}
              labels={labels}
              sparks={sparkById}
              states={states}
              finished={finished}
              asking={askingIds}
              selected={selectedId}
              label={`Graph of this run: ${done}`}
            />
          </Suspense>
        </div>
        <div className="wf-col wf-col-right">
          <h3>All steps</h3>
          <RunStepList
            steps={run.steps}
            labels={labels}
            sparkById={sparkById}
            asking={askingIds}
            selected={selectedId}
            now={now}
            onSelect={setPicked}
          />
          {selected && (
            <RunStepPanel
              step={selected}
              label={labels.get(selected.stepId) ?? selected.stepId}
              spark={sparkById.get(selected.sparkId)}
              member={members.find((member) => member.runId === selected.runId)}
              approvalId={asking.get(selected.stepId) ?? null}
              passedTo={passedTo(run.steps, selected.stepId).map((stepId) => ({
                stepId,
                label: labels.get(stepId) ?? stepId,
              }))}
              now={now}
              inChat={inChat}
              onSelect={setPicked}
              onOpenTurn={() =>
                openChat(
                  run.runId && selected.runId ? agentAnchor(run.runId, selected.runId) : null,
                )
              }
              onOpenCard={(approvalId) => openChat(approvalAnchor(approvalId))}
            />
          )}
        </div>
      </div>
    </section>
  );
}

export function RunView({ runId, seed, ...rest }: RunViewProps) {
  const run = useWorkflowRun(runId, seed);
  if (run.data) return <Loaded run={run.data} {...rest} />;
  return (
    <section className="wf-editor wf-run" aria-label="Workflow run" aria-busy={run.isPending}>
      <header className="wf-bar">
        <button type="button" className="btn ghost sm" onClick={rest.onBack}>
          <BackIcon />
          {rest.backLabel}
        </button>
      </header>
      {run.error && (
        <p className="wf-problem wf-error" role="alert">
          <WarnIcon />
          <span>
            <b>Couldn’t load this run</b> · {run.error.message}
          </span>
        </p>
      )}
    </section>
  );
}

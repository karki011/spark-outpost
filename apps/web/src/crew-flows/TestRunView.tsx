import './test-run.css';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TEST_RUN_LIMITS,
  type Approval,
  type WorkflowStep,
  type WorkflowStepState,
  type WorkflowTestRun,
} from '@spark-outpost/contracts';
import { approvalsApi } from '../api/approvals.ts';
import { ResumeIcon, ShieldIcon, TrashIcon, WarnIcon } from '../ui/icons.tsx';
import type { CrewSpark } from './spark-lookup.ts';
import { SparkDot } from './StagePreview.tsx';
import { StepState } from './StepState.tsx';
import { testRunApi, testRunKeys } from './test-run-api.ts';
import {
  cardAnswers,
  cardStep,
  copyLine,
  firstShown,
  heldLine,
  polls,
  progressLine,
  runWord,
  stepTime,
} from './test-run-model.ts';

const FlowGraph = lazy(() => import('./FlowGraph.tsx'));
const POLL_MS = 1500;

interface TestRunViewProps {
  runId: string;
  name: string;
  steps: readonly WorkflowStep[];
  labels: ReadonlyMap<string, string>;
  sparkById: ReadonlyMap<string, CrewSpark>;
  discarding: boolean;
  onDiscard: () => void;
  onRunForReal?: (test: WorkflowTestRun) => void;
  runForRealPending?: boolean;
  error: string | null;
}

function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

function WaitingCard({ card, step, runId }: { card: Approval; step: string; runId: string }) {
  const client = useQueryClient();
  const answer = useMutation({
    mutationFn: (optionId: string) =>
      approvalsApi.decide(card.id, { optionId, payloadHash: card.payloadHash }),
    onSettled: () => client.invalidateQueries({ queryKey: testRunKeys.one(runId) }),
  });
  return (
    <li className="wf-test-card">
      <b>{step} is waiting for your OK</b>
      <code>{card.payload.command ?? card.title}</code>
      {card.reason && <span className="wf-hint">{card.reason}</span>}
      <span className="wf-test-acts">
        {cardAnswers(card).map((option) => (
          <button
            key={option.optionId}
            type="button"
            className={option.allows ? 'btn primary sm' : 'btn line sm'}
            disabled={answer.isPending}
            onClick={() => answer.mutate(option.optionId)}
          >
            {option.label}
          </button>
        ))}
      </span>
      {answer.error && (
        <span className="wf-hint" role="alert">
          {answer.error.message}
        </span>
      )}
    </li>
  );
}

export function TestRunView(props: TestRunViewProps) {
  const { runId, steps, labels, sparkById } = props;
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({
    queryKey: testRunKeys.one(runId),
    queryFn: () => testRunApi.get(runId),
    refetchInterval: (state) => (polls(state.state.data) ? POLL_MS : false),
    retry: false,
  });
  const test = query.data;
  const now = useNow(test?.run.status === 'running');
  const states = useMemo<Record<string, WorkflowStepState>>(
    () => Object.fromEntries((test?.run.steps ?? []).map((step) => [step.stepId, step.state])),
    [test],
  );
  const label = (id: string) => labels.get(id) ?? id;
  const shownId = test ? firstShown(test.run, selected) : null;
  const shown = test?.run.steps.find((step) => step.stepId === shownId);
  const problem = props.error ?? query.error?.message ?? null;

  return (
    <section className="wf-test" aria-label={`Test run of ${props.name}`}>
      <header className="wf-test-bar">
        <span className="wf-test-title">{props.name}</span>
        <span className="wf-test-acts wf-test-end">
          <button
            type="button"
            className="btn line sm"
            disabled={props.discarding}
            onClick={props.onDiscard}
          >
            <TrashIcon />
            Discard
          </button>
          {props.onRunForReal && (
            <button
              type="button"
              className="btn primary sm"
              disabled={!test || props.runForRealPending || props.discarding}
              onClick={() => test && props.onRunForReal?.(test)}
            >
              <ResumeIcon />
              Run for real
            </button>
          )}
        </span>
      </header>
      <div className="wf-banner">
        <span className="wf-banner-t">
          <ShieldIcon />
          <b>Test run</b>
        </span>
        <span className="wf-banner-d">{test ? copyLine(test) : 'Starting…'}</span>
        {test && (
          <span className="wf-test-progress" role="status">
            <b>{runWord(test.run)}</b> · {progressLine(test, now)}
          </span>
        )}
      </div>
      {problem && (
        <p className="wf-problem wf-error" role="alert">
          <WarnIcon />
          <span>
            <b>Couldn’t finish</b> · {problem}
          </span>
        </p>
      )}
      {test && (
        <div className="wf-body wf-test-body">
          {steps.length > 1 && (
            <div className="wf-canvas">
              <Suspense fallback={null}>
                <FlowGraph
                  steps={steps}
                  labels={labels}
                  sparks={sparkById}
                  states={states}
                  label={`Test run of ${props.name}. ${runWord(test.run)}.`}
                />
              </Suspense>
            </div>
          )}
          <div className="wf-col wf-col-right wf-test-side">
            {test.waiting.length > 0 && (
              <ul className="wf-test-list" aria-label="Waiting for your OK">
                {test.waiting.map((card) => (
                  <WaitingCard
                    key={card.id}
                    card={card}
                    runId={runId}
                    step={label(cardStep(card, test.run) ?? 'A step')}
                  />
                ))}
              </ul>
            )}
            <h3>Steps</h3>
            <ul className="wf-test-steps" aria-label="Steps">
              {test.run.steps.map((step) => (
                <li key={step.stepId}>
                  <button
                    type="button"
                    className="wf-test-step"
                    aria-pressed={step.stepId === shownId}
                    onClick={() => setSelected(step.stepId)}
                  >
                    <SparkDot spark={sparkById.get(step.sparkId)} size={24} />
                    <b>{label(step.stepId)}</b>
                    <StepState state={step.state} />
                  </button>
                </li>
              ))}
            </ul>
            <h3>Would have been sent</h3>
            <p className="wf-hint">Held back because this is a test run.</p>
            {test.held.length === 0 ? (
              <p className="wf-hint">
                {test.run.status === 'running' ? 'Nothing so far.' : 'Nothing was held.'}
              </p>
            ) : (
              <ul className="wf-test-list" aria-label="Would have been sent">
                {test.held.map((held) => {
                  const line = heldLine(held, labels);
                  return (
                    <li key={held.id} className="wf-test-held">
                      <span>
                        <b>{line.kind}</b>
                        {line.step ? ` · ${line.step}` : ''}
                      </span>
                      <span className="wf-test-summary">{line.summary}</span>
                      <span className="wf-hint">Not sent</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <h3>Step output</h3>
            {shown ? (
              <>
                <p className="wf-hint">
                  {[label(shown.stepId), stepTime(shown, now)].filter(Boolean).join(' · ')}
                </p>
                <div className="wf-test-out" role="region" aria-label="Step output" tabIndex={0}>
                  {shown.note ?? (shown.state === 'running' ? 'Working…' : 'No output.')}
                </div>
              </>
            ) : (
              <p className="wf-hint">No steps.</p>
            )}
            <p className="wf-hint">
              Closing this view deletes the copy and this run. {TEST_RUN_LIMITS}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

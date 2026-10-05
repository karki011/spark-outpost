import type { ReactNode } from 'react';
import {
  isTerminalRunStatus,
  type Approval,
  type ConversationDetail,
  type Message,
  type Project,
  type Run,
  type TerminalRunStatus,
} from '@spark-outpost/contracts';
import { RunUsageMeta } from '../usage/RunUsageMeta.tsx';
import { AiTurn, type TurnState } from './AiTurn.tsx';
import { ApprovalCard } from './approvals/ApprovalCard.tsx';
import { decidedFirst, hasPending } from './approvals/approval-events.ts';
import { BrowserCheckMeta } from '../browser/BrowserCheckMeta.tsx';
import { BrowserShots } from './../browser/BrowserShots.tsx';
import { RailFlags } from './approvals/RailFlags.tsx';
import { RevertRun } from './approvals/RevertRun.tsx';
import { FilesChanged, taskForRuns } from './changes/FilesChanged.tsx';
import { CheckpointCard } from './checkpoints/CheckpointCard.tsx';
import { isCheckpoint } from './checkpoints/checkpoint-model.ts';
import { mergeCheckpoints, shownApprovals } from './crew/crew-items.ts';
import { MakeChange } from './make-change/MakeChange.tsx';
import { MessageActions } from './message-actions/MessageActions.tsx';
import { Markdown } from './markdown/Markdown.tsx';
import { keepCardHost } from './outcomes/feedback-host.ts';
import { ReplyPlanAction, TurnPlanOffer } from './plans/TurnPlans.tsx';
import { TurnFeedback } from './outcomes/TurnFeedback.tsx';
import { KeepCardFooter } from './outcomes/KeepCardFooter.tsx';
import {
  shownText,
  streamLeads,
  type LiveRunStatus,
  type RunProjection,
} from './run-projection.ts';
import { providerName } from './provider-name.ts';
import { useLiveReport } from './status/status-context.ts';
import { runSeconds } from './turns.ts';
import { useRunStream } from './use-run-stream.ts';
import { StepList, StepToggle, turnHeading, useStepLog } from './WorkLog.tsx';

const liveStates: Record<LiveRunStatus, TurnState> = {
  connecting: 'working',
  running: 'working',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'stopped',
};

const liveMoods: Record<LiveRunStatus, string> = {
  connecting: 'working',
  running: 'working',
  succeeded: 'done',
  failed: 'hit a problem',
  cancelled: 'stopped',
};

const finishedStates: Record<TerminalRunStatus, TurnState> = {
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'stopped',
  outcome_unknown: 'stopped',
};

const finishedMoods: Record<TerminalRunStatus, string> = {
  succeeded: 'done',
  failed: 'hit a problem',
  cancelled: 'stopped',
  outcome_unknown: 'interrupted',
};

interface SoloTurnProps {
  run: Run;
  taskCount?: ReactNode;
  detail: ConversationDetail;
  assistantMessage: Message | null;
  repo: Project | null;
}

function soloChild(run: Run, detail: ConversationDetail) {
  const crew = detail.orchestrations?.[run.id]?.crew ?? [];
  const member = crew.findLast((candidate) => candidate.role !== 'spark') ?? null;
  const child = member
    ? (detail.runs.find((candidate) => candidate.id === member.runId) ?? null)
    : null;
  return { member, child };
}

function turnApprovals(
  run: Run,
  detail: ConversationDetail,
  stream: RunProjection,
  memberRunId: string | null,
): Approval[] {
  const stored = detail.approvals.filter(
    (approval) =>
      (approval.runId === run.id || approval.runId === memberRunId) && !isCheckpoint(approval),
  );
  if (isTerminalRunStatus(run.status)) return shownApprovals(stored);
  const pendingCheckpoint = detail.orchestrations?.[run.id]?.pendingCheckpoint;
  return shownApprovals(stored, pendingCheckpoint ? [pendingCheckpoint] : [], stream.approvals);
}

function turnStatus(run: Run, stream: RunProjection, waiting: boolean) {
  if (isTerminalRunStatus(run.status)) {
    return { state: finishedStates[run.status], label: finishedMoods[run.status] };
  }
  if (waiting) return { state: 'waiting' as const, label: 'waiting for you' };
  return { state: liveStates[stream.status], label: liveMoods[stream.status] };
}

export function SoloTurn({ run, detail, assistantMessage, repo, taskCount }: SoloTurnProps) {
  const { member, child } = soloChild(run, detail);
  const provider = member?.provider ?? run.provider;
  const finished = isTerminalRunStatus(run.status);
  const stream = useRunStream(member?.runId ?? run.id, detail.conversation.id, !finished);
  const leads = streamLeads(stream, finished);
  const active = stream.status === 'connecting' || stream.status === 'running';
  const working = !finished && active;
  const approvals = turnApprovals(run, detail, stream, member?.runId ?? null);
  const waiting = working && hasPending(approvals);
  const cards = decidedFirst(approvals);
  const approvalCard = (approval: Approval) =>
    isCheckpoint(approval) ? (
      <CheckpointCard key={approval.id} approval={approval} />
    ) : (
      <ApprovalCard key={approval.id} approval={approval} provider={provider} repo={repo} />
    );
  const { state, label } = turnStatus(run, stream, waiting);

  const persistedSteps = detail.activity[run.id]?.length
    ? detail.activity[run.id]!
    : (detail.activity[member?.runId ?? ''] ?? []);
  const steps = leads || persistedSteps.length === 0 ? stream.steps : persistedSteps;
  useLiveReport(
    { id: run.id, name: providerName(provider), provider, kind: 'agent' },
    working,
    steps,
  );
  const persistedText =
    assistantMessage?.content ??
    detail.messages.find((message) => message.role === 'assistant' && message.runId === child?.id)
      ?.content;
  const text = shownText(stream, persistedText, finished);
  const interrupted = run.status === 'outcome_unknown';
  const error = finished ? (interrupted ? null : run.error) : stream.error;
  const checkpoints = finished
    ? mergeCheckpoints(detail.orchestrations?.[run.id]?.checkpoints ?? [])
    : [];
  const revertible = finished
    ? [run, child].find(
        (candidate): candidate is Run => candidate?.mode === 'do' && candidate.snapshot !== null,
      )
    : undefined;
  const host = finished ? keepCardHost(checkpoints, Boolean(revertible?.revertedAt)) : null;

  const turnRuns = [run, child].filter((candidate): candidate is Run => Boolean(candidate));
  const changeRunIds = turnRuns.map((candidate) => candidate.id);
  const seconds = finished ? runSeconds(run) : null;
  const log = useStepLog(steps, state);
  const changeTask =
    finished && turnRuns.some((candidate) => candidate.mode === 'do')
      ? taskForRuns(detail.tasks, changeRunIds)
      : null;

  return (
    <AiTurn
      provider={provider}
      label={working && !waiting && !log && !text ? 'thinking' : label}
      state={state}
      liveId={working && !waiting ? run.id : null}
      category={run.category}
      advice={detail.advice?.[run.id]}
      following={child?.following ?? run.following}
      status={
        log || taskCount ? (
          <>
            {log && (
              <StepToggle log={log} label={turnHeading(log.views, state, seconds, log.open)} />
            )}
            {log && taskCount && (
              <span className="mood-dot" aria-hidden="true">
                ·
              </span>
            )}
            {taskCount}
          </>
        ) : null
      }
    >
      {log && (
        <div className={log.open ? 'steps open' : 'steps'}>
          <StepList log={log} />
        </div>
      )}
      <TurnPlanOffer detail={detail} runId={run.id} />
      <RailFlags detail={detail} runId={run.id} />
      <BrowserShots detail={detail} runId={run.id} />
      {cards.decided.map(approvalCard)}
      {text && <Markdown text={text} streaming={leads && active} />}
      {cards.pending.map(approvalCard)}
      <ReplyPlanAction
        detail={detail}
        message={assistantMessage}
        finished={finished}
        category={run.category}
      />
      {finished && <MakeChange run={run} detail={detail} />}
      {run.status === 'cancelled' && <p className="ai-note">Stopped before finishing.</p>}
      {error && <p className="error-line">{error}</p>}
      {finished && (
        <div className="turn-foot">
          <RunUsageMeta run={child?.usage ? child : run} />
          <BrowserCheckMeta
            detail={detail}
            run={run}
            taskId={changeTask?.id ?? null}
            runIds={changeRunIds}
          />
          {text && (
            <MessageActions
              text={text}
              createdAt={assistantMessage?.createdAt ?? run.finishedAt ?? run.createdAt}
              copyLabel="Copy reply"
              side="assistant"
            />
          )}
          {!host && <TurnFeedback runId={run.id} variant="turn" />}
        </div>
      )}
      {changeTask && <FilesChanged taskId={changeTask.id} runIds={changeRunIds} />}
      {checkpoints.map((approval) => (
        <CheckpointCard
          key={approval.id}
          approval={approval}
          footer={
            host?.approvalId === approval.id ? (
              <KeepCardFooter
                runId={run.id}
                host={host}
                taskId={changeTask?.id ?? null}
                conversationId={detail.conversation.id}
              />
            ) : undefined
          }
        />
      ))}
      {revertible && <RevertRun run={revertible} />}
    </AiTurn>
  );
}

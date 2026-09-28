import {
  isCheckApproval,
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
import { hasPending } from './approvals/approval-events.ts';
import { RevertRun } from './approvals/RevertRun.tsx';
import { FilesChanged, taskForRuns } from './changes/FilesChanged.tsx';
import { CheckpointCard } from './checkpoints/CheckpointCard.tsx';
import { isCheckpoint } from './checkpoints/checkpoint-model.ts';
import { mergeCheckpoints } from './crew/crew-items.ts';
import { MessageActions } from './message-actions/MessageActions.tsx';
import { Markdown } from './markdown/Markdown.tsx';
import { keepCardHost } from './outcomes/feedback-host.ts';
import { ReplyPlanAction, TurnPlanOffer } from './plans/TurnPlans.tsx';
import { TurnFeedback } from './outcomes/TurnFeedback.tsx';
import {
  shownText,
  streamLeads,
  type LiveRunStatus,
  type RunProjection,
} from './run-projection.ts';
import { runSeconds } from './turns.ts';
import { useRunStream } from './use-run-stream.ts';
import { WorkLog } from './WorkLog.tsx';

const liveStates: Record<LiveRunStatus, TurnState> = {
  connecting: 'working',
  running: 'working',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'stopped',
};

const liveMoods: Record<LiveRunStatus, string> = {
  connecting: 'thinking',
  running: 'thinking',
  succeeded: 'done',
  failed: 'hit a problem',
  cancelled: 'stopped',
};

const finishedStates: Record<TerminalRunStatus, TurnState> = {
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'stopped',
  outcome_unknown: 'failed',
};

const finishedMoods: Record<TerminalRunStatus, string> = {
  succeeded: 'done',
  failed: 'hit a problem',
  cancelled: 'stopped',
  outcome_unknown: 'outcome unknown',
};

interface SoloTurnProps {
  run: Run;
  detail: ConversationDetail;
  assistantMessage: Message | null;
  repo: Project | null;
}

function soloChild(run: Run, detail: ConversationDetail) {
  const member = detail.orchestrations?.[run.id]?.crew.at(-1) ?? null;
  const child = member
    ? (detail.runs.find((candidate) => candidate.id === member.runId) ?? null)
    : null;
  return { member, child };
}

function liveApprovals(stream: RunProjection, pending: readonly Approval[]): readonly Approval[] {
  const extra = pending.filter(
    (approval) => !stream.approvals.some((known) => known.id === approval.id),
  );
  return [...stream.approvals, ...extra];
}

function turnStatus(run: Run, stream: RunProjection, waiting: boolean) {
  if (isTerminalRunStatus(run.status)) {
    return { state: finishedStates[run.status], label: finishedMoods[run.status] };
  }
  if (waiting) return { state: 'waiting' as const, label: 'waiting for you' };
  return { state: liveStates[stream.status], label: liveMoods[stream.status] };
}

export function SoloTurn({ run, detail, assistantMessage, repo }: SoloTurnProps) {
  const { member, child } = soloChild(run, detail);
  const provider = member?.provider ?? run.provider;
  const finished = isTerminalRunStatus(run.status);
  const stream = useRunStream(member?.runId ?? run.id, detail.conversation.id, !finished);
  const leads = streamLeads(stream, finished);
  const active = stream.status === 'connecting' || stream.status === 'running';
  const working = !finished && active;
  const pendingCheckpoint = detail.orchestrations?.[run.id]?.pendingCheckpoint ?? null;
  const pendingChecks = detail.approvals.filter(
    (approval) => approval.runId === run.id && isCheckApproval(approval),
  );
  const pending = pendingCheckpoint ? [pendingCheckpoint, ...pendingChecks] : pendingChecks;
  const approvals = finished ? [] : liveApprovals(stream, pending);
  const waiting = working && hasPending(approvals);
  const { state, label } = turnStatus(run, stream, waiting);

  const persistedSteps = detail.activity[run.id]?.length
    ? detail.activity[run.id]!
    : (detail.activity[member?.runId ?? ''] ?? []);
  const steps = leads || persistedSteps.length === 0 ? stream.steps : persistedSteps;
  const persistedText =
    assistantMessage?.content ??
    detail.messages.find((message) => message.role === 'assistant' && message.runId === child?.id)
      ?.content;
  const text = shownText(stream, persistedText, finished);
  const error = finished ? run.error : stream.error;
  const checkpoints = finished
    ? mergeCheckpoints(detail.orchestrations?.[run.id]?.checkpoints ?? [])
    : [];
  const host = finished ? keepCardHost(checkpoints) : null;
  const revertible = finished
    ? [run, child].find(
        (candidate): candidate is Run => candidate?.mode === 'do' && candidate.snapshot !== null,
      )
    : undefined;

  const turnRuns = [run, child].filter((candidate): candidate is Run => Boolean(candidate));
  const changeRunIds = turnRuns.map((candidate) => candidate.id);
  const changeTask =
    finished && turnRuns.some((candidate) => candidate.mode === 'do')
      ? taskForRuns(detail.tasks, changeRunIds)
      : null;

  return (
    <AiTurn
      provider={provider}
      label={label}
      state={state}
      category={run.category}
      following={child?.following ?? run.following}
    >
      <WorkLog steps={steps} state={state} seconds={finished ? runSeconds(run) : null} />
      <TurnPlanOffer detail={detail} runId={run.id} />
      {approvals.map((approval) =>
        isCheckpoint(approval) ? (
          <CheckpointCard key={approval.id} approval={approval} />
        ) : (
          <ApprovalCard key={approval.id} approval={approval} provider={provider} repo={repo} />
        ),
      )}
      {text && <Markdown text={text} streaming={leads && active} />}
      {working && !waiting && !text && (
        <span className="dots" role="status" aria-label="Working">
          <i />
          <i />
          <i />
        </span>
      )}
      <ReplyPlanAction detail={detail} message={assistantMessage} finished={finished} />
      {run.status === 'cancelled' && <p className="ai-note">Stopped before finishing.</p>}
      {error && <p className="error-line">{error}</p>}
      {finished && (
        <div className="turn-foot">
          <RunUsageMeta run={child?.usage ? child : run} />
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
              <TurnFeedback runId={run.id} variant={host.variant} />
            ) : undefined
          }
        />
      ))}
      {revertible && <RevertRun run={revertible} />}
    </AiTurn>
  );
}

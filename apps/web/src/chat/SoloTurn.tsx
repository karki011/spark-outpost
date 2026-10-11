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
import { turnShots } from '../browser/browser-check.ts';
import { RailFlags } from './approvals/RailFlags.tsx';
import { RevertChanged } from './approvals/RevertChanged.tsx';
import { askedBeforeTimeout, isLatestTurn, timedOut, WAITED_LABEL } from './approvals/timed-out.ts';
import { FilesChanged, taskForRuns } from './changes/FilesChanged.tsx';
import { CheckpointCard } from './checkpoints/CheckpointCard.tsx';
import { turnAgentTerminals } from './commands/agent-terminal-model.ts';
import { AgentTerminalsRunning } from './commands/AgentTerminalRow.tsx';
import { runCommands, shownCommands } from './commands/command-model.ts';
import { useChatAgentTerminals } from './commands/use-agent-terminals.ts';
import { TurnReply } from './commands/TurnReply.tsx';
import { isCheckpoint } from './checkpoints/checkpoint-model.ts';
import { turnCheckpoints } from './checkpoints/turn-checkpoints.ts';
import { shownApprovals } from './crew/crew-items.ts';
import { MessageActions } from './message-actions/MessageActions.tsx';
import { Markdown } from './markdown/Markdown.tsx';
import { keepCardHost } from './outcomes/feedback-host.ts';
import { AgreedReplyLine } from './plans/AgreedReplyLine.tsx';
import { PlanSavedLine } from './plans/PlanSavedLine.tsx';
import { TurnFeedback } from './outcomes/TurnFeedback.tsx';
import { ResultBlock } from './outcomes/ResultBlock.tsx';
import { PublishResult } from './publish/PublishResult.tsx';
import { copiedReply, splitAtPublish, turnReplies } from './publish/turn-replies.ts';
import {
  shownSteps,
  streamLeads,
  type LiveRunStatus,
  type RunProjection,
} from './run-projection.ts';
import { ErrorLine, ModelSwitchNote } from './ModelSwitchNote.tsx';
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
  laterMessages: readonly Message[];
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
  if (timedOut(run.error)) return { state: 'stopped' as const, label: WAITED_LABEL };
  if (isTerminalRunStatus(run.status)) {
    return { state: finishedStates[run.status], label: finishedMoods[run.status] };
  }
  if (waiting) return { state: 'waiting' as const, label: 'waiting for you' };
  return { state: liveStates[stream.status], label: liveMoods[stream.status] };
}

export function SoloTurn({
  run,
  detail,
  assistantMessage,
  laterMessages,
  repo,
  taskCount,
}: SoloTurnProps) {
  const { member, child } = soloChild(run, detail);
  const provider = member?.provider ?? run.provider;
  const finished = isTerminalRunStatus(run.status);
  const streamRunId = member?.runId ?? run.id;
  const stream = useRunStream(streamRunId, detail.conversation.id, !finished);
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
  const steps = shownSteps(stream, persistedSteps, leads);
  const stepsRunId = !leads && detail.activity[run.id]?.length ? run.id : streamRunId;
  useLiveReport(
    { id: run.id, name: providerName(provider), provider, kind: 'agent' },
    working,
    steps,
  );
  const persistedText =
    assistantMessage?.content ??
    detail.messages.find((message) => message.role === 'assistant' && message.runId === child?.id)
      ?.content;
  const replies = turnReplies(stream, { reply: persistedText, later: laterMessages }, leads);
  const { text } = replies;
  const replyClosedAt = laterMessages.length > 0 ? (assistantMessage?.createdAt ?? null) : null;
  const terminals = turnAgentTerminals(
    useChatAgentTerminals(detail.conversation.id).data,
    stream.terminals,
    [run.id, member?.runId],
    streamRunId,
  );
  const commands = splitAtPublish(
    shownCommands(
      runCommands(detail.commands, [run.id, member?.runId]),
      stream.commands,
      streamRunId,
    ),
    {
      streamed: stream.commands,
      streamedBeforePublish: stream.replyEnd?.commands ?? null,
      replyClosedAt,
    },
  );
  const terminalParts = splitAtPublish(terminals, {
    streamed: stream.terminals,
    streamedBeforePublish: stream.replyEnd?.terminals ?? null,
    replyClosedAt,
  });
  const publishing = replies.publishText !== '' || commands.publish.length > 0;
  const interrupted = run.status === 'outcome_unknown';
  const shown = child?.modelSwitch || child?.errorDetails ? child : run;
  const error = finished ? (interrupted ? null : run.error) : stream.error;
  const checkpoints = finished ? turnCheckpoints(run.id, detail) : [];
  const revertible = finished
    ? [run, child].find(
        (candidate): candidate is Run => candidate?.mode === 'do' && candidate.snapshot !== null,
      )
    : undefined;
  const host = finished ? keepCardHost(checkpoints, Boolean(revertible?.revertedAt)) : null;
  const kept = checkpoints.find((approval) => approval.id === host?.approvalId) ?? null;

  const turnRuns = [run, child].filter((candidate): candidate is Run => Boolean(candidate));
  const changeRunIds = turnRuns.map((candidate) => candidate.id);
  const seconds = finished ? runSeconds(run) : null;
  const log = useStepLog(steps, state, stepsRunId);
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
      <PlanSavedLine detail={detail} runId={run.id} />
      <RailFlags detail={detail} runId={run.id} />
      {cards.decided.map(approvalCard)}
      <TurnReply
        text={text}
        shots={turnShots(detail, run.id)}
        commands={commands.reply}
        terminals={terminalParts.reply}
        waiting={waiting}
      >
        {(part, last) => (
          <Markdown text={part} streaming={last && leads && active && !publishing} />
        )}
      </TurnReply>
      <PublishResult
        text={replies.publishText}
        commands={commands.publish}
        terminals={terminalParts.publish}
        waiting={waiting}
        streaming={leads && active}
      />
      {cards.pending.map(approvalCard)}
      <AgreedReplyLine detail={detail} message={assistantMessage} finished={finished} />
      {finished && <AgentTerminalsRunning terminals={terminals} />}
      {run.status === 'cancelled' && <p className="ai-note">Stopped before finishing.</p>}
      <ModelSwitchNote change={finished ? shown.modelSwitch : stream.modelSwitch} />
      <ErrorLine
        error={error}
        details={finished ? shown.errorDetails : null}
        change={finished ? shown.modelSwitch : null}
        waited={{
          asked: askedBeforeTimeout(
            detail.approvals.filter((approval) => changeRunIds.includes(approval.runId)),
          ),
          retryIn: isLatestTurn(detail, run.id) ? detail.conversation.id : null,
        }}
      />
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
              text={copiedReply(replies)}
              createdAt={assistantMessage?.createdAt ?? run.finishedAt ?? run.createdAt}
              copyLabel="Copy reply"
              side="assistant"
            />
          )}
          {!host && <TurnFeedback runId={run.id} variant="turn" />}
        </div>
      )}
      {changeTask && !kept && <FilesChanged taskId={changeTask.id} runIds={changeRunIds} />}
      {checkpoints
        .filter((approval) => approval !== kept)
        .map((approval) => (
          <CheckpointCard key={approval.id} approval={approval} />
        ))}
      {host && kept && (
        <ResultBlock
          approval={kept}
          variant={host.variant}
          runId={run.id}
          runIds={changeRunIds}
          revertible={revertible ?? null}
          taskId={changeTask?.id ?? null}
          conversationId={detail.conversation.id}
        />
      )}
      {revertible && !kept && (
        <RevertChanged run={revertible} taskId={changeTask?.id ?? null} runIds={changeRunIds} />
      )}
    </AiTurn>
  );
}

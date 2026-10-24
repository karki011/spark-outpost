import {
  isTerminalRunStatus,
  STOPPED_BY_QUIT,
  type Approval,
  type ConversationDetail,
  type Message,
  type Project,
  type Run,
} from '@spark-outpost/contracts';
import { CacheRebuildNote } from '../usage/CacheRebuildNote.tsx';
import { RunUsageMeta } from '../usage/RunUsageMeta.tsx';
import { waitLabel } from './wait-label.ts';
import { ApprovalCard } from './approvals/ApprovalCard.tsx';
import { decidedFirst, hasPending } from './approvals/approval-events.ts';
import { BrowserCheckMeta } from '../browser/BrowserCheckMeta.tsx';
import { turnShots } from '../browser/browser-check.ts';
import { RailFlags } from './approvals/RailFlags.tsx';
import { askedBeforeTimeout, isLatestTurn } from './approvals/timed-out.ts';
import { taskForRuns } from './changes/FilesChanged.tsx';
import { ChatFiles } from './files/ChatFiles.tsx';
import { ArtifactCards } from './artifacts/ArtifactCards.tsx';
import { CheckpointCard } from './checkpoints/CheckpointCard.tsx';
import { turnAgentTerminals } from './commands/agent-terminal-model.ts';
import { cardsLeft, commandAnswers } from './commands/command-answers.ts';
import { hourCycle } from '../desktop/hour-cycle.ts';
import { AgentTerminalsRunning } from './commands/AgentTerminalRow.tsx';
import { runCommands, shownCommands } from './commands/command-model.ts';
import { useChatAgentTerminals } from './commands/use-agent-terminals.ts';
import { isCheckpoint } from './checkpoints/checkpoint-model.ts';
import { turnCheckpoints } from './checkpoints/turn-checkpoints.ts';
import { shownApprovals } from './crew/crew-items.ts';
import { MessageActions } from './message-actions/MessageActions.tsx';
import { Markdown } from './markdown/Markdown.tsx';
import { keepCardHost } from './outcomes/feedback-host.ts';
import { AgreedReplyLine } from './plans/AgreedReplyLine.tsx';
import { PlanSavedLine } from './plans/PlanSavedLine.tsx';
import { TurnFeedback } from './outcomes/TurnFeedback.tsx';
import { PublishResult } from './publish/PublishResult.tsx';
import { copiedReply, splitAtPublish, turnReplies } from './publish/turn-replies.ts';
import { shownSteps, streamLeads, viewSteps, type RunProjection } from './run-projection.ts';
import { ErrorLine, ModelSwitchNote } from './ModelSwitchNote.tsx';
import { providerName } from './provider-name.ts';
import { useLiveReport } from './status/status-context.ts';
import { BackgroundWork } from './BackgroundWork.tsx';
import { SubagentsLine } from './subagents/SubagentsLine.tsx';
import { useShowAgents } from './subagents/agent-board.ts';
import { shownSubagents } from './subagents/subagent-view.ts';
import { runSeconds } from './turns.ts';
import { clockText } from './status/status-text.ts';
import { modelOf } from '../crew/chat-agent.ts';
import { useRunStream } from './use-run-stream.ts';
import { currentTodo, shownTodo, turnTodo } from '../todo/todo-model.ts';
import { TurnTodo } from '../todo/TurnTodo.tsx';
import { TurnRows } from './rows/TurnRows.tsx';
import { turnRowParts } from './rows/turn-rows.ts';
import { useTurnChanges } from './rows/use-turn-changes.ts';
import { AgentMark, TurnMeta, WorkingLine, agentChanged } from './turn/TurnParts.tsx';
import { TurnChangesLine } from './turn/TurnChangesLine.tsx';
import { turnMood } from './turn/turn-mood.ts';
import { liveLabel } from './turn/live-label.ts';
import { SteerGroup } from './steer/SteeredMessage.tsx';
import { seenAfter, steerMarks, turnSteers } from './steer/steer-model.ts';

interface SoloTurnProps {
  run: Run;
  detail: ConversationDetail;
  assistantMessage: Message | null;
  laterMessages: readonly Message[];
  previous?: Run | null;
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

function metaLine(run: Run, model: string | null): string | null {
  const seconds = runSeconds(run);
  const parts = [model, seconds === null ? null : clockText(seconds * 1000)].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function SoloTurn({
  run,
  detail,
  assistantMessage,
  laterMessages,
  previous = null,
  repo,
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
  const subagents = shownSubagents(stream.subagents.rows, detail.subagents?.[run.id], leads);
  useShowAgents(run.id, run.createdAt, subagents, working);
  const waitingOn = working && !waiting ? stream.subagents.waitingOn : 0;
  const waitingText =
    waitingOn > 0 ? waitLabel(waitingOn, stream.subagents.background).toLowerCase() : null;

  const persistedSteps = detail.activity[run.id]?.length
    ? detail.activity[run.id]!
    : (detail.activity[member?.runId ?? ''] ?? []);
  const steps = shownSteps(stream, persistedSteps, leads);
  const todo = shownTodo(stream.todo, child?.todo ?? run.todo);
  const doingTodo = working && !waitingText ? currentTodo(todo) : null;
  const stepsRunId = !leads && detail.activity[run.id]?.length ? run.id : streamRunId;
  useLiveReport(
    {
      id: run.id,
      name: providerName(provider),
      provider,
      kind: 'agent',
      ...(waitingText ? { doing: waitingText } : {}),
      ...(doingTodo ? { todo: doingTodo } : {}),
    },
    working,
    waitingText ? [] : steps,
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
  const error = finished
    ? interrupted || run.status === 'cancelled'
      ? null
      : run.error
    : stream.error;
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
  const changeTask = turnRuns.some((candidate) => candidate.mode === 'do')
    ? taskForRuns(detail.tasks, changeRunIds)
    : null;
  const changes = useTurnChanges(changeTask?.id ?? null, changeRunIds);
  const todoEntries = turnTodo(detail.runs, run.id, todo);
  const answers = commandAnswers(approvals, hourCycle());
  const commandCalls = new Set(
    [...commands.reply, ...commands.publish].flatMap((command) =>
      command.toolCallId ? [command.toolCallId] : [],
    ),
  );
  const steers = turnSteers(detail, run.id);
  const parts = turnRowParts({
    text,
    steps: viewSteps(steps),
    commands: commands.reply,
    shots: turnShots(detail, run.id),
    terminals: terminalParts.reply,
    steers: steerMarks(steers),
    todo: todoEntries.length > 0,
  });
  const steersAt = (ids: readonly string[], index: number) => (
    <SteerGroup
      messages={steers.filter((message) => ids.includes(message.id))}
      detail={detail}
      run={run}
      crew={false}
      seen={seenAfter(parts, index)}
    />
  );
  const mood = turnMood({
    run,
    live: stream.status,
    waiting,
    waitingText,
    started: steps.length > 0 || text !== '',
  });
  const usageRun = child?.usage ? child : run;
  const meta = metaLine(run, modelOf(usageRun) ?? modelOf(run));

  return (
    <div className="msg ai solo" data-state={finished ? run.status : 'working'}>
      <p className="sr-only">
        {providerName(provider)} <span className="mood">{mood}</span>
      </p>
      {agentChanged(run, previous) && <AgentMark provider={provider} model={modelOf(run)} />}
      <SubagentsLine runId={run.id} rows={subagents} live={working} />
      <PlanSavedLine detail={detail} runId={run.id} />
      <TurnRows
        parts={parts}
        context={{
          runId: stepsRunId,
          working,
          waiting,
          changes,
          todo: <TurnTodo entries={todoEntries} live={working} />,
          answers,
        }}
        steers={steersAt}
      >
        {(part, last) => (
          <Markdown text={part} streaming={last && leads && active && !publishing} />
        )}
      </TurnRows>
      <BackgroundWork
        runId={run.id}
        background={working && !waiting ? stream.subagents.background : null}
      />
      {cardsLeft(cards.decided, answers, commandCalls).map(approvalCard)}
      <ChatFiles files={(detail.chatFiles ?? []).filter((file) => file.runId === run.id)} />
      <ArtifactCards chatId={detail.conversation.id} runId={run.id} pages={detail.artifactPages} />
      <RailFlags detail={detail} runId={run.id} />
      {finished && (
        <TurnChangesLine
          kept={kept}
          host={host}
          changes={changes}
          revertible={revertible ?? null}
          runIds={changeRunIds}
          taskId={changeTask?.id ?? null}
          conversationId={detail.conversation.id}
        />
      )}
      {checkpoints
        .filter((approval) => approval !== kept)
        .map((approval) => (
          <CheckpointCard key={approval.id} approval={approval} />
        ))}
      <PublishResult
        text={replies.publishText}
        commands={commands.publish}
        terminals={terminalParts.publish}
        waiting={waiting}
        streaming={leads && active}
        answers={answers}
      />
      {cards.pending.map(approvalCard)}
      <AgreedReplyLine detail={detail} message={assistantMessage} finished={finished} />
      {finished && <AgentTerminalsRunning terminals={terminals} />}
      {run.status === 'cancelled' && (
        <p className="ai-note">
          {run.error === STOPPED_BY_QUIT ? STOPPED_BY_QUIT : 'Stopped before finishing.'}
        </p>
      )}
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
      {working && !waiting && (
        <WorkingLine
          run={run}
          doing={liveLabel(subagents, [...commands.reply, ...commands.publish])}
        />
      )}
      {finished && (
        <TurnMeta>
          {text && (
            <MessageActions
              text={copiedReply(replies)}
              createdAt={assistantMessage?.createdAt ?? run.finishedAt ?? run.createdAt}
              copyLabel="Copy reply"
              side="assistant"
            />
          )}
          <TurnFeedback
            key={host?.variant ?? 'turn'}
            runId={run.id}
            variant={host?.variant ?? 'turn'}
          />
          {meta && <span className="turn-meta-line">{meta}</span>}
          <RunUsageMeta run={usageRun} />
          <CacheRebuildNote rebuild={detail.promptCache?.rebuilds[run.id]} />
          <BrowserCheckMeta
            detail={detail}
            run={run}
            taskId={changeTask?.id ?? null}
            runIds={changeRunIds}
          />
        </TurnMeta>
      )}
    </div>
  );
}

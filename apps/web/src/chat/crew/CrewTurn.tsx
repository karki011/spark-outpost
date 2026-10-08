import './crew-turn.css';
import { useState, type ReactNode } from 'react';
import {
  isCheckApproval,
  isTerminalRunStatus,
  needsYouLines,
  type Approval,
  type ConversationDetail,
  type Orchestration,
  type Project,
  type Run,
} from '@spark-outpost/contracts';
import { agentAnchor } from '../../crew/conversation-crew.ts';
import { crewTotals, totalsLine } from '../../crew/crew-model.ts';
import { betweenAgents, crewAgents, runAgent } from '../../crew/crew-projection.ts';
import { doingPhrase, jevDoing } from '../../crew/jev-doing.ts';
import { PieceBoard } from '../../crew/PieceBoard.tsx';
import { ApprovalCard } from '../approvals/ApprovalCard.tsx';
import { BrowserCheckMeta } from '../../browser/BrowserCheckMeta.tsx';
import { BrowserShots } from '../../browser/BrowserShots.tsx';
import { turnShots } from '../../browser/browser-check.ts';
import { ShotReply } from '../../browser/ShotReply.tsx';
import { runCommands } from '../commands/command-model.ts';
import { RailFlags } from '../approvals/RailFlags.tsx';
import { RevertRun } from '../approvals/RevertRun.tsx';
import { askedBeforeTimeout, isLatestTurn, timedOut } from '../approvals/timed-out.ts';
import { TimedOutNote } from '../approvals/TimedOutNote.tsx';
import { FilesChanged, taskForRuns } from '../changes/FilesChanged.tsx';
import { Markdown } from '../markdown/Markdown.tsx';
import { CheckpointCard } from '../checkpoints/CheckpointCard.tsx';
import type { CheckpointApproval } from '../checkpoints/checkpoint-model.ts';
import { keepCardHost } from '../outcomes/feedback-host.ts';
import { TurnFeedback } from '../outcomes/TurnFeedback.tsx';
import { ResultBlock } from '../outcomes/ResultBlock.tsx';
import { ReplyPlanAction, TurnPlanOffer } from '../plans/TurnPlans.tsx';
import { PlanSavedLine } from '../plans/PlanSavedLine.tsx';
import type { RunStep } from '../run-projection.ts';
import { useLiveReport } from '../status/status-context.ts';
import { useRunStream } from '../use-run-stream.ts';
import { AgentBlock, AgentHead } from './AgentBlock.tsx';
import { blockStatus } from './block-status.ts';
import {
  crewItems,
  groupParallel,
  handOffAt,
  itemStartedAt,
  lastAgentIndex,
  memberTexts,
  mergeCheckpoints,
  turnApprovals,
  type CrewItem,
} from './crew-items.ts';
import { DispatchLine } from './DispatchLine.tsx';
import { ParallelGroup } from './ParallelGroup.tsx';
import { pieceLabels } from '../../crew/piece-labels.ts';
import { SteerAnswer, steerAnswers } from '../steer/SteerAnswer.tsx';
import { SteeredMessage } from '../steer/SteeredMessage.tsx';
import { steerSlots, turnSteers } from '../steer/steer-model.ts';
import { turnRunIds } from '../turn-props.ts';

function footLabel(status: Orchestration['status']): string {
  if (status === 'cancelled') return 'Stopped';
  return isTerminalRunStatus(status) ? 'Done' : 'So far';
}

interface CrewTurnProps {
  run: Run;
  detail: ConversationDetail;
  orchestration: Orchestration;
  repo: Project | null;
  taskCard: ReactNode;
  continued: boolean;
}

interface BodyProps extends CrewTurnProps {
  liveApprovals: readonly Approval[];
}

function newer(live: Orchestration | null, stored: Orchestration): Orchestration {
  return live && live.updatedAt > stored.updatedAt ? live : stored;
}

const NO_STEPS: RunStep[] = [];

function CrewTurnBody({
  run,
  detail,
  orchestration,
  repo,
  taskCard,
  continued,
  liveApprovals,
}: BodyProps) {
  const [alreadyShown] = useState(
    () => new Set(continued ? orchestration.crew.map((member) => member.runId) : []),
  );
  const runsById = new Map(detail.runs.map((candidate) => [candidate.id, candidate]));
  const handedOffAt = handOffAt(orchestration.crew, run.id);
  const textByRun = memberTexts(detail.messages, run.id, handedOffAt);
  const agents = crewAgents(orchestration, detail.activity);
  const jev = agents[0]!;
  const crewRunIds = turnRunIds(detail, run.id);
  const shots = turnShots(detail, run.id);
  const memberRunIds = new Set(orchestration.crew.map((member) => member.runId));
  const otherShots = shots.filter((shot) => !memberRunIds.has(shot.runId));
  const summary = orchestration.crew.length === 0 ? (textByRun.get(run.id) ?? '') : '';
  const lastReply = detail.messages.findLast(
    (message) => message.role === 'assistant' && message.runId === run.id,
  );
  const approvals = turnApprovals(crewRunIds, detail.approvals, liveApprovals);
  const checkpoints = mergeCheckpoints(
    orchestration.checkpoints,
    orchestration.pendingCheckpoint ? [orchestration.pendingCheckpoint] : [],
    approvals,
  );
  const checkApprovals = approvals.filter(isCheckApproval);
  const items = groupParallel(crewItems(orchestration.crew, checkpoints, checkApprovals, run.id));
  const last = lastAgentIndex(items);
  const steers = steerSlots(items.map(itemStartedAt), turnSteers(detail, run.id));
  const steeredAfter = (index: number) =>
    (steers.get(index) ?? []).flatMap((message) => [
      <SteeredMessage key={message.id} message={message} detail={detail} run={run} crew />,
      ...steerAnswers(orchestration.answers, message.id).map((member) => (
        <SteerAnswer key={member.runId} member={member} conversationId={detail.conversation.id} />
      )),
    ]);
  const finished = isTerminalRunStatus(orchestration.status);
  const deciding = !finished && betweenAgents(orchestration, agents.slice(1));
  const leadId = `lead:${run.id}`;
  const planLine = detail.plans?.lines.find((line) => line.runId === run.id);
  const plannedPieces = planLine?.unit === 'pieces' && planLine.items > 0 ? planLine.items : null;
  const doing = doingPhrase(jevDoing(orchestration, plannedPieces));
  useLiveReport(
    { id: leadId, name: jev.name, provider: jev.provider, kind: 'lead', doing },
    deciding,
    NO_STEPS,
  );
  const jevStatus =
    jev.state === 'done'
      ? null
      : blockStatus(jev, { steps: NO_STEPS, waiting: false, started: false });
  const changeTask = taskForRuns(detail.tasks, crewRunIds);
  const showsOwnChanges = (runId: string) => {
    const child = runsById.get(runId);
    return Boolean(child && child.mode === 'do' && isTerminalRunStatus(child.status));
  };
  const changedBy = (runId: string) =>
    changeTask && showsOwnChanges(runId) ? (
      <FilesChanged taskId={changeTask.id} runIds={[runId]} />
    ) : null;
  const unlisted = crewRunIds.filter((runId) => runId === run.id || !showsOwnChanges(runId));
  const host = keepCardHost(checkpoints, run.revertedAt !== null);
  const latest = isLatestTurn(detail, run.id);
  const waitedOn = (runIds: readonly string[]) => ({
    asked: askedBeforeTimeout(
      detail.approvals.filter((approval) => runIds.includes(approval.runId)),
    ),
    retryIn: latest ? detail.conversation.id : null,
  });
  const crewTimedOut = orchestration.crew.some((member) => timedOut(member.error));
  const kept = checkpoints.find((approval) => approval.id === host?.approvalId) ?? null;
  const checkpointCard = (approval: CheckpointApproval) =>
    approval === kept ? null : <CheckpointCard key={approval.id} approval={approval} />;

  const agentBlock = (item: Extract<CrewItem, { kind: 'agent' }>, collapsible: boolean) => {
    const member = item.member;
    const agent = runAgent(member, orchestration, detail.activity[member.runId] ?? []);
    return (
      <AgentBlock
        key={member.runId}
        agent={agent}
        anchor={agentAnchor(orchestration.runId, member.runId)}
        live={!isTerminalRunStatus(member.status)}
        settled={member.runId === run.id && handedOffAt !== null}
        collapsed={collapsible && agent.state === 'done'}
        still={alreadyShown.has(member.runId)}
        conversationId={detail.conversation.id}
        steps={detail.activity[member.runId] ?? []}
        text={textByRun.get(member.runId) ?? ''}
        shots={shots.filter((shot) => shot.runId === member.runId)}
        commands={runCommands(detail.commands, [member.runId])}
        error={member.error}
        errorDetails={member.errorDetails ?? null}
        modelSwitch={member.modelSwitch ?? null}
        approvals={detail.approvals.filter((approval) => approval.runId === member.runId)}
        repo={repo}
        waited={waitedOn([member.runId])}
        changes={changedBy(member.runId)}
        after={item.checkpoints.map(checkpointCard)}
      />
    );
  };

  const itemBlock = (item: CrewItem, index: number) => {
    if (item.kind === 'checkpoint') {
      return checkpointCard(item.approval);
    }
    if (item.kind === 'group') {
      const byRun = new Map(item.members.map((entry) => [entry.member.runId, entry]));
      return (
        <ParallelGroup
          key={item.members[0]!.member.runId}
          agents={item.members.map((entry) =>
            runAgent(entry.member, orchestration, detail.activity[entry.member.runId] ?? []),
          )}
          labels={pieceLabels(orchestration)}
          renderMember={(agent) => agentBlock(byRun.get(agent.id)!, false)}
        />
      );
    }
    if (item.kind === 'approval') {
      return (
        <ApprovalCard
          key={item.approval.id}
          approval={item.approval}
          provider={run.provider}
          repo={repo}
        />
      );
    }
    return agentBlock(item, index !== last);
  };

  return (
    <div className="crew-turn">
      <div className={continued ? 'msg ai agent-block jev still' : 'msg ai agent-block jev'}>
        <AgentHead
          agent={jev}
          anchor={agentAnchor(orchestration.runId, 'jev')}
          status={jevStatus}
          liveId={deciding ? leadId : null}
        />
        <DispatchLine
          orchestration={orchestration}
          advice={detail.advice?.[run.id]}
          category={run.category}
        />
        {taskCard}
        {orchestration.pieces && (
          <PieceBoard list={orchestration.pieces} crew={orchestration.crew} />
        )}
      </div>
      {steeredAfter(-1)}
      {items.flatMap((item, index) => [itemBlock(item, index), ...steeredAfter(index)])}
      {summary && (
        <div className="msg ai crew-summary">
          <ShotReply text={summary} shots={otherShots}>
            {(part) => <Markdown text={part} />}
          </ShotReply>
        </div>
      )}
      {!summary &&
        needsYouLines(lastReply?.content ?? '').map((line) => (
          <p className="ai-note needs-you" role="status" key={line}>
            {line}
          </p>
        ))}
      {timedOut(orchestration.error)
        ? !crewTimedOut && (
            <TimedOutNote
              asked={waitedOn(crewRunIds).asked}
              conversationId={latest ? detail.conversation.id : null}
            />
          )
        : orchestration.error && <p className="error-line">{orchestration.error}</p>}
      <RailFlags detail={detail} runId={run.id} />
      {!summary && <BrowserShots shots={otherShots} />}
      <PlanSavedLine detail={detail} runId={run.id} />
      <TurnPlanOffer detail={detail} runId={run.id} />
      <ReplyPlanAction
        detail={detail}
        message={detail.messages.find(
          (message) => message.role === 'assistant' && message.runId === run.id,
        )}
        finished={finished}
        category={run.category}
      />
      {finished && changeTask && run.mode === 'do' && !kept && (
        <FilesChanged taskId={changeTask.id} runIds={crewRunIds} listed={unlisted} />
      )}
      {host && kept && (
        <ResultBlock
          approval={kept}
          variant={host.variant}
          runId={run.id}
          runIds={crewRunIds}
          revertible={finished && run.mode === 'do' && run.snapshot ? run : null}
          taskId={run.mode === 'do' ? (changeTask?.id ?? null) : null}
          conversationId={detail.conversation.id}
        />
      )}
      <div className="turn-foot">
        <p className="crew-foot">
          <span>{footLabel(orchestration.status)}</span>{' '}
          {totalsLine(crewTotals(orchestration.totals, agents.length - 1))}
        </p>
        {finished && (
          <BrowserCheckMeta
            detail={detail}
            run={run}
            taskId={run.mode === 'do' ? (changeTask?.id ?? null) : null}
            runIds={crewRunIds}
          />
        )}
        {finished && !kept && <TurnFeedback runId={run.id} variant="turn" />}
        {run.mode === 'do' && run.snapshot && finished && !kept && <RevertRun run={run} compact />}
      </div>
    </div>
  );
}

export function CrewTurn(props: CrewTurnProps) {
  const live = !isTerminalRunStatus(props.run.status);
  const stream = useRunStream(props.run.id, props.detail.conversation.id, live);
  return (
    <CrewTurnBody
      {...props}
      orchestration={newer(stream.orchestration, props.orchestration)}
      liveApprovals={stream.approvals}
    />
  );
}

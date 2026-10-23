import './crew-turn.css';
import {
  isCheckApproval,
  isTerminalRunStatus,
  needsYouLines,
  type ConversationDetail,
  type Orchestration,
  type Project,
  type Run,
} from '@spark-outpost/contracts';
import { agentAnchor } from '../../crew/conversation-crew.ts';
import { crewTotals, totalsLine } from '../../crew/crew-model.ts';
import { crewAgents, runAgent } from '../../crew/crew-projection.ts';
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
import { AgreedReplyLine } from '../plans/AgreedReplyLine.tsx';
import { PlanSavedLine } from '../plans/PlanSavedLine.tsx';
import type { RunStep } from '../run-projection.ts';
import { AgentBlock, AgentHead } from './AgentBlock.tsx';
import { blockStatus } from './block-status.ts';
import {
  closingReply,
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
}

const NO_STEPS: RunStep[] = [];

export function CrewTurn({ run, detail, orchestration, repo }: CrewTurnProps) {
  const runsById = new Map(detail.runs.map((candidate) => [candidate.id, candidate]));
  const handedOffAt = handOffAt(orchestration.crew, run.id);
  const textByRun = memberTexts(detail.messages, run.id, handedOffAt);
  const agents = crewAgents(orchestration, detail.activity);
  const jev = agents[0]!;
  const crewRunIds = turnRunIds(detail, run.id);
  const shots = turnShots(detail, run.id);
  const memberRunIds = new Set(orchestration.crew.map((member) => member.runId));
  const otherShots = shots.filter((shot) => !memberRunIds.has(shot.runId));
  const summary = closingReply(detail.messages, orchestration.crew, run.id);
  const lastReply = detail.messages.findLast(
    (message) => message.role === 'assistant' && message.runId === run.id,
  );
  const approvals = turnApprovals(crewRunIds, detail.approvals, []);
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
      <div className="msg ai agent-block jev">
        <AgentHead
          agent={jev}
          anchor={agentAnchor(orchestration.runId, 'jev')}
          status={jevStatus}
        />
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
      <AgreedReplyLine
        detail={detail}
        message={detail.messages.find(
          (message) => message.role === 'assistant' && message.runId === run.id,
        )}
        finished={finished}
      />
      {finished && changeTask && run.mode === 'do' && !kept && (
        <FilesChanged taskId={changeTask.id} runIds={crewRunIds} listed={unlisted} />
      )}
      {host && kept && (
        <ResultBlock
          approval={kept}
          variant={host.variant}
          runIds={crewRunIds}
          revertible={finished && run.mode === 'do' && run.snapshot ? run : null}
          taskId={run.mode === 'do' ? (changeTask?.id ?? null) : null}
          conversationId={detail.conversation.id}
          onReview={null}
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
        {finished && (
          <TurnFeedback
            key={host?.variant ?? 'turn'}
            runId={run.id}
            variant={kept ? (host?.variant ?? 'turn') : 'turn'}
          />
        )}
        {run.mode === 'do' && run.snapshot && finished && !kept && <RevertRun run={run} compact />}
      </div>
    </div>
  );
}

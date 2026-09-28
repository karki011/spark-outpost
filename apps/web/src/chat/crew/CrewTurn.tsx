import './crew-turn.css';
import type { ReactNode } from 'react';
import {
  isCheckApproval,
  isTerminalRunStatus,
  type Approval,
  type ConversationDetail,
  type Orchestration,
  type Project,
  type Run,
} from '@spark-outpost/contracts';
import { agentAnchor } from '../../crew/conversation-crew.ts';
import { crewTotals, totalsLine } from '../../crew/crew-model.ts';
import { crewAgents, runAgent } from '../../crew/crew-projection.ts';
import { ApprovalCard } from '../approvals/ApprovalCard.tsx';
import { RevertRun } from '../approvals/RevertRun.tsx';
import { FilesChanged, taskForRuns } from '../changes/FilesChanged.tsx';
import { Markdown } from '../markdown/Markdown.tsx';
import { CheckpointCard } from '../checkpoints/CheckpointCard.tsx';
import type { CheckpointApproval } from '../checkpoints/checkpoint-model.ts';
import { keepCardHost } from '../outcomes/feedback-host.ts';
import { TurnFeedback } from '../outcomes/TurnFeedback.tsx';
import { ReplyPlanAction, TurnPlanOffer } from '../plans/TurnPlans.tsx';
import { runSeconds } from '../turns.ts';
import { useRunStream } from '../use-run-stream.ts';
import { AgentBlock, AgentHead } from './AgentBlock.tsx';
import {
  crewItems,
  lastAgentIndex,
  mergeCheckpoints,
  turnApprovals,
  type CrewItem,
} from './crew-items.ts';
import { DispatchLine } from './DispatchLine.tsx';

interface CrewTurnProps {
  run: Run;
  detail: ConversationDetail;
  orchestration: Orchestration;
  repo: Project | null;
  taskCard: ReactNode;
}

interface BodyProps extends CrewTurnProps {
  liveApprovals: readonly Approval[];
}

function newer(live: Orchestration | null, stored: Orchestration): Orchestration {
  return live && live.updatedAt > stored.updatedAt ? live : stored;
}

function CrewTurnBody({ run, detail, orchestration, repo, taskCard, liveApprovals }: BodyProps) {
  const runsById = new Map(detail.runs.map((candidate) => [candidate.id, candidate]));
  const textByRun = new Map(
    detail.messages
      .filter((message) => message.role === 'assistant' && message.runId)
      .map((message) => [message.runId!, message.content]),
  );
  const agents = crewAgents(orchestration, detail.activity);
  const jev = agents[0]!;
  const crewRunIds = [run.id, ...orchestration.crew.map((member) => member.runId)];
  const approvals = turnApprovals(crewRunIds, detail.approvals, liveApprovals);
  const checkpoints = mergeCheckpoints(
    orchestration.checkpoints,
    orchestration.pendingCheckpoint ? [orchestration.pendingCheckpoint] : [],
    approvals,
  );
  const checkApprovals = approvals.filter(isCheckApproval);
  const items = crewItems(orchestration.crew, checkpoints, checkApprovals);
  const last = lastAgentIndex(items);
  const finished = isTerminalRunStatus(orchestration.status);
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
  const host = finished ? keepCardHost(checkpoints) : null;
  const checkpointCard = (approval: CheckpointApproval) => (
    <CheckpointCard
      key={approval.id}
      approval={approval}
      footer={
        host?.approvalId === approval.id ? (
          <TurnFeedback runId={run.id} variant={host.variant} />
        ) : undefined
      }
    />
  );

  const agentBlock = (item: Extract<CrewItem, { kind: 'agent' }>, collapsible: boolean) => {
    const member = item.member;
    const agent = runAgent(member, orchestration, detail.activity[member.runId] ?? []);
    const child = runsById.get(member.runId);
    return (
      <AgentBlock
        key={member.runId}
        agent={agent}
        anchor={agentAnchor(orchestration.runId, member.runId)}
        live={!isTerminalRunStatus(member.status)}
        collapsed={collapsible && agent.state === 'done'}
        conversationId={detail.conversation.id}
        steps={detail.activity[member.runId] ?? []}
        text={textByRun.get(member.runId) ?? ''}
        error={member.error}
        seconds={child ? runSeconds(child) : null}
        approvals={detail.approvals.filter((approval) => approval.runId === member.runId)}
        repo={repo}
        changes={changedBy(member.runId)}
        after={item.checkpoints.map(checkpointCard)}
      />
    );
  };

  return (
    <div className="crew-turn">
      <div className="msg ai agent-block jev">
        <AgentHead agent={jev} anchor={agentAnchor(orchestration.runId, 'jev')} />
        <DispatchLine
          orchestration={orchestration}
          advice={detail.advice?.[run.id]}
          category={run.category}
        />
        {taskCard}
      </div>
      {items.map((item, index) => {
        if (item.kind === 'checkpoint') {
          return checkpointCard(item.approval);
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
      })}
      {orchestration.crew.length === 0 && textByRun.get(run.id) && (
        <div className="msg ai crew-summary">
          <Markdown text={textByRun.get(run.id)!} />
        </div>
      )}
      {orchestration.error && <p className="error-line">{orchestration.error}</p>}
      <TurnPlanOffer detail={detail} runId={run.id} />
      <ReplyPlanAction
        detail={detail}
        message={detail.messages.find(
          (message) => message.role === 'assistant' && message.runId === run.id,
        )}
        finished={finished}
      />
      {finished && changeTask && run.mode === 'do' && (
        <FilesChanged taskId={changeTask.id} runIds={crewRunIds} listed={unlisted} />
      )}
      <div className="turn-foot">
        <p className="crew-foot">
          <span>{finished ? 'Done' : 'So far'}</span>{' '}
          {totalsLine(crewTotals(orchestration.totals, agents.length - 1))}
        </p>
        {finished && !host && <TurnFeedback runId={run.id} variant="turn" />}
        {run.mode === 'do' && run.snapshot && finished && <RevertRun run={run} compact />}
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

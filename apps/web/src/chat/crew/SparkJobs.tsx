import './crew-turn.css';
import {
  isTerminalRunStatus,
  type ConversationDetail,
  type CrewMember,
  type Orchestration,
  type Project,
  type Run,
} from '@spark-outpost/contracts';
import { agentAnchor, sparkMembers } from '../../crew/conversation-crew.ts';
import { runAgent } from '../../crew/crew-projection.ts';
import { useRunStream } from '../use-run-stream.ts';
import { steersReadBy, turnSteers } from '../steer/steer-model.ts';
import { AgentBlock } from './AgentBlock.tsx';
import { blockSteers } from './block-steers.tsx';

const NO_TEXT = '';

export function mainAgentRan(orchestration: Orchestration): boolean {
  return sparkMembers(orchestration).some((member) => member.spark?.only === false);
}

export function jobMembers(orchestration: Orchestration | null | undefined): CrewMember[] {
  return sparkMembers(orchestration).filter((member) => member.spark?.step === undefined);
}

interface SparkJobsProps {
  run: Run;
  detail: ConversationDetail;
  orchestration: Orchestration;
  repo: Project | null;
  collapsed?: boolean;
  pick?: SparkPick;
  withApprovals?: boolean;
  placeSteers?: boolean;
}

type SparkPick = 'all' | 'jobs' | 'steps';

export function pickedMembers(orchestration: Orchestration, pick: SparkPick = 'all'): CrewMember[] {
  if (pick === 'jobs') return jobMembers(orchestration);
  const members = sparkMembers(orchestration);
  return pick === 'steps' ? members.filter((member) => member.spark?.step !== undefined) : members;
}

export function SparkJobs({
  run,
  detail,
  orchestration,
  repo,
  collapsed = false,
  pick = 'all',
  withApprovals = true,
  placeSteers = false,
}: SparkJobsProps) {
  const live = !isTerminalRunStatus(run.status);
  const stream = useRunStream(run.id, detail.conversation.id, live);
  const current =
    stream.orchestration && stream.orchestration.updatedAt > orchestration.updatedAt
      ? stream.orchestration
      : orchestration;
  const steers = placeSteers ? turnSteers(detail, run.id) : [];
  const placeable = pickedMembers(orchestration, pick).map((member) => member.runId);
  const steersIn = (runId: string) =>
    placeable.includes(runId) ? steersReadBy(steers, runId) : [];
  return (
    <div className="crew-turn spark-jobs">
      {pickedMembers(current, pick).map((member) => (
        <AgentBlock
          key={member.runId}
          agent={runAgent(member, current, detail.activity[member.runId] ?? [])}
          anchor={agentAnchor(current.runId, member.runId)}
          live={!isTerminalRunStatus(member.status)}
          collapsed={collapsed && steersIn(member.runId).length === 0}
          conversationId={detail.conversation.id}
          steps={detail.activity[member.runId] ?? []}
          text={NO_TEXT}
          error={member.error}
          approvals={
            withApprovals
              ? detail.approvals.filter((approval) => approval.runId === member.runId)
              : []
          }
          repo={repo}
          steers={blockSteers(steersIn(member.runId), detail, run)}
        />
      ))}
    </div>
  );
}

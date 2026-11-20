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
import { AgentBlock } from './AgentBlock.tsx';

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
  jobsOnly?: boolean;
}

export function SparkJobs({
  run,
  detail,
  orchestration,
  repo,
  collapsed = false,
  jobsOnly = false,
}: SparkJobsProps) {
  const live = !isTerminalRunStatus(run.status);
  const stream = useRunStream(run.id, detail.conversation.id, live);
  const current =
    stream.orchestration && stream.orchestration.updatedAt > orchestration.updatedAt
      ? stream.orchestration
      : orchestration;
  return (
    <div className="crew-turn spark-jobs">
      {(jobsOnly ? jobMembers(current) : sparkMembers(current)).map((member) => (
        <AgentBlock
          key={member.runId}
          agent={runAgent(member, current, detail.activity[member.runId] ?? [])}
          anchor={agentAnchor(current.runId, member.runId)}
          live={!isTerminalRunStatus(member.status)}
          collapsed={collapsed}
          conversationId={detail.conversation.id}
          steps={detail.activity[member.runId] ?? []}
          text={NO_TEXT}
          error={member.error}
          approvals={detail.approvals.filter((approval) => approval.runId === member.runId)}
          repo={repo}
        />
      ))}
    </div>
  );
}

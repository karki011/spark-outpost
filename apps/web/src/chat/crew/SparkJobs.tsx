import './crew-turn.css';
import {
  isTerminalRunStatus,
  type ConversationDetail,
  type CrewMember,
  type Orchestration,
  type Project,
  type Run,
} from '@spark-outpost/contracts';
import { agentAnchor } from '../../crew/conversation-crew.ts';
import { runAgent } from '../../crew/crew-projection.ts';
import { useRunStream } from '../use-run-stream.ts';
import { AgentBlock } from './AgentBlock.tsx';
import { useStoredTurn } from './stored-turn.ts';

const NO_TEXT = '';

export function sparkMembers(orchestration: Orchestration | null | undefined): CrewMember[] {
  return orchestration?.crew.filter((member) => member.role === 'spark') ?? [];
}

export function isSparkLed(orchestration: Orchestration | null | undefined): boolean {
  return orchestration?.depthSource === 'user' && sparkMembers(orchestration).length > 0;
}

export function mainAgentRan(orchestration: Orchestration): boolean {
  return sparkMembers(orchestration).some((member) => member.spark?.only === false);
}

interface SparkJobsProps {
  run: Run;
  detail: ConversationDetail;
  orchestration: Orchestration;
  repo: Project | null;
}

export function SparkJobs({ run, detail, orchestration, repo }: SparkJobsProps) {
  const live = !isTerminalRunStatus(run.status);
  const readOnly = useStoredTurn(run);
  const stream = useRunStream(run.id, detail.conversation.id, live);
  const current =
    stream.orchestration && stream.orchestration.updatedAt > orchestration.updatedAt
      ? stream.orchestration
      : orchestration;
  return (
    <div className="crew-turn spark-jobs">
      {sparkMembers(current).map((member) => (
        <AgentBlock
          key={member.runId}
          agent={runAgent(member, current, detail.activity[member.runId] ?? [])}
          anchor={agentAnchor(current.runId, member.runId)}
          live={!isTerminalRunStatus(member.status)}
          collapsed={false}
          readOnly={readOnly}
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

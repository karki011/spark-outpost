import { useId, useState, type ReactNode } from 'react';
import {
  isCheckApproval,
  type AgentTerminalStarted,
  type Approval,
  type BrowserShot,
  type CommandRun,
  type ModelSwitch,
  type Project,
} from '@spark-outpost/contracts';
import { BrowserShots } from '../../browser/BrowserShots.tsx';
import { CrewBlob } from '../../crew/CrewBlob.tsx';
import { modelLabel, roleLabel, usageParts, type CrewAgent } from '../../crew/crew-model.ts';
import { memberReplyText } from '../../crew/member-reply.ts';
import { ChevronIcon } from '../../ui/icons.tsx';
import type { TurnState } from '../AiTurn.tsx';
import { ApprovalCard } from '../approvals/ApprovalCard.tsx';
import { decidedFirst } from '../approvals/approval-events.ts';
import { EffortMeter } from '../composer/EffortMeter.tsx';
import { isCheckpoint } from '../checkpoints/checkpoint-model.ts';
import { turnAgentTerminals } from '../commands/agent-terminal-model.ts';
import { AgentTerminalsRunning } from '../commands/AgentTerminalRow.tsx';
import { shownCommands, type LiveCommand } from '../commands/command-model.ts';
import { useChatAgentTerminals } from '../commands/use-agent-terminals.ts';
import { TurnReply } from '../commands/TurnReply.tsx';
import { ErrorLine, ModelSwitchNote, type TimedOutFacts } from '../ModelSwitchNote.tsx';
import { shownSteps, shownText, streamLeads, type RunStep } from '../run-projection.ts';
import { useLiveHead, useLiveReport } from '../status/status-context.ts';
import { useRunStream } from '../use-run-stream.ts';
import { WorkLog } from '../WorkLog.tsx';
import { blockStatus, type BlockStatus } from './block-status.ts';
import { shownApprovals } from './crew-items.ts';
import { CrewName } from './CrewHint.tsx';
import { MemberReplyText } from './MemberReplyText.tsx';
import { SparkCrewFace } from '../../teammates/SparkCrewFace.tsx';

const EFFORT_SCALE = ['low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({
  id,
  label: id,
  description: null,
}));

function HeadMeta({ agent }: { agent: CrewAgent }) {
  const model = modelLabel({ ...agent, effort: null });
  const rest = [agent.routeNote, ...usageParts(agent)].filter(Boolean).join(' · ');
  return (
    <span className="ah-meta">
      · {model}
      {agent.effort && (
        <span className="ah-effort" title={`${agent.effort} effort`}>
          <EffortMeter efforts={EFFORT_SCALE} effort={agent.effort} />
          <span className="sr-only">{agent.effort} effort</span>
        </span>
      )}
      {rest && ` · ${rest}`}
    </span>
  );
}

const TURN_STATES: Record<CrewAgent['state'], TurnState> = {
  thinking: 'working',
  working: 'working',
  waiting: 'waiting',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
  queued: 'working',
};

function AgentFace({ agent, size }: { agent: CrewAgent; size: number }) {
  if (agent.spark) {
    return (
      <SparkCrewFace sparkId={agent.spark.id} name={agent.name} state={agent.state} size={size} />
    );
  }
  return <CrewBlob name={agent.name} provider={agent.provider} state={agent.state} size={size} />;
}

function AgentName({ agent }: { agent: CrewAgent }) {
  if (agent.spark) return <span className="agent-name">{agent.name}</span>;
  return <CrewName name={agent.name} />;
}

interface AgentHeadProps {
  agent: CrewAgent;
  anchor: string;
  status: BlockStatus | null;
  liveId?: string | null;
}

export function AgentHead({ agent, anchor, status, liveId = null }: AgentHeadProps) {
  const headRef = useLiveHead(liveId);
  return (
    <div className="agent-head" id={anchor} ref={headRef}>
      <span className={`agent-ava ${agent.state}`} aria-hidden="true">
        <AgentFace agent={agent} size={30} />
      </span>
      <span className="agent-who">
        <AgentName agent={agent} />
        <span className="agent-role">{roleLabel(agent)}</span>
      </span>
      {status && <span className={`agent-state ${status.state}`}>{status.label}</span>}
      <HeadMeta agent={agent} />
    </div>
  );
}

interface BodyProps {
  agent: CrewAgent;
  anchor: string;
  bodyId: string;
  conversationId: string;
  steps: readonly RunStep[];
  text: string;
  shots: readonly BrowserShot[];
  commands?: readonly CommandRun[];
  error: string | null;
  errorDetails?: string | null;
  modelSwitch?: ModelSwitch | null;
  approvals: readonly Approval[];
  repo: Project | null;
  waited?: TimedOutFacts;
}

const NO_COMMANDS: readonly CommandRun[] = [];
const NO_STREAMED: readonly LiveCommand[] = [];
const NO_STARTED: readonly AgentTerminalStarted[] = [];

interface StreamedProps {
  liveId?: string | null;
  streamed?: readonly LiveCommand[];
  started?: readonly AgentTerminalStarted[];
}

function AgentBody({
  agent,
  anchor,
  bodyId,
  conversationId,
  liveId = null,
  steps,
  text,
  shots,
  commands = NO_COMMANDS,
  streamed = NO_STREAMED,
  started = NO_STARTED,
  error,
  errorDetails = null,
  modelSwitch = null,
  approvals,
  repo,
  waited,
}: BodyProps & StreamedProps) {
  const busy = agent.state === 'working' || agent.state === 'thinking';
  const saved = useChatAgentTerminals(conversationId).data;
  const terminals = turnAgentTerminals(saved, started, [agent.id], agent.id);
  const cards = decidedFirst(
    approvals.filter(
      (approval) =>
        approval.runId === agent.id && !isCheckpoint(approval) && !isCheckApproval(approval),
    ),
  );
  const approvalCard = (approval: Approval) => (
    <ApprovalCard
      key={approval.id}
      approval={approval}
      provider={agent.provider}
      agent={agent.name}
      repo={repo}
    />
  );
  const status = blockStatus(
    agent,
    { steps, waiting: cards.pending.length > 0, started: Boolean(text) },
    error,
  );
  return (
    <>
      <AgentHead agent={agent} anchor={anchor} status={status} liveId={liveId} />
      <div id={bodyId}>
        <WorkLog steps={[...steps]} state={TURN_STATES[status.state]} runId={agent.id} />
        {cards.decided.map(approvalCard)}
        <TurnReply
          text={text}
          shots={shots}
          commands={shownCommands(commands, streamed, agent.id)}
          terminals={terminals}
          waiting={cards.pending.length > 0}
        >
          {(part, last) => (
            <MemberReplyText role={agent.role} text={part} streaming={last && busy} />
          )}
        </TurnReply>
        {cards.pending.map(approvalCard)}
        {!busy && <AgentTerminalsRunning terminals={terminals} />}
        <ModelSwitchNote change={modelSwitch} />
        <ErrorLine error={error} details={errorDetails} change={modelSwitch} waited={waited} />
      </div>
    </>
  );
}

function StreamedBody({ live, ...stored }: BodyProps & { live: boolean }) {
  const stream = useRunStream(stored.agent.id, stored.conversationId, live || !stored.text);
  const leads = streamLeads(stream, !live);
  const steps = shownSteps(stream, stored.steps, leads);
  const streaming = stream.status === 'connecting' || stream.status === 'running';
  const { id, name, provider } = stored.agent;
  useLiveReport({ id, name, provider, kind: 'crew' }, live && streaming, steps);
  return (
    <AgentBody
      {...stored}
      liveId={live && streaming ? id : null}
      steps={steps}
      streamed={stream.commands}
      started={stream.terminals}
      text={shownText(stream, stored.text, !live)}
      error={leads ? stream.error : (stored.error ?? stream.error)}
      modelSwitch={stored.modelSwitch ?? stream.modelSwitch}
      approvals={shownApprovals(stored.approvals, stream.approvals)}
    />
  );
}

interface AgentBlockProps {
  agent: CrewAgent;
  anchor: string;
  live: boolean;
  settled?: boolean;
  collapsed: boolean;
  conversationId: string;
  steps: readonly RunStep[];
  text: string;
  shots?: readonly BrowserShot[];
  commands?: readonly CommandRun[];
  error: string | null;
  errorDetails?: string | null;
  modelSwitch?: ModelSwitch | null;
  approvals: readonly Approval[];
  repo: Project | null;
  waited?: TimedOutFacts;
  after?: ReactNode;
  changes?: ReactNode;
  todo?: ReactNode;
}

const NO_SHOTS: readonly BrowserShot[] = [];

function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map((part) => part.replace(/[#*`>_-]/g, '').trim())
    .find(Boolean);
  return line ?? '';
}

export function AgentBlock({
  agent,
  anchor,
  live,
  settled = false,
  collapsed,
  conversationId,
  after,
  changes,
  todo,
  shots = NO_SHOTS,
  ...body
}: AgentBlockProps) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const bodyId = useId();
  const open = choice ?? !collapsed;
  const block = { agent, anchor, bodyId, conversationId, shots };
  const className = open ? 'msg ai agent-block' : 'msg ai agent-block folded';
  if (!open) {
    return (
      <div className={className} data-agent={agent.id}>
        <button
          type="button"
          className="agent-fold"
          id={anchor}
          aria-expanded={false}
          aria-controls={bodyId}
          onClick={() => setChoice(true)}
        >
          <span className="agent-ava sm" aria-hidden="true">
            <AgentFace agent={agent} size={20} />
          </span>
          <AgentName agent={agent} />
          <span className="agent-role">{roleLabel(agent)}</span>
          <span className="fold-text">
            {firstLine(memberReplyText(agent.role, body.text, false)) || agent.line}
          </span>
          <span className="fold-meta">{usageParts(agent).join(' · ')}</span>
          <ChevronIcon />
        </button>
        <BrowserShots shots={shots} />
        {changes}
        {after}
      </div>
    );
  }
  return (
    <div className={className} data-agent={agent.id}>
      {settled ? (
        <AgentBody {...block} {...body} />
      ) : (
        <StreamedBody live={live} {...block} {...body} />
      )}
      {choice === true && (
        <button type="button" className="agent-unfold" onClick={() => setChoice(false)}>
          Collapse
        </button>
      )}
      {todo}
      {changes}
      {after}
    </div>
  );
}

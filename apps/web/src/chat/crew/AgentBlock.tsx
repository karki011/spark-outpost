import { useId, useState, type ReactNode } from 'react';
import {
  isCheckApproval,
  type Approval,
  type MemberMessage,
  type Project,
} from '@spark-outpost/contracts';
import { CrewBlob } from '../../crew/CrewBlob.tsx';
import { MessageMemberButton } from '../../crew/MessageMemberButton.tsx';
import { MemberMessageList } from '../../crew/MemberMessageList.tsx';
import '../../crew/member-chat.css';
import {
  crewStateWord,
  modelLabel,
  roleLabel,
  usageParts,
  type CrewAgent,
} from '../../crew/crew-model.ts';
import { ChevronIcon } from '../../ui/icons.tsx';
import type { TurnState } from '../AiTurn.tsx';
import { ApprovalCard } from '../approvals/ApprovalCard.tsx';
import { decidedFirst } from '../approvals/approval-events.ts';
import { EffortMeter } from '../composer/EffortMeter.tsx';
import { isCheckpoint } from '../checkpoints/checkpoint-model.ts';
import { Markdown } from '../markdown/Markdown.tsx';
import { shownText, streamLeads, type RunStep } from '../run-projection.ts';
import { useLiveReport } from '../status/status-context.ts';
import { useRunStream } from '../use-run-stream.ts';
import { WorkLog } from '../WorkLog.tsx';
import { shownApprovals } from './crew-items.ts';
import { CrewName } from './CrewHint.tsx';
import { SparkCrewFace } from '../../teammates/SparkCrewFace.tsx';

const NO_MESSAGES: readonly MemberMessage[] = [];

const EFFORT_SCALE = ['low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({
  id,
  label: id,
  description: null,
}));

function HeadMeta({ agent }: { agent: CrewAgent }) {
  const model = modelLabel({ ...agent, effort: null });
  const rest = [agent.routeNote, agent.budget, ...usageParts(agent)].filter(Boolean).join(' · ');
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
  conversationId?: string;
}

export function AgentHead({ agent, anchor, conversationId }: AgentHeadProps) {
  const live = agent.state !== 'done';
  return (
    <div className="agent-head" id={anchor}>
      <span className={`agent-ava ${agent.state}`} aria-hidden="true">
        <AgentFace agent={agent} size={30} />
      </span>
      <span className="agent-who">
        <AgentName agent={agent} />
        <span className="agent-role">{roleLabel(agent)}</span>
      </span>
      {live && <span className={`agent-state ${agent.state}`}>{crewStateWord(agent.state)}</span>}
      <HeadMeta agent={agent} />
      {conversationId && (
        <MessageMemberButton
          conversationId={conversationId}
          agent={agent}
          className="icon-btn agent-msg"
        />
      )}
    </div>
  );
}

interface BodyProps {
  agent: CrewAgent;
  steps: readonly RunStep[];
  text: string;
  error: string | null;
  seconds: number | null;
  approvals: readonly Approval[];
  repo: Project | null;
}

function AgentBody({ agent, steps, text, error, seconds, approvals, repo }: BodyProps) {
  const state = TURN_STATES[agent.state];
  const busy = agent.state === 'working' || agent.state === 'thinking';
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
  return (
    <>
      <WorkLog steps={[...steps]} state={state} seconds={seconds} />
      {cards.decided.map(approvalCard)}
      {text && <Markdown text={text} streaming={busy} />}
      {cards.pending.map(approvalCard)}
      {busy && !text && steps.length === 0 && (
        <span className="dots" role="status" aria-label={`${agent.name} is working`}>
          <i />
          <i />
          <i />
        </span>
      )}
      {agent.state === 'queued' && !agent.spark && (
        <p className="ai-note">Queued. Starts when Jev hands off.</p>
      )}
      {error && <p className="error-line">{error}</p>}
    </>
  );
}

function StreamedBody({
  live,
  conversationId,
  ...stored
}: BodyProps & { live: boolean; conversationId: string }) {
  const stream = useRunStream(stored.agent.id, conversationId, live || !stored.text);
  const leads = streamLeads(stream, !live);
  const steps = leads || stored.steps.length === 0 ? stream.steps : stored.steps;
  const streaming = stream.status === 'connecting' || stream.status === 'running';
  const { id, name, provider } = stored.agent;
  useLiveReport({ id, name, provider, kind: 'crew' }, live && streaming, steps);
  return (
    <AgentBody
      {...stored}
      steps={steps}
      text={shownText(stream, stored.text, !live)}
      error={leads ? stream.error : (stored.error ?? stream.error)}
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
  error: string | null;
  seconds: number | null;
  approvals: readonly Approval[];
  repo: Project | null;
  after?: ReactNode;
  changes?: ReactNode;
  messages?: readonly MemberMessage[];
}

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
  messages = NO_MESSAGES,
  ...body
}: AgentBlockProps) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const bodyId = useId();
  const open = choice ?? !collapsed;
  if (!open) {
    return (
      <div className="msg ai agent-block folded" data-agent={agent.id}>
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
          <span className="fold-text">{firstLine(body.text) || agent.line}</span>
          <span className="fold-meta">{usageParts(agent).join(' · ')}</span>
          <ChevronIcon />
        </button>
        {changes}
        {after}
      </div>
    );
  }
  return (
    <div className="msg ai agent-block" data-agent={agent.id}>
      <AgentHead agent={agent} anchor={anchor} conversationId={conversationId} />
      <div id={bodyId}>
        {settled ? (
          <AgentBody agent={agent} {...body} />
        ) : (
          <StreamedBody agent={agent} live={live} conversationId={conversationId} {...body} />
        )}
      </div>
      <MemberMessageList
        name={agent.name}
        live={live}
        messages={messages}
        className="mc-log agent-notes"
      />
      {choice === true && (
        <button type="button" className="agent-unfold" onClick={() => setChoice(false)}>
          Collapse
        </button>
      )}
      {changes}
      {after}
    </div>
  );
}

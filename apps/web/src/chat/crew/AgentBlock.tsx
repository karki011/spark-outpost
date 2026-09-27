import { useId, useState, type ReactNode } from 'react';
import { isCheckApproval, type Approval, type Project } from '@spark-outpost/contracts';
import { CrewBlob } from '../../crew/CrewBlob.tsx';
import {
  crewStateWord,
  headerMeta,
  roleLabel,
  usageParts,
  type CrewAgent,
} from '../../crew/crew-model.ts';
import { ChevronIcon } from '../../ui/icons.tsx';
import type { TurnState } from '../AiTurn.tsx';
import { ApprovalCard } from '../approvals/ApprovalCard.tsx';
import { isCheckpoint } from '../checkpoints/checkpoint-model.ts';
import { Markdown } from '../markdown/Markdown.tsx';
import { shownText, streamLeads, type RunStep } from '../run-projection.ts';
import { useRunStream } from '../use-run-stream.ts';
import { WorkLog } from '../WorkLog.tsx';

const TURN_STATES: Record<CrewAgent['state'], TurnState> = {
  thinking: 'working',
  working: 'working',
  waiting: 'waiting',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
  queued: 'working',
};

export function AgentHead({ agent, anchor }: { agent: CrewAgent; anchor: string }) {
  const live = agent.state !== 'done';
  return (
    <div className="agent-head" id={anchor}>
      <span className={`agent-ava ${agent.state}`} aria-hidden="true">
        <CrewBlob name={agent.name} provider={agent.provider} state={agent.state} size={30} />
      </span>
      <span className="agent-who">
        <span className="agent-name">{agent.name}</span>
        <span className="agent-role">{roleLabel(agent)}</span>
      </span>
      {live && <span className={`agent-state ${agent.state}`}>{crewStateWord(agent.state)}</span>}
      <span className="ah-meta">· {headerMeta(agent)}</span>
    </div>
  );
}

interface BodyProps {
  agent: CrewAgent;
  steps: readonly RunStep[];
  notes?: readonly string[];
  text: string;
  error: string | null;
  seconds: number | null;
  approvals: readonly Approval[];
  repo: Project | null;
}

function AgentBody({ agent, steps, notes = [], text, error, seconds, approvals, repo }: BodyProps) {
  const state = TURN_STATES[agent.state];
  const busy = agent.state === 'working' || agent.state === 'thinking';
  return (
    <>
      <WorkLog steps={[...steps]} state={state} seconds={seconds} />
      {notes.map((note, index) => (
        <p key={index} className="ai-note watchdog-note">
          {note}
        </p>
      ))}
      {approvals
        .filter(
          (approval) =>
            approval.runId === agent.id && !isCheckpoint(approval) && !isCheckApproval(approval),
        )
        .map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            provider={agent.provider}
            agent={agent.name}
            repo={repo}
          />
        ))}
      {text && <Markdown text={text} streaming={busy} />}
      {busy && !text && steps.length === 0 && (
        <span className="dots" role="status" aria-label={`${agent.name} is working`}>
          <i />
          <i />
          <i />
        </span>
      )}
      {agent.state === 'queued' && <p className="ai-note">Queued. Starts when Jev hands off.</p>}
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
  return (
    <AgentBody
      {...stored}
      steps={steps}
      text={shownText(stream, stored.text, !live)}
      error={leads ? stream.error : (stored.error ?? stream.error)}
      approvals={leads ? stream.approvals : stored.approvals}
    />
  );
}

interface AgentBlockProps {
  agent: CrewAgent;
  anchor: string;
  live: boolean;
  collapsed: boolean;
  conversationId: string;
  steps: readonly RunStep[];
  notes?: readonly string[];
  text: string;
  error: string | null;
  seconds: number | null;
  approvals: readonly Approval[];
  repo: Project | null;
  after?: ReactNode;
  changes?: ReactNode;
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
  collapsed,
  conversationId,
  after,
  changes,
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
            <CrewBlob name={agent.name} provider={agent.provider} state={agent.state} size={20} />
          </span>
          <span className="agent-name">{agent.name}</span>
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
      <AgentHead agent={agent} anchor={anchor} />
      <div id={bodyId}>
        <StreamedBody agent={agent} live={live} conversationId={conversationId} {...body} />
      </div>
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

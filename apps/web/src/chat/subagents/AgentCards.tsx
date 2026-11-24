import './subagents.css';
import './agent-cards.css';
import { useEffect, useId, useRef, useState } from 'react';
import type { SubagentRow } from '@spark-outpost/contracts';
import { StepName } from '../WorkLog.tsx';
import { ChatFace } from '../../brand/ChatFace.tsx';
import {
  runsOtherModel,
  workerIdentity,
  workerPresentation,
  workerRole,
} from '../../crew/worker-identity.ts';
import { SubagentDetail } from './SubagentDetail.tsx';
import { agentActivity, agentMeta, agentPurpose } from './agent-cards.ts';
import type { AgentFocus } from './agent-board.ts';
import { hasDetail, subagentLines, workingFirst } from './subagent-view.ts';

function namesRole(name: string, role: string): boolean {
  return name.trim().toLowerCase().startsWith(`${role.toLowerCase()}:`);
}

function AgentCard({
  row,
  nested,
  live,
  focus,
  leadModel,
  onRedirect,
}: {
  row: SubagentRow;
  nested: boolean;
  live: boolean;
  focus: AgentFocus | null;
  leadModel: string | null;
  onRedirect?: ((row: SubagentRow) => void) | undefined;
}) {
  const focused = focus?.workerId === row.id;
  const detailed = hasDetail(row);
  const [open, setOpen] = useState(focused && detailed);
  const card = useRef<HTMLLIElement>(null);
  const nameButton = useRef<HTMLButtonElement>(null);
  const nonce = focused ? focus.nonce : 0;
  const [seenNonce, setSeenNonce] = useState(nonce);
  if (nonce !== seenNonce) {
    setSeenNonce(nonce);
    if (detailed) setOpen(true);
  }
  useEffect(() => {
    if (nonce === 0) return;
    const target = nameButton.current ?? card.current;
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  }, [nonce]);
  const detailId = useId();
  const purpose = agentPurpose(row.task, row.name);
  const working = row.state === 'working';
  const activity = live ? agentActivity(row) : null;
  const meta = agentMeta(row);
  const task = row.task && row.task !== row.name ? row.task : null;
  const role = workerRole(row.name);
  const presentation = workerPresentation(row.state, live);
  return (
    <li
      ref={card}
      tabIndex={-1}
      className="ac-card"
      data-state={row.state}
      data-worker-id={row.id}
      data-nested={nested || undefined}
    >
      <div className="ac-top">
        <ChatFace chatId={workerIdentity(row.id)} size="strip" state={presentation.face} />
        {detailed ? (
          <button
            ref={nameButton}
            type="button"
            className="ac-name"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen(!open)}
          >
            {row.name}
          </button>
        ) : (
          <b className="ac-name">{row.name}</b>
        )}
        <span className="sr-only">{presentation.label}</span>
        {role && !namesRole(row.name, role) && <span className="ac-role">{role}</span>}
        {runsOtherModel(row.usage, leadModel) && (
          <span className="ac-role" title={`The chat's agent runs ${leadModel}`}>
            Different model
          </span>
        )}
        {meta && <span className="ac-meta">{meta}</span>}
      </div>
      {purpose && !open && (
        <p className="ac-purpose" title={row.task.trim()}>
          {purpose}
        </p>
      )}
      {activity && !open && (
        <p className="ac-now" title={activity.full}>
          Now: {activity.command ? <code>{activity.text}</code> : <StepName name={activity.text} />}
        </p>
      )}
      {open && <SubagentDetail id={detailId} row={row} task={task} live={live} />}
      {onRedirect && live && working && (
        <button
          type="button"
          className="btn sm line"
          onClick={() => onRedirect(row)}
          title="Opens a draft in the lead chat; this does not message the sub-agent directly."
        >
          Ask lead to redirect
        </button>
      )}
    </li>
  );
}

interface AgentCardsProps {
  rows: readonly SubagentRow[];
  live: boolean;
  label?: string;
  focus?: AgentFocus | null;
  leadModel?: string | null;
  onRedirect?: ((row: SubagentRow) => void) | undefined;
}

export function AgentCards({
  rows,
  live,
  label = 'Sub-agents',
  focus = null,
  leadModel = null,
  onRedirect,
}: AgentCardsProps) {
  if (rows.length === 0) return null;
  return (
    <ul className="ac-list" aria-label={label}>
      {(live ? workingFirst(subagentLines(rows)) : subagentLines(rows)).map(({ row, depth }) => (
        <AgentCard
          key={row.id}
          row={row}
          nested={depth > 0}
          live={live}
          focus={focus}
          leadModel={leadModel}
          onRedirect={onRedirect}
        />
      ))}
    </ul>
  );
}

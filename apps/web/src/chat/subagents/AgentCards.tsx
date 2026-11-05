import './subagents.css';
import './agent-cards.css';
import { useId, useState } from 'react';
import type { SubagentRow } from '@spark-outpost/contracts';
import { StepName } from '../WorkLog.tsx';
import { ChatFace } from '../../brand/ChatFace.tsx';
import { workerIdentity, workerPresentation, workerRole } from '../../crew/worker-identity.ts';
import { SubagentDetail } from './SubagentDetail.tsx';
import { agentActivity, agentMeta, agentPurpose } from './agent-cards.ts';
import { hasDetail, subagentLines } from './subagent-view.ts';

function AgentCard({
  row,
  nested,
  live,
  onRedirect,
}: {
  row: SubagentRow;
  nested: boolean;
  live: boolean;
  onRedirect?: ((row: SubagentRow) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
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
      className="ac-card"
      data-state={row.state}
      data-worker-id={row.id}
      data-nested={nested || undefined}
    >
      <div className="ac-top">
        <ChatFace chatId={workerIdentity(row.id)} size="strip" state={presentation.face} />
        {hasDetail(row) ? (
          <button
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
        {meta && <span className="ac-meta">{meta}</span>}
      </div>
      {role && <span className="ac-role">{role}</span>}
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
  onRedirect?: ((row: SubagentRow) => void) | undefined;
}

export function AgentCards({ rows, live, label = 'Sub-agents', onRedirect }: AgentCardsProps) {
  if (rows.length === 0) return null;
  return (
    <ul className="ac-list" aria-label={label}>
      {subagentLines(rows).map(({ row, depth }) => (
        <AgentCard key={row.id} row={row} nested={depth > 0} live={live} onRedirect={onRedirect} />
      ))}
    </ul>
  );
}

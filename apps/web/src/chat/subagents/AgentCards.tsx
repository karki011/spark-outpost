import './subagents.css';
import './agent-cards.css';
import { useId, useState } from 'react';
import type { SubagentRow } from '@spark-outpost/contracts';
import { StepIcon, StepName } from '../WorkLog.tsx';
import { SubagentDetail } from './SubagentDetail.tsx';
import { agentActivity, agentMeta, agentPurpose } from './agent-cards.ts';
import { SUBAGENT_STATE_WORDS, hasDetail, subagentLines } from './subagent-view.ts';

const ICON_STATUS = { working: 'open', cancelled: 'open', done: 'done', failed: 'failed' } as const;

function AgentCard({ row, nested, live }: { row: SubagentRow; nested: boolean; live: boolean }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const purpose = agentPurpose(row.task, row.name);
  const working = row.state === 'working';
  const activity = agentActivity(row);
  const meta = agentMeta(row);
  const task = row.task && row.task !== row.name ? row.task : null;
  return (
    <li className="ac-card" data-state={row.state} data-nested={nested || undefined}>
      <div className="ac-top">
        <StepIcon
          step={{ name: row.name, status: ICON_STATUS[row.state] }}
          working={live && working}
        />
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
        <span className="sr-only">{SUBAGENT_STATE_WORDS[row.state]}</span>
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
    </li>
  );
}

interface AgentCardsProps {
  rows: readonly SubagentRow[];
  live: boolean;
  label?: string;
}

export function AgentCards({ rows, live, label = 'Sub-agents' }: AgentCardsProps) {
  if (rows.length === 0) return null;
  return (
    <ul className="ac-list" aria-label={label}>
      {subagentLines(rows).map(({ row, depth }) => (
        <AgentCard key={row.id} row={row} nested={depth > 0} live={live} />
      ))}
    </ul>
  );
}

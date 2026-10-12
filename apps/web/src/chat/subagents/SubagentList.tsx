import './subagents.css';
import { useId, useState } from 'react';
import { subagentSummary, type SubagentRow } from '@spark-outpost/contracts';
import { formatDuration } from '../../audit/audit-model.ts';
import { StepIcon, StepName } from '../WorkLog.tsx';
import { SUBAGENT_STATE_WORDS, subagentDurationMs, subagentLines } from './subagent-view.ts';

const ICON_STATUS = { working: 'open', cancelled: 'open', done: 'done', failed: 'failed' } as const;

function SubagentItem({ row, depth, live }: { row: SubagentRow; depth: number; live: boolean }) {
  const [reading, setReading] = useState(false);
  const taskId = useId();
  const task = row.task && row.task !== row.name ? row.task : null;
  const duration = subagentDurationMs(row);
  return (
    <li className="sa-row" data-state={row.state} data-nested={depth > 0 || undefined}>
      <StepIcon
        step={{ name: row.name, status: ICON_STATUS[row.state] }}
        working={live && row.state === 'working'}
      />
      <span className="sa-main">
        <span className="sa-top">
          {task ? (
            <button
              type="button"
              className="sa-name sa-toggle"
              aria-expanded={reading}
              aria-controls={taskId}
              onClick={() => setReading(!reading)}
            >
              {row.name}
            </button>
          ) : (
            <b className="sa-name">{row.name}</b>
          )}
          <span className={`sa-state ${row.state}`}>{SUBAGENT_STATE_WORDS[row.state]}</span>
          {duration !== null && <span className="sa-time">{formatDuration(duration)}</span>}
          {row.step && (
            <span className="sa-step">
              <StepName name={row.step} />
            </span>
          )}
        </span>
        {task && (
          <span id={taskId} className={reading ? 'sa-task open' : 'sa-task'}>
            {task}
          </span>
        )}
      </span>
    </li>
  );
}

interface SubagentListProps {
  rows: readonly SubagentRow[];
  live: boolean;
}

export function SubagentList({ rows, live }: SubagentListProps) {
  const [open, setOpen] = useState(true);
  const listId = useId();
  if (rows.length === 0) return null;
  return (
    <div className="subagents">
      <button
        type="button"
        className="steps-head"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4.5 3 7.5 6l-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="lbl">{subagentSummary(rows)}</span>
      </button>
      <ul id={listId} className="sa-rows" hidden={!open} aria-label="Sub-agents">
        {subagentLines(rows).map(({ row, depth }) => (
          <SubagentItem key={row.id} row={row} depth={depth} live={live} />
        ))}
      </ul>
    </div>
  );
}

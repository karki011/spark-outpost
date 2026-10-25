import './subagents-line.css';
import { createContext, use, useId, useState } from 'react';
import type { SubagentRow } from '@spark-outpost/contracts';
import { ChatFace } from '../../brand/ChatFace.tsx';
import { workerIdentity, workerRole } from '../../crew/worker-identity.ts';
import { AgentCards } from './AgentCards.tsx';
import { agentCounts, agentsLine } from './agent-cards.ts';

export const OpenAgentsContext = createContext<((runId: string) => void) | null>(null);

function Workers({ rows, live }: { rows: readonly SubagentRow[]; live: boolean }) {
  return (
    <ul className="sl-workers" aria-label="Agent progress">
      {rows.map((row) => {
        const working = live && row.state === 'working';
        const role = workerRole(row.name);
        const status =
          row.state === 'cancelled'
            ? 'Stopped'
            : row.state === 'working'
              ? live
                ? 'Working'
                : 'Inactive'
              : row.state === 'done'
                ? 'Done'
                : 'Failed';
        return (
          <li
            key={row.id}
            className="sl-worker"
            data-worker-id={row.id}
            data-state={row.state}
            title={[row.name, row.task].filter(Boolean).join(' · ')}
          >
            <ChatFace
              chatId={workerIdentity(row.id)}
              size="row"
              state={
                row.state === 'cancelled'
                  ? 'archived'
                  : row.state === 'working' && !working
                    ? 'idle'
                    : row.state
              }
            />
            <span className="sl-name">{role ?? row.name}</span>
            <span className="sl-state">{status}</span>
          </li>
        );
      })}
    </ul>
  );
}

interface SubagentsLineProps {
  runId: string;
  rows: readonly SubagentRow[];
  live: boolean;
}

export function SubagentsLine({ runId, rows, live }: SubagentsLineProps) {
  const openAgents = use(OpenAgentsContext);
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (rows.length === 0) return null;
  const counts = agentCounts(rows);
  const text = agentsLine(live ? counts : { ...counts, working: 0 });
  return (
    <div className="sl">
      <div className="sl-line">
        <Workers rows={rows} live={live} />
        <span className="sl-text sr-only" role="status">
          {text}
        </span>
        {openAgents ? (
          <button
            type="button"
            className="sl-view"
            aria-label="View agents"
            onClick={() => openAgents(runId)}
          >
            View <span aria-hidden="true">→</span>
          </button>
        ) : (
          <button
            type="button"
            className="sl-view"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Hide agents' : 'View agents'}
          </button>
        )}
      </div>
      {!openAgents && open && (
        <div id={listId} className="sl-cards">
          <AgentCards rows={rows} live={live} />
        </div>
      )}
    </div>
  );
}

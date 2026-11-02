import './subagents-line.css';
import { createContext, use, useId, useState } from 'react';
import type { SubagentRow } from '@spark-outpost/contracts';
import { ChatFace } from '../../brand/ChatFace.tsx';
import { workerIdentity, workerPresentation, workerRole } from '../../crew/worker-identity.ts';
import { AgentCards } from './AgentCards.tsx';
import { agentCounts, agentsLine, allDoneLine } from './agent-cards.ts';

export const OpenAgentsContext = createContext<((runId: string) => void) | null>(null);

function Workers({ rows, live }: { rows: readonly SubagentRow[]; live: boolean }) {
  return (
    <ul className="sl-workers" aria-label="Agent progress">
      {rows.map((row) => {
        const role = workerRole(row.name);
        const presentation = workerPresentation(row.state, live);
        return (
          <li
            key={row.id}
            className="sl-worker"
            data-worker-id={row.id}
            data-state={row.state}
            title={[row.name, row.task].filter(Boolean).join(' · ')}
          >
            <ChatFace chatId={workerIdentity(row.id)} size="row" state={presentation.face} />
            <span className="sl-name">{role ?? row.name}</span>
            <span className="sl-state">{presentation.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function AllDone({ rows, text }: { rows: readonly SubagentRow[]; text: string }) {
  return (
    <p
      className="sl-worker sl-done"
      data-state="done"
      title={rows.map((row) => row.name).join(' · ')}
    >
      <ChatFace chatId={workerIdentity(rows[0]!.id)} size="row" state="done" />
      <span className="sl-name">{text}</span>
    </p>
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
  const done = allDoneLine(rows);
  return (
    <div className="sl">
      <div className="sl-line">
        {done ? <AllDone rows={rows} text={done} /> : <Workers rows={rows} live={live} />}
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

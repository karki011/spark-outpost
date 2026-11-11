import './subagents-line.css';
import { createContext, use, useId, useState } from 'react';
import type { SubagentRow } from '@spark-outpost/contracts';
import { ChatFace } from '../../brand/ChatFace.tsx';
import {
  workerIdentity,
  workerModelLabel,
  workerPresentation,
  workerRole,
} from '../../crew/worker-identity.ts';
import { AgentCards } from './AgentCards.tsx';
import type { AgentFocus } from './agent-board.ts';
import { agentCounts, agentsLine, allDoneLine } from './agent-cards.ts';
import { rollupRows } from './subagents-rollup.ts';

export const OpenAgentsContext = createContext<((runId: string, workerId?: string) => void) | null>(
  null,
);

interface WorkersProps {
  rows: readonly SubagentRow[];
  live: boolean;
  compact: boolean;
  onPick: (workerId: string) => void;
}

function Workers({ rows, live, compact, onPick }: WorkersProps) {
  return (
    <ul className={compact ? 'sl-workers sl-faces' : 'sl-workers'} aria-label="Agent progress">
      {rows.map((row) => {
        const role = workerRole(row.name);
        const presentation = workerPresentation(row.state, live);
        const faceOnly = compact && row.state === 'done';
        const model = workerModelLabel(row.usage);
        const described = [row.name, model, presentation.label].filter(Boolean).join(', ');
        return (
          <li key={row.id} className="sl-worker" data-worker-id={row.id} data-state={row.state}>
            <button
              type="button"
              className="sl-face"
              aria-label={described}
              title={[row.name, model, row.task].filter(Boolean).join(' · ')}
              onClick={() => onPick(row.id)}
            >
              <ChatFace chatId={workerIdentity(row.id)} size="row" state={presentation.face} />
              {!faceOnly && (
                <>
                  <span className="sl-name">{role ?? row.name}</span>
                  <span className="sl-state">{presentation.label}</span>
                </>
              )}
            </button>
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
  const [focus, setFocus] = useState<AgentFocus | null>(null);
  const listId = useId();
  if (rows.length === 0) return null;
  const rollup = rollupRows(rows, live);
  const counts = agentCounts(rows);
  const text = agentsLine(live ? counts : { ...counts, working: 0 });
  const done = allDoneLine(rows);
  const pick = (workerId: string) => {
    if (openAgents) {
      openAgents(runId, workerId);
      return;
    }
    setOpen(true);
    setFocus((current) => ({ workerId, nonce: (current?.nonce ?? 0) + 1 }));
  };
  return (
    <div className="sl">
      <div className="sl-line">
        {rollup && (
          <span className="sl-summary" data-rollup="true">
            {rollup.text}
          </span>
        )}
        {done && !rollup ? (
          <AllDone rows={rows} text={done} />
        ) : (
          <Workers rows={rows} live={live} compact={rollup !== null} onPick={pick} />
        )}
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
          <AgentCards rows={rows} live={live} focus={focus} />
        </div>
      )}
    </div>
  );
}

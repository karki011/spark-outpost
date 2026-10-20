import './subagents-line.css';
import { createContext, use, useId, useState } from 'react';
import type { SubagentRow } from '@spark-outpost/contracts';
import { BlobScout } from '../../brand/BlobScout.tsx';
import { AgentCards } from './AgentCards.tsx';
import { agentCounts, agentsLine } from './agent-cards.ts';

export const OpenAgentsContext = createContext<(() => void) | null>(null);

const SCOUTS_SHOWN = 5;

function Scouts({ rows, live }: { rows: readonly SubagentRow[]; live: boolean }) {
  const shown = rows.slice(0, SCOUTS_SHOWN);
  const more = rows.length - shown.length;
  return (
    <span className="sl-scouts" aria-hidden="true">
      {shown.map((row) => {
        const working = live && row.state === 'working';
        return (
          <span key={row.id} className="sl-scout" data-working={working || undefined}>
            <BlobScout size={18} mood={working ? 'working' : null} />
          </span>
        );
      })}
      {more > 0 && <span className="sl-more">+{more}</span>}
    </span>
  );
}

interface SubagentsLineProps {
  rows: readonly SubagentRow[];
  live: boolean;
}

export function SubagentsLine({ rows, live }: SubagentsLineProps) {
  const openAgents = use(OpenAgentsContext);
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (rows.length === 0) return null;
  const counts = agentCounts(rows);
  const text = agentsLine(live ? counts : { ...counts, working: 0 });
  return (
    <div className="sl">
      <div className="sl-line">
        <Scouts rows={rows} live={live} />
        <span className="sl-text" role="status">
          {text}
        </span>
        {openAgents ? (
          <button type="button" className="sl-view" aria-label="View agents" onClick={openAgents}>
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

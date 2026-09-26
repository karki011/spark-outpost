import { useId, useState, type ReactNode } from 'react';
import { CrewBlob } from '../../crew/CrewBlob.tsx';
import { crewStateWord, roleLabel, type CrewAgent } from '../../crew/crew-model.ts';

const SETTLED = new Set<CrewAgent['state']>(['done', 'failed', 'stopped']);

export function parallelTitle(agents: readonly CrewAgent[]): string {
  const live = agents.some((agent) => !SETTLED.has(agent.state));
  const names = agents.map((agent) => agent.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return `${live ? 'Working' : 'Worked'} in parallel: ${list}`;
}

interface ParallelGroupProps {
  agents: readonly CrewAgent[];
  renderMember: (agent: CrewAgent) => ReactNode;
}

export function ParallelGroup({ agents, renderMember }: ParallelGroupProps) {
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const baseId = useId();
  const title = parallelTitle(agents);
  const shown = (agent: CrewAgent) => chosen[agent.id] ?? !SETTLED.has(agent.state);
  return (
    <div className="par-group" role="group" aria-label={title}>
      <p className="par-h">{title}</p>
      <div className="par-heads">
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            className={`par-head ${agent.state}`}
            aria-expanded={shown(agent)}
            aria-controls={`${baseId}-${agent.id}`}
            onClick={() => setChosen({ ...chosen, [agent.id]: !shown(agent) })}
          >
            <span className="agent-ava sm" aria-hidden="true">
              <CrewBlob name={agent.name} provider={agent.provider} state={agent.state} size={20} />
            </span>
            <span className="agent-who">
              <span className="agent-name">{agent.name}</span>
              <span className="agent-role">{roleLabel(agent)}</span>
            </span>
            <span className={`agent-state ${agent.state}`}>{crewStateWord(agent.state)}</span>
          </button>
        ))}
      </div>
      {agents.map((agent) =>
        shown(agent) ? (
          <div key={agent.id} id={`${baseId}-${agent.id}`} className="par-body">
            {renderMember(agent)}
          </div>
        ) : null,
      )}
    </div>
  );
}

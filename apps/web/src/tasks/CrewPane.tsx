import './task-panes.css';
import { CrewMemberRow } from '../crew/CrewMemberRow.tsx';
import { modelLabel, roleLabel, type CrewAgent } from '../crew/crew-model.ts';

function jobLine(agent: CrewAgent, piece: string | undefined): string {
  return [piece ?? roleLabel(agent), modelLabel(agent)].join(' · ');
}

interface CrewPaneProps {
  agents: readonly CrewAgent[];
  labels: ReadonlyMap<string, string>;
}

export function CrewPane({ agents, labels }: CrewPaneProps) {
  return (
    <div className="wsec">
      <div className="wsec-h">
        <h3>Crew</h3>
        <span className="r">
          {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
        </span>
      </div>
      <ul className="tlist" aria-label="Crew">
        {agents.map((agent) => (
          <CrewMemberRow key={agent.id} agent={agent} job={jobLine(agent, labels.get(agent.id))} />
        ))}
      </ul>
    </div>
  );
}

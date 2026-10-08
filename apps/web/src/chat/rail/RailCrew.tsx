import { openAgentTv } from '../../crew/agent-tv-store.ts';
import { CrewMemberRow } from '../../crew/CrewMemberRow.tsx';
import type { CrewAgent } from '../../crew/crew-model.ts';
import { crewHeading, crewJob } from './rail-model.ts';

interface RailCrewProps {
  conversationId: string;
  agents: readonly CrewAgent[];
}

export function RailCrew({ conversationId, agents }: RailCrewProps) {
  return (
    <section className="crail-crew" aria-label="Crew">
      <div className="crail-tasks-head">
        <h3 className="crail-title">{crewHeading(agents)}</h3>
        <button
          type="button"
          className="crail-tasks-count"
          aria-label="Open Agent TV"
          onClick={() => openAgentTv(conversationId)}
        >
          Agent TV
        </button>
      </div>
      <ul tabIndex={0} aria-label="Crew members">
        {agents.map((agent) => (
          <CrewMemberRow key={agent.id} agent={agent} job={crewJob(agent)} blobSize={22} />
        ))}
      </ul>
    </section>
  );
}

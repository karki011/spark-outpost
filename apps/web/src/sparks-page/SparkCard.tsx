import { useQuery } from '@tanstack/react-query';
import { providerName, type TeammateView } from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../api/client.ts';
import { modeLabel } from '../chat/composer/mode-summary.ts';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import { skillCountLabel } from './folder-model.ts';

interface SparkCardProps {
  spark: TeammateView;
  skills: number | undefined;
  onOpen: () => void;
}

export function useAgentLine(spark: TeammateView): string {
  const capabilities = useQuery({
    ...capabilitiesQuery(spark.provider ?? 'claude'),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: spark.provider !== null && spark.agentMode !== null,
  });
  const agent = spark.provider ? providerName(spark.provider) : 'Default agent';
  return `${agent} · ${modeLabel(capabilities.data?.modes ?? [], spark.agentMode)}`;
}

export function SparkCard({ spark, skills, onOpen }: SparkCardProps) {
  const agent = useAgentLine(spark);
  const facts = skills === undefined ? agent : `${agent} · ${skillCountLabel(skills)}`;
  return (
    <li className="spk-card">
      <button
        type="button"
        className="spk-card-open"
        aria-label={`Open ${spark.name}. ${spark.role || 'Spark'}. ${facts}`}
        onClick={onOpen}
      >
        <span className="spk-card-top">
          <TeammateFace face={spark.face} state={spark.state} size={40} />
          <span className="spk-card-who">
            <b>{spark.name}</b>
            <small>{spark.role || 'Spark'}</small>
          </span>
        </span>
        <span className="spk-card-meta">{agent}</span>
        {skills !== undefined && <span className="spk-card-meta">{skillCountLabel(skills)}</span>}
      </button>
    </li>
  );
}

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
  const skillWords = skills === undefined ? '' : skillCountLabel(skills);
  const facts = skillWords ? `${agent} · ${skillWords}` : agent;
  return (
    <li className="spk-crew">
      <button
        type="button"
        className="spk-crew-open"
        aria-label={`Open ${spark.name}. ${spark.role || 'Spark'}. ${facts}`}
        onClick={onOpen}
      >
        <span className="spk-crew-who">
          <TeammateFace face={spark.face} state={spark.state} size={32} />
          <span className="spk-crew-name">
            <b>{spark.name}</b>
            <small>{spark.role || 'Spark'}</small>
          </span>
        </span>
        <span className="spk-crew-meta">{agent}</span>
        <span className="spk-crew-meta">{skillWords}</span>
      </button>
    </li>
  );
}

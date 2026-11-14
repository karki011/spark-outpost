import type { TeammateStarterId, TeammateView } from '@spark-outpost/contracts';
import { StarterSuggestions } from '../teammates/StarterSuggestions.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { WarnIcon } from '../ui/icons.tsx';
import { SparkCard } from './SparkCard.tsx';
import { useSkillCounts } from './use-crew-files.ts';

interface CrewTabProps {
  loading: boolean;
  error: Error | null;
  sparks: readonly TeammateView[];
  starters: readonly TeammateStarterId[];
  remote: boolean;
  onOpen: (sparkId: string) => void;
}

export function CrewTab({ loading, error, sparks, starters, remote, onOpen }: CrewTabProps) {
  const skills = useSkillCounts(
    sparks.map((spark) => spark.id),
    !remote,
  );
  if (loading) {
    return <Skeleton label="Loading your Sparks" shape="cards" rows={3} />;
  }
  if (error) {
    return (
      <p className="spk-problem" role="alert">
        <WarnIcon /> Couldn’t load your Sparks. {error.message}
      </p>
    );
  }
  if (sparks.length === 0) {
    return (
      <div className="spk-empty">
        <h2>Build your crew</h2>
        {remote ? (
          <p className="spk-hint">No Sparks yet. Make one on the Mac.</p>
        ) : (
          <StarterSuggestions starters={starters} />
        )}
      </div>
    );
  }
  return (
    <ul className="spk-grid" aria-label="Your Sparks">
      {sparks.map((spark) => (
        <SparkCard
          key={spark.id}
          spark={spark}
          skills={skills.get(spark.id)}
          onOpen={() => onOpen(spark.id)}
        />
      ))}
    </ul>
  );
}

import type { TeammateStarterId, TeammateView } from '@spark-outpost/contracts';
import { StarterSuggestions } from '../teammates/StarterSuggestions.tsx';
import { openTeammateSheet } from '../teammates/teammate-store.ts';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { PlusIcon, WarnIcon } from '../ui/icons.tsx';
import { BuilderButton } from './builder-button.tsx';
import { CrewEmpty } from './CrewEmpty.tsx';
import { SparkCard } from './SparkCard.tsx';
import { useSkillCounts } from './use-crew-files.ts';
import { hostWords } from '../desktop/host-words.ts';

interface CrewTabProps {
  loading: boolean;
  error: Error | null;
  sparks: readonly TeammateView[];
  starters: readonly TeammateStarterId[];
  remote: boolean;
  onOpen: (sparkId: string) => void;
}

const CREW_POINTS = [
  {
    title: 'Its own instructions',
    detail: 'Standing rules it follows on every job, in a SPARK.md you can edit.',
  },
  {
    title: 'Skills and scripts',
    detail: 'Files it reads only when a job needs them.',
  },
  {
    title: 'Your defaults',
    detail: 'Provider, model and mode, set once for every run.',
  },
];

function NoSparks({
  starters,
  remote,
}: {
  starters: readonly TeammateStarterId[];
  remote: boolean;
}) {
  return (
    <CrewEmpty
      title="Build your crew"
      lede="A Spark is an agent with a name, a face, its own instructions and skills. Hand it a job from any chat, or chain several into a workflow."
      points={CREW_POINTS}
      after={!remote && <StarterSuggestions starters={starters} />}
    >
      {remote ? (
        <p className="spk-hint">No Sparks yet. Make one on the {hostWords().computer}.</p>
      ) : (
        <>
          <button
            type="button"
            className="btn primary sm spk-new-spark"
            onClick={() => openTeammateSheet({ kind: 'create' })}
          >
            <PlusIcon /> New Spark
          </button>
          <BuilderButton />
        </>
      )}
    </CrewEmpty>
  );
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
  if (sparks.length === 0) return <NoSparks starters={starters} remote={remote} />;
  return (
    <div className="spk-list">
      <div className="spk-list-head" aria-hidden="true">
        <span>Name</span>
        <span>Agent and mode</span>
        <span>Skills</span>
      </div>
      <ul aria-label="Your Sparks">
        {sparks.map((spark) => (
          <SparkCard
            key={spark.id}
            spark={spark}
            skills={skills.get(spark.id)}
            onOpen={() => onOpen(spark.id)}
          />
        ))}
      </ul>
    </div>
  );
}

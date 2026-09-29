import '../spark/spark.css';
import type { Profile } from '@spark-outpost/contracts';
import { UserBlob } from '../brand/UserBlob.tsx';
import {
  NameSetting,
  PersonalitySetting,
  SparkSwitch,
  TeamModeSetting,
} from '../spark/SparkSettings.tsx';
import { SparkPreview } from '../spark/SparkPreview.tsx';
import { useReducedMotion } from '../ui/motion.ts';

const DRIFT_COUNT = 10;

interface MeetSparkStepProps {
  profile: Profile;
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  onEnter: () => void;
}

export function MeetSparkStep({
  profile,
  displayName,
  onDisplayNameChange,
  onEnter,
}: MeetSparkStepProps) {
  const reducedMotion = useReducedMotion();
  const named = displayName.trim() !== '';
  return (
    <>
      {!reducedMotion && (
        <div className="drifts" aria-hidden="true">
          {Array.from({ length: DRIFT_COUNT }, (_, index) => (
            <i
              key={index}
              className="drift"
              style={{
                left: `${6 + index * 9.5}%`,
                animationDelay: `${(index * 1.3) % 10}s`,
                animationDuration: `${9 + (index % 4)}s`,
              }}
            />
          ))}
        </div>
      )}
      <h1 id="onbTitle">Meet Spark</h1>
      <p className="lede">
        Spark is your assistant in Spark Outpost. It keeps your AI agents on task, asks when
        something is unclear and checks the work before you see it.
      </p>
      <SparkPreview
        displayName={displayName}
        personality={profile.personality}
        enabled={profile.sparkEnabled}
        size={64}
      />
      <NameSetting name={displayName} onName={onDisplayNameChange} autoFocus onEnter={onEnter} />
      <div className={`greet${named ? ' in' : ''}`}>
        {named ? (
          <>
            <UserBlob displayName={displayName} size={36} animate="always" />
            <p>This little one is you. It’s made from your name.</p>
          </>
        ) : (
          <p>This is how you’ll appear in chats.</p>
        )}
      </div>
      <PersonalitySetting personality={profile.personality} />
      <SparkSwitch enabled={profile.sparkEnabled} />
      <TeamModeSetting enabled={profile.teamMode} />
    </>
  );
}

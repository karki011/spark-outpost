import './spark.css';
import { useState } from 'react';
import type { SetupState } from '@spark-outpost/contracts';
import { NameSetting, PersonalitySetting } from './SparkSettings.tsx';
import { SparkPreview } from './SparkPreview.tsx';

export function ProfileSection({ setup }: { setup: SetupState }) {
  const { profile } = setup;
  const [name, setName] = useState(profile.displayName);
  return (
    <>
      <SparkPreview displayName={name} personality={profile.personality} />
      <section className="spark-group" aria-labelledby="spark-you">
        <h4 id="spark-you">You and Spark</h4>
        <NameSetting name={name} onName={setName} />
        <PersonalitySetting personality={profile.personality} />
      </section>
    </>
  );
}

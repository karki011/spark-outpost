import './spark.css';
import { useState } from 'react';
import type { SetupState } from '@spark-outpost/contracts';
import { AutoContinueSetting } from '../settings/AutoContinueSetting.tsx';
import { CompanionSetting } from '../settings/CompanionSetting.tsx';
import { FailingChecksSetting } from '../settings/FailingChecksSetting.tsx';
import { LevelSetting } from './LevelSetting.tsx';
import {
  NameSetting,
  PersonalitySetting,
  SparkSwitch,
  TeamModeSetting,
  UseNameSetting,
} from './SparkSettings.tsx';
import { SparkPreview } from './SparkPreview.tsx';

export function SparkSection({ setup }: { setup: SetupState }) {
  const { profile } = setup;
  const [name, setName] = useState(profile.displayName);
  return (
    <>
      <SparkPreview
        displayName={name}
        personality={profile.personality}
        enabled={profile.sparkEnabled}
      />
      <section className="spark-group" aria-labelledby="spark-you">
        <h4 id="spark-you">You and Spark</h4>
        <NameSetting name={name} onName={setName} />
        <PersonalitySetting personality={profile.personality} />
        <UseNameSetting enabled={profile.useName} displayName={name} />
      </section>
      <section className="spark-group" aria-labelledby="spark-work">
        <h4 id="spark-work">How Spark works</h4>
        <SparkSwitch enabled={profile.sparkEnabled} />
        <TeamModeSetting enabled={profile.teamMode} />
        <LevelSetting level={profile.defaultLevel} />
        <AutoContinueSetting seconds={profile.autoContinueSeconds} />
        <FailingChecksSetting opensDraft={profile.shipFailingChecks} />
      </section>
      <section className="spark-group" aria-labelledby="spark-around">
        <h4 id="spark-around">Around the app</h4>
        <CompanionSetting />
      </section>
    </>
  );
}

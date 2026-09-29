import './spark.css';
import { useState } from 'react';
import type { SetupState } from '@spark-outpost/contracts';
import { AutoContinueSetting } from '../settings/AutoContinueSetting.tsx';
import { CompanionSetting } from '../settings/CompanionSetting.tsx';
import { FailingChecksSetting } from '../settings/FailingChecksSetting.tsx';
import { LevelSetting } from './LevelSetting.tsx';
import { MorningBriefSetting } from './MorningBriefSetting.tsx';
import { NameSetting, PersonalitySetting, SparkSwitch } from './SparkSettings.tsx';
import { SparkPreview } from './SparkPreview.tsx';
import { SpendCapSetting } from './SpendCapSetting.tsx';

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
      </section>
      <section className="spark-group" aria-labelledby="spark-work">
        <h4 id="spark-work">How Spark works</h4>
        <SparkSwitch enabled={profile.sparkEnabled} />
        <LevelSetting level={profile.defaultLevel} />
        <SpendCapSetting usd={profile.spendCapUsd} />
        <AutoContinueSetting seconds={profile.autoContinueSeconds} />
        <FailingChecksSetting opensDraft={profile.shipFailingChecks} />
      </section>
      <section className="spark-group" aria-labelledby="spark-around">
        <h4 id="spark-around">Around the app</h4>
        <MorningBriefSetting enabled={profile.morningBrief} time={profile.morningBriefTime} />
        <CompanionSetting />
      </section>
    </>
  );
}

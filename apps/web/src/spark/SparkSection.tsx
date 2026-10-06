import './spark.css';
import { useState } from 'react';
import type { SetupState } from '@spark-outpost/contracts';
import { AutoContinueSetting } from '../settings/AutoContinueSetting.tsx';
import { BusyEnterSetting } from '../settings/BusyEnterSetting.tsx';
import { CompanionSetting } from '../settings/CompanionSetting.tsx';
import { DesktopCompanionSetting } from '../settings/DesktopCompanionSetting.tsx';
import { FailingChecksSetting } from '../settings/FailingChecksSetting.tsx';
import { WideWindowSetting } from '../settings/WideWindowSetting.tsx';
import { OpenPullRequestsAsSetting, PrFollowUpSettings } from '../settings/PullRequestSettings.tsx';
import { CompactionSettings } from './CompactionSettings.tsx';
import { LevelSetting } from './LevelSetting.tsx';
import { MorningBriefSetting } from './MorningBriefSetting.tsx';
import { NameSetting, PersonalitySetting, SparkSwitch } from './SparkSettings.tsx';
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
      </section>
      <section className="spark-group" aria-labelledby="spark-work">
        <h4 id="spark-work">How Spark works</h4>
        <SparkSwitch enabled={profile.sparkEnabled} />
        <LevelSetting level={profile.defaultLevel} />
        <AutoContinueSetting seconds={profile.autoContinueSeconds} />
      </section>
      <CompactionSettings profile={profile} />
      <section className="spark-group" aria-labelledby="spark-prs">
        <h4 id="spark-prs">Pull requests</h4>
        <OpenPullRequestsAsSetting ready={profile.prReadyForReview} />
        <FailingChecksSetting opensDraft={profile.shipFailingChecks} />
        <PrFollowUpSettings profile={profile} />
      </section>
      <section className="spark-group" aria-labelledby="spark-around">
        <h4 id="spark-around">Around the app</h4>
        <MorningBriefSetting enabled={profile.morningBrief} time={profile.morningBriefTime} />
        <BusyEnterSetting action={profile.busyEnter} />
        <WideWindowSetting layout={profile.wideWindow} />
        <CompanionSetting />
        <DesktopCompanionSetting />
      </section>
    </>
  );
}

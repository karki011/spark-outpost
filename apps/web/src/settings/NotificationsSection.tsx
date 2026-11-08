import '../spark/spark.css';
import type { Profile } from '@spark-outpost/contracts';
import {
  CalendarBriefSetting,
  CalendarMeetingSettings,
} from '../calendar/CalendarNotifySettings.tsx';
import { MorningBriefSetting } from '../spark/MorningBriefSetting.tsx';
import { WeekRecapSetting } from '../spark/WeekRecapSetting.tsx';
import { CompanionSetting } from './CompanionSetting.tsx';
import { DesktopCompanionSetting } from './DesktopCompanionSetting.tsx';

export function NotificationsSection({ profile }: { profile: Profile }) {
  return (
    <>
      <section className="spark-group" aria-labelledby="notify-app">
        <h4 id="notify-app">In the app</h4>
        <MorningBriefSetting enabled={profile.morningBrief} time={profile.morningBriefTime} />
        <WeekRecapSetting
          enabled={profile.weekRecap}
          day={profile.weekRecapDay}
          time={profile.weekRecapTime}
        />
        <CalendarBriefSetting />
        <CompanionSetting />
      </section>
      <CalendarMeetingSettings />
      <DesktopCompanionSetting />
    </>
  );
}

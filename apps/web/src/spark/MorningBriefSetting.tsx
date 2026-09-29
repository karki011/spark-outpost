import { useState } from 'react';
import { morningBriefTimeSchema } from '@spark-outpost/contracts';
import { useProfileSetting } from '../settings/use-profile-setting.ts';
import { SwitchValueSetting } from './SwitchValueSetting.tsx';

const INFO =
  'Each morning after this time, Spark refreshes your tickets and writes a brief on Home of what changed since the last one, if anything did. Uses this computer’s time zone, and the app needs to be running; it checks every 10 minutes.';

function morningClock(time: string): string {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface MorningBriefSettingProps {
  enabled: boolean;
  time: string;
}

export function MorningBriefSetting({ enabled, time }: MorningBriefSettingProps) {
  const on = useProfileSetting(enabled, (value) => ({ morningBrief: value }));
  const at = useProfileSetting(time, (value) => ({ morningBriefTime: value }));
  const [draft, setDraft] = useState(time);
  const hint =
    on.error ??
    at.error ??
    (on.value
      ? `Spark writes it after ${morningClock(at.value)} each morning.`
      : 'No brief each morning.');
  return (
    <SwitchValueSetting
      label="Morning brief"
      blob="sun"
      info={INFO}
      hint={hint}
      on={on.value}
      onToggle={on.set}
    >
      {(hintId) => (
        <input
          type="time"
          className="inp spark-time"
          aria-label="Morning brief time"
          aria-describedby={hintId}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            const parsed = morningBriefTimeSchema.safeParse(event.target.value);
            if (parsed.success && parsed.data !== at.value) at.set(parsed.data);
          }}
        />
      )}
    </SwitchValueSetting>
  );
}

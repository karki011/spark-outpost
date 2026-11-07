import { useState } from 'react';
import { morningBriefTimeSchema } from '@spark-outpost/contracts';
import { useProfileSetting } from '../settings/use-profile-setting.ts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { SwitchValueSetting } from './SwitchValueSetting.tsx';

export const WEEK_RECAP_LABEL = 'Week recap';

const INFO = {
  items: [
    {
      label: 'What',
      text: 'A recap on Home of what you got done, what is in progress and where someone could help, ready to copy.',
    },
    {
      label: 'When',
      text: 'Once a week on this day after this time, in this computer’s time zone.',
    },
    { label: 'Model', text: 'Your default provider’s middle-tier model, at medium effort.' },
  ],
  footer: 'Nothing is sent anywhere; you copy it yourself.',
};

const DAYS = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
  id: String(day),
  label: new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(
    new Date(2026, 10, 1 + day),
  ),
}));

interface WeekRecapSettingProps {
  enabled: boolean;
  day: number;
  time: string;
}

export function WeekRecapSetting({ enabled, day, time }: WeekRecapSettingProps) {
  const on = useProfileSetting(enabled, (value) => ({ weekRecap: value }));
  const weekday = useProfileSetting(day, (value) => ({ weekRecapDay: value }));
  const at = useProfileSetting(time, (value) => ({ weekRecapTime: value }));
  const [draft, setDraft] = useState(time);
  const dayName = DAYS[weekday.value - 1]?.label ?? '';
  const hint =
    on.error ??
    weekday.error ??
    at.error ??
    (on.value ? `Spark writes it each ${dayName} after ${at.value}.` : 'No weekly recap.');
  return (
    <SwitchValueSetting
      label={WEEK_RECAP_LABEL}
      blob="sun"
      info={INFO}
      hint={hint}
      on={on.value}
      onToggle={on.set}
    >
      {(hintId) => (
        <span className="spark-recap-when">
          <ChoicePicker
            label="Week recap day"
            choices={DAYS}
            value={String(weekday.value)}
            onChange={(id) => weekday.set(Number(id))}
          />
          <input
            type="time"
            className="inp spark-time"
            aria-label="Week recap time"
            aria-describedby={hintId}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              const parsed = morningBriefTimeSchema.safeParse(event.target.value);
              if (parsed.success && parsed.data !== at.value) at.set(parsed.data);
            }}
          />
        </span>
      )}
    </SwitchValueSetting>
  );
}

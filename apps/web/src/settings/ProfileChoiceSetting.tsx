import { useId } from 'react';
import type { UpdateProfileRequest } from '@spark-outpost/contracts';
import { Segmented } from '../ui/Segmented.tsx';
import type { DocTarget } from '../ui/DocLink.tsx';
import type { TipContent } from '../ui/Tooltip.tsx';
import { SettingRow } from './SettingRow.tsx';
import { useProfileSetting } from './use-profile-setting.ts';

export interface ProfileChoice<T> {
  id: string;
  label: string;
  value: T;
}

interface ProfileChoiceSettingProps<T> {
  saved: T;
  choices: ProfileChoice<T>[];
  label: string;
  info?: TipContent;
  doc?: DocTarget;
  hint: string | ((value: T) => string);
  toUpdate: (value: T) => UpdateProfileRequest;
  onPick?: (value: T) => void;
}

export function ProfileChoiceSetting<T>({
  saved,
  choices,
  label,
  info,
  doc,
  hint,
  toUpdate,
  onPick,
}: ProfileChoiceSettingProps<T>) {
  const hintId = useId();
  const setting = useProfileSetting(saved, toUpdate);
  const current = choices.find((choice) => choice.value === setting.value) ?? choices[0]!;
  return (
    <SettingRow
      label={label}
      hint={setting.error ?? (typeof hint === 'string' ? hint : hint(current.value))}
      hintId={hintId}
      {...(info ? { info } : {})}
      doc={doc}
    >
      <Segmented
        ariaLabel={label}
        describedBy={hintId}
        options={choices}
        value={current.id}
        onChange={(id) => {
          const choice = choices.find((entry) => entry.id === id);
          if (!choice) return;
          setting.set(choice.value);
          onPick?.(choice.value);
        }}
      />
    </SettingRow>
  );
}

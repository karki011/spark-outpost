import '../chat/project/agent-setup.css';
import { useId } from 'react';
import type { UpdateProfileRequest } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { SetupSwitch } from '../chat/project/SetupCard.tsx';
import { SettingRow } from './SettingRow.tsx';
import { useProfileSetting } from './use-profile-setting.ts';

interface ProfileSwitchSettingProps {
  enabled: boolean;
  label: string;
  info: string;
  hint: string | ((enabled: boolean) => string);
  disabled?: boolean;
  blob?: boolean;
  toUpdate: (value: boolean) => UpdateProfileRequest;
}

export function ProfileSwitchSetting({
  enabled,
  label,
  info,
  hint,
  disabled = false,
  blob = false,
  toUpdate,
}: ProfileSwitchSettingProps) {
  const switchId = useId();
  const hintId = useId();
  const setting = useProfileSetting(enabled, toUpdate);
  const Toggle = blob ? BlobToggle : SetupSwitch;
  return (
    <SettingRow
      label={label}
      controlId={switchId}
      info={info}
      hint={setting.error ?? (typeof hint === 'string' ? hint : hint(setting.value))}
      hintId={hintId}
      disabled={disabled}
    >
      <Toggle
        id={switchId}
        label={label}
        checked={setting.value}
        disabled={disabled}
        describedBy={hintId}
        onChange={setting.set}
      />
    </SettingRow>
  );
}

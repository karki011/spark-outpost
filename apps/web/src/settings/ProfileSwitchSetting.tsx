import '../chat/project/agent-setup.css';
import { useId } from 'react';
import type { UpdateProfileRequest } from '@spark-outpost/contracts';
import { SetupSwitch } from '../chat/project/SetupCard.tsx';
import { SettingRow } from './SettingRow.tsx';
import { useProfileSetting } from './use-profile-setting.ts';

interface ProfileSwitchSettingProps {
  enabled: boolean;
  label: string;
  info: string;
  hint: string;
  disabled?: boolean;
  toUpdate: (value: boolean) => UpdateProfileRequest;
}

export function ProfileSwitchSetting({
  enabled,
  label,
  info,
  hint,
  disabled = false,
  toUpdate,
}: ProfileSwitchSettingProps) {
  const switchId = useId();
  const hintId = useId();
  const setting = useProfileSetting(enabled, toUpdate);
  return (
    <SettingRow
      label={label}
      controlId={switchId}
      info={info}
      hint={setting.error ?? hint}
      hintId={hintId}
      disabled={disabled}
    >
      <SetupSwitch
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

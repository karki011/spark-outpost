import '../chat/project/agent-setup.css';
import { useId } from 'react';
import type { UpdateProfileRequest } from '@spark-outpost/contracts';
import { BlobToggle, type BlobKind } from '../brand/BlobToggle.tsx';
import type { DocTarget } from '../ui/DocLink.tsx';
import type { TipContent } from '../ui/Tooltip.tsx';
import { SettingRow } from './SettingRow.tsx';
import { useProfileSetting } from './use-profile-setting.ts';

interface ProfileSwitchSettingProps {
  enabled: boolean;
  label: string;
  info: TipContent;
  doc?: DocTarget;
  hint: string | ((enabled: boolean) => string);
  disabled?: boolean;
  blob?: BlobKind;
  toUpdate: (value: boolean) => UpdateProfileRequest;
}

export function ProfileSwitchSetting({
  enabled,
  label,
  info,
  doc,
  hint,
  disabled = false,
  blob,
  toUpdate,
}: ProfileSwitchSettingProps) {
  const switchId = useId();
  const hintId = useId();
  const setting = useProfileSetting(enabled, toUpdate);
  const toggle = {
    id: switchId,
    label,
    checked: setting.value,
    disabled,
    describedBy: hintId,
    onChange: setting.set,
  };
  return (
    <SettingRow
      label={label}
      controlId={switchId}
      info={info}
      doc={doc}
      hint={setting.error ?? (typeof hint === 'string' ? hint : hint(setting.value))}
      hintId={hintId}
      disabled={disabled}
    >
      <BlobToggle kind={blob ?? 'plain'} {...toggle} />
    </SettingRow>
  );
}

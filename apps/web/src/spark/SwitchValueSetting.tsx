import { useId, type ReactNode } from 'react';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { SettingRow } from '../settings/SettingRow.tsx';

interface SwitchValueSettingProps {
  label: string;
  info: string;
  hint: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  children: (hintId: string) => ReactNode;
}

export function SwitchValueSetting({
  label,
  info,
  hint,
  on,
  onToggle,
  children,
}: SwitchValueSettingProps) {
  const switchId = useId();
  const hintId = useId();
  return (
    <SettingRow label={label} controlId={switchId} info={info} hint={hint} hintId={hintId}>
      <span className="spark-value">
        {on && children(hintId)}
        <BlobToggle
          id={switchId}
          label={label}
          checked={on}
          describedBy={hintId}
          onChange={onToggle}
        />
      </span>
    </SettingRow>
  );
}

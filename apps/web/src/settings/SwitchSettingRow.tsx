import { useId } from 'react';
import { Switch } from '../ui/Switch.tsx';
import { SettingRow } from './SettingRow.tsx';

interface SwitchSettingRowProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}

export function SwitchSettingRow({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: SwitchSettingRowProps) {
  const id = useId();
  const hintId = useId();
  return (
    <SettingRow label={label} controlId={id} hint={hint} hintId={hintId} disabled={disabled}>
      <Switch
        id={id}
        label={label}
        checked={checked}
        describedBy={hintId}
        disabled={disabled}
        onChange={onChange}
      />
    </SettingRow>
  );
}

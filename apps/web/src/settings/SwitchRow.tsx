import { useId } from 'react';
import { Switch } from '../ui/Switch.tsx';
import type { DocTarget } from '../ui/DocLink.tsx';
import { SettingRow } from './SettingRow.tsx';

interface SwitchRowProps {
  id: string;
  label: string;
  doc: DocTarget;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  standsFor?: readonly string[] | undefined;
}

export function SwitchRow({
  id,
  label,
  doc,
  hint,
  checked,
  onChange,
  disabled = false,
  standsFor,
}: SwitchRowProps) {
  const hintId = useId();
  return (
    <SettingRow
      label={label}
      controlId={id}
      doc={doc}
      hint={hint}
      hintId={hintId}
      disabled={disabled}
      standsFor={standsFor}
    >
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

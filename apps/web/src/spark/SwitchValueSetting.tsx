import { useId, type ReactNode } from 'react';
import { BlobToggle, type BlobKind } from '../brand/BlobToggle.tsx';
import { SettingRow } from '../settings/SettingRow.tsx';
import type { DocTarget } from '../ui/DocLink.tsx';
import type { TipContent } from '../ui/Tooltip.tsx';

interface SwitchValueSettingProps {
  label: string;
  blob: BlobKind;
  info: TipContent;
  doc?: DocTarget;
  hint: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  children: (hintId: string) => ReactNode;
}

export function SwitchValueSetting({
  label,
  blob,
  info,
  doc,
  hint,
  on,
  onToggle,
  children,
}: SwitchValueSettingProps) {
  const switchId = useId();
  const hintId = useId();
  return (
    <SettingRow
      label={label}
      controlId={switchId}
      info={info}
      doc={doc}
      hint={hint}
      hintId={hintId}
    >
      <span className="spark-value">
        {on && children(hintId)}
        <BlobToggle
          id={switchId}
          label={label}
          kind={blob}
          checked={on}
          describedBy={hintId}
          onChange={onToggle}
        />
      </span>
    </SettingRow>
  );
}

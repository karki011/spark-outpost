import './setting-row.css';
import type { ReactNode } from 'react';
import { DocLink, type DocTarget } from '../ui/DocLink.tsx';
import { InfoTip } from '../ui/InfoTip.tsx';
import type { TipContent } from '../ui/Tooltip.tsx';

interface SettingRowProps {
  label: string;
  controlId?: string;
  info?: TipContent;
  doc?: DocTarget | undefined;
  hint: string;
  hintId: string;
  disabled?: boolean;
  children: ReactNode;
}

export function SettingRow({
  label,
  controlId,
  info,
  doc,
  hint,
  hintId,
  disabled = false,
  children,
}: SettingRowProps) {
  return (
    <div className="set-row" data-disabled={disabled || undefined}>
      <div className="set-row-head">
        {controlId ? (
          <label className="set-row-label" htmlFor={controlId}>
            {label}
          </label>
        ) : (
          <span className="set-row-label">{label}</span>
        )}
        {info ? (
          <InfoTip topic={label} text={info} doc={doc} />
        ) : (
          doc && <DocLink topic={label} doc={doc} />
        )}
      </div>
      <div className="set-row-control">{children}</div>
      <p id={hintId} className="set-hint set-row-hint" aria-live="polite">
        {hint}
      </p>
    </div>
  );
}

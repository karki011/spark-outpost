import './setting-row.css';
import type { ReactNode } from 'react';
import { InfoTip } from '../ui/InfoTip.tsx';
import type { TipContent } from '../ui/Tooltip.tsx';

interface SettingRowProps {
  label: string;
  controlId?: string;
  info?: TipContent;
  hint: string;
  hintId: string;
  disabled?: boolean;
  children: ReactNode;
}

export function SettingRow({
  label,
  controlId,
  info,
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
        {info && <InfoTip topic={label} text={info} />}
      </div>
      <div className="set-row-control">{children}</div>
      <p id={hintId} className="set-hint set-row-hint" aria-live="polite">
        {hint}
      </p>
    </div>
  );
}

import './warning-note.css';
import type { ReactNode } from 'react';
import { WarnIcon } from './icons.tsx';

interface WarningNoteProps {
  id?: string;
  lead: string;
  children: ReactNode;
}

export function WarningNote({ id, lead, children }: WarningNoteProps) {
  return (
    <div id={id} className="warn-note" role="note">
      <WarnIcon />
      <p>
        <b>{lead}</b> {children}
      </p>
    </div>
  );
}

interface ConfirmCheckProps {
  label: string;
  checked: boolean;
  describedBy?: string;
  onChange: (checked: boolean) => void;
}

export function ConfirmCheck({ label, checked, describedBy, onChange }: ConfirmCheckProps) {
  return (
    <label className="warn-check">
      <input
        type="checkbox"
        checked={checked}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

import './switch.css';
import { useSwitchWords } from './switch-words.ts';

interface SwitchProps {
  label: string;
  size?: 'md' | 'sm';
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  describedBy?: string;
  disabled?: boolean;
}

function classesFor(size: 'md' | 'sm', extra = ''): string {
  return ['switch-ctl', size === 'sm' ? 'sm' : '', extra].filter(Boolean).join(' ');
}

function Track() {
  return (
    <span className="switch-track" aria-hidden="true">
      <span className="switch-knob" />
    </span>
  );
}

export function Switch({
  label,
  size = 'md',
  checked,
  onChange,
  id,
  describedBy,
  disabled = false,
}: SwitchProps) {
  const words = useSwitchWords();
  return (
    <button
      id={id}
      type="button"
      role="switch"
      className={classesFor(size, words ? 'switch-worded' : '')}
      data-on={checked}
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <Track />
      {words && (
        <span className="switch-word" aria-hidden="true">
          {checked ? 'On' : 'Off'}
        </span>
      )}
    </button>
  );
}

export function SwitchFace({ checked, size = 'sm' }: { checked: boolean; size?: 'md' | 'sm' }) {
  return (
    <span className={classesFor(size, 'switch-face')} data-on={checked} aria-hidden="true">
      <Track />
    </span>
  );
}

import { CheckIcon, SpinnerIcon, XIcon } from '../ui/icons.tsx';
import { LabelText } from './LabelText.tsx';
import type { VerifyLogLine } from './verify-log.ts';

export function VerifyLog({ lines }: { lines: VerifyLogLine[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="vlog" aria-live="polite">
      {lines.map((line) => (
        <li
          key={line.id}
          className={line.status === 'bad' ? 'bad' : line.status === 'good' ? 'good' : ''}
        >
          <span className="ic">
            {line.status === 'pending' && <SpinnerIcon />}
            {line.status === 'good' && <CheckIcon />}
            {line.status === 'bad' && <XIcon />}
          </span>
          <span>
            <LabelText label={line.label} />
          </span>
        </li>
      ))}
    </ul>
  );
}

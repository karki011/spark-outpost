import type { UnusableChoice } from './model-options.ts';
import './unusable-model.css';

interface UnusableModelNoticeProps {
  issue: UnusableChoice;
  detail?: string;
  busy?: boolean;
  onSwitch: (model: string) => void;
}

export function UnusableModelNotice({
  issue,
  detail,
  busy = false,
  onSwitch,
}: UnusableModelNoticeProps) {
  const target = issue.switchTo;
  return (
    <div className="munavail" role="status">
      <p>
        {issue.text}
        {detail ? ` ${detail}` : ''}
      </p>
      {target && (
        <button
          type="button"
          className="btn line sm"
          disabled={busy}
          onClick={() => onSwitch(target.id)}
        >
          Switch to {target.label}
        </button>
      )}
    </div>
  );
}

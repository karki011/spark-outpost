import { ChevronIcon } from '../../ui/icons.tsx';
import { copyButtonText, useCopyFeedback } from '../../ui/use-copy-feedback.ts';
import type { ConnectionFailure } from './connection-failure.ts';

const RESTART_COMMAND = 'pnpm dev';

interface FailureDetailsProps {
  failure: ConnectionFailure;
  failedAt: number;
}

export function FailureDetails({ failure, failedAt }: FailureDetailsProps) {
  const { state, copy } = useCopyFeedback();

  return (
    <details className="offline-details">
      <summary>
        <ChevronIcon />
        Details
      </summary>
      <dl>
        <dt>Status</dt>
        <dd>{failure.status ?? 'No response'}</dd>
        <dt>URL</dt>
        <dd className="mono">{failure.url ?? 'Unknown'}</dd>
        <dt>Time</dt>
        <dd>{new Date(failedAt).toLocaleTimeString()}</dd>
      </dl>
      <div className="offline-hint">
        <span>
          If this keeps happening, restart it with <code>{RESTART_COMMAND}</code>
        </span>
        <button type="button" className="btn line sm" onClick={() => copy(RESTART_COMMAND)}>
          {copyButtonText(state)}
        </button>
      </div>
    </details>
  );
}

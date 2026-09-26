import { useEffect, useState } from 'react';
import { ChevronIcon } from '../../ui/icons.tsx';
import type { ConnectionFailure } from './connection-failure.ts';

const RESTART_COMMAND = 'pnpm dev';

type CopyState = 'idle' | 'copied' | 'failed';

interface FailureDetailsProps {
  failure: ConnectionFailure;
  failedAt: number;
}

export function FailureDetails({ failure, failedAt }: FailureDetailsProps) {
  const [copy, setCopy] = useState<CopyState>('idle');

  useEffect(() => {
    if (copy === 'idle') return;
    const timeout = setTimeout(() => setCopy('idle'), 1600);
    return () => clearTimeout(timeout);
  }, [copy]);

  const copyCommand = () => {
    navigator.clipboard.writeText(RESTART_COMMAND).then(
      () => setCopy('copied'),
      () => setCopy('failed'),
    );
  };

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
        <button type="button" className="btn line sm" onClick={copyCommand}>
          {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
      </div>
    </details>
  );
}

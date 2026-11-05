import { queuedCount } from '../queue/queue-model.ts';
import { AgentBlob } from '../../brand/AgentBlob.tsx';
import type { BlobExpression } from '../../brand/blob-expression.ts';
import { CrewBlob } from '../../crew/CrewBlob.tsx';
import type { Worker } from './status-store.ts';

export function Dot() {
  return (
    <>
      {' '}
      <span className="cs-dot" aria-hidden="true">
        ·
      </span>{' '}
    </>
  );
}

export function Indicator({
  provider,
  expression,
  still = false,
}: {
  provider: string;
  expression: BlobExpression;
  still?: boolean;
}) {
  return (
    <span className="cs-blob" aria-hidden="true">
      <AgentBlob
        provider={provider}
        size={18}
        expression={expression}
        animate={still ? 'hover' : 'always'}
      />
    </span>
  );
}

export function WorkerFace({ worker, idle }: { worker: Worker; idle: boolean }) {
  if (worker.kind === 'agent') {
    return <Indicator provider={worker.provider} expression={idle ? 'thinking' : 'idle'} />;
  }
  return (
    <span className="cs-blob" aria-hidden="true">
      <CrewBlob
        name={worker.name}
        provider={worker.provider}
        state={idle ? 'thinking' : 'working'}
        size={18}
      />
    </span>
  );
}

export function QueuedTail({ queued }: { queued: number }) {
  if (queued === 0) return null;
  return (
    <>
      <Dot />
      <span className="cs-queued">{queuedCount(queued)}</span>
    </>
  );
}

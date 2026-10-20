import { useMutation } from '@tanstack/react-query';
import type { BackgroundWait } from '@spark-outpost/contracts';
import { api } from '../api/client.ts';

export function backgroundLine(background: BackgroundWait): string {
  const names = background.names.join(', ');
  return names ? `Still running in the background: ${names}` : 'Still running in the background';
}

export function BackgroundWork({
  runId,
  background,
}: {
  runId: string;
  background: BackgroundWait | null;
}) {
  const stop = useMutation({ mutationFn: () => api.cancelRun(runId) });
  if (!background) return null;
  return (
    <div className="ai-note background-work">
      <span role="status">{backgroundLine(background)}.</span>
      <button
        type="button"
        className="btn sm"
        disabled={stop.isPending}
        onClick={() => stop.mutate()}
      >
        {stop.isPending ? 'Stopping…' : 'Stop background tasks'}
      </button>
      {stop.error && (
        <span className="agent-term-error" role="alert">
          Couldn't stop: {stop.error.message}
        </span>
      )}
    </div>
  );
}

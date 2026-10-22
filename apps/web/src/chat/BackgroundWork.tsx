import { useMutation } from '@tanstack/react-query';
import type { BackgroundWait } from '@spark-outpost/contracts';
import { api } from '../api/client.ts';
import { sleepingLine } from './wait-label.ts';

function runningLine(background: BackgroundWait): string {
  const names = background.names.join(', ');
  return names ? `Still running in the background: ${names}` : 'Still running in the background';
}

export function backgroundLine(background: BackgroundWait): string {
  const working = background.agents + background.tasks > 0;
  if (background.wakesAt === undefined) return runningLine(background);
  const sleeping = sleepingLine(background.wakesAt);
  return working ? `${runningLine(background)}. ${sleeping}` : sleeping;
}

function stopLabel(background: BackgroundWait): string {
  return background.agents + background.tasks > 0 ? 'Stop background tasks' : 'Stop waiting';
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
        {stop.isPending ? 'Stopping…' : stopLabel(background)}
      </button>
      {stop.error && (
        <span className="agent-term-error" role="alert">
          Couldn't stop: {stop.error.message}
        </span>
      )}
    </div>
  );
}

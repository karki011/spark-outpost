import type { ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { BackgroundWait } from '@spark-outpost/contracts';
import { api } from '../api/client.ts';
import { countLabel } from '../ui/count-label.ts';
import { sleepingLine } from './wait-label.ts';
import { useLiveHead } from './status/status-context.ts';

const COMMAND_SHAPE = /[;|&>]|^(cd|pnpm|npm|npx|node|git|sh|bash|make|yarn|python3?)\s/;

function runningLine(background: BackgroundWait): string {
  const counts = [
    background.agents > 0 ? countLabel(background.agents, 'agent') : null,
    background.tasks > 0 ? countLabel(background.tasks, 'task') : null,
  ].filter((part) => part !== null);
  const head = 'Still running in the background';
  return counts.length > 0 ? `${head}: ${counts.join(', ')}` : head;
}

export function backgroundLine(background: BackgroundWait): string {
  const working = background.agents + background.tasks > 0;
  if (background.wakesAt === undefined) return runningLine(background);
  const sleeping = sleepingLine(background.wakesAt);
  return working ? `${runningLine(background)}. ${sleeping}` : sleeping;
}

function BackgroundNames({ names }: { names: readonly string[] }) {
  if (names.length === 0) return null;
  return (
    <ul className="bgw-names" aria-label="Background work">
      {names.map((name, index) => (
        <li key={`${name}-${index}`} title={name}>
          {COMMAND_SHAPE.test(name) ? <code>{name}</code> : name}
        </li>
      ))}
    </ul>
  );
}

function stopLabel(background: BackgroundWait): string {
  return background.agents + background.tasks > 0 ? 'Stop background tasks' : 'Stop waiting';
}

export function BackgroundWork({
  runId,
  background,
  children,
}: {
  runId: string;
  background: BackgroundWait | null;
  children?: ReactNode;
}) {
  const headRef = useLiveHead(runId);
  const stop = useMutation({ mutationFn: () => api.cancelRun(runId) });
  if (!background) return null;
  return (
    <div className="ai-note background-work" ref={headRef}>
      <span className="bgw-line" role="status">
        {backgroundLine(background)}.
      </span>
      {children}
      <button
        type="button"
        className="btn sm"
        disabled={stop.isPending}
        onClick={() => stop.mutate()}
      >
        {stop.isPending ? 'Stopping…' : stopLabel(background)}
      </button>
      <BackgroundNames names={background.names} />
      {stop.error && (
        <span className="agent-term-error" role="alert">
          Couldn't stop: {stop.error.message}
        </span>
      )}
    </div>
  );
}

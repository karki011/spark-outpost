import './turn.css';
import type { ReactNode } from 'react';
import type { Run } from '@spark-outpost/contracts';
import { AgentBlob } from '../../brand/AgentBlob.tsx';
import { formatTokens } from '../composer/model-options.ts';
import { providerName } from '../provider-name.ts';
import { Spinner } from '../rows/Rows.tsx';
import { useLiveHead } from '../status/status-context.ts';
import { clockText } from '../status/status-text.ts';
import { useNow } from '../status/use-status-line.ts';

export function agentChanged(run: Run, previous: Run | null): boolean {
  if (!previous) return false;
  if (previous.provider !== run.provider) return true;
  const before = previous.usedModel ?? previous.model;
  const now = run.usedModel ?? run.model;
  return Boolean(before && now && before !== now);
}

export function AgentMark({ provider, model }: { provider: string; model: string | null }) {
  return (
    <p className="agent-mark">
      <AgentBlob provider={provider} size={16} />
      <span>
        {providerName(provider)}
        {model && <span className="agent-mark-model"> · {model}</span>}
      </span>
    </p>
  );
}

export function WorkingLine({ run }: { run: Run }) {
  const headRef = useLiveHead(run.id);
  const now = useNow(true);
  const since = Date.parse(run.startedAt ?? run.createdAt);
  const tokens = run.usage?.tokens?.total ?? null;
  return (
    <p className="turn-working" ref={headRef}>
      <Spinner />
      <b>Working</b>
      <span className="turn-working-meta">
        {Number.isFinite(since) && <> · {clockText(Math.max(0, now - since))}</>}
        {tokens !== null && tokens > 0 && <> · {formatTokens(tokens)} tokens</>}
      </span>
      <span className="turn-working-stop">
        <kbd>Esc</kbd> to stop
      </span>
    </p>
  );
}

export function TurnMeta({ children }: { children: ReactNode }) {
  return (
    <div className="turn-meta" role="group" aria-label="Turn actions and details">
      {children}
    </div>
  );
}

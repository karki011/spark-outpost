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
import type { LeadStep } from './live-label.ts';

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

function sinceText(now: number, since: number | null): string | null {
  return since !== null && Number.isFinite(since) ? clockText(Math.max(0, now - since)) : null;
}

export function WorkingLine({ run, step }: { run: Run; step: LeadStep }) {
  const headRef = useLiveHead(run.id);
  const now = useNow(true);
  const stepClock = sinceText(now, step.since);
  const turnClock = sinceText(now, Date.parse(run.startedAt ?? run.createdAt));
  const tokens = run.usage?.tokens?.total ?? null;
  return (
    <div className="turn-working" ref={headRef}>
      <Spinner />
      <span className="turn-working-now">
        <b>{step.label}</b>
        {stepClock && <span className="turn-working-meta"> · {stepClock}</span>}
      </span>
      <span className="turn-working-turn">
        {turnClock && <> · Turn {turnClock}</>}
        {tokens !== null && tokens > 0 && <> · {formatTokens(tokens)} tokens</>}
      </span>
      <span className="turn-working-stop">
        <kbd>Esc</kbd> to stop
      </span>
    </div>
  );
}

export function TurnMeta({ children }: { children: ReactNode }) {
  return (
    <div className="turn-meta" role="group" aria-label="Turn actions and details">
      {children}
    </div>
  );
}

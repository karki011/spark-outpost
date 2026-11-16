import './turn.css';
import { useId, useState, type ReactNode } from 'react';
import type { Run } from '@spark-outpost/contracts';
import { AgentBlob } from '../../brand/AgentBlob.tsx';
import { ChevronIcon } from '../../ui/icons.tsx';
import { formatTokens } from '../composer/model-options.ts';
import { providerName } from '../provider-name.ts';
import { Spinner } from '../rows/RowStatus.tsx';
import { useLiveHead } from '../status/status-context.ts';
import { clockText } from '../status/status-text.ts';
import { thoughtText } from '../thought-text.ts';
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

function WorkingNow({ step, clock }: { step: LeadStep; clock: string | null }) {
  return (
    <>
      <b>{step.label}</b>
      {clock && <span className="turn-working-meta"> · {clock}</span>}
    </>
  );
}

export function WorkingLine({ run, step }: { run: Run; step: LeadStep }) {
  const headRef = useLiveHead(run.id);
  const now = useNow(true);
  const [showThought, setShowThought] = useState(false);
  const thoughtId = useId();
  const stepClock = sinceText(now, step.since);
  const turnClock = sinceText(now, Date.parse(run.startedAt ?? run.createdAt));
  const tokens = run.usage?.tokens?.total ?? null;
  const thought = step.thought;
  return (
    <>
      <div className="turn-working" ref={headRef}>
        <Spinner />
        {thought ? (
          <button
            type="button"
            className="turn-working-now turn-working-toggle"
            aria-expanded={showThought}
            aria-controls={thoughtId}
            onClick={() => setShowThought(!showThought)}
          >
            <WorkingNow step={step} clock={stepClock} />
            <ChevronIcon />
          </button>
        ) : (
          <span className="turn-working-now">
            <WorkingNow step={step} clock={stepClock} />
          </span>
        )}
        <span className="turn-working-turn">
          {turnClock && <> · Turn {turnClock}</>}
          {tokens !== null && tokens > 0 && <> · {formatTokens(tokens)} tokens</>}
        </span>
        <span className="turn-working-stop">
          <kbd>Esc</kbd> to stop
        </span>
      </div>
      {thought && showThought && (
        <div
          id={thoughtId}
          className="step-thought turn-working-thought"
          role="group"
          aria-label="Thinking"
          tabIndex={0}
        >
          {thoughtText(thought)}
        </div>
      )}
    </>
  );
}

export function TurnMeta({ children }: { children: ReactNode }) {
  return (
    <div className="turn-meta" role="group" aria-label="Turn actions and details">
      {children}
    </div>
  );
}

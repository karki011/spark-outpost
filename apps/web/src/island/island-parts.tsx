import { useEffect, useState, type ReactNode } from 'react';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { providerName } from '../chat/provider-name.ts';
import { CrewBlob } from '../crew/CrewBlob.tsx';
import type { CrewState } from '../crew/crew-model.ts';

export const ARMING_MS = 600;

export function useArmed(key: string): boolean {
  const [armedKey, setArmedKey] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setArmedKey(key), ARMING_MS);
    return () => clearTimeout(timer);
  }, [key]);
  return armedKey === key;
}

export function ProviderTag({ provider }: { provider: string | null }) {
  if (!provider) return null;
  return (
    <span className="isl-ptag">
      <span
        className="isl-pdot"
        style={{ ['--pc' as string]: `var(--c-${provider}, var(--faint))` }}
      />
      {providerName(provider)}
    </span>
  );
}

interface WhoProps {
  name: string;
  role?: string | null;
  provider: string | null;
  title?: string | null;
  expression?: BlobExpression;
  crewState?: CrewState;
}

export function Who({ name, role, provider, title, expression = 'idle', crewState }: WhoProps) {
  return (
    <div className="isl-who">
      <span className="isl-blob" aria-hidden="true">
        {crewState && provider ? (
          <CrewBlob name={name} provider={provider} state={crewState} size={16} />
        ) : (
          <AgentBlob provider={provider ?? 'claude'} size={16} expression={expression} />
        )}
      </span>
      <b>{name}</b>
      {role && <span> · {role}</span>}
      <ProviderTag provider={provider} />
      {title && <span className="isl-who-title"> · {title}</span>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="isl-k" aria-hidden="true">
      {children}
    </span>
  );
}

export function RunDots() {
  return (
    <span className="isl-run-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function elapsedText(startedAt: string | null, now: number): string {
  if (!startedAt) return '0:00';
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function useSecondClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

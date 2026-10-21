import { useEffect, useState, type ReactNode } from 'react';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { providerName } from '../chat/provider-name.ts';
import { CrewBlob } from '../crew/CrewBlob.tsx';
import type { CrewState } from '../crew/crew-model.ts';

export const ARMING_MS = 600;

export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export function useArmed(key: string): boolean {
  const [armedKey, setArmedKey] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setArmedKey(key), ARMING_MS);
    return () => clearTimeout(timer);
  }, [key]);
  return armedKey === key;
}

export function useArmedAfterChange(key: string): boolean {
  const [armedKey, setArmedKey] = useState(key);
  useEffect(() => {
    if (armedKey === key) return;
    const timer = setTimeout(() => setArmedKey(key), ARMING_MS);
    return () => clearTimeout(timer);
  }, [key, armedKey]);
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
      {provider && providerName(provider) !== name && <ProviderTag provider={provider} />}
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

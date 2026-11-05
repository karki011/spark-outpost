import { useId } from 'react';
import type { RatedVerdict } from '../analytics-model.ts';
import { DotPattern, HatchPattern } from './Patterns.tsx';

const COLORS: Record<string, string> = {
  good: 'var(--success)',
  mixed: 'var(--warn)',
  unclear: 'var(--muted)',
  bad: 'var(--danger)',
};

export function verdictColor(verdict: string): string {
  return COLORS[verdict] ?? 'var(--muted)';
}

interface VerdictPatternIds {
  mixed: string;
  bad: string;
}

export function useVerdictPatternIds(): VerdictPatternIds {
  const base = useId();
  return { mixed: `${base}m`, bad: `${base}b` };
}

export function VerdictPatterns({ ids }: { ids: VerdictPatternIds }) {
  return (
    <>
      <DotPattern id={ids.mixed} color={verdictColor('mixed')} />
      <HatchPattern id={ids.bad} color={verdictColor('bad')} />
    </>
  );
}

export function verdictFill(verdict: RatedVerdict, ids: VerdictPatternIds): string {
  if (verdict === 'mixed') return `url(#${ids.mixed})`;
  if (verdict === 'bad') return `url(#${ids.bad})`;
  if (verdict === 'unclear') return 'var(--panel)';
  return verdictColor('good');
}

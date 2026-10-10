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

export function VerdictShape({
  verdict,
  x,
  y,
  r = 4.5,
}: {
  verdict: string;
  x: number;
  y: number;
  r?: number;
}) {
  const color = verdictColor(verdict);
  if (verdict === 'good')
    return <circle className="an-pt" cx={x} cy={y} r={r} style={{ fill: color }} />;
  if (verdict === 'bad') {
    const s = r * 0.95;
    return (
      <path
        className="an-pt an-pt-x"
        d={`M${x - s},${y - s}L${x + s},${y + s}M${x + s},${y - s}L${x - s},${y + s}`}
        style={{ stroke: color }}
      />
    );
  }
  if (verdict === 'mixed') {
    const s = r * 1.25;
    return (
      <path
        className="an-pt"
        d={`M${x},${y - s}L${x + s},${y}L${x},${y + s}L${x - s},${y}Z`}
        style={{ fill: color }}
      />
    );
  }
  return (
    <circle className="an-pt an-pt-ring" cx={x} cy={y} r={r - 0.5} style={{ stroke: color }} />
  );
}

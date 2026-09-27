import { useId } from 'react';
import type { VerdictCounts } from '@spark-outpost/contracts';
import { percent, plural, verdictName } from '../analytics-model.ts';
import { Mark, roveMarks } from './Mark.tsx';
import { DotPattern, HatchPattern } from './Patterns.tsx';
import { useChartWidth } from './use-chart-width.ts';

const ORDER = ['good', 'mixed', 'unclear', 'bad'] as const;
const COLORS = {
  good: 'var(--success)',
  mixed: 'var(--warn)',
  unclear: 'var(--muted)',
  bad: 'var(--danger)',
};
const HEIGHT = 22;

export function verdictFill(verdict: (typeof ORDER)[number], ids: { mixed: string; bad: string }) {
  if (verdict === 'mixed') return `url(#${ids.mixed})`;
  if (verdict === 'bad') return `url(#${ids.bad})`;
  if (verdict === 'unclear') return 'var(--panel)';
  return COLORS.good;
}

export function VerdictSwatch({ verdict }: { verdict: (typeof ORDER)[number] }) {
  const base = useId();
  const ids = { mixed: `${base}m`, bad: `${base}b` };
  return (
    <svg width="14" height="14" aria-hidden="true">
      <defs>
        <DotPattern id={ids.mixed} color={COLORS.mixed} />
        <HatchPattern id={ids.bad} color={COLORS.bad} />
      </defs>
      <rect
        x="1"
        y="1"
        width="12"
        height="12"
        rx="3"
        style={{ fill: verdictFill(verdict, ids), stroke: COLORS[verdict] }}
        strokeWidth={verdict === 'good' ? 0 : 1.5}
      />
    </svg>
  );
}

export function VerdictBar({ counts }: { counts: VerdictCounts }) {
  const base = useId();
  const ids = { mixed: `${base}m`, bad: `${base}b` };
  const { ref, width } = useChartWidth<HTMLDivElement>(400, 200);
  const total = ORDER.reduce((sum, key) => sum + counts[key], 0);
  const present = ORDER.filter((key) => counts[key] > 0);
  const room = width - (present.length - 1) * 2;
  const widths = present.map((key) => Math.max(3, (counts[key] / total) * room));
  const starts = widths.map((_, index) =>
    widths.slice(0, index).reduce((sum, w) => sum + w + 2, 0),
  );
  return (
    <div ref={ref} className="an-fill">
      <svg width={width} height={HEIGHT} role="group" aria-label="Outcomes" onKeyDown={roveMarks}>
        <defs>
          <DotPattern id={ids.mixed} color={COLORS.mixed} />
          <HatchPattern id={ids.bad} color={COLORS.bad} />
        </defs>
        {present.map((key, index) => {
          const w = widths[index]!;
          const at = starts[index]!;
          return (
            <Mark
              key={key}
              first={index === 0}
              label={`${verdictName(key)}: ${plural(counts[key], 'turn')} (${percent(counts[key], total)})`}
            >
              <rect className="an-hit" x={at - 2} y={0} width={w + 4} height={HEIGHT} rx={6} />
              <rect
                x={at + 1}
                y={2}
                width={Math.max(1, w - 2)}
                height={HEIGHT - 4}
                rx={4}
                style={{ fill: verdictFill(key, ids), stroke: COLORS[key] }}
                strokeWidth={key === 'good' ? 0 : 1.5}
              />
            </Mark>
          );
        })}
      </svg>
      <ul className="an-legend">
        {ORDER.map((key) => (
          <li key={key}>
            <VerdictSwatch verdict={key} />
            {verdictName(key)} <b>{counts[key]}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
